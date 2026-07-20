import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  assertJsonSafety,
  compileToolContract,
  createApprovalChallenge,
  JsonResourceLimitError,
  policyValidationError,
  rejectAcceptedDecisionByPolicy,
  validateToolCall,
  type GuardPolicy,
  type CompileContractRequest,
  type ActionGateContext,
  type ActionGateDecision,
  type GuardDecision,
  type DriftReport,
  type ValidateRequest,
} from '@schema-guard/core';
import {
  PostgresControlState,
  PostgresActionState,
  PostgresSchemaState,
  PostgresAlertState,
  PostgresIntelligenceState,
  SharedQuotaExceededError,
  SharedRateLimitExceededError,
  SharedStateIntegrityError,
  type ActionState,
  type ControlState,
  type SchemaState,
  type AlertState,
  type IntelligenceState,
  type SharedObservationContext,
  type SharedReservationResult,
} from '@schema-guard/shared-state';
import { dashboardHtml } from './dashboard.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { ManagedError, ManagedStore, normalizedPublicWebhookEndpoint } from './store.js';
import {
  recommendFixes,
  scoreSchemaQuality,
  type ConformanceRun,
  type FailureCluster,
} from './intelligence.js';
import {
  deliverAlertWebhook,
  dispatchAlertWebhooksOnce,
  dispatchSharedAlertWebhooksOnce,
  dispatchCheckpointAnchorsOnce,
  dispatchSharedCheckpointAnchorsOnce,
} from './webhook.js';
import {
  ALL_SCOPES,
  type ActionIdempotencyCheckpoint,
  type ManagedConfig,
  type PlanId,
  type Principal,
  type Scope,
  type SignedRuleSet,
} from './types.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  extra: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...extra,
  });
  response.end(`${JSON.stringify(value)}\n`);
}
async function readBody(request: IncomingMessage, max = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > max) throw new ManagedError(413, 'body_too_large', 'request body exceeds 1 MB');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ManagedError(400, 'invalid_json', 'request body must be valid JSON');
  }
}
function bearer(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length <= 7)
    throw new ManagedError(401, 'authentication_required', 'provide a bearer API key');
  return header.slice(7);
}
async function authenticate(
  store: ManagedStore,
  controlState: ControlState | undefined,
  request: IncomingMessage,
): Promise<Principal> {
  const principal = controlState
    ? ((await controlState.authenticate(bearer(request))) as Principal | undefined)
    : store.authenticate(bearer(request));
  if (!principal) throw new ManagedError(401, 'invalid_api_key', 'API key is invalid or revoked');
  return principal;
}
function pathOf(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://local');
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!object(value))
    throw new ManagedError(400, 'object_required', 'request body must be an object');
  return value;
}
function enforceJsonSafety(value: unknown, label: string): void {
  try {
    assertJsonSafety(value, label);
  } catch (error) {
    if (error instanceof JsonResourceLimitError)
      throw new ManagedError(413, 'resource_limit_exceeded', error.message);
    throw new ManagedError(400, 'invalid_json_value', `${label} must contain only JSON values`);
  }
}
function validateObservationContext(value: unknown): void {
  if (value === undefined) return;
  if (!object(value)) throw new ManagedError(400, 'invalid_context', 'context must be an object');
  const adapter = value.adapter;
  if (
    adapter !== undefined &&
    (typeof adapter !== 'string' ||
      !['json_schema', 'mcp', 'openai_agents', 'pydantic_ai', 'google_adk'].includes(adapter))
  )
    throw new ManagedError(400, 'invalid_context', 'context adapter is unknown');
  for (const key of [
    'tool_version',
    'schema_revision',
    'provider',
    'provider_version',
    'framework',
    'framework_version',
    'environment',
  ]) {
    const item = value[key];
    const maximum = key === 'environment' ? 64 : 128;
    if (
      item !== undefined &&
      (typeof item !== 'string' || item.length === 0 || item.length > maximum)
    )
      throw new ManagedError(
        400,
        'invalid_context',
        `context ${key} must be a non-empty string of at most ${maximum} characters`,
      );
  }
}
function mergePolicy(organization: GuardPolicy, caller: GuardPolicy | undefined): GuardPolicy {
  const merged: GuardPolicy = {};
  if (organization.allowed_repairs && caller?.allowed_repairs)
    merged.allowed_repairs = organization.allowed_repairs.filter((rule) =>
      caller.allowed_repairs!.includes(rule),
    );
  else if (organization.allowed_repairs ?? caller?.allowed_repairs)
    merged.allowed_repairs = [...(organization.allowed_repairs ?? caller!.allowed_repairs!)];
  const limits = [organization.max_repairs, caller?.max_repairs].filter(
    (value): value is number => value !== undefined,
  );
  if (limits.length) merged.max_repairs = Math.min(...limits);
  const denied = new Set([
    ...(organization.deny_argument_paths ?? []),
    ...(caller?.deny_argument_paths ?? []),
  ]);
  if (denied.size) merged.deny_argument_paths = [...denied];
  if (organization.require_closed_schema || caller?.require_closed_schema)
    merged.require_closed_schema = true;
  return merged;
}
function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]!);
  const cell = (value: unknown): string => {
    const rendered = value === null || value === undefined ? '' : (JSON.stringify(value) ?? '');
    return `"${rendered.replaceAll('"', '""')}"`;
  };
  return `${columns.map(cell).join(',')}\n${rows.map((row) => columns.map((column) => cell(row[column])).join(',')).join('\n')}\n`;
}

function sharedReservationDecision(
  gate: ActionGateDecision,
  reservation: SharedReservationResult,
): ActionGateDecision {
  if (reservation.state === 'new') {
    if (!gate.reservation || !reservation.reservation_id)
      throw new ManagedError(
        500,
        'reservation_identity_missing',
        'shared reservation was created without an operator-safe identifier',
      );
    return {
      ...gate,
      reservation: { ...gate.reservation, reservation_id: reservation.reservation_id },
    };
  }
  const withoutReservation: ActionGateDecision = {
    status: gate.status,
    reason_code: gate.reason_code,
    reason: gate.reason,
    execution_fingerprint: gate.execution_fingerprint,
    requires_approval: gate.requires_approval,
    requires_idempotency: gate.requires_idempotency,
  };
  if (reservation.state === 'duplicate')
    return {
      ...withoutReservation,
      status: 'duplicate_blocked',
      reason_code: 'DUPLICATE_EXECUTION',
      reason: 'This idempotency key already reserved the same action; reuse its prior result.',
    };
  return {
    ...withoutReservation,
    status: 'rejected',
    reason_code: 'IDEMPOTENCY_CONFLICT',
    reason: 'This idempotency key is already bound to a different action.',
  };
}

function sharedStateUnavailable(error: unknown): ManagedError {
  const integrityFailure =
    error instanceof SharedStateIntegrityError ||
    (error instanceof Error && error.name === 'SharedStateIntegrityError');
  return new ManagedError(
    503,
    integrityFailure ? 'shared_action_state_integrity_invalid' : 'shared_action_state_unavailable',
    integrityFailure
      ? 'shared action state integrity verification failed; execution is unavailable'
      : 'shared action state is unavailable; execution is unavailable',
  );
}

function sharedControlStateUnavailable(error: unknown): ManagedError {
  if (
    error instanceof SharedRateLimitExceededError ||
    (error instanceof Error && error.name === 'SharedRateLimitExceededError')
  )
    return new ManagedError(429, 'rate_limit_exceeded', 'per-key rate limit exceeded');
  if (
    error instanceof SharedQuotaExceededError ||
    (error instanceof Error && error.name === 'SharedQuotaExceededError')
  )
    return new ManagedError(429, 'monthly_quota_exceeded', 'monthly validation quota exceeded');
  const integrityFailure =
    error instanceof SharedStateIntegrityError ||
    (error instanceof Error && error.name === 'SharedStateIntegrityError');
  return new ManagedError(
    503,
    integrityFailure
      ? 'shared_control_state_integrity_invalid'
      : 'shared_control_state_unavailable',
    integrityFailure
      ? 'shared control state integrity verification failed; authorization is unavailable'
      : 'shared control state is unavailable; authorization is unavailable',
  );
}

function sharedSchemaStateUnavailable(error: unknown): ManagedError {
  if (error instanceof TypeError) {
    if (error.message.includes('environment does not exist'))
      return new ManagedError(404, 'environment_not_found', 'environment does not exist');
    if (error.message.includes('environment already exists'))
      return new ManagedError(409, 'environment_exists', 'environment name already exists');
    if (error.message.includes('registered schema does not exist'))
      return new ManagedError(
        404,
        'registered_schema_not_found',
        'the requested registered schema version does not exist',
      );
    if (error.message.includes('version conflicts'))
      return new ManagedError(
        409,
        'schema_version_conflict',
        'this schema version is already registered with different content or adapter',
      );
    if (error.message.includes('hash mismatch'))
      return new ManagedError(
        409,
        'schema_hash_mismatch',
        'expected_schema_hash does not match the registered schema',
      );
    if (error.message.includes('breaking schema promotion'))
      return new ManagedError(
        409,
        'breaking_schema_promotion_blocked',
        'breaking schema promotion requires allow_breaking and bounded review evidence',
      );
    return new ManagedError(400, 'invalid_shared_schema_request', error.message);
  }
  const integrityFailure =
    error instanceof SharedStateIntegrityError ||
    (error instanceof Error && error.name === 'SharedStateIntegrityError');
  return new ManagedError(
    503,
    integrityFailure ? 'shared_schema_state_integrity_invalid' : 'shared_schema_state_unavailable',
    integrityFailure
      ? 'shared schema state integrity verification failed; schema admission is unavailable'
      : 'shared schema state is unavailable; schema admission is unavailable',
  );
}

