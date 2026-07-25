import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  PostgresBillingState,
  createSharedStatePool,
  exportSharedTenantData,
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
  type SharedStatePool,
  type BillingState,
} from '@schema-guard/shared-state';

import { dashboardHtml, dashboardScript, dashboardStyle } from './dashboard.js';
import { environmentValue } from './environment.js';
import { valueFreeEvaluationExport } from './evaluation-export.js';
import { managedInventory, type ManagedInventoryInput } from './inventory.js';
import { ManagedMetrics, type ManagedReadinessMetrics } from './metrics.js';
import { effectivePlanEntitlements, managedPlan, planCatalog } from './plans.js';
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
import { billingTenantReference, StripeBillingProvider, type BillingProvider } from './billing.js';
import {
  ALL_SCOPES,
  type ActionIdempotencyCheckpoint,
  type ManagedConfig,
  type ManagedOperationalMetrics,
  type PlanId,
  type Principal,
  type Scope,
  type SignedRuleSet,
} from './types.js';

const dashboardGeistSans = readFileSync(
  new URL(
    '../../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
    import.meta.url,
  ),
);
const dashboardGeistMono = readFileSync(
  new URL(
    '../../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
    import.meta.url,
  ),
);

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function privacySafeRoute(pathname: string): string {
  if (/^\/v1\/alerts\/\d+\/acknowledge$/u.test(pathname)) return '/v1/alerts/:id/acknowledge';
  return pathname
    .split('/')
    .map((segment) =>
      /^(?:ach|alert|delivery|env|key|res|webhook)_[A-Za-z0-9-]+$/u.test(segment) ? ':id' : segment,
    )
    .join('/');
}
interface TraceCorrelation {
  responseTraceparent: string;
  traceId: string;
  traceIdHash: string;
}
function traceCorrelation(request: IncomingMessage): TraceCorrelation | undefined {
  const header = request.headers.traceparent;
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || !/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/u.test(header))
    throw new ManagedError(
      400,
      'invalid_traceparent',
      'traceparent must be a lowercase W3C version 00 trace context',
    );
  const [, traceId, , flags] = header.split('-') as [string, string, string, string];
  if (/^0{32}$/u.test(traceId))
    throw new ManagedError(400, 'invalid_traceparent', 'traceparent trace ID must be non-zero');
  const parentId = header.slice(36, 52);
  if (/^0{16}$/u.test(parentId))
    throw new ManagedError(400, 'invalid_traceparent', 'traceparent parent ID must be non-zero');
  const spanId = randomBytes(8).toString('hex');
  return {
    responseTraceparent: `00-${traceId}-${spanId}-${flags}`,
    traceId,
    traceIdHash: `sha256:${createHash('sha256').update(traceId).digest('hex')}`,
  };
}
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
  const body = await readRawBody(request, max);
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new ManagedError(400, 'invalid_json', 'request body must be valid JSON');
  }
}
async function readRawBody(request: IncomingMessage, max = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > max) throw new ManagedError(413, 'body_too_large', 'request body exceeds 1 MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function bearer(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length <= 7)
    throw new ManagedError(401, 'authentication_required', 'provide a bearer API key');
  return header.slice(7);
}
function secretMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
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