function sharedAlertStateUnavailable(error: unknown): ManagedError {
  if (error instanceof TypeError) {
    if (error.message.includes('conflicts with an existing webhook'))
      return new ManagedError(409, 'webhook_conflict', 'webhook label or endpoint already exists');
    return new ManagedError(400, 'invalid_shared_alert_request', error.message);
  }
  const integrityFailure =
    error instanceof SharedStateIntegrityError ||
    (error instanceof Error && error.name === 'SharedStateIntegrityError');
  return new ManagedError(
    503,
    integrityFailure ? 'shared_alert_state_integrity_invalid' : 'shared_alert_state_unavailable',
    integrityFailure
      ? 'shared alert state integrity verification failed; alert workflows are unavailable'
      : 'shared alert state is unavailable; alert workflows are unavailable',
  );
}

function sharedIntelligenceStateUnavailable(error: unknown): ManagedError {
  if (error instanceof TypeError) {
    if (error.message.includes('version conflicts'))
      return new ManagedError(409, 'ruleset_version_conflict', error.message);
    return new ManagedError(400, 'invalid_shared_intelligence_request', error.message);
  }
  const integrityFailure =
    error instanceof SharedStateIntegrityError ||
    (error instanceof Error && error.name === 'SharedStateIntegrityError');
  return new ManagedError(
    503,
    integrityFailure
      ? 'shared_intelligence_state_integrity_invalid'
      : 'shared_intelligence_state_unavailable',
    integrityFailure
      ? 'shared intelligence integrity verification failed; intelligence workflows are unavailable'
      : 'shared intelligence state is unavailable; intelligence workflows are unavailable',
  );
}

export function createManagedServer(
  config: ManagedConfig,
  dependencies: {
    checkpointAnchorDeliver?: typeof deliverAlertWebhook;
    actionState?: ActionState;
    controlState?: ControlState;
    schemaState?: SchemaState;
    alertState?: AlertState;
    intelligenceState?: IntelligenceState;
  } = {},
) {
  validateManagedConfig(config);
  const store = new ManagedStore(config);
  const alertState =
    dependencies.alertState ??
    (config.sharedControlDatabaseUrl
      ? new PostgresAlertState(
          config.sharedControlDatabaseUrl,
          config.masterSecret,
          undefined,
          config.alertWebhookMaxAttempts ?? 8,
        )
      : undefined);
  const transactionalAlertWriter =
    alertState instanceof PostgresAlertState ? alertState : undefined;
  const actionState =
    dependencies.actionState ??
    (config.sharedActionDatabaseUrl
      ? new PostgresActionState(config.sharedActionDatabaseUrl, config.masterSecret, undefined, {
          checkpointAnchoring: Boolean(config.actionCheckpointAnchorUrl),
          checkpointAnchorMaxAttempts: config.actionCheckpointAnchorMaxAttempts ?? 8,
          ...(transactionalAlertWriter &&
          config.sharedActionDatabaseUrl === config.sharedControlDatabaseUrl
            ? { alertWriter: transactionalAlertWriter }
            : {}),
        })
      : undefined);
  const transactionalAcceptedDecisionWriter =
    dependencies.actionState === undefined &&
    actionState instanceof PostgresActionState &&
    config.sharedActionDatabaseUrl === config.sharedControlDatabaseUrl
      ? actionState
      : undefined;
  const intelligenceState =
    dependencies.intelligenceState ??
    (config.sharedControlDatabaseUrl
      ? new PostgresIntelligenceState(config.sharedControlDatabaseUrl, config.masterSecret)
      : undefined);
  const transactionalIntelligenceWriter =
    intelligenceState instanceof PostgresIntelligenceState ? intelligenceState : undefined;
  const controlState =
    dependencies.controlState ??
    (config.sharedControlDatabaseUrl
      ? new PostgresControlState(config.sharedControlDatabaseUrl, config.masterSecret, undefined, {
          ...(transactionalAlertWriter ? { alertWriter: transactionalAlertWriter } : {}),
          ...(transactionalIntelligenceWriter
            ? { intelligenceWriter: transactionalIntelligenceWriter }
            : {}),
          ...(transactionalAcceptedDecisionWriter
            ? { acceptedDecisionWriter: transactionalAcceptedDecisionWriter }
            : {}),
        })
      : undefined);
  const schemaState =
    dependencies.schemaState ??
    (config.sharedControlDatabaseUrl
      ? new PostgresSchemaState(config.sharedControlDatabaseUrl, config.masterSecret, undefined, {
          ...(transactionalAlertWriter ? { alertWriter: transactionalAlertWriter } : {}),
        })
      : undefined);
  const limiter = new FixedWindowRateLimiter(config.rateLimitPerMinute ?? 120);
  let draining = false;
  let actionStateInitialized = actionState === undefined;
  let actionStateInitializationFailed = false;
  const actionStateInitialization = actionState
    ? actionState
        .migrate()
        .then(() => {
          actionStateInitialized = true;
        })
        .catch(() => {
          actionStateInitializationFailed = true;
        })
    : Promise.resolve();
  let controlStateInitialized = controlState === undefined;
  let controlStateInitializationFailed = false;
  const controlStateInitialization = controlState
    ? controlState
        .migrate()
        .then(() => {
          controlStateInitialized = true;
        })
        .catch(() => {
          controlStateInitializationFailed = true;
        })
    : Promise.resolve();
  let schemaStateInitialized = schemaState === undefined;
  let schemaStateInitializationFailed = false;
  const schemaStateInitialization = schemaState
    ? (async () => {
        await controlStateInitialization;
        if (controlStateInitializationFailed)
          throw new Error('shared control state initialization failed');
        await schemaState.migrate();
        schemaStateInitialized = true;
      })().catch(() => {
        schemaStateInitializationFailed = true;
      })
    : Promise.resolve();
  let alertStateInitialized = alertState === undefined;
  let alertStateInitializationFailed = false;
  const alertStateInitialization = alertState
    ? (async () => {
        await controlStateInitialization;
        if (controlStateInitializationFailed)
          throw new Error('shared control state initialization failed');
        await alertState.migrate();
        alertStateInitialized = true;
      })().catch(() => {
        alertStateInitializationFailed = true;
      })
    : Promise.resolve();
  let intelligenceStateInitialized = intelligenceState === undefined;
  let intelligenceStateInitializationFailed = false;
  const intelligenceStateInitialization = intelligenceState
    ? (async () => {
        await controlStateInitialization;
        if (controlStateInitializationFailed)
          throw new Error('shared control state initialization failed');
        await intelligenceState.migrate();
        intelligenceStateInitialized = true;
      })().catch(() => {
        intelligenceStateInitializationFailed = true;
      })
    : Promise.resolve();
  let webhookDispatch: Promise<void> | undefined;
  let checkpointAnchorDispatch: Promise<void> | undefined;
  const runWebhookDispatch = (): Promise<void> => {
    if (webhookDispatch) return webhookDispatch;
    webhookDispatch = (
      alertState
        ? alertStateInitialization.then(async () => {
            if (alertStateInitializationFailed) throw sharedAlertStateUnavailable(undefined);
            return dispatchSharedAlertWebhooksOnce(alertState, {
              timeoutMs: config.alertWebhookRequestTimeoutMs ?? 5_000,
            });
          })
        : dispatchAlertWebhooksOnce(store, {
            timeoutMs: config.alertWebhookRequestTimeoutMs ?? 5_000,
          })
    )
      .then(() => undefined)
      .finally(() => {
        webhookDispatch = undefined;
      });
    return webhookDispatch;
  };
  const webhookTimer = setInterval(
    () => void runWebhookDispatch().catch(() => undefined),
    config.alertWebhookPollIntervalMs ?? 5_000,
  );
  webhookTimer.unref();
  const runCheckpointAnchorDispatch = (batchSize = 25): Promise<void> => {
    if (checkpointAnchorDispatch) return checkpointAnchorDispatch;
    checkpointAnchorDispatch = (async () => {
      await actionStateInitialization;
      if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
      const options = {
        timeoutMs: config.actionCheckpointAnchorRequestTimeoutMs ?? 5_000,
        batchSize,
        ...(dependencies.checkpointAnchorDeliver
          ? { deliver: dependencies.checkpointAnchorDeliver }
          : {}),
      };
      if (
        actionState &&
        config.actionCheckpointAnchorUrl &&
        config.actionCheckpointAnchorSigningSecret
      )
        await dispatchSharedCheckpointAnchorsOnce(
          actionState,
          config.actionCheckpointAnchorUrl,
          config.actionCheckpointAnchorSigningSecret,
          options,
        );
      else await dispatchCheckpointAnchorsOnce(store, options);
    })()
      .then(() => undefined)
      .finally(() => {
        checkpointAnchorDispatch = undefined;
      });
    return checkpointAnchorDispatch;
  };
  const checkpointAnchorTimer = setInterval(
    () => void runCheckpointAnchorDispatch().catch(() => undefined),
    config.actionCheckpointAnchorPollIntervalMs ?? 5_000,
  );
  checkpointAnchorTimer.unref();
  const actionCheckpointAcknowledged = async (principal: Principal): Promise<boolean> => {
    if (!actionState) return store.actionCheckpointAnchorAcknowledged(principal);
    try {
      return await actionState.checkpointAnchorAcknowledged(principal.tenantId);
    } catch (error) {
      throw sharedStateUnavailable(error);
    }
  };
  const publicResponseHeaders = config.publicMode
    ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
    : {};
  const sendJson = (
    response: ServerResponse,
    status: number,
    value: unknown,
    extra: Record<string, string> = {},
  ): void => {
    json(response, status, value, { ...publicResponseHeaders, ...extra });
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!response.headersSent)
        sendJson(response, 503, {
          error: 'request_timeout',
          message: 'request exceeded the local service deadline',
        });
      else response.destroy();
      if (!request.destroyed) request.destroy();
    }, config.requestTimeoutMs ?? 10_000);
    const guardedBody = async (): Promise<unknown> => {
      const value = await readBody(request);
      if (timedOut)
        throw new ManagedError(
          503,
          'request_timeout',
          'request exceeded the local service deadline',
        );
      return value;
    };
    try {
      const url = pathOf(request);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/readyz') {
        await Promise.all([
          actionStateInitialization,
          controlStateInitialization,
          schemaStateInitialization,
          alertStateInitialization,
          intelligenceStateInitialization,
        ]);
        const sharedAvailable =
          actionState === undefined ||
          (!actionStateInitializationFailed &&
            actionStateInitialized &&
            (await actionState.ready()));
        const sharedControlAvailable =
          controlState === undefined ||
          (!controlStateInitializationFailed &&
            controlStateInitialized &&
            (await controlState.ready()));
        const sharedSchemaAvailable =
          schemaState === undefined ||
          (!schemaStateInitializationFailed &&
            schemaStateInitialized &&
            (await schemaState.ready()));
        const sharedAlertAvailable =
          alertState === undefined ||
          (!alertStateInitializationFailed && alertStateInitialized && (await alertState.ready()));
        const sharedIntelligenceAvailable =
          intelligenceState === undefined ||
          (!intelligenceStateInitializationFailed &&
            intelligenceStateInitialized &&
            (await intelligenceState.ready()));
        const available =
          !draining &&
          store.readinessCheck() &&
          sharedAvailable &&
          sharedControlAvailable &&
          sharedSchemaAvailable &&
          sharedAlertAvailable &&
          sharedIntelligenceAvailable;
        sendJson(response, available ? 200 : 503, {
          status: available
            ? 'ready'
            : draining
              ? 'draining'
              : controlStateInitializationFailed || !sharedControlAvailable
                ? 'shared_control_state_unavailable'
                : schemaStateInitializationFailed || !sharedSchemaAvailable
                  ? 'shared_schema_state_unavailable'
                  : alertStateInitializationFailed || !sharedAlertAvailable
                    ? 'shared_alert_state_unavailable'
                    : intelligenceStateInitializationFailed || !sharedIntelligenceAvailable
                      ? 'shared_intelligence_state_unavailable'
                      : actionStateInitializationFailed || !sharedAvailable
                        ? 'shared_action_state_unavailable'
                        : 'database_unavailable',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/dashboard') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          ...publicResponseHeaders,
        });
        response.end(dashboardHtml);
        return;
      }
      await controlStateInitialization;
      if (controlStateInitializationFailed) throw sharedControlStateUnavailable(undefined);
      await schemaStateInitialization;
      if (schemaStateInitializationFailed) throw sharedSchemaStateUnavailable(undefined);
      await alertStateInitialization;
      if (alertStateInitializationFailed) throw sharedAlertStateUnavailable(undefined);
      await intelligenceStateInitialization;
      if (intelligenceStateInitializationFailed)
        throw sharedIntelligenceStateUnavailable(undefined);
      let principal: Principal;
      try {
        principal = await authenticate(store, controlState, request);
      } catch (error) {
        if (error instanceof ManagedError) throw error;
        throw sharedControlStateUnavailable(error);
      }
      if (controlState) {
        try {
          await controlState.consumeRateLimit(
            principal.tenantId,
            principal.keyId,
            config.rateLimitPerMinute ?? 120,
          );
        } catch (error) {
          throw sharedControlStateUnavailable(error);
        }
      } else limiter.consume(principal);
      if (request.method === 'POST' && url.pathname === '/v1/validate') {
        store.requireScope(principal, 'validate');
        const input = asRecord(await guardedBody());
        const validationRequest = input as unknown as ValidateRequest;
        validateObservationContext(input.context);
        const callerPolicyError = policyValidationError(validationRequest.policy);
        if (callerPolicyError) throw new ManagedError(400, 'invalid_policy', callerPolicyError);
        let environmentPolicy: GuardPolicy = {};
        if (validationRequest.context?.environment) {
          try {
            environmentPolicy = schemaState
              ? await schemaState.environmentPolicy(
                  principal.tenantId,
                  validationRequest.context.environment,
                )
              : store.environmentPolicy(principal, validationRequest.context.environment);
          } catch (error) {
            if (error instanceof ManagedError) throw error;
            throw schemaState
              ? sharedSchemaStateUnavailable(error)
              : new ManagedError(500, 'internal_error', 'environment policy lookup failed closed');
          }
        }
        validationRequest.policy = mergePolicy(
          mergePolicy(principal.policy, environmentPolicy),
          validationRequest.policy,
        );
        let evaluated = validateToolCall(validationRequest);
        if (
          evaluated.decision !== 'rejected' &&
          validationRequest.context?.environment &&
          typeof validationRequest.tool_name === 'string' &&
          (typeof validationRequest.tool_schema === 'boolean' ||
            object(validationRequest.tool_schema))
        ) {
          let admission;
          try {
            admission = schemaState
              ? await schemaState.schemaAdmission(
                  principal.tenantId,
                  validationRequest.context.environment,
                  validationRequest.tool_name,
                  validationRequest.tool_schema,
                )
              : store.schemaAdmission(
                  principal,
                  validationRequest.context.environment,
                  validationRequest.tool_name,
                  validationRequest.tool_schema,
                );
          } catch (error) {
            if (error instanceof ManagedError) throw error;
            throw sharedSchemaStateUnavailable(error);
          }
          if (!admission.allowed)
            evaluated = rejectAcceptedDecisionByPolicy(evaluated, {
              policy_id: 'managed.schema_release_admission.v1',
              policy_reasons: [`managed.${admission.reason ?? 'schema_release_denied'}`],
              reason: `tool schema is not admitted in environment ${admission.environment}`,
              repair_hint:
                'register and promote the exact schema, or switch the environment to observe mode during rollout',
            });
        }
        let decision: GuardDecision;
        if (controlState) {
          const scoped = store.scopeValidationForSharedState(principal, evaluated);
          try {
            await controlState.recordValidation(
              principal.tenantId,
              scoped,
              validationRequest.context as SharedObservationContext | undefined,
            );
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
          store.recordScopedValidationAfterSharedState(
            principal,
            scoped,
            validationRequest.context,
            !controlState.recordsValidationIntelligence,
          );
          decision = scoped;
        } else decision = store.recordValidation(principal, evaluated, validationRequest.context);
        if (intelligenceState && (!controlState || !controlState.recordsValidationIntelligence))
          await intelligenceState
            .recordObservation(
              principal.tenantId,
              decision,
              validationRequest.context as SharedObservationContext | undefined,
            )
            .catch((error: unknown) => {
              throw sharedIntelligenceStateUnavailable(error);
            });
        if (
          actionState &&
          decision.decision !== 'rejected' &&
          !controlState?.recordsAcceptedActionDecisions
        ) {
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            await actionState.recordAcceptedDecision(principal.tenantId, decision);
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        }
        if (
          alertState &&
          decision.decision === 'rejected' &&
          !controlState?.recordsValidationAlerts
        ) {
          try {
            await alertState.recordAlert(
              principal.tenantId,
              'validation_rejected',
              'warning',
              { audit_id: decision.audit_id, reason_code: decision.reason_code },
              `validation:${decision.audit_id}`,
            );
          } catch (error) {
            throw sharedAlertStateUnavailable(error);
          }
        }
        sendJson(response, decision.decision === 'rejected' ? 422 : 200, decision);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/contracts/compile') {
        store.requireScope(principal, 'compile');
        const input = asRecord(await guardedBody());
        const known = new Set([
          'target',
          'tool_name',
          'tool_schema',
          'description',
          'target_version',
          'openai_strict_policy',
        ]);
        if (Object.keys(input).some((key) => !known.has(key)))
          throw new ManagedError(
            400,
            'invalid_compile_request',
            'compile request contains unknown fields',
          );
        if (
          !['openai', 'anthropic', 'google_gemini', 'mcp'].includes(String(input.target)) ||
          typeof input.tool_name !== 'string' ||
          input.tool_name.length === 0 ||
          input.tool_name.length > 64 ||
          (!object(input.tool_schema) && typeof input.tool_schema !== 'boolean') ||
          (input.description !== undefined &&
            (typeof input.description !== 'string' || input.description.length > 8_192)) ||
          (input.target_version !== undefined &&
            (typeof input.target_version !== 'string' ||
              input.target_version.length === 0 ||
              input.target_version.length > 128)) ||
          (input.openai_strict_policy !== undefined &&
            input.openai_strict_policy !== 'reject' &&
            input.openai_strict_policy !== 'normalize')
        )
          throw new ManagedError(
            400,
            'invalid_compile_request',
            'target, tool_name, and tool_schema must form a bounded compile request',
          );
        enforceJsonSafety(input.tool_schema, 'canonical contract schema');
        const compiled = compileToolContract(input as unknown as CompileContractRequest);
        sendJson(response, compiled.status === 'unsupported' ? 422 : 200, compiled);
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/v1/admin/actions/descriptors') {
        const input = asRecord(await guardedBody());
        if (
          typeof input.tool_name !== 'string' ||
          typeof input.environment !== 'string' ||
          !['read', 'low', 'medium', 'high', 'critical'].includes(String(input.risk_level)) ||
          !['none', 'reversible', 'irreversible'].includes(String(input.side_effect))
        )
          throw new ManagedError(
            400,
            'invalid_action_descriptor',
            'tool_name, environment, risk_level, and side_effect are required',
          );
        store.requireScope(principal, 'admin');
        let descriptor;
        if (actionState) {
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            descriptor = await actionState.upsertActionDescriptor(
              principal.tenantId,
              input.tool_name,
              input.environment,
              input.risk_level as 'read' | 'low' | 'medium' | 'high' | 'critical',
              input.side_effect as 'none' | 'reversible' | 'irreversible',
            );
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        } else
          descriptor = store.registerActionDescriptor(
            principal,
            input.tool_name,
            input.environment,
            input.risk_level as 'read' | 'low' | 'medium' | 'high' | 'critical',
            input.side_effect as 'none' | 'reversible' | 'irreversible',
          );
        sendJson(response, 200, descriptor);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/actions/challenges') {
        store.requireScope(principal, 'evaluate:action');
        const input = asRecord(await guardedBody());
        enforceJsonSafety(input, 'action challenge request');
        if (
          typeof input.tool_name !== 'string' ||
          typeof input.environment !== 'string' ||
          !object(input.decision) ||
          !Number.isInteger(input.expires_in_seconds) ||
          Number(input.expires_in_seconds) < 60 ||
          Number(input.expires_in_seconds) > 86_400
        )
          throw new ManagedError(
            400,
            'invalid_action_challenge',
            'tool_name, environment, accepted decision, and expires_in_seconds 60-86400 are required',
          );
        const decision = input.decision as unknown as GuardDecision;
        let action: Awaited<ReturnType<ActionState['actionDescriptor']>>;
        if (actionState) {
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            if (
              !(await actionState.verifyAcceptedDecision(
                principal.tenantId,
                decision,
                input.tool_name,
              ))
            )
              throw new ManagedError(
                409,
                'action_decision_invalid',
                'action decision does not match a stored accepted audit',
              );
            action = await actionState.actionDescriptor(
              principal.tenantId,
              input.tool_name,
              input.environment,
            );
          } catch (error) {
            if (error instanceof ManagedError) throw error;
            if (error instanceof TypeError)
              throw new ManagedError(
                403,
                'action_descriptor_required',
                'tool action risk must be registered by an administrator before evaluation',
              );
            throw sharedStateUnavailable(error);
          }
        } else {
          if (!store.verifyActionDecision(principal, decision, input.tool_name))
            throw new ManagedError(
              409,
              'action_decision_invalid',
              'action decision does not match a stored accepted audit',
            );
          action = store.actionDescriptor(principal, input.tool_name, input.environment);
        }
        const createdAt = new Date();
        const challenge = createApprovalChallenge({
          decision,
          action,
          environment: action.environment,
          created_at: createdAt.toISOString(),
          expires_at: new Date(
            createdAt.getTime() + Number(input.expires_in_seconds) * 1_000,
          ).toISOString(),
        });
        if (actionState) {
          try {
            await actionState.recordActionChallenge(principal.tenantId, challenge);
          } catch (error) {
            if (error instanceof TypeError)
              throw new ManagedError(409, 'approval_challenge_invalid', error.message);
            throw sharedStateUnavailable(error);
          }
        } else store.recordActionChallenge(principal, challenge);
        sendJson(response, 201, challenge);
        return;
      }
      if (
        request.method === 'POST' &&
        url.pathname.startsWith('/v1/actions/challenges/') &&
        url.pathname.endsWith('/approve')
      ) {
        const challengeId = decodeURIComponent(
          url.pathname.slice('/v1/actions/challenges/'.length, -'/approve'.length),
        );
        if (actionState) {
          store.requireScope(principal, 'approve:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            sendJson(
              response,
              200,
              await actionState.approveActionChallenge(
                principal.tenantId,
                challengeId,
                principal.keyId,
              ),
            );
          } catch (error) {
            if (error instanceof TypeError)
              throw new ManagedError(409, 'approval_challenge_invalid', error.message);
            throw sharedStateUnavailable(error);
          }
        } else sendJson(response, 200, store.approveActionChallenge(principal, challengeId));
        return;
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/v1/actions/challenges/')) {
        const challengeId = decodeURIComponent(
          url.pathname.slice('/v1/actions/challenges/'.length),
        );
        if (actionState) {
          store.requireScope(principal, 'approve:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            if (!(await actionState.revokeActionChallenge(principal.tenantId, challengeId)))
              throw new ManagedError(
                404,
                'approval_challenge_not_found',
                'approval challenge not found',
              );
          } catch (error) {
            if (error instanceof ManagedError) throw error;
            throw sharedStateUnavailable(error);
          }
        } else store.revokeActionChallenge(principal, challengeId);
        sendJson(response, 200, { revoked: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/actions/evaluate') {
        const input = asRecord(await guardedBody());
        enforceJsonSafety(input, 'action evaluation request');
        if (
          typeof input.tool_name !== 'string' ||
          typeof input.environment !== 'string' ||
          !object(input.decision) ||
          (input.approval !== undefined && !object(input.approval)) ||
          (input.idempotency_key !== undefined && typeof input.idempotency_key !== 'string')
        )
          throw new ManagedError(
            400,
            'invalid_action_evaluation',
            'tool_name, environment, accepted decision, and optional approval/idempotency key are required',
          );
        const context: Omit<ActionGateContext, 'environment'> = {
          ...(input.approval
            ? { approval: input.approval as unknown as NonNullable<ActionGateContext['approval']> }
            : {}),
          ...(typeof input.idempotency_key === 'string'
            ? { idempotency_key: input.idempotency_key }
            : {}),
        };
        let gate: ActionGateDecision;
        if (actionState) {
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          let trustedAction: Awaited<ReturnType<ActionState['actionDescriptor']>>;
          let approvalAlreadyVerified = false;
          try {
            if (
              !(await actionState.verifyAcceptedDecision(
                principal.tenantId,
                input.decision as unknown as GuardDecision,
                input.tool_name,
              ))
            )
              throw new ManagedError(
                409,
                'action_decision_invalid',
                'action decision does not match a stored accepted audit',
              );
            trustedAction = await actionState.actionDescriptor(
              principal.tenantId,
              input.tool_name,
              input.environment,
            );
            if (context.approval) {
              approvalAlreadyVerified = await actionState.verifyRecordedApproval(
                principal.tenantId,
                context.approval,
              );
              if (!approvalAlreadyVerified)
                throw new ManagedError(
                  409,
                  'approval_evidence_unrecognized',
                  'approval evidence is not an approved tenant challenge',
                );
            }
          } catch (error) {
            if (error instanceof ManagedError) throw error;
            if (error instanceof TypeError)
              throw new ManagedError(
                403,
                'action_descriptor_required',
                'tool action risk must be registered by an administrator before evaluation',
              );
            throw sharedStateUnavailable(error);
          }
          gate = store.evaluateManagedActionPreflightForSharedState({
            principal,
            decision: input.decision as unknown as GuardDecision,
            toolName: input.tool_name,
            environment: input.environment,
            context,
            trustedAction,
            approvalAlreadyVerified,
          });
          if (
            gate.status === 'allowed' &&
            gate.reservation &&
            typeof input.idempotency_key === 'string'
          ) {
            try {
              gate = sharedReservationDecision(
                gate,
                await actionState.reserve(
                  principal.tenantId,
                  input.idempotency_key,
                  gate.execution_fingerprint,
                  {
                    auditId: (input.decision as unknown as GuardDecision).audit_id,
                    toolNameHash: (input.decision as unknown as GuardDecision).audit.tool_name_hash,
                    environment: input.environment,
                  },
                ),
              );
            } catch (error) {
              if (error instanceof ManagedError) throw error;
              throw sharedStateUnavailable(error);
            }
          }
        } else
          gate = store.evaluateManagedActionForServer({
            principal,
            decision: input.decision as unknown as GuardDecision,
            toolName: input.tool_name,
            environment: input.environment,
            context,
          });
        if (gate.status === 'allowed' && gate.reservation && config.actionCheckpointAnchorUrl) {
          for (
            let attempt = 0;
            attempt < 4 && !(await actionCheckpointAcknowledged(principal));
            attempt += 1
          )
            await runCheckpointAnchorDispatch(100);
          const acknowledged = await actionCheckpointAcknowledged(principal);
          if (!acknowledged)
            throw new ManagedError(
              503,
              'checkpoint_anchor_unacknowledged',
              'the independent checkpoint receiver did not acknowledge the reservation; execution is unavailable and the reservation remains pending',
            );
        }
        sendJson(response, 200, gate);
        return;
      }
      if (
        request.method === 'POST' &&
        (url.pathname === '/v1/actions/idempotency/complete' ||
          url.pathname === '/v1/actions/idempotency/release')
      ) {
        store.requireScope(principal, 'evaluate:action');
        const input = asRecord(await guardedBody());
        if (
          typeof input.idempotency_key !== 'string' ||
          input.idempotency_key.length < 8 ||
          input.idempotency_key.length > 256 ||
          typeof input.execution_fingerprint !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(input.execution_fingerprint)
        )
          throw new ManagedError(
            400,
            'invalid_idempotency_transition',
            'idempotency_key and execution_fingerprint are required',
          );
        if (actionState) {
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            if (url.pathname.endsWith('/complete'))
              await actionState.complete(
                principal.tenantId,
                input.idempotency_key,
                input.execution_fingerprint,
              );
            else
              await actionState.release(
                principal.tenantId,
                input.idempotency_key,
                input.execution_fingerprint,
              );
          } catch (error) {
            if (error instanceof TypeError)
              throw new ManagedError(
                409,
                'idempotency_transition_invalid',
                'idempotency transition did not match a pending shared reservation',
              );
            throw sharedStateUnavailable(error);
          }
        } else {
          const ledger = store.actionIdempotencyLedger(principal);
          if (url.pathname.endsWith('/complete'))
            ledger.complete(input.idempotency_key, input.execution_fingerprint);
          else ledger.release(input.idempotency_key, input.execution_fingerprint);
        }
        sendJson(response, 200, { updated: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/actions/idempotency/checkpoint') {
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            sendJson(response, 200, await actionState.checkpoint(principal.tenantId));
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        } else sendJson(response, 200, store.actionIdempotencyCheckpoint(principal));
        return;
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/v1/actions/idempotency/checkpoint/compare'
      ) {
        const input = asRecord(await guardedBody());
        if (!object(input.checkpoint))
          throw new ManagedError(
            400,
            'invalid_checkpoint_comparison',
            'checkpoint object is required',
          );
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            sendJson(
              response,
              200,
              await actionState.compareCheckpoint(
                principal.tenantId,
                input.checkpoint as unknown as ActionIdempotencyCheckpoint,
              ),
            );
          } catch (error) {
            if (error instanceof TypeError)
              throw new ManagedError(
                409,
                'anchored_checkpoint_invalid',
                'the externally retained shared idempotency checkpoint is invalid for this tenant',
              );
            throw sharedStateUnavailable(error);
          }
        } else
          sendJson(
            response,
            200,
            store.compareActionIdempotencyCheckpoint(
              principal,
              input.checkpoint as unknown as ActionIdempotencyCheckpoint,
            ),
          );
        return;
      }
      if (
        request.method === 'GET' &&
        url.pathname === '/v1/actions/idempotency/anchors/deliveries'
      ) {
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            sendJson(response, 200, {
              deliveries: await actionState.listCheckpointAnchorDeliveries(
                principal.tenantId,
                Number(url.searchParams.get('limit') ?? 100),
              ),
            });
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        } else
          sendJson(response, 200, {
            deliveries: store.listCheckpointAnchorDeliveries(
              principal,
              Number(url.searchParams.get('limit') ?? 100),
            ),
          });
        return;
      }
      if (
        request.method === 'POST' &&
        url.pathname.startsWith('/v1/actions/idempotency/anchors/deliveries/') &&
        url.pathname.endsWith('/redrive')
      ) {
        const deliveryId = decodeURIComponent(
          url.pathname.slice(
            '/v1/actions/idempotency/anchors/deliveries/'.length,
            -'/redrive'.length,
          ),
        );
        let redriven: boolean;
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            redriven = await actionState.redriveCheckpointAnchorDelivery(
              principal.tenantId,
              deliveryId,
            );
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        } else redriven = store.redriveCheckpointAnchorDelivery(principal, deliveryId);
        if (!redriven)
          throw new ManagedError(
            409,
            'anchor_delivery_not_redrivable',
            'checkpoint anchor delivery is not dead, missing, or anchoring is not configured',
          );
        void runCheckpointAnchorDispatch().catch(() => undefined);
        sendJson(response, 200, { redriven: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/actions/reconciliation/pending') {
        const requestedAge = url.searchParams.get('older_than_seconds');
        const olderThanSeconds = requestedAge === null ? undefined : Number(requestedAge);
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          const minimum = config.actionReconciliationMinAgeSeconds ?? 300;
          const selectedAge = olderThanSeconds ?? minimum;
          if (!Number.isInteger(selectedAge) || selectedAge < minimum || selectedAge > 2_592_000)
            throw new ManagedError(
              400,
              'invalid_reconciliation_age',
              `older_than_seconds must be an integer from ${minimum} through 2592000`,
            );
          try {
            sendJson(response, 200, {
              pending: await actionState.pending(principal.tenantId, selectedAge),
            });
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        } else
          sendJson(response, 200, {
            pending: store.pendingActionReservations(principal, olderThanSeconds),
          });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/actions/reconciliation/history') {
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            sendJson(response, 200, {
              reconciliations: await actionState.reconciliationHistory(principal.tenantId),
            });
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        } else
          sendJson(response, 200, {
            reconciliations: store.actionReconciliationHistory(principal),
          });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/actions/reconciliation/verify') {
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            sendJson(response, 200, await actionState.verifyReconciliations(principal.tenantId));
          } catch (error) {
            throw sharedStateUnavailable(error);
          }
        } else sendJson(response, 200, store.verifyActionReconciliationHistory(principal));
        return;
      }
      if (request.method === 'POST' && url.pathname.startsWith('/v1/actions/reconciliation/')) {
        const reservationId = decodeURIComponent(
          url.pathname.slice('/v1/actions/reconciliation/'.length),
        );
        const input = asRecord(await guardedBody());
        if (
          !['confirmed_executed', 'confirmed_not_executed'].includes(String(input.outcome)) ||
          typeof input.evidence_reference !== 'string'
        )
          throw new ManagedError(
            400,
            'invalid_action_reconciliation',
            'outcome and evidence_reference are required',
          );
        if (actionState) {
          store.requireScope(principal, 'reconcile:action');
          await actionStateInitialization;
          if (actionStateInitializationFailed) throw sharedStateUnavailable(undefined);
          try {
            const reconciliation = await actionState.reconcile(
              principal.tenantId,
              reservationId,
              input.outcome as 'confirmed_executed' | 'confirmed_not_executed',
              input.evidence_reference,
              principal.keyId,
              config.actionReconciliationMinAgeSeconds ?? 300,
            );
            if (alertState && !actionState.recordsReconciliationAlerts)
              await alertState.recordAlert(
                principal.tenantId,
                'action_reconciled',
                'critical',
                {
                  reservation_id: reconciliation.reservation_id,
                  reconciliation_id: reconciliation.reconciliation_id,
                  audit_id: reconciliation.audit_id,
                  outcome: reconciliation.outcome,
                  evidence_hash: reconciliation.evidence_hash,
                },
                `action-reconciliation:${reconciliation.reconciliation_id}`,
              );
            sendJson(response, 200, reconciliation);
          } catch (error) {
            if (
              error instanceof SharedStateIntegrityError ||
              (error instanceof Error && error.name === 'SharedStateIntegrityError')
            )
              throw sharedStateUnavailable(error);
            if (error instanceof TypeError)
              throw new ManagedError(409, 'shared_action_reconciliation_invalid', error.message);
            throw sharedStateUnavailable(error);
          }
        } else
          sendJson(
            response,
            200,
            store.reconcileActionReservation(
              principal,
              reservationId,
              input.outcome as 'confirmed_executed' | 'confirmed_not_executed',
              input.evidence_reference,
            ),
          );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/schemas') {
        store.requireScope(principal, 'write:schema');
        const input = asRecord(await guardedBody());
        if (
          typeof input.tool_name !== 'string' ||
          input.tool_name.length === 0 ||
          input.tool_name.length > 256 ||
          typeof input.adapter !== 'string' ||
          !['json_schema', 'mcp', 'openai_agents', 'pydantic_ai', 'google_adk'].includes(
            input.adapter,
          ) ||
          typeof input.version !== 'string' ||
          input.version.length === 0 ||
          input.version.length > 128 ||
          (!object(input.schema) && typeof input.schema !== 'boolean')
        )
          throw new ManagedError(
            400,
            'invalid_schema_registration',
            'tool_name, adapter, version, and schema are required',
          );
        enforceJsonSafety(input.schema, 'registered schema');
        const schemaInput = {
          tool_name: input.tool_name,
          adapter: input.adapter,
          version: input.version,
          schema: input.schema,
        };
        let registration;
        try {
          registration = schemaState
            ? await schemaState.registerSchema(principal.tenantId, schemaInput)
            : store.registerSchema(principal, schemaInput);
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        const registrationDrift = registration.drift as DriftReport | null;
        if (
          controlState &&
          registration.drift &&
          typeof registration.drift === 'object' &&
          'changed' in registration.drift &&
          registration.drift.changed === true
        ) {
          try {
            await controlState.recordDrift(principal.tenantId);
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
        }
        if (
          alertState &&
          !schemaState?.recordsSchemaAlerts &&
          registrationDrift?.changed &&
          registrationDrift.compatibility === 'breaking'
        ) {
          try {
            await alertState.recordAlert(
              principal.tenantId,
              'breaking_schema_drift',
              'critical',
              {
                changes: registrationDrift.changes.map((change) => change.kind),
              },
              `schema-drift:${input.tool_name}:${input.version}:${registration.schema_hash}`,
            );
          } catch (error) {
            throw sharedAlertStateUnavailable(error);
          }
        }
        sendJson(response, 201, registration);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/schema-releases') {
        store.requireScope(principal, 'promote:schema');
        const input = asRecord(await guardedBody());
        if (
          typeof input.tool_name !== 'string' ||
          typeof input.version !== 'string' ||
          typeof input.environment !== 'string' ||
          typeof input.expected_schema_hash !== 'string' ||
          (input.allow_breaking !== undefined && typeof input.allow_breaking !== 'boolean') ||
          (input.evidence_reference !== undefined && typeof input.evidence_reference !== 'string')
        )
          throw new ManagedError(
            400,
            'invalid_schema_promotion',
            'tool_name, version, environment, expected_schema_hash, and valid optional review fields are required',
          );
        const promotion = {
          tool_name: input.tool_name,
          version: input.version,
          environment: input.environment,
          expected_schema_hash: input.expected_schema_hash,
          ...(input.allow_breaking === undefined ? {} : { allow_breaking: input.allow_breaking }),
          ...(typeof input.evidence_reference === 'string'
            ? { evidence_reference: input.evidence_reference }
            : {}),
        };
        let release;
        try {
          release = schemaState
            ? await schemaState.promoteSchemaRelease(principal.tenantId, principal.keyId, promotion)
            : store.promoteSchemaRelease(principal, promotion);
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        if (alertState && !schemaState?.recordsSchemaAlerts) {
          try {
            await alertState.recordAlert(
              principal.tenantId,
              'schema_promoted',
              'critical',
              release,
              `schema-release:${release.release_id}`,
            );
          } catch (error) {
            throw sharedAlertStateUnavailable(error);
          }
        }
        sendJson(response, 201, release);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/schema-releases/verify') {
        store.requireScope(principal, 'promote:schema');
        try {
          sendJson(
            response,
            200,
            schemaState
              ? await schemaState.verifySchemaReleaseHistory(principal.tenantId)
              : store.verifySchemaReleaseHistory(principal),
          );
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/schema-releases') {
        store.requireScope(principal, 'promote:schema');
        const environment = url.searchParams.get('environment') ?? undefined;
        try {
          sendJson(response, 200, {
            releases: schemaState
              ? await schemaState.listSchemaReleases(
                  principal.tenantId,
                  environment,
                  Number(url.searchParams.get('limit') ?? 100),
                )
              : store.listSchemaReleases(
                  principal,
                  environment,
                  Number(url.searchParams.get('limit') ?? 100),
                ),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/audits') {
        store.requireScope(principal, 'read:audit');
        const selectedLimit = Number(url.searchParams.get('limit') ?? 100);
        const rows = controlState
          ? await controlState
              .listAudits(principal.tenantId, selectedLimit)
              .catch((error: unknown) => {
                throw sharedControlStateUnavailable(error);
              })
          : store.listAudits(principal, selectedLimit);
        if (url.searchParams.get('format') === 'csv') {
          response.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="schema-guard-audits.csv"',
            'cache-control': 'no-store',
            ...publicResponseHeaders,
          });
          response.end(csv(rows));
        } else sendJson(response, 200, { audits: rows });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/audits/verify') {
        store.requireScope(principal, 'read:audit');
        sendJson(
          response,
          200,
          controlState
            ? await controlState.verifyAuditChain(principal.tenantId).catch((error: unknown) => {
                throw sharedControlStateUnavailable(error);
              })
            : store.verifyAuditChain(principal),
        );
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/intelligence') {
        store.requireScope(principal, 'read:intelligence');
        if (intelligenceState) {
          try {
            const [clusters, compatibilityMatrix, latestSchemas, networkClusters] =
              await Promise.all([
                intelligenceState.tenantFailureClusters(principal.tenantId),
                intelligenceState.compatibilityMatrix(principal.tenantId),
                schemaState
                  ? schemaState.listLatestSchemas(principal.tenantId)
                  : Promise.resolve([]),
                intelligenceState.networkFailureClusters(config.aggregateTenantThreshold ?? 3),
              ]);
            const schemas = latestSchemas.map((schema) => ({
              tool_name_hash: schema.tool_name_hash,
              adapter: schema.adapter,
              version: schema.version,
              schema_hash: schema.schema_hash,
              created_at: schema.created_at,
              quality: scoreSchemaQuality(schema.schema),
              drift: schema.drift,
            }));
            const recommendations = [
              ...recommendFixes({ clusters: clusters as FailureCluster[] }).map(
                (recommendation) => ({
                  ...recommendation,
                  source: 'failure_clusters' as const,
                }),
              ),
              ...schemas.flatMap((schema) =>
                recommendFixes({
                  quality: schema.quality,
                  ...(schema.drift === null ? {} : { drift: schema.drift }),
                }).map((recommendation) => ({
                  ...recommendation,
                  source: 'schema_registry' as const,
                  tool_name_hash: schema.tool_name_hash,
                  schema_hash: schema.schema_hash,
                })),
              ),
            ];
            sendJson(response, 200, {
              failure_clusters: clusters,
              schema_quality: schemas,
              compatibility_matrix: compatibilityMatrix,
              recommendations,
              privacy_threshold: config.aggregateTenantThreshold ?? 3,
              network_failure_clusters: networkClusters,
              network_signatures: [],
            });
          } catch (error) {
            throw sharedIntelligenceStateUnavailable(error);
          }
        } else
          sendJson(response, 200, {
            ...store.tenantIntelligence(principal),
            privacy_threshold: config.aggregateTenantThreshold ?? 3,
            network_failure_clusters: store.aggregateFailureIntelligence(),
            network_signatures: store.aggregateIntelligence(),
          });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/conformance-runs') {
        store.requireScope(principal, 'admin');
        const input = asRecord(await guardedBody());
        enforceJsonSafety(input, 'conformance run');
        const result = intelligenceState
          ? await intelligenceState
              .recordConformanceRun(principal.tenantId, input as unknown as ConformanceRun)
              .catch((error: unknown) => {
                throw sharedIntelligenceStateUnavailable(error);
              })
          : store.recordConformanceRun(principal, input as unknown as ConformanceRun);
        sendJson(response, result.recorded ? 201 : 200, result);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        store.requireScope(principal, 'read:usage');
        const usage = controlState
          ? await controlState.usage(principal.tenantId).catch((error: unknown) => {
              throw sharedControlStateUnavailable(error);
            })
          : store.usage(principal);
        sendJson(response, 200, {
          plan: principal.plan,
          monthly_limit: principal.monthlyLimit,
          usage,
          payment_processing: 'not_configured_local_mode',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/environments') {
        store.requireScope(principal, 'read:environment');
        try {
          sendJson(response, 200, {
            environments: schemaState
              ? await schemaState.listEnvironments(principal.tenantId)
              : store.listEnvironments(principal),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/billing/statement') {
        store.requireScope(principal, 'read:billing');
        const usage = controlState
          ? await controlState.usage(principal.tenantId).catch((error: unknown) => {
              throw sharedControlStateUnavailable(error);
            })
          : store.usage(principal);
        sendJson(response, 200, {
          period: usage.month,
          plan: principal.plan,
          included_validations: principal.monthlyLimit,
          usage,
          amount_due: null,
          currency: null,
          payment_processing: 'integration_required',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/alerts') {
        store.requireScope(principal, 'read:alerts');
        try {
          sendJson(response, 200, {
            alerts: alertState
              ? await alertState.listAlerts(principal.tenantId)
              : store.alerts(principal),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedAlertStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/admin/control-plane-integrity') {
        store.requireScope(principal, 'admin');
        if (controlState || schemaState || alertState || actionState || intelligenceState) {
          try {
            const [audit, releases, alerts, actions, intelligence] = await Promise.all([
              controlState
                ? controlState.verifyAuditChain(principal.tenantId)
                : Promise.resolve(store.verifyAuditChain(principal)),
              schemaState
                ? schemaState.verifySchemaReleaseHistory(principal.tenantId)
                : Promise.resolve({ valid: true, checked: 0 }),
              alertState
                ? alertState.verifyTenant(principal.tenantId)
                : Promise.resolve({ valid: true, checked: 0 }),
              actionState
                ? Promise.all([
                    actionState.verifyReconciliations(principal.tenantId),
                    actionState.ready(),
                  ]).then(([history, ready]) => ({
                    valid: history.valid && ready,
                    checked: history.checked,
                  }))
                : Promise.resolve({ valid: true, checked: 0 }),
              intelligenceState
                ? intelligenceState.verifyTenantHistory(principal.tenantId)
                : Promise.resolve({ valid: true, checked: 0 }),
            ]);
            const components = { audit, releases, alerts, actions, intelligence };
            sendJson(response, 200, {
              valid: Object.values(components).every((result) => result.valid),
              checked: Object.values(components).reduce(
                (total, result) => total + result.checked,
                0,
              ),
              components,
            });
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
        } else sendJson(response, 200, store.verifyControlPlaneIntegrity(principal));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/alert-webhooks') {
        store.requireScope(principal, 'manage:webhooks');
        const input = asRecord(await guardedBody());
        if (typeof input.label !== 'string' || typeof input.endpoint !== 'string')
          throw new ManagedError(400, 'invalid_webhook', 'label and HTTPS endpoint are required');
        const endpoint = normalizedPublicWebhookEndpoint(input.endpoint);
        try {
          sendJson(
            response,
            201,
            alertState
              ? await alertState.createWebhook(principal.tenantId, input.label, endpoint)
              : store.createAlertWebhook(principal, input.label, endpoint),
          );
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedAlertStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/alert-webhooks') {
        store.requireScope(principal, 'manage:webhooks');
        try {
          sendJson(response, 200, {
            webhooks: alertState
              ? await alertState.listWebhooks(principal.tenantId)
              : store.listAlertWebhooks(principal),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedAlertStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/alert-webhooks/deliveries') {
        store.requireScope(principal, 'manage:webhooks');
        try {
          sendJson(response, 200, {
            deliveries: alertState
              ? await alertState.listDeliveries(
                  principal.tenantId,
                  Number(url.searchParams.get('limit') ?? 100),
                )
              : store.listAlertWebhookDeliveries(
                  principal,
                  Number(url.searchParams.get('limit') ?? 100),
                ),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedAlertStateUnavailable(error);
        }
        return;
      }
      if (
        request.method === 'POST' &&
        url.pathname.startsWith('/v1/alert-webhooks/deliveries/') &&
        url.pathname.endsWith('/redrive')
      ) {
        store.requireScope(principal, 'manage:webhooks');
        const deliveryId = decodeURIComponent(
          url.pathname.slice('/v1/alert-webhooks/deliveries/'.length, -'/redrive'.length),
        );
        let redriven: boolean;
        try {
          redriven = alertState
            ? await alertState.redriveDelivery(principal.tenantId, deliveryId)
            : store.redriveAlertWebhookDelivery(principal, deliveryId);
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedAlertStateUnavailable(error);
        }
        if (!redriven)
          throw new ManagedError(
            409,
            'delivery_not_redrivable',
            'delivery is not dead, missing, or its webhook is disabled',
          );
        sendJson(response, 200, { redriven: true });
        return;
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/v1/alert-webhooks/')) {
        store.requireScope(principal, 'manage:webhooks');
        const webhookId = decodeURIComponent(url.pathname.slice('/v1/alert-webhooks/'.length));
        let disabled: boolean;
        try {
          disabled = alertState
            ? await alertState.disableWebhook(principal.tenantId, webhookId)
            : store.disableAlertWebhook(principal, webhookId);
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedAlertStateUnavailable(error);
        }
        if (!disabled) throw new ManagedError(404, 'webhook_not_found', 'webhook was not found');
        sendJson(response, 200, { disabled: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/rulesets/latest') {
        store.requireScope(principal, 'read:ruleset');
        const ruleset = intelligenceState
          ? await intelligenceState.latestRuleset(principal.tenantId).catch((error: unknown) => {
              throw sharedIntelligenceStateUnavailable(error);
            })
          : store.latestRuleset(principal);
        if (!ruleset)
          throw new ManagedError(404, 'ruleset_not_found', 'no ruleset has been published');
        const valid = intelligenceState
          ? await intelligenceState.verifyRuleset(ruleset).catch((error: unknown) => {
              throw sharedIntelligenceStateUnavailable(error);
            })
          : store.verifyRuleset(ruleset);
        if (!valid)
          throw new ManagedError(
            500,
            'ruleset_signature_invalid',
            'stored ruleset signature did not verify',
          );
        sendJson(response, 200, ruleset);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/rulesets') {
        store.requireScope(principal, 'admin');
        const input = asRecord(await guardedBody()) as unknown as Omit<
          SignedRuleSet,
          'key_id' | 'public_key' | 'signature'
        >;
        if (
          typeof input.version !== 'string' ||
          !Array.isArray(input.rules) ||
          typeof input.issued_at !== 'string' ||
          typeof input.expires_at !== 'string'
        )
          throw new ManagedError(
            400,
            'invalid_ruleset',
            'version, issued_at, expires_at, and rules are required',
          );
        sendJson(
          response,
          201,
          intelligenceState
            ? await intelligenceState
                .publishRuleset(principal.tenantId, input)
                .catch((error: unknown) => {
                  throw sharedIntelligenceStateUnavailable(error);
                })
            : store.publishRuleset(principal, input),
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/api-keys') {
        store.requireScope(principal, 'admin');
        const input = asRecord(await guardedBody());
        if (
          !Array.isArray(input.scopes) ||
          !input.scopes.every(
            (scope) => typeof scope === 'string' && ALL_SCOPES.includes(scope as Scope),
          )
        )
          throw new ManagedError(400, 'invalid_scopes', 'scopes must be an array of scope names');
        if (controlState) {
          try {
            sendJson(
              response,
              201,
              await controlState.issueApiKey(principal.tenantId, input.scopes as Scope[]),
            );
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
        } else sendJson(response, 201, store.issueApiKey(principal, input.scopes as Scope[]));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/environments') {
        store.requireScope(principal, 'admin');
        const input = asRecord(await guardedBody());
        if (typeof input.name !== 'string')
          throw new ManagedError(400, 'invalid_environment', 'environment name is required');
        const policy = input.policy === undefined ? {} : asRecord(input.policy);
        const policyError = policyValidationError(policy);
        if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
        try {
          sendJson(
            response,
            201,
            schemaState
              ? await schemaState.createEnvironment(principal.tenantId, input.name, policy)
              : store.createEnvironment(principal, input.name, policy),
          );
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        return;
      }
      if (
        request.method === 'PUT' &&
        url.pathname.startsWith('/v1/admin/environments/') &&
        url.pathname.endsWith('/policy')
      ) {
        store.requireScope(principal, 'admin');
        const environmentId = decodeURIComponent(
          url.pathname.slice('/v1/admin/environments/'.length, -'/policy'.length),
        );
        const policy = asRecord(await guardedBody()) as GuardPolicy;
        const policyError = policyValidationError(policy);
        if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
        try {
          if (schemaState)
            await schemaState.updateEnvironmentPolicy(principal.tenantId, environmentId, policy);
          else store.updateEnvironmentPolicy(principal, environmentId, policy);
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        sendJson(response, 200, { updated: true, applies_on_next_request: true });
        return;
      }
      if (
        request.method === 'PUT' &&
        url.pathname.startsWith('/v1/admin/environments/') &&
        url.pathname.endsWith('/schema-enforcement')
      ) {
        store.requireScope(principal, 'promote:schema');
        const environmentId = decodeURIComponent(
          url.pathname.slice('/v1/admin/environments/'.length, -'/schema-enforcement'.length),
        );
        const input = asRecord(await guardedBody());
        if (input.mode !== 'observe' && input.mode !== 'enforce')
          throw new ManagedError(
            400,
            'invalid_schema_enforcement',
            'mode must be observe or enforce',
          );
        try {
          if (schemaState)
            await schemaState.updateEnvironmentSchemaEnforcement(
              principal.tenantId,
              environmentId,
              input.mode,
            );
          else store.updateEnvironmentSchemaEnforcement(principal, environmentId, input.mode);
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
        sendJson(response, 200, { updated: true, mode: input.mode });
        return;
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/v1/admin/api-keys/')) {
        const keyId = decodeURIComponent(url.pathname.slice('/v1/admin/api-keys/'.length));
        if (keyId === principal.keyId)
          throw new ManagedError(
            409,
            'cannot_revoke_current_key',
            'use another admin key to revoke the current key',
          );
        try {
          sendJson(response, 200, {
            revoked: controlState
              ? await controlState.revokeApiKey(principal.tenantId, principal.keyId, keyId)
              : store.revokeApiKey(principal, keyId),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedControlStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/v1/admin/policy') {
        const input = asRecord(await guardedBody()) as GuardPolicy;
        const policyError = policyValidationError(input);
        if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
        if (controlState) {
          try {
            await controlState.updateTenantPolicy(principal.tenantId, input);
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
        } else store.updateTenantPolicy(principal, input);
        sendJson(response, 200, { updated: true, applies_on_next_request: true });
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/v1/admin/plan') {
        const input = asRecord(await guardedBody());
        if (input.plan !== 'trial' && input.plan !== 'team')
          throw new ManagedError(400, 'invalid_plan', 'plan must be trial or team');
        if (controlState) {
          try {
            await controlState.updatePlan(principal.tenantId, input.plan as PlanId);
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
        } else store.updatePlan(principal, input.plan as PlanId);
        sendJson(response, 200, {
          updated: true,
          plan: input.plan,
          applies_on_next_request: true,
          payment_processing: 'integration_required',
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/retention/purge') {
        store.requireScope(principal, 'admin');
        if (controlState) {
          let deleted: number;
          try {
            deleted = await controlState.purgeExpiredAudits(
              principal.tenantId,
              principal.retentionDays,
            );
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
          store.purgeExpired(principal);
          sendJson(response, 200, { deleted });
        } else sendJson(response, 200, { deleted: store.purgeExpired(principal) });
        return;
      }
      sendJson(response, 404, { error: 'not_found', message: 'route not found' });
    } catch (error) {
      if (timedOut || response.writableEnded || response.destroyed) return;
      const managed =
        error instanceof ManagedError
          ? error
          : new ManagedError(500, 'internal_error', 'managed service failed closed');
      sendJson(response, managed.status, { error: managed.code, message: managed.message });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    server,
    store,
    async close(): Promise<void> {
      draining = true;
      clearInterval(webhookTimer);
      clearInterval(checkpointAnchorTimer);
      await webhookDispatch;
      await checkpointAnchorDispatch;
      await Promise.all([
        actionStateInitialization,
        controlStateInitialization,
        schemaStateInitialization,
        alertStateInitialization,
        intelligenceStateInitialization,
      ]);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (actionState) await actionState.close();
      if (controlState) await controlState.close();
      if (schemaState) await schemaState.close();
      if (alertState) await alertState.close();
      if (intelligenceState) await intelligenceState.close();
      store.close();
    },
  };
}

export function validateManagedConfig(config: ManagedConfig): void {
  if (!config.databasePath) throw new Error('SCHEMA_GUARD_DATABASE is required');
  if (!config.masterSecret || config.masterSecret.length < 32)
    throw new Error('SCHEMA_GUARD_MASTER_SECRET must be at least 32 characters');
  if (
    config.sharedActionDatabaseUrl !== undefined &&
    !/^postgres(?:ql)?:\/\/[^\s]+$/u.test(config.sharedActionDatabaseUrl)
  )
    throw new Error('SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL must be a PostgreSQL URL');
  if (
    config.sharedControlDatabaseUrl !== undefined &&
    !/^postgres(?:ql)?:\/\/[^\s]+$/u.test(config.sharedControlDatabaseUrl)
  )
    throw new Error('SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL must be a PostgreSQL URL');
  if (
    config.port !== undefined &&
    (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535)
  )
    throw new Error('PORT must be an integer from 1 through 65535');
  if (
    config.instanceCount !== undefined &&
    (!Number.isInteger(config.instanceCount) ||
      config.instanceCount < 1 ||
      config.instanceCount > 100)
  )
    throw new Error('SCHEMA_GUARD_INSTANCE_COUNT must be an integer from 1 through 100');
  if ((config.instanceCount ?? 1) !== 1)
    throw new Error(
      'SCHEMA_GUARD_INSTANCE_COUNT must remain 1 until every managed state path is transactional and shared',
    );
  if (
    config.requestTimeoutMs !== undefined &&
    (!Number.isFinite(config.requestTimeoutMs) ||
      !Number.isInteger(config.requestTimeoutMs) ||
      config.requestTimeoutMs < 1)
  )
    throw new Error('SCHEMA_GUARD_REQUEST_TIMEOUT_MS must be a positive finite integer');
  if (
    config.rateLimitPerMinute !== undefined &&
    (!Number.isFinite(config.rateLimitPerMinute) ||
      !Number.isInteger(config.rateLimitPerMinute) ||
      config.rateLimitPerMinute < 1)
  )
    throw new Error('SCHEMA_GUARD_RATE_LIMIT_PER_MINUTE must be a positive finite integer');
  if (
    config.aggregateTenantThreshold !== undefined &&
    (!Number.isFinite(config.aggregateTenantThreshold) ||
      !Number.isInteger(config.aggregateTenantThreshold) ||
      config.aggregateTenantThreshold < 2)
  )
    throw new Error('aggregate tenant threshold must be a finite integer of at least 2');
  if (
    config.actionReconciliationMinAgeSeconds !== undefined &&
    (!Number.isFinite(config.actionReconciliationMinAgeSeconds) ||
      !Number.isInteger(config.actionReconciliationMinAgeSeconds) ||
      config.actionReconciliationMinAgeSeconds < 60 ||
      config.actionReconciliationMinAgeSeconds > 86_400)
  )
    throw new Error(
      'SCHEMA_GUARD_ACTION_RECONCILIATION_MIN_AGE_SECONDS must be an integer from 60 through 86400',
    );
  if (
    config.alertWebhookPollIntervalMs !== undefined &&
    (!Number.isInteger(config.alertWebhookPollIntervalMs) ||
      config.alertWebhookPollIntervalMs < 100 ||
      config.alertWebhookPollIntervalMs > 60_000)
  )
    throw new Error(
      'SCHEMA_GUARD_ALERT_WEBHOOK_POLL_INTERVAL_MS must be an integer from 100 through 60000',
    );
  if (
    config.alertWebhookRequestTimeoutMs !== undefined &&
    (!Number.isInteger(config.alertWebhookRequestTimeoutMs) ||
      config.alertWebhookRequestTimeoutMs < 500 ||
      config.alertWebhookRequestTimeoutMs > 10_000)
  )
    throw new Error(
      'SCHEMA_GUARD_ALERT_WEBHOOK_REQUEST_TIMEOUT_MS must be an integer from 500 through 10000',
    );
  if (
    config.alertWebhookMaxAttempts !== undefined &&
    (!Number.isInteger(config.alertWebhookMaxAttempts) ||
      config.alertWebhookMaxAttempts < 1 ||
      config.alertWebhookMaxAttempts > 20)
  )
    throw new Error('SCHEMA_GUARD_ALERT_WEBHOOK_MAX_ATTEMPTS must be an integer from 1 through 20');
  if (
    (config.actionCheckpointAnchorUrl === undefined) !==
    (config.actionCheckpointAnchorSigningSecret === undefined)
  )
    throw new Error(
      'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL and SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET must be configured together',
    );
  if (config.actionCheckpointAnchorUrl !== undefined) {
    try {
      normalizedPublicWebhookEndpoint(config.actionCheckpointAnchorUrl);
    } catch {
      throw new Error(
        'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL must be a public HTTPS URL on port 443',
      );
    }
  }
  if (
    config.actionCheckpointAnchorSigningSecret !== undefined &&
    config.actionCheckpointAnchorSigningSecret.length < 32
  )
    throw new Error(
      'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET must be at least 32 characters',
    );
  if (
    config.actionCheckpointAnchorPollIntervalMs !== undefined &&
    (!Number.isInteger(config.actionCheckpointAnchorPollIntervalMs) ||
      config.actionCheckpointAnchorPollIntervalMs < 100 ||
      config.actionCheckpointAnchorPollIntervalMs > 60_000)
  )
    throw new Error(
      'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_POLL_INTERVAL_MS must be an integer from 100 through 60000',
    );
  if (
    config.actionCheckpointAnchorRequestTimeoutMs !== undefined &&
    (!Number.isInteger(config.actionCheckpointAnchorRequestTimeoutMs) ||
      config.actionCheckpointAnchorRequestTimeoutMs < 500 ||
      config.actionCheckpointAnchorRequestTimeoutMs > 10_000)
  )
    throw new Error(
      'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS must be an integer from 500 through 10000',
    );
  if (
    config.actionCheckpointAnchorMaxAttempts !== undefined &&
    (!Number.isInteger(config.actionCheckpointAnchorMaxAttempts) ||
      config.actionCheckpointAnchorMaxAttempts < 1 ||
      config.actionCheckpointAnchorMaxAttempts > 20)
  )
    throw new Error(
      'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_MAX_ATTEMPTS must be an integer from 1 through 20',
    );
  if (config.publicMode) {
    if (config.masterSecret.length < 64)
      throw new Error('public mode requires a 64+ character SCHEMA_GUARD_MASTER_SECRET');
    if (!config.externalUrl) throw new Error('public mode requires SCHEMA_GUARD_EXTERNAL_URL');
    let parsed: URL;
    try {
      parsed = new URL(config.externalUrl);
    } catch {
      throw new Error('SCHEMA_GUARD_EXTERNAL_URL must be an absolute URL');
    }
    if (parsed.protocol !== 'https:')
      throw new Error('public mode requires an https SCHEMA_GUARD_EXTERNAL_URL');
    if (config.trustProxy !== true)
      throw new Error('public mode requires SCHEMA_GUARD_TRUST_PROXY=true behind TLS ingress');
    if (!config.actionCheckpointAnchorUrl || !config.actionCheckpointAnchorSigningSecret)
      throw new Error(
        'public mode requires an independently hosted action checkpoint anchor URL and signing secret',
      );
    if (config.sharedActionDatabaseUrl) {
      const sslMode = new URL(config.sharedActionDatabaseUrl).searchParams.get('sslmode');
      if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode))
        throw new Error(
          'public mode requires SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL with sslmode=require, verify-ca, or verify-full',
        );
    }
    if (config.sharedControlDatabaseUrl) {
      const sslMode = new URL(config.sharedControlDatabaseUrl).searchParams.get('sslmode');
      if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode))
        throw new Error(
          'public mode requires SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL with sslmode=require, verify-ca, or verify-full',
        );
    }
    if ((config.requestTimeoutMs ?? 10_000) > 15_000)
      throw new Error('public mode request timeout must be 15000 ms or lower');
    if ((config.rateLimitPerMinute ?? 120) > 600)
      throw new Error('public mode rate limit must be 600 requests/minute or lower per key');
  }
}

function configFromEnvironment(): ManagedConfig {
  const databasePath = process.env.SCHEMA_GUARD_DATABASE;
  const masterSecret = process.env.SCHEMA_GUARD_MASTER_SECRET;
  if (!databasePath || !masterSecret)
    throw new Error('SCHEMA_GUARD_DATABASE and SCHEMA_GUARD_MASTER_SECRET are required');
  const config: ManagedConfig = {
    databasePath,
    masterSecret,
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 8788),
    publicMode: process.env.SCHEMA_GUARD_PUBLIC_MODE === 'true',
    instanceCount: Number(process.env.SCHEMA_GUARD_INSTANCE_COUNT ?? 1),
    trustProxy: process.env.SCHEMA_GUARD_TRUST_PROXY === 'true',
    ...(process.env.SCHEMA_GUARD_ALERT_FILE
      ? { alertFile: process.env.SCHEMA_GUARD_ALERT_FILE }
      : {}),
  };
  if (process.env.SCHEMA_GUARD_EXTERNAL_URL)
    config.externalUrl = process.env.SCHEMA_GUARD_EXTERNAL_URL;
  if (process.env.SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL)
    config.sharedActionDatabaseUrl = process.env.SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL;
  if (process.env.SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL)
    config.sharedControlDatabaseUrl = process.env.SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL;
  if (process.env.SCHEMA_GUARD_RATE_LIMIT_PER_MINUTE)
    config.rateLimitPerMinute = Number(process.env.SCHEMA_GUARD_RATE_LIMIT_PER_MINUTE);
  if (process.env.SCHEMA_GUARD_REQUEST_TIMEOUT_MS)
    config.requestTimeoutMs = Number(process.env.SCHEMA_GUARD_REQUEST_TIMEOUT_MS);
  if (process.env.SCHEMA_GUARD_ACTION_RECONCILIATION_MIN_AGE_SECONDS)
    config.actionReconciliationMinAgeSeconds = Number(
      process.env.SCHEMA_GUARD_ACTION_RECONCILIATION_MIN_AGE_SECONDS,
    );
  if (process.env.SCHEMA_GUARD_ALERT_WEBHOOK_POLL_INTERVAL_MS)
    config.alertWebhookPollIntervalMs = Number(
      process.env.SCHEMA_GUARD_ALERT_WEBHOOK_POLL_INTERVAL_MS,
    );
  if (process.env.SCHEMA_GUARD_ALERT_WEBHOOK_REQUEST_TIMEOUT_MS)
    config.alertWebhookRequestTimeoutMs = Number(
      process.env.SCHEMA_GUARD_ALERT_WEBHOOK_REQUEST_TIMEOUT_MS,
    );
  if (process.env.SCHEMA_GUARD_ALERT_WEBHOOK_MAX_ATTEMPTS)
    config.alertWebhookMaxAttempts = Number(process.env.SCHEMA_GUARD_ALERT_WEBHOOK_MAX_ATTEMPTS);
  if (process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL)
    config.actionCheckpointAnchorUrl = process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL;
  if (process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET)
    config.actionCheckpointAnchorSigningSecret =
      process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET;
  if (process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_POLL_INTERVAL_MS)
    config.actionCheckpointAnchorPollIntervalMs = Number(
      process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_POLL_INTERVAL_MS,
    );
  if (process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS)
    config.actionCheckpointAnchorRequestTimeoutMs = Number(
      process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS,
    );
  if (process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_MAX_ATTEMPTS)
    config.actionCheckpointAnchorMaxAttempts = Number(
      process.env.SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_MAX_ATTEMPTS,
    );
  validateManagedConfig(config);
  return config;
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const config = configFromEnvironment();
  const managed = createManagedServer(config);
  managed.server.listen(config.port, config.host, () => {
    console.log(`Schema Guard managed local listening on http://${config.host}:${config.port}`);
  });
  const shutdown = (): void => {
    void managed.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