function billingStateUnavailable(error: unknown): ManagedError {
  const integrityFailure =
    error instanceof SharedStateIntegrityError ||
    (error instanceof Error && error.name === 'SharedStateIntegrityError');
  return new ManagedError(
    503,
    integrityFailure ? 'billing_state_integrity_invalid' : 'billing_state_unavailable',
    integrityFailure
      ? 'billing state integrity verification failed; entitlements are unavailable'
      : 'billing state is unavailable; entitlements are unavailable',
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
    billingState?: BillingState;
    billingProvider?: BillingProvider;
  } = {},
) {
  validateManagedConfig(config);
  const store = new ManagedStore(config);
  const ownedSharedPools = new Set<SharedStatePool>();
  const needsSharedControlPool = Boolean(
    config.sharedControlDatabaseUrl &&
    (dependencies.alertState === undefined ||
      dependencies.controlState === undefined ||
      dependencies.schemaState === undefined ||
      dependencies.intelligenceState === undefined ||
      (dependencies.actionState === undefined &&
        config.sharedActionDatabaseUrl === config.sharedControlDatabaseUrl)),
  );
  const sharedControlPool =
    needsSharedControlPool && config.sharedControlDatabaseUrl
      ? createSharedStatePool(config.sharedControlDatabaseUrl)
      : undefined;
  if (sharedControlPool) ownedSharedPools.add(sharedControlPool);
  const sharedActionPool =
    dependencies.actionState === undefined && config.sharedActionDatabaseUrl
      ? config.sharedActionDatabaseUrl === config.sharedControlDatabaseUrl && sharedControlPool
        ? sharedControlPool
        : createSharedStatePool(config.sharedActionDatabaseUrl)
      : undefined;
  if (sharedActionPool) ownedSharedPools.add(sharedActionPool);
  const alertState =
    dependencies.alertState ??
    (config.sharedControlDatabaseUrl
      ? new PostgresAlertState(
          config.sharedControlDatabaseUrl,
          config.masterSecret,
          sharedControlPool,
          config.alertWebhookMaxAttempts ?? 8,
        )
      : undefined);
  const transactionalAlertWriter =
    alertState instanceof PostgresAlertState ? alertState : undefined;
  const actionState =
    dependencies.actionState ??
    (config.sharedActionDatabaseUrl
      ? new PostgresActionState(
          config.sharedActionDatabaseUrl,
          config.masterSecret,
          sharedActionPool,
          {
            checkpointAnchoring: Boolean(config.actionCheckpointAnchorUrl),
            checkpointAnchorMaxAttempts: config.actionCheckpointAnchorMaxAttempts ?? 8,
            ...(transactionalAlertWriter &&
            config.sharedActionDatabaseUrl === config.sharedControlDatabaseUrl
              ? { alertWriter: transactionalAlertWriter }
              : {}),
          },
        )
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
      ? new PostgresIntelligenceState(
          config.sharedControlDatabaseUrl,
          config.masterSecret,
          sharedControlPool,
        )
      : undefined);
  const transactionalIntelligenceWriter =
    intelligenceState instanceof PostgresIntelligenceState ? intelligenceState : undefined;
  const controlState =
    dependencies.controlState ??
    (config.sharedControlDatabaseUrl
      ? new PostgresControlState(
          config.sharedControlDatabaseUrl,
          config.masterSecret,
          sharedControlPool,
          {
            ...(transactionalAlertWriter ? { alertWriter: transactionalAlertWriter } : {}),
            ...(transactionalIntelligenceWriter
              ? { intelligenceWriter: transactionalIntelligenceWriter }
              : {}),
            ...(transactionalAcceptedDecisionWriter
              ? { acceptedDecisionWriter: transactionalAcceptedDecisionWriter }
              : {}),
          },
        )
      : undefined);
  const schemaState =
    dependencies.schemaState ??
    (config.sharedControlDatabaseUrl
      ? new PostgresSchemaState(
          config.sharedControlDatabaseUrl,
          config.masterSecret,
          sharedControlPool,
          {
            ...(transactionalAlertWriter ? { alertWriter: transactionalAlertWriter } : {}),
          },
        )
      : undefined);
  const stripeConfigured = [
    config.stripeSecretKey,
    config.stripeWebhookSecret,
    config.stripeTeamPriceId,
    config.stripeCheckoutSuccessUrl,
    config.stripeCheckoutCancelUrl,
    config.stripePortalReturnUrl,
  ].every((value) => value !== undefined);
  const billingState =
    dependencies.billingState ??
    (stripeConfigured && config.sharedControlDatabaseUrl
      ? new PostgresBillingState(
          config.sharedControlDatabaseUrl,
          config.masterSecret,
          sharedControlPool,
        )
      : undefined);
  const billingProvider =
    dependencies.billingProvider ??
    (stripeConfigured
      ? new StripeBillingProvider({
          secretKey: config.stripeSecretKey!,
          webhookSecret: config.stripeWebhookSecret!,
          teamPriceId: config.stripeTeamPriceId!,
          successUrl: config.stripeCheckoutSuccessUrl!,
          cancelUrl: config.stripeCheckoutCancelUrl!,
          portalReturnUrl: config.stripePortalReturnUrl!,
        })
      : undefined);
  const limiter = new FixedWindowRateLimiter(config.rateLimitPerMinute ?? 120);
  const metrics = new ManagedMetrics();
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
  let billingStateInitialized = billingState === undefined;
  let billingStateInitializationFailed = false;
  const billingStateInitialization = billingState
    ? (async () => {
        await controlStateInitialization;
        if (controlStateInitializationFailed)
          throw new Error('shared control state initialization failed');
        await billingState.migrate();
        billingStateInitialized = true;
      })().catch(() => {
        billingStateInitializationFailed = true;
      })
    : Promise.resolve();
  const dependencyReady = async (
    state: { ready(): Promise<boolean> } | undefined,
    initializationFailed: boolean,
    initialized: boolean,
  ): Promise<boolean> => {
    if (state === undefined) return true;
    if (initializationFailed || !initialized) return false;
    try {
      return await state.ready();
    } catch {
      return false;
    }
  };
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
    () =>
      void runWebhookDispatch().catch(() => {
        metrics.webhookDispatchFailed();
      }),
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
    () =>
      void runCheckpointAnchorDispatch().catch(() => {
        metrics.anchorDispatchFailed();
      }),
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
  const loadTenantIntelligence = async (principal: Principal): Promise<Record<string, unknown>> => {
    if (!intelligenceState)
      return {
        ...store.tenantIntelligence(principal),
        privacy_threshold: config.aggregateTenantThreshold ?? 3,
        network_failure_clusters: store.aggregateFailureIntelligence(),
        network_signatures: store.aggregateIntelligence(),
      };
    try {
      const [clusters, compatibilityMatrix, latestSchemas, networkClusters] = await Promise.all([
        intelligenceState.tenantFailureClusters(principal.tenantId),
        intelligenceState.compatibilityMatrix(principal.tenantId),
        schemaState ? schemaState.listLatestSchemas(principal.tenantId) : Promise.resolve([]),
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
        ...recommendFixes({ clusters: clusters as FailureCluster[] }).map((recommendation) => ({
          ...recommendation,
          source: 'failure_clusters' as const,
        })),
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
      return {
        failure_clusters: clusters,
        schema_quality: schemas,
        compatibility_matrix: compatibilityMatrix,
        recommendations,
        privacy_threshold: config.aggregateTenantThreshold ?? 3,
        network_failure_clusters: networkClusters,
        network_signatures: [],
      };
    } catch (error) {
      throw sharedIntelligenceStateUnavailable(error);
    }
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = `req_${randomUUID()}`;
    const requestStarted = process.hrtime.bigint();
    response.setHeader('x-request-id', requestId);
    let correlation: TraceCorrelation | undefined;
    metrics.requestStarted();
    let metricsRecorded = false;
    const recordMetrics = (): void => {
      if (metricsRecorded) return;
      metricsRecorded = true;
      const elapsed = Number(process.hrtime.bigint() - requestStarted) / 1_000_000;
      let route = '/invalid-request-target';
      try {
        route = privacySafeRoute(pathOf(request).pathname);
      } catch {
        // Malformed request targets must not create unbounded metric labels.
      }
      metrics.requestCompleted(request.method ?? 'UNKNOWN', route, response.statusCode, elapsed);
    };
    response.once('finish', recordMetrics);
    response.once('close', recordMetrics);
    if (config.accessLog ?? config.publicMode ?? false) {
      let logged = false;
      const emitAccessLog = (): void => {
        if (logged) return;
        logged = true;
        const elapsed = Number(process.hrtime.bigint() - requestStarted) / 1_000_000;
        let route = '/invalid-request-target';
        try {
          route = privacySafeRoute(pathOf(request).pathname);
        } catch {
          // Malformed request targets must not break or enrich the access log.
        }
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'schema-guard-managed',
            event: 'http_request_completed',
            request_id: requestId,
            method: request.method ?? 'UNKNOWN',
            route,
            status: response.statusCode,
            duration_ms: Number(elapsed.toFixed(3)),
            ...(correlation ? { trace_id_hash: correlation.traceIdHash } : {}),
          }),
        );
      };
      response.once('finish', emitAccessLog);
      response.once('close', emitAccessLog);
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      metrics.requestTimedOut();
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
      correlation = traceCorrelation(request);
      if (correlation) {
        response.setHeader('traceparent', correlation.responseTraceparent);
        response.setHeader('x-akriven-trace-id', correlation.traceId);
      }
      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/metrics') {
        if (!config.metricsBearerToken) throw new ManagedError(404, 'not_found', 'route not found');
        const supplied = bearer(request);
        if (!secretMatches(supplied, config.metricsBearerToken))
          throw new ManagedError(401, 'invalid_metrics_token', 'metrics token is invalid');
        await Promise.all([
          actionStateInitialization,
          controlStateInitialization,
          schemaStateInitialization,
          alertStateInitialization,
          intelligenceStateInitialization,
          billingStateInitialization,
        ]);
        const [
          actionStateReady,
          controlStateReady,
          schemaStateReady,
          alertStateReady,
          intelligenceStateReady,
          billingStateReady,
        ] = await Promise.all([
          dependencyReady(actionState, actionStateInitializationFailed, actionStateInitialized),
          dependencyReady(controlState, controlStateInitializationFailed, controlStateInitialized),
          dependencyReady(schemaState, schemaStateInitializationFailed, schemaStateInitialized),
          dependencyReady(alertState, alertStateInitializationFailed, alertStateInitialized),
          dependencyReady(
            intelligenceState,
            intelligenceStateInitializationFailed,
            intelligenceStateInitialized,
          ),
          dependencyReady(billingState, billingStateInitializationFailed, billingStateInitialized),
        ]);
        const readiness: ManagedReadinessMetrics = {
          draining,
          localDatabase: store.readinessCheck(),
          actionState: actionStateReady,
          controlState: controlStateReady,
          schemaState: schemaStateReady,
          alertState: alertStateReady,
          intelligenceState: intelligenceStateReady,
          billingState: billingStateReady,
        };
        let operational: ManagedOperationalMetrics = {
          quota_tenants: { healthy: 0, warning: 0, exhausted: 0 },
          alert_deliveries: {
            pending: 0,
            processing: 0,
            dead: 0,
            oldest_pending_age_seconds: 0,
          },
          anchor_deliveries: {
            pending: 0,
            processing: 0,
            dead: 0,
            oldest_pending_age_seconds: 0,
          },
          pending_action_reservations: 0,
          oldest_pending_action_age_seconds: 0,
          sources_ready: { quota: false, alert: false, action: false },
        };
        if (readiness.localDatabase)
          try {
            operational = store.operationalMetrics();
          } catch {
            operational.sources_ready = { quota: false, alert: false, action: false };
          }
        if (controlState) {
          operational.sources_ready.quota = false;
          operational.quota_tenants = { healthy: 0, warning: 0, exhausted: 0 };
          if (readiness.controlState && controlState.operationalMetrics)
            try {
              operational.quota_tenants = await controlState.operationalMetrics();
              operational.sources_ready.quota = true;
            } catch {
              operational.sources_ready.quota = false;
            }
        }
        if (alertState) {
          operational.sources_ready.alert = false;
          operational.alert_deliveries = {
            pending: 0,
            processing: 0,
            dead: 0,
            oldest_pending_age_seconds: 0,
          };
          if (readiness.alertState && alertState.operationalMetrics)
            try {
              operational.alert_deliveries = await alertState.operationalMetrics();
              operational.sources_ready.alert = true;
            } catch {
              operational.sources_ready.alert = false;
            }
        }
        if (actionState) {
          operational.sources_ready.action = false;
          operational.anchor_deliveries = {
            pending: 0,
            processing: 0,
            dead: 0,
            oldest_pending_age_seconds: 0,
          };
          operational.pending_action_reservations = 0;
          operational.oldest_pending_action_age_seconds = 0;
          if (readiness.actionState && actionState.operationalMetrics)
            try {
              const actionOperational = await actionState.operationalMetrics();
              operational.anchor_deliveries = actionOperational.anchor_deliveries;
              operational.pending_action_reservations =
                actionOperational.pending_action_reservations;
              operational.oldest_pending_action_age_seconds =
                actionOperational.oldest_pending_action_age_seconds;
              operational.sources_ready.action = true;
            } catch {
              operational.sources_ready.action = false;
            }
        }
        response.writeHead(200, {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          ...publicResponseHeaders,
        });
        response.end(metrics.render(readiness, operational));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/readyz') {
        await Promise.all([
          actionStateInitialization,
          controlStateInitialization,
          schemaStateInitialization,
          alertStateInitialization,
          intelligenceStateInitialization,
          billingStateInitialization,
        ]);
        const [
          sharedAvailable,
          sharedControlAvailable,
          sharedSchemaAvailable,
          sharedAlertAvailable,
          sharedIntelligenceAvailable,
          billingAvailable,
        ] = await Promise.all([
          dependencyReady(actionState, actionStateInitializationFailed, actionStateInitialized),
          dependencyReady(controlState, controlStateInitializationFailed, controlStateInitialized),
          dependencyReady(schemaState, schemaStateInitializationFailed, schemaStateInitialized),
          dependencyReady(alertState, alertStateInitializationFailed, alertStateInitialized),
          dependencyReady(
            intelligenceState,
            intelligenceStateInitializationFailed,
            intelligenceStateInitialized,
          ),
          dependencyReady(billingState, billingStateInitializationFailed, billingStateInitialized),
        ]);
        const available =
          !draining &&
          store.readinessCheck() &&
          sharedAvailable &&
          sharedControlAvailable &&
          sharedSchemaAvailable &&
          sharedAlertAvailable &&
          sharedIntelligenceAvailable &&
          billingAvailable;
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
                      : billingStateInitializationFailed || !billingAvailable
                        ? 'billing_state_unavailable'
                        : actionStateInitializationFailed || !sharedAvailable
                          ? 'shared_action_state_unavailable'
                          : 'database_unavailable',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/plans') {
        sendJson(response, 200, {
          plans: planCatalog(),
          checkout: 'disabled',
          note: 'Private-beta enrollment is operator-led; no online purchase is available.',
        });
        return;
      }
      if (
        request.method === 'GET' &&
        (url.pathname === '/dashboard' ||
          /^\/dashboard\/(?:overview|integrate|decisions|schemas|environments|actions|approvals|alerts|intelligence|evidence|access|usage|workbench|settings)$/u.test(
            url.pathname,
          ))
      ) {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          ...publicResponseHeaders,
        });
        response.end(dashboardHtml(Boolean(config.publicMode)));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/dashboard/app.js') {
        response.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          ...publicResponseHeaders,
        });
        response.end(dashboardScript);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/dashboard/app.css') {
        response.writeHead(200, {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          ...publicResponseHeaders,
        });
        response.end(dashboardStyle);
        return;
      }
      if (
        request.method === 'GET' &&
        (url.pathname === '/dashboard/fonts/geist-sans.woff2' ||
          url.pathname === '/dashboard/fonts/geist-mono.woff2')
      ) {
        response.writeHead(200, {
          'content-type': 'font/woff2',
          'cache-control': 'public, max-age=31536000, immutable',
          'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          ...publicResponseHeaders,
        });
        response.end(
          url.pathname.endsWith('geist-mono.woff2') ? dashboardGeistMono : dashboardGeistSans,
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/billing/stripe/webhook') {
        if (!billingProvider || !billingState)
          throw new ManagedError(
            501,
            'billing_integration_required',
            'Stripe billing is not configured',
          );
        await Promise.all([controlStateInitialization, billingStateInitialization]);
        if (controlStateInitializationFailed || billingStateInitializationFailed)
          throw new ManagedError(503, 'billing_state_unavailable', 'billing state is unavailable');
        const signature = request.headers['stripe-signature'];
        if (typeof signature !== 'string' || signature.length > 2048)
          throw new ManagedError(
            400,
            'invalid_billing_signature',
            'a valid Stripe-Signature header is required',
          );
        const rawBody = await readRawBody(request);
        let envelope;
        try {
          envelope = billingProvider.parseWebhook(rawBody, signature);
        } catch {
          throw new ManagedError(
            400,
            'invalid_billing_signature',
            'billing webhook signature or envelope is invalid',
          );
        }
        if (!envelope.subscription_id && !envelope.checkout_session_id) {
          sendJson(response, 200, { received: true, event_status: 'ignored' });
          return;
        }
        let snapshot = envelope.event_snapshot;
        if (envelope.subscription_id)
          try {
            snapshot = await billingProvider.retrieveSubscription(
              envelope.subscription_id,
              envelope.event_type === 'customer.subscription.deleted'
                ? envelope.event_snapshot
                : undefined,
            );
          } catch {
            throw new ManagedError(
              503,
              'billing_provider_unavailable',
              'billing provider reconciliation is unavailable',
            );
          }
        let result;
        try {
          result = await billingState.ingestStripeEvent({
            event_id: envelope.event_id,
            event_created: envelope.event_created,
            event_type: envelope.event_type,
            payload_sha256: envelope.payload_sha256,
            ...(envelope.subscription_id ? { subscription_id: envelope.subscription_id } : {}),
            ...(envelope.checkout_session_id
              ? { checkout_session_id: envelope.checkout_session_id }
              : {}),
            ...(snapshot ? { snapshot } : {}),
            team_price_id: billingProvider.teamPriceId,
          });
        } catch (error) {
          throw billingStateUnavailable(error);
        }
        if (result.event_status === 'pending')
          throw new ManagedError(
            503,
            'billing_binding_unavailable',
            'billing event is retained pending a trusted tenant binding',
          );
        if (result.event_status === 'ready' && result.tenant_id && result.desired_plan) {
          try {
            if (controlState) await controlState.updatePlan(result.tenant_id, result.desired_plan);
            else store.operatorUpdatePlan(result.tenant_id, result.desired_plan);
          } catch (error) {
            throw sharedControlStateUnavailable(error);
          }
          try {
            await billingState.markEventApplied(envelope.event_id);
          } catch (error) {
            throw billingStateUnavailable(error);
          }
        }
        sendJson(response, 200, {
          received: true,
          event_status: result.event_status,
        });
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
      await billingStateInitialization;
      if (billingStateInitializationFailed)
        throw new ManagedError(503, 'billing_state_unavailable', 'billing state is unavailable');
      let principal: Principal;
      try {
        principal = await authenticate(store, controlState, request);
      } catch (error) {
        if (error instanceof ManagedError) throw error;
        throw sharedControlStateUnavailable(error);
      }
      if (billingState)
        try {
          if (!(await billingState.entitlementReady(principal.tenantId)))
            throw new ManagedError(
              503,
              'billing_reconciliation_pending',
              'billing entitlement reconciliation is pending; tenant access is unavailable',
            );
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw new ManagedError(503, 'billing_state_unavailable', 'billing state is unavailable');
        }
      const lifecycleRoute =
        (request.method === 'GET' && url.pathname === '/v1/admin/tenant/lifecycle') ||
        (request.method === 'GET' && url.pathname === '/v1/admin/tenant/export') ||
        (request.method === 'POST' && url.pathname === '/v1/admin/tenant/deletion-request');
      if (principal.lifecycleStatus !== 'active' && !lifecycleRoute) {
        const messages = {
          suspended:
            'tenant access is suspended; only lifecycle and export operations remain available',
          canceled:
            'tenant access is canceled; only lifecycle and export operations remain available',
          deletion_pending:
            'tenant deletion is pending; only lifecycle and export operations remain available',
        } as const;
        throw new ManagedError(
          423,
          `tenant_${principal.lifecycleStatus}`,
          messages[principal.lifecycleStatus],
        );
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
      if (request.method === 'GET' && url.pathname === '/v1/admin/tenant/lifecycle') {
        store.requireScope(principal, 'admin');
        try {
          sendJson(response, 200, {
            lifecycle: controlState
              ? await controlState.tenantLifecycle(principal.tenantId)
              : store.tenantLifecycle(principal),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedControlStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/admin/tenant/export') {
        store.requireScope(principal, 'admin');
        try {
          let exported: Record<string, unknown>;
          if (controlState) {
            if (!sharedControlPool || !sharedActionPool)
              throw new ManagedError(
                503,
                'tenant_export_unavailable',
                'shared tenant export requires the configured control and action database pools',
              );
            const states = [controlState, actionState, schemaState, alertState, intelligenceState];
            if (
              (
                await Promise.all(
                  states.filter((state) => state !== undefined).map(async (state) => state.ready()),
                )
              ).some((ready) => !ready)
            )
              throw new ManagedError(
                503,
                'tenant_export_integrity_invalid',
                'tenant export was refused because shared state readiness failed',
              );
            exported = (await exportSharedTenantData(
              sharedControlPool,
              sharedActionPool,
              principal.tenantId,
            )) as Record<string, unknown>;
          } else exported = store.exportTenantData(principal);
          sendJson(response, 200, exported, {
            'content-disposition': `attachment; filename="akriven-tenant-export-${principal.tenantId}.json"`,
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw controlState
            ? sharedControlStateUnavailable(error)
            : new ManagedError(503, 'tenant_export_unavailable', 'tenant export failed closed');
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/tenant/deletion-request') {
        store.requireScope(principal, 'admin');
        const input = asRecord(await guardedBody());
        if (input.confirm_tenant_id !== principal.tenantId)
          throw new ManagedError(
            400,
            'tenant_confirmation_required',
            'confirm_tenant_id must exactly match the authenticated tenant',
          );
        try {
          let lifecycle;
          if (controlState) {
            const currentShared = await controlState.tenantLifecycle(principal.tenantId);
            const currentLocal = store.operatorTenantLifecycle(principal.tenantId);
            let localChanged = false;
            if (currentLocal.status !== 'deletion_pending') {
              store.operatorUpdateTenantLifecycle(
                principal.tenantId,
                'deletion_pending',
                'customer_requested',
              );
              localChanged = true;
            }
            try {
              lifecycle =
                currentShared.status === 'deletion_pending'
                  ? currentShared
                  : await controlState.updateTenantLifecycle(
                      principal.tenantId,
                      'deletion_pending',
                      'customer_requested',
                    );
            } catch (error) {
              if (localChanged)
                store.operatorUpdateTenantLifecycle(
                  principal.tenantId,
                  currentLocal.status,
                  currentLocal.reason_code,
                );
              throw error;
            }
          } else {
            const current = store.tenantLifecycle(principal);
            lifecycle =
              current.status === 'deletion_pending'
                ? current
                : store.updateTenantLifecycle(principal, 'deletion_pending', 'customer_requested');
          }
          sendJson(response, 202, {
            lifecycle,
            execution: 'operator_confirmation_required',
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedControlStateUnavailable(error);
        }
        return;
      }
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
      if (request.method === 'GET' && url.pathname === '/v1/admin/actions/descriptors') {
        store.requireScope(principal, 'admin');
        try {
          sendJson(response, 200, {
            descriptors: actionState
              ? await actionState.listActionDescriptors(principal.tenantId)
              : store.listActionDescriptors(principal),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/actions/challenges') {
        store.requireScope(principal, 'approve:action');
        const requestedStatus = url.searchParams.get('status') ?? undefined;
        if (
          requestedStatus !== undefined &&
          !['pending', 'approved', 'revoked'].includes(requestedStatus)
        )
          throw new ManagedError(
            400,
            'invalid_action_challenge_status',
            'action challenge status is invalid',
          );
        const limit = Number(url.searchParams.get('limit') ?? 100);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
          throw new ManagedError(
            400,
            'invalid_action_challenge_limit',
            'action challenge limit must be 1-500',
          );
        try {
          sendJson(response, 200, {
            challenges: actionState
              ? await actionState.listActionChallenges(
                  principal.tenantId,
                  requestedStatus as 'pending' | 'approved' | 'revoked' | undefined,
                  limit,
                )
              : store.listActionChallenges(
                  principal,
                  requestedStatus as 'pending' | 'approved' | 'revoked' | undefined,
                  limit,
                ),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedStateUnavailable(error);
        }
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
          if (!(await actionCheckpointAcknowledged(principal)))
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
      if (request.method === 'GET' && url.pathname === '/v1/schemas') {
        store.requireScope(principal, 'read:environment');
        try {
          sendJson(response, 200, {
            schemas: schemaState
              ? await schemaState.listLatestSchemas(principal.tenantId)
              : store.listLatestSchemas(principal),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedSchemaStateUnavailable(error);
        }
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
        store.requireScope(principal, 'read:environment');
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
        store.requireScope(principal, 'read:environment');
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
        sendJson(response, 200, await loadTenantIntelligence(principal));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/intelligence/evaluation-export') {
        store.requireScope(principal, 'read:intelligence');
        sendJson(
          response,
          200,
          valueFreeEvaluationExport(await loadTenantIntelligence(principal)),
          {
            'content-disposition': 'attachment; filename="akriven-value-free-evaluation.json"',
            'cache-control': 'no-store',
          },
        );
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
          plan_name: managedPlan(principal.plan).display_name,
          monthly_limit: principal.monthlyLimit,
          entitlements: effectivePlanEntitlements(principal.plan, principal.retentionDays),
          usage,
          payment_processing: managedPlan(principal.plan).payment_collection,
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
      if (request.method === 'GET' && url.pathname === '/v1/inventory') {
        store.requireScope(principal, 'admin');
        try {
          const [schemas, releases, environments, descriptors, compatibility] = await Promise.all([
            schemaState
              ? schemaState.listLatestSchemas(principal.tenantId)
              : Promise.resolve(store.listLatestSchemas(principal)),
            schemaState
              ? schemaState.listSchemaReleases(principal.tenantId, undefined, 500)
              : Promise.resolve(store.listSchemaReleases(principal, undefined, 500)),
            schemaState
              ? schemaState.listEnvironments(principal.tenantId)
              : Promise.resolve(store.listEnvironments(principal)),
            actionState
              ? actionState.listActionDescriptors(principal.tenantId)
              : Promise.resolve(store.listActionDescriptors(principal)),
            intelligenceState
              ? intelligenceState.compatibilityMatrix(principal.tenantId)
              : Promise.resolve(
                  store.tenantIntelligence(principal).compatibility_matrix as unknown[],
                ),
          ]);
          sendJson(
            response,
            200,
            managedInventory({
              schemas: schemas as ManagedInventoryInput['schemas'],
              releases: releases as ManagedInventoryInput['releases'],
              environments: environments as ManagedInventoryInput['environments'],
              descriptors: descriptors as ManagedInventoryInput['descriptors'],
              compatibility: compatibility as ManagedInventoryInput['compatibility'],
            }),
          );
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw new ManagedError(
            503,
            'inventory_state_unavailable',
            'registered and observed inventory is unavailable',
          );
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/billing/checkout-session') {
        store.requireScope(principal, 'admin');
        if (!billingProvider || !billingState)
          throw new ManagedError(
            501,
            'billing_integration_required',
            'Stripe billing is not configured',
          );
        if (await billingState.customerForTenant(principal.tenantId))
          throw new ManagedError(
            409,
            'billing_subscription_exists',
            'use the billing portal to manage the existing subscription',
          );
        try {
          const session = await billingProvider.createCheckoutSession({
            tenantReference: billingTenantReference(config.masterSecret, principal.tenantId),
          });
          await billingState.recordCheckoutSession(
            principal.tenantId,
            session.session_id,
            session.expires_at,
          );
          sendJson(response, 201, session);
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw new ManagedError(
            503,
            'billing_provider_unavailable',
            'billing checkout is unavailable',
          );
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/billing/portal-session') {
        store.requireScope(principal, 'admin');
        if (!billingProvider || !billingState)
          throw new ManagedError(
            501,
            'billing_integration_required',
            'Stripe billing is not configured',
          );
        const customerId = await billingState.customerForTenant(principal.tenantId);
        if (!customerId)
          throw new ManagedError(
            409,
            'billing_subscription_missing',
            'start checkout before opening the billing portal',
          );
        try {
          sendJson(response, 201, await billingProvider.createPortalSession(customerId));
        } catch {
          throw new ManagedError(
            503,
            'billing_provider_unavailable',
            'billing portal is unavailable',
          );
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
        const billing = billingState ? await billingState.statement(principal.tenantId) : undefined;
        sendJson(response, 200, {
          period: usage.month,
          plan: principal.plan,
          plan_name: managedPlan(principal.plan).display_name,
          included_validations: principal.monthlyLimit,
          entitlements: effectivePlanEntitlements(principal.plan, principal.retentionDays),
          offer: managedPlan(principal.plan).price,
          usage,
          amount_due: null,
          currency: null,
          payment_processing: billing ? 'stripe' : 'integration_required',
          ...(billing ? { subscription: billing } : {}),
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
      if (request.method === 'POST' && /^\/v1\/alerts\/\d+\/acknowledge$/u.test(url.pathname)) {
        store.requireScope(principal, 'admin');
        const alertId = Number(url.pathname.split('/')[3]);
        try {
          const acknowledged = alertState
            ? await alertState.acknowledgeAlert(principal.tenantId, alertId)
            : store.acknowledgeAlert(principal, alertId);
          if (!acknowledged) throw new ManagedError(404, 'alert_not_found', 'alert does not exist');
          sendJson(response, 200, { acknowledged: true, alert_id: alertId });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedAlertStateUnavailable(error);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/admin/control-plane-integrity') {
        store.requireScope(principal, 'admin');
        if (
          controlState ||
          schemaState ||
          alertState ||
          actionState ||
          intelligenceState ||
          billingState
        ) {
          try {
            const [audit, releases, alerts, actions, intelligence, billing] = await Promise.all([
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
              billingState
                ? billingState.verifyIntegrity(principal.tenantId)
                : Promise.resolve({ valid: true, checked: 0 }),
            ]);
            const components = { audit, releases, alerts, actions, intelligence, billing };
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
      if (request.method === 'GET' && url.pathname === '/v1/admin/api-keys') {
        store.requireScope(principal, 'admin');
        try {
          sendJson(response, 200, {
            api_keys: controlState
              ? await controlState.listApiKeys(principal.tenantId, principal.keyId)
              : store.listApiKeys(principal),
          });
        } catch (error) {
          if (error instanceof ManagedError) throw error;
          throw sharedControlStateUnavailable(error);
        }
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
        store.requireScope(principal, 'admin');
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
      if (request.method === 'GET' && url.pathname === '/v1/admin/policy') {
        store.requireScope(principal, 'admin');
        sendJson(response, 200, { policy: principal.policy });
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/v1/admin/plan') {
        if (config.publicMode)
          throw new ManagedError(
            501,
            'billing_integration_required',
            'public plan changes require a verified billing or operator workflow',
          );
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
        billingStateInitialization,
      ]);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (actionState) await actionState.close();
      if (controlState) await controlState.close();
      if (schemaState) await schemaState.close();
      if (alertState) await alertState.close();
      if (intelligenceState) await intelligenceState.close();
      if (billingState) await billingState.close();
      await Promise.all([...ownedSharedPools].map((pool) => pool.end()));
      store.close();
    },
  };
}

export function validateManagedConfig(config: ManagedConfig): void {
  if (!config.databasePath) throw new Error('SCHEMA_GUARD_DATABASE is required');
  if (!config.masterSecret || config.masterSecret.length < 32)
    throw new Error('SCHEMA_GUARD_MASTER_SECRET must be at least 32 characters');
  if (
    config.metricsBearerToken !== undefined &&
    (config.metricsBearerToken.length < 32 || config.metricsBearerToken.length > 512)
  )
    throw new Error('SCHEMA_GUARD_METRICS_BEARER_TOKEN must be 32 through 512 characters');
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
  if (
    config.actionCheckpointAnchorUrl &&
    (config.actionCheckpointAnchorRequestTimeoutMs ?? 5_000) >= (config.requestTimeoutMs ?? 10_000)
  )
    throw new Error(
      'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS must be lower than SCHEMA_GUARD_REQUEST_TIMEOUT_MS',
    );
  const stripeValues = [
    config.stripeMode,
    config.stripeSecretKey,
    config.stripeWebhookSecret,
    config.stripeTeamPriceId,
    config.stripeCheckoutSuccessUrl,
    config.stripeCheckoutCancelUrl,
    config.stripePortalReturnUrl,
  ];
  if (
    stripeValues.some((value) => value !== undefined) &&
    !stripeValues.every((value) => value !== undefined)
  )
    throw new Error(
      'Stripe billing requires secret key, webhook secret, team price, checkout success/cancel URLs, and portal return URL together',
    );
  if (stripeValues.every((value) => value !== undefined)) {
    if (
      config.stripeMode !== 'sandbox' ||
      !config.stripeSecretKey!.startsWith('sk_test_') ||
      !config.stripeWebhookSecret!.startsWith('whsec_') ||
      !/^price_[A-Za-z0-9_]+$/u.test(config.stripeTeamPriceId!)
    )
      throw new Error(
        'Stripe billing must use sandbox mode with a test secret key, valid webhook secret, and team price identifier',
      );
    if (!config.sharedControlDatabaseUrl)
      throw new Error('Stripe billing requires shared PostgreSQL control state');
    for (const value of [
      config.stripeCheckoutSuccessUrl!,
      config.stripeCheckoutCancelUrl!,
      config.stripePortalReturnUrl!,
    ]) {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error('Stripe billing return URLs must be absolute HTTPS URLs');
      }
      if (parsed.protocol !== 'https:')
        throw new Error('Stripe billing return URLs must be absolute HTTPS URLs');
    }
  }
  if (config.publicMode) {
    if (!config.metricsBearerToken)
      throw new Error('public mode requires SCHEMA_GUARD_METRICS_BEARER_TOKEN');
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
  const masterSecret = environmentValue('SCHEMA_GUARD_MASTER_SECRET');
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
    ...(process.env.SCHEMA_GUARD_ACCESS_LOG
      ? { accessLog: process.env.SCHEMA_GUARD_ACCESS_LOG === 'true' }
      : {}),
    ...(process.env.SCHEMA_GUARD_ALERT_FILE
      ? { alertFile: process.env.SCHEMA_GUARD_ALERT_FILE }
      : {}),
  };
  if (process.env.SCHEMA_GUARD_EXTERNAL_URL)
    config.externalUrl = process.env.SCHEMA_GUARD_EXTERNAL_URL;
  const sharedActionDatabaseUrl = environmentValue('SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL');
  if (sharedActionDatabaseUrl) config.sharedActionDatabaseUrl = sharedActionDatabaseUrl;
  const sharedControlDatabaseUrl = environmentValue('SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL');
  if (sharedControlDatabaseUrl) config.sharedControlDatabaseUrl = sharedControlDatabaseUrl;
  const metricsBearerToken = environmentValue('SCHEMA_GUARD_METRICS_BEARER_TOKEN');
  if (metricsBearerToken) config.metricsBearerToken = metricsBearerToken;
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
  const actionCheckpointAnchorSigningSecret = environmentValue(
    'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET',
  );
  if (actionCheckpointAnchorSigningSecret)
    config.actionCheckpointAnchorSigningSecret = actionCheckpointAnchorSigningSecret;
  const stripeSecretKey = environmentValue('SCHEMA_GUARD_STRIPE_SECRET_KEY');
  if (stripeSecretKey) config.stripeSecretKey = stripeSecretKey;
  if (process.env.SCHEMA_GUARD_STRIPE_MODE === 'sandbox') config.stripeMode = 'sandbox';
  const stripeWebhookSecret = environmentValue('SCHEMA_GUARD_STRIPE_WEBHOOK_SECRET');
  if (stripeWebhookSecret) config.stripeWebhookSecret = stripeWebhookSecret;
  if (process.env.SCHEMA_GUARD_STRIPE_TEAM_PRICE_ID)
    config.stripeTeamPriceId = process.env.SCHEMA_GUARD_STRIPE_TEAM_PRICE_ID;
  if (process.env.SCHEMA_GUARD_STRIPE_CHECKOUT_SUCCESS_URL)
    config.stripeCheckoutSuccessUrl = process.env.SCHEMA_GUARD_STRIPE_CHECKOUT_SUCCESS_URL;
  if (process.env.SCHEMA_GUARD_STRIPE_CHECKOUT_CANCEL_URL)
    config.stripeCheckoutCancelUrl = process.env.SCHEMA_GUARD_STRIPE_CHECKOUT_CANCEL_URL;
  if (process.env.SCHEMA_GUARD_STRIPE_PORTAL_RETURN_URL)
    config.stripePortalReturnUrl = process.env.SCHEMA_GUARD_STRIPE_PORTAL_RETURN_URL;
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
