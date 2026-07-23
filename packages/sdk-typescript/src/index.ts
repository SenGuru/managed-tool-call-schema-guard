import {
  compileToolContract,
  detectSchemaDrift,
  evaluateActionGate,
  normalizeTool,
  validateToolCall,
  type AdapterName,
  type ActionControlPolicy,
  type ActionDescriptor,
  type ActionGateContext,
  type ActionGateDecision,
  type ApprovalChallenge,
  type ApprovalEvidence,
  type CompileContractRequest,
  type CompiledContract,
  type GuardDecision,
  type GuardPolicy,
  type DriftReport,
  type JsonObject,
  type IdempotencyLedger,
  type ValidateRequest,
} from '@schema-guard/core';
export type { GuardDecision, ValidateRequest } from '@schema-guard/core';

export class SchemaGuardConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaGuardConfigurationError';
  }
}

export class SchemaGuardServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'SchemaGuardServiceError';
  }
}

export class SchemaGuardTimeoutError extends SchemaGuardServiceError {
  constructor(public readonly timeoutMs: number) {
    super(`Schema Guard request exceeded ${timeoutMs} ms`, undefined, 'request_timeout');
    this.name = 'SchemaGuardTimeoutError';
  }
}

export interface SchemaGuardClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface SchemaGuardValidateOptions {
  signal?: AbortSignal;
}

export interface ManagedPendingActionReservation {
  reservation_id: string;
  execution_fingerprint: string;
  audit_id: string;
  tool_name_hash: string;
  environment: string;
  created_at: string;
  updated_at: string;
  age_seconds: number;
}

export interface ManagedActionReconciliation {
  reconciliation_id: string;
  reservation_id: string;
  execution_fingerprint: string;
  audit_id: string;
  tool_name_hash: string;
  environment: string;
  outcome: 'confirmed_executed' | 'confirmed_not_executed';
  evidence_hash: string;
  reconciled_by_hash: string;
  reconciled_at: string;
  previous_hash: string;
  record_hash: string;
  integrity_valid?: boolean;
}

export interface ManagedActionIdempotencyCheckpoint {
  checkpoint_version: '1';
  tenant_ref: string;
  revision: number;
  row_count: number;
  accumulator: string;
  updated_at: string;
  checkpoint_hash: string;
}

export interface ManagedActionIdempotencyCheckpointComparison {
  status: 'same' | 'advanced' | 'rollback_detected' | 'integrity_conflict';
  anchored_revision: number;
  current_revision: number;
  current_checkpoint: ManagedActionIdempotencyCheckpoint;
}

export interface ManagedActionCheckpointAnchorDelivery {
  delivery_id: string;
  revision: number;
  checkpoint_hash: string;
  status: 'pending' | 'processing' | 'delivered' | 'dead';
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  delivered_at: string | null;
  response_status: number | null;
  error_code: string | null;
  created_at: string;
}

export interface ManagedAlertWebhook {
  webhook_id: string;
  label: string;
  endpoint_hash: string;
  created_at: string;
  disabled_at: string | null;
}

export interface CreatedManagedAlertWebhook extends ManagedAlertWebhook {
  signing_secret: string;
}

export interface ManagedAlertWebhookDelivery {
  delivery_id: string;
  webhook_id: string;
  alert_id: number;
  status: 'pending' | 'processing' | 'delivered' | 'dead';
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  delivered_at: string | null;
  response_status: number | null;
  error_code: string | null;
  created_at: string;
}

export interface ManagedSchemaRelease {
  release_id: string;
  tool_name_hash: string;
  environment: string;
  schema_hash: string;
  adapter: string;
  version: string;
  compatibility: 'initial' | 'identical' | 'backward_compatible' | 'breaking' | 'review';
  evidence_hash: string;
  promoted_by_hash: string;
  promoted_at: string;
  previous_hash: string;
  record_hash: string;
  integrity_valid?: boolean;
  drift?: DriftReport | null;
}

export interface ManagedSchemaRegistration {
  schema_hash: string;
  drift: DriftReport | null;
}

export interface ManagedUsage {
  tenant_id: string;
  month: string;
  validation_count: number;
  repair_count: number;
  rejection_count: number;
  drift_count: number;
}

export interface ManagedUsageStatement {
  plan: 'trial' | 'team';
  monthly_limit: number;
  usage: ManagedUsage;
  payment_processing: string;
}

export interface ManagedAuditRecord {
  [key: string]: unknown;
  sequence: number;
  audit_id: string;
  occurred_at: string;
  decision: GuardDecision['decision'];
  reason_code: string | null;
  repair_rules: string[];
}

export interface ManagedAlert {
  id: number;
  alert_id: string;
  kind: string;
  severity: string;
  detail: Record<string, unknown>;
  created_at: string;
  acknowledged_at: null;
}

export interface ManagedEnvironment {
  id: string;
  name: string;
  policy: GuardPolicy;
  schema_enforcement: 'observe' | 'enforce';
  created_at: string;
  updated_at: string;
}

export interface IssuedManagedApiKey {
  key_id: string;
  api_key: string;
  scopes: string[];
}

export interface ManagedTenantLifecycle {
  status: 'active' | 'suspended' | 'canceled' | 'deletion_pending';
  reason_code: string | null;
  deletion_requested_at: string | null;
  updated_at: string;
}

export interface ManagedTenantExport {
  export_version: number;
  generated_at: string;
  tenant_id: string;
  content_sha256: string;
  tenant: Record<string, unknown>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export class SchemaGuardClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: SchemaGuardClientOptions = {}) {
    if (options.baseUrl && !options.apiKey)
      throw new SchemaGuardConfigurationError('apiKey is required when baseUrl is configured');
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) ||
        !Number.isInteger(options.timeoutMs) ||
        options.timeoutMs < 1)
    )
      throw new SchemaGuardConfigurationError('timeoutMs must be a positive finite integer');
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }
  validateLocal(request: ValidateRequest): GuardDecision {
    return validateToolCall(request);
  }
  compileLocal(request: CompileContractRequest): CompiledContract {
    return compileToolContract(request);
  }
  private async post(
    path: string,
    body: unknown,
    callOptions: SchemaGuardValidateOptions,
    method = 'POST',
  ): Promise<{ payload: unknown; status: number }> {
    if (!this.options.baseUrl)
      throw new SchemaGuardConfigurationError('baseUrl is required for a remote request');
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort(callOptions.signal?.reason);
    if (callOptions.signal?.aborted) onAbort();
    else callOptions.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await (this.options.fetch ?? fetch)(
        `${this.options.baseUrl.replace(/\/$/u, '')}${path}`,
        {
          method,
          headers: {
            authorization: `Bearer ${this.options.apiKey!}`,
            'content-type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        },
      );
      const payload = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok && response.status !== 422) {
        const error =
          payload !== null && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : {};
        throw new SchemaGuardServiceError(
          typeof error.message === 'string'
            ? error.message
            : `Schema Guard service failed with ${response.status}`,
          response.status,
          typeof error.error === 'string' ? error.error : undefined,
        );
      }
      return { payload, status: response.status };
    } catch (error) {
      if (timedOut) throw new SchemaGuardTimeoutError(this.timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      callOptions.signal?.removeEventListener('abort', onAbort);
    }
  }
  async validate(
    request: ValidateRequest,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<GuardDecision> {
    if (!this.options.baseUrl) return this.validateLocal(request);
    const { payload, status } = await this.post('/v1/validate', request, callOptions);
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !['valid', 'valid_with_repair', 'rejected'].includes(
        String((payload as Record<string, unknown>).decision),
      )
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid decision envelope',
        status,
        'invalid_service_response',
      );
    return payload as GuardDecision;
  }
  async compile(
    request: CompileContractRequest,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<CompiledContract> {
    if (!this.options.baseUrl) return this.compileLocal(request);
    const { payload, status } = await this.post('/v1/contracts/compile', request, callOptions);
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      ![
        'native',
        'lossless_transform',
        'policy_required',
        'unsupported',
        'runtime_unverified',
      ].includes(String((payload as Record<string, unknown>).status)) ||
      (payload as Record<string, unknown>).target !== request.target
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid compiled contract envelope',
        status,
        'invalid_service_response',
      );
    return payload as CompiledContract;
  }
  async registerManagedActionDescriptor(
    input: ActionDescriptor & { environment: string },
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ActionDescriptor & { environment: string }> {
    const { payload, status } = await this.post(
      '/v1/admin/actions/descriptors',
      input,
      callOptions,
      'PUT',
    );
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid action descriptor',
        status,
        'invalid_service_response',
      );
    return payload as ActionDescriptor & { environment: string };
  }
  async createManagedActionChallenge(
    input: {
      decision: GuardDecision;
      tool_name: string;
      environment: string;
      expires_in_seconds: number;
    },
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ApprovalChallenge> {
    const { payload, status } = await this.post('/v1/actions/challenges', input, callOptions);
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).challenge_id !== 'string' ||
      typeof (payload as Record<string, unknown>).binding_hash !== 'string'
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid approval challenge',
        status,
        'invalid_service_response',
      );
    return payload as ApprovalChallenge;
  }
  async approveManagedActionChallenge(
    challengeId: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ApprovalEvidence> {
    const { payload, status } = await this.post(
      `/v1/actions/challenges/${encodeURIComponent(challengeId)}/approve`,
      {},
      callOptions,
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).signature !== 'string'
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned invalid approval evidence',
        status,
        'invalid_service_response',
      );
    return payload as ApprovalEvidence;
  }
  async evaluateManagedAction(
    input: {
      decision: GuardDecision;
      tool_name: string;
      environment: string;
      approval?: ApprovalEvidence;
      idempotency_key?: string;
    },
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ActionGateDecision> {
    const { payload, status } = await this.post('/v1/actions/evaluate', input, callOptions);
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !['allowed', 'approval_required', 'rejected', 'duplicate_blocked'].includes(
        String((payload as Record<string, unknown>).status),
      ) ||
      !/^sha256:[0-9a-f]{64}$/u.test(
        String((payload as Record<string, unknown>).execution_fingerprint),
      )
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid action decision',
        status,
        'invalid_service_response',
      );
    return payload as ActionGateDecision;
  }
  async completeManagedAction(
    idempotencyKey: string,
    executionFingerprint: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<void> {
    await this.post(
      '/v1/actions/idempotency/complete',
      { idempotency_key: idempotencyKey, execution_fingerprint: executionFingerprint },
      callOptions,
    );
  }
  async releaseManagedAction(
    idempotencyKey: string,
    executionFingerprint: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<void> {
    await this.post(
      '/v1/actions/idempotency/release',
      { idempotency_key: idempotencyKey, execution_fingerprint: executionFingerprint },
      callOptions,
    );
  }
  async getManagedActionIdempotencyCheckpoint(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedActionIdempotencyCheckpoint> {
    const { payload, status } = await this.post(
      '/v1/actions/idempotency/checkpoint',
      undefined,
      callOptions,
      'GET',
    );
    const checkpoint = payload as Record<string, unknown> | null;
    if (
      checkpoint === null ||
      typeof checkpoint !== 'object' ||
      Array.isArray(checkpoint) ||
      checkpoint.checkpoint_version !== '1' ||
      !/^hmac-sha256:[0-9a-f]{64}$/u.test(String(checkpoint.tenant_ref)) ||
      !Number.isInteger(checkpoint.revision) ||
      Number(checkpoint.revision) < 0 ||
      !Number.isInteger(checkpoint.row_count) ||
      Number(checkpoint.row_count) < 0 ||
      !/^xor256:[0-9a-f]{64}$/u.test(String(checkpoint.accumulator)) ||
      typeof checkpoint.updated_at !== 'string' ||
      !/^hmac-sha256:[0-9a-f]{64}$/u.test(String(checkpoint.checkpoint_hash))
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid action idempotency checkpoint',
        status,
        'invalid_service_response',
      );
    return checkpoint as unknown as ManagedActionIdempotencyCheckpoint;
  }
  async compareManagedActionIdempotencyCheckpoint(
    checkpoint: ManagedActionIdempotencyCheckpoint,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedActionIdempotencyCheckpointComparison> {
    const { payload, status } = await this.post(
      '/v1/actions/idempotency/checkpoint/compare',
      { checkpoint },
      callOptions,
    );
    const comparison = payload as Record<string, unknown> | null;
    if (
      comparison === null ||
      typeof comparison !== 'object' ||
      Array.isArray(comparison) ||
      !['same', 'advanced', 'rollback_detected', 'integrity_conflict'].includes(
        String(comparison.status),
      ) ||
      !Number.isInteger(comparison.anchored_revision) ||
      !Number.isInteger(comparison.current_revision) ||
      comparison.current_checkpoint === null ||
      typeof comparison.current_checkpoint !== 'object' ||
      Array.isArray(comparison.current_checkpoint)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid checkpoint comparison',
        status,
        'invalid_service_response',
      );
    return comparison as unknown as ManagedActionIdempotencyCheckpointComparison;
  }
  async listManagedActionCheckpointAnchorDeliveries(
    limit = 100,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedActionCheckpointAnchorDelivery[]> {
    const { payload, status } = await this.post(
      `/v1/actions/idempotency/anchors/deliveries?limit=${encodeURIComponent(limit)}`,
      undefined,
      callOptions,
      'GET',
    );
    const deliveries =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).deliveries
        : undefined;
    if (!Array.isArray(deliveries))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid checkpoint-anchor delivery list',
        status,
        'invalid_service_response',
      );
    return deliveries as ManagedActionCheckpointAnchorDelivery[];
  }
  async redriveManagedActionCheckpointAnchorDelivery(
    deliveryId: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<void> {
    await this.post(
      `/v1/actions/idempotency/anchors/deliveries/${encodeURIComponent(deliveryId)}/redrive`,
      {},
      callOptions,
    );
  }
  async listPendingManagedActions(
    olderThanSeconds?: number,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedPendingActionReservation[]> {
    const query =
      olderThanSeconds === undefined
        ? ''
        : `?older_than_seconds=${encodeURIComponent(olderThanSeconds)}`;
    const { payload, status } = await this.post(
      `/v1/actions/reconciliation/pending${query}`,
      undefined,
      callOptions,
      'GET',
    );
    const pending =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).pending
        : undefined;
    if (!Array.isArray(pending))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid pending-action list',
        status,
        'invalid_service_response',
      );
    return pending as ManagedPendingActionReservation[];
  }
  async reconcileManagedAction(
    reservationId: string,
    outcome: ManagedActionReconciliation['outcome'],
    evidenceReference: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedActionReconciliation> {
    const { payload, status } = await this.post(
      `/v1/actions/reconciliation/${encodeURIComponent(reservationId)}`,
      { outcome, evidence_reference: evidenceReference },
      callOptions,
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).reconciliation_id !== 'string' ||
      (payload as Record<string, unknown>).reservation_id !== reservationId
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid reconciliation record',
        status,
        'invalid_service_response',
      );
    return payload as ManagedActionReconciliation;
  }
  async listManagedActionReconciliations(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedActionReconciliation[]> {
    const { payload, status } = await this.post(
      '/v1/actions/reconciliation/history',
      undefined,
      callOptions,
      'GET',
    );
    const reconciliations =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).reconciliations
        : undefined;
    if (!Array.isArray(reconciliations))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid reconciliation history',
        status,
        'invalid_service_response',
      );
    return reconciliations as ManagedActionReconciliation[];
  }
  async verifyManagedActionReconciliations(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<{ valid: boolean; checked: number; first_invalid_reconciliation_id?: string }> {
    const { payload, status } = await this.post(
      '/v1/actions/reconciliation/verify',
      undefined,
      callOptions,
      'GET',
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).valid !== 'boolean' ||
      !Number.isInteger((payload as Record<string, unknown>).checked)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid reconciliation verification result',
        status,
        'invalid_service_response',
      );
    return payload as {
      valid: boolean;
      checked: number;
      first_invalid_reconciliation_id?: string;
    };
  }
  async createManagedAlertWebhook(
    label: string,
    endpoint: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<CreatedManagedAlertWebhook> {
    const { payload, status } = await this.post(
      '/v1/alert-webhooks',
      { label, endpoint },
      callOptions,
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).webhook_id !== 'string' ||
      typeof (payload as Record<string, unknown>).signing_secret !== 'string'
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid alert webhook',
        status,
        'invalid_service_response',
      );
    return payload as CreatedManagedAlertWebhook;
  }
  async listManagedAlertWebhooks(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedAlertWebhook[]> {
    const { payload, status } = await this.post(
      '/v1/alert-webhooks',
      undefined,
      callOptions,
      'GET',
    );
    const webhooks =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).webhooks
        : undefined;
    if (!Array.isArray(webhooks))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid alert-webhook list',
        status,
        'invalid_service_response',
      );
    return webhooks as ManagedAlertWebhook[];
  }
  async listManagedAlertWebhookDeliveries(
    limit = 100,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedAlertWebhookDelivery[]> {
    const { payload, status } = await this.post(
      `/v1/alert-webhooks/deliveries?limit=${encodeURIComponent(limit)}`,
      undefined,
      callOptions,
      'GET',
    );
    const deliveries =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).deliveries
        : undefined;
    if (!Array.isArray(deliveries))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid alert-delivery list',
        status,
        'invalid_service_response',
      );
    return deliveries as ManagedAlertWebhookDelivery[];
  }
  async disableManagedAlertWebhook(
    webhookId: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<void> {
    await this.post(
      `/v1/alert-webhooks/${encodeURIComponent(webhookId)}`,
      undefined,
      callOptions,
      'DELETE',
    );
  }
  async redriveManagedAlertWebhookDelivery(
    deliveryId: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<void> {
    await this.post(
      `/v1/alert-webhooks/deliveries/${encodeURIComponent(deliveryId)}/redrive`,
      {},
      callOptions,
    );
  }
  async promoteManagedSchema(
    input: {
      tool_name: string;
      version: string;
      environment: string;
      expected_schema_hash: string;
      allow_breaking?: boolean;
      evidence_reference?: string;
    },
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedSchemaRelease> {
    const { payload, status } = await this.post('/v1/schema-releases', input, callOptions);
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).release_id !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(String((payload as Record<string, unknown>).schema_hash))
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid schema release',
        status,
        'invalid_service_response',
      );
    return payload as ManagedSchemaRelease;
  }
  async registerManagedSchema(
    input: {
      tool_name: string;
      adapter: 'json_schema' | 'mcp' | 'openai_agents' | 'pydantic_ai' | 'google_adk';
      version: string;
      schema: JsonObject | boolean;
    },
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedSchemaRegistration> {
    const { payload, status } = await this.post('/v1/schemas', input, callOptions);
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !/^sha256:[0-9a-f]{64}$/u.test(String((payload as Record<string, unknown>).schema_hash)) ||
      ((payload as Record<string, unknown>).drift !== null &&
        typeof (payload as Record<string, unknown>).drift !== 'object')
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid schema registration',
        status,
        'invalid_service_response',
      );
    return payload as ManagedSchemaRegistration;
  }
  async listManagedSchemaReleases(
    options: { environment?: string; limit?: number } = {},
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedSchemaRelease[]> {
    const query = new URLSearchParams();
    if (options.environment) query.set('environment', options.environment);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const { payload, status } = await this.post(
      `/v1/schema-releases${query.size ? `?${query}` : ''}`,
      undefined,
      callOptions,
      'GET',
    );
    const releases =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).releases
        : undefined;
    if (!Array.isArray(releases))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid schema-release list',
        status,
        'invalid_service_response',
      );
    return releases as ManagedSchemaRelease[];
  }
  async verifyManagedSchemaReleases(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<{ valid: boolean; checked: number; first_invalid_release_id?: string }> {
    const { payload, status } = await this.post(
      '/v1/schema-releases/verify',
      undefined,
      callOptions,
      'GET',
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).valid !== 'boolean' ||
      !Number.isInteger((payload as Record<string, unknown>).checked)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid schema-release verification result',
        status,
        'invalid_service_response',
      );
    return payload as {
      valid: boolean;
      checked: number;
      first_invalid_release_id?: string;
    };
  }
  async setManagedEnvironmentSchemaEnforcement(
    environmentId: string,
    mode: 'observe' | 'enforce',
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<void> {
    await this.post(
      `/v1/admin/environments/${encodeURIComponent(environmentId)}/schema-enforcement`,
      { mode },
      callOptions,
      'PUT',
    );
  }
  async getManagedUsage(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedUsageStatement> {
    const { payload, status } = await this.post('/v1/usage', undefined, callOptions, 'GET');
    const record = payload as Record<string, unknown> | null;
    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      !['trial', 'team'].includes(String(record.plan)) ||
      !Number.isInteger(record.monthly_limit) ||
      record.usage === null ||
      typeof record.usage !== 'object' ||
      Array.isArray(record.usage)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid usage statement',
        status,
        'invalid_service_response',
      );
    return record as unknown as ManagedUsageStatement;
  }
  async getManagedTenantLifecycle(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedTenantLifecycle> {
    const { payload, status } = await this.post(
      '/v1/admin/tenant/lifecycle',
      undefined,
      callOptions,
      'GET',
    );
    const lifecycle =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).lifecycle
        : undefined;
    if (
      lifecycle === null ||
      typeof lifecycle !== 'object' ||
      Array.isArray(lifecycle) ||
      !['active', 'suspended', 'canceled', 'deletion_pending'].includes(
        String((lifecycle as Record<string, unknown>).status),
      ) ||
      typeof (lifecycle as Record<string, unknown>).updated_at !== 'string'
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid tenant lifecycle',
        status,
        'invalid_service_response',
      );
    return lifecycle as ManagedTenantLifecycle;
  }
  async exportManagedTenantData(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedTenantExport> {
    const { payload, status } = await this.post(
      '/v1/admin/tenant/export',
      undefined,
      callOptions,
      'GET',
    );
    const record = payload as Record<string, unknown> | null;
    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      !Number.isInteger(record.export_version) ||
      typeof record.generated_at !== 'string' ||
      typeof record.tenant_id !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(record.content_sha256)) ||
      record.tenant === null ||
      typeof record.tenant !== 'object' ||
      Array.isArray(record.tenant) ||
      record.tables === null ||
      typeof record.tables !== 'object' ||
      Array.isArray(record.tables)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid tenant export',
        status,
        'invalid_service_response',
      );
    return record as unknown as ManagedTenantExport;
  }
  async requestManagedTenantDeletion(
    confirmTenantId: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedTenantLifecycle> {
    const { payload, status } = await this.post(
      '/v1/admin/tenant/deletion-request',
      { confirm_tenant_id: confirmTenantId },
      callOptions,
    );
    const lifecycle =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).lifecycle
        : undefined;
    if (
      lifecycle === null ||
      typeof lifecycle !== 'object' ||
      Array.isArray(lifecycle) ||
      (lifecycle as Record<string, unknown>).status !== 'deletion_pending'
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid deletion request result',
        status,
        'invalid_service_response',
      );
    return lifecycle as ManagedTenantLifecycle;
  }
  async listManagedAudits(
    limit = 100,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedAuditRecord[]> {
    const { payload, status } = await this.post(
      `/v1/audits?limit=${encodeURIComponent(limit)}`,
      undefined,
      callOptions,
      'GET',
    );
    const audits =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).audits
        : undefined;
    if (!Array.isArray(audits))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid audit list',
        status,
        'invalid_service_response',
      );
    return audits as ManagedAuditRecord[];
  }
  async verifyManagedAudits(callOptions: SchemaGuardValidateOptions = {}): Promise<{
    valid: boolean;
    checked: number;
    first_invalid_sequence?: number;
    anchor_invalid?: boolean;
    manifest_invalid?: boolean;
  }> {
    const { payload, status } = await this.post('/v1/audits/verify', undefined, callOptions, 'GET');
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).valid !== 'boolean' ||
      !Number.isInteger((payload as Record<string, unknown>).checked)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid audit verification result',
        status,
        'invalid_service_response',
      );
    return payload as {
      valid: boolean;
      checked: number;
      first_invalid_sequence?: number;
      anchor_invalid?: boolean;
      manifest_invalid?: boolean;
    };
  }
  async listManagedAlerts(callOptions: SchemaGuardValidateOptions = {}): Promise<ManagedAlert[]> {
    const { payload, status } = await this.post('/v1/alerts', undefined, callOptions, 'GET');
    const alerts =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).alerts
        : undefined;
    if (!Array.isArray(alerts))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid alert list',
        status,
        'invalid_service_response',
      );
    return alerts as ManagedAlert[];
  }
  async listManagedEnvironments(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<ManagedEnvironment[]> {
    const { payload, status } = await this.post('/v1/environments', undefined, callOptions, 'GET');
    const environments =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).environments
        : undefined;
    if (!Array.isArray(environments))
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid environment list',
        status,
        'invalid_service_response',
      );
    return environments as ManagedEnvironment[];
  }
  async getManagedIntelligence(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<Record<string, unknown>> {
    const { payload, status } = await this.post('/v1/intelligence', undefined, callOptions, 'GET');
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !Array.isArray((payload as Record<string, unknown>).failure_clusters) ||
      !Array.isArray((payload as Record<string, unknown>).recommendations)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid intelligence result',
        status,
        'invalid_service_response',
      );
    return payload as Record<string, unknown>;
  }
  async getManagedBillingStatement(
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<Record<string, unknown>> {
    const { payload, status } = await this.post(
      '/v1/billing/statement',
      undefined,
      callOptions,
      'GET',
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).period !== 'string' ||
      typeof (payload as Record<string, unknown>).payment_processing !== 'string'
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid billing statement',
        status,
        'invalid_service_response',
      );
    return payload as Record<string, unknown>;
  }
  async issueManagedApiKey(
    scopes: string[],
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<IssuedManagedApiKey> {
    const { payload, status } = await this.post('/v1/admin/api-keys', { scopes }, callOptions);
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).key_id !== 'string' ||
      typeof (payload as Record<string, unknown>).api_key !== 'string' ||
      !Array.isArray((payload as Record<string, unknown>).scopes)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid issued API key',
        status,
        'invalid_service_response',
      );
    return payload as IssuedManagedApiKey;
  }
  async revokeManagedApiKey(
    keyId: string,
    callOptions: SchemaGuardValidateOptions = {},
  ): Promise<void> {
    const { payload, status } = await this.post(
      `/v1/admin/api-keys/${encodeURIComponent(keyId)}`,
      undefined,
      callOptions,
      'DELETE',
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      (payload as Record<string, unknown>).revoked !== true
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid API-key revocation result',
        status,
        'invalid_service_response',
      );
  }
  async verifyManagedControlPlaneIntegrity(callOptions: SchemaGuardValidateOptions = {}): Promise<{
    valid: boolean;
    checked: number;
    first_invalid_table?: string;
    first_invalid_id?: string;
  }> {
    const { payload, status } = await this.post(
      '/v1/admin/control-plane-integrity',
      undefined,
      callOptions,
      'GET',
    );
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).valid !== 'boolean' ||
      !Number.isInteger((payload as Record<string, unknown>).checked)
    )
      throw new SchemaGuardServiceError(
        'Schema Guard service returned an invalid control-plane integrity result',
        status,
        'invalid_service_response',
      );
    return payload as {
      valid: boolean;
      checked: number;
      first_invalid_table?: string;
      first_invalid_id?: string;
    };
  }
}

export interface SchemaGuardIntegrationOptions {
  client?: SchemaGuardClient;
  policy?: GuardPolicy;
  context?: ValidateRequest['context'];
  onDecision?: (decision: GuardDecision) => void | Promise<void>;
  onDrift?: (event: { toolName: string; report: DriftReport }) => void | Promise<void>;
}

export class SchemaGuardRejectedError extends Error {
  constructor(public readonly decision: Extract<GuardDecision, { decision: 'rejected' }>) {
    super(`Schema Guard rejected tool execution: ${decision.reason}`);
    this.name = 'SchemaGuardRejectedError';
  }
}

export class SchemaGuardActionRejectedError extends Error {
  constructor(public readonly gate: ActionGateDecision) {
    super(`Schema Guard action gate denied execution: ${gate.reason}`);
    this.name = 'SchemaGuardActionRejectedError';
  }
}

export class SchemaGuardActionCompletionError extends Error {
  constructor(
    public readonly completionError: unknown,
    public readonly reservationId?: string,
    public readonly executionFingerprint?: string,
  ) {
    super(
      'The action executed, but Schema Guard could not record idempotency completion; the reservation was retained to block unsafe retries.',
    );
    this.name = 'SchemaGuardActionCompletionError';
  }
}

export interface GuardedActionOptions<T> {
  request: ValidateRequest;
  action: ActionDescriptor;
  context: ActionGateContext;
  execute: (validArguments: JsonObject) => Promise<T> | T;
  client?: SchemaGuardClient;
  policy?: ActionControlPolicy;
  approvalSecret?: string;
  idempotencyLedger?: IdempotencyLedger;
  onDecision?: (decision: GuardDecision) => void | Promise<void>;
  onActionDecision?: (decision: ActionGateDecision) => void | Promise<void>;
}

/**
 * Validates, authorizes, reserves idempotency, and only then executes an
 * action. Successful mutations complete their reservation; execution failures
 * release it so callers can safely retry with the same key. Completion failures
 * retain the reservation because the side effect may already have happened.
 */
export async function executeGuardedAction<T>(options: GuardedActionOptions<T>): Promise<{
  result: T;
  decision: Extract<GuardDecision, { decision: 'valid' | 'valid_with_repair' }>;
  actionDecision: ActionGateDecision & { status: 'allowed' };
}> {
  const decision = await (options.client ?? new SchemaGuardClient()).validate(options.request);
  await options.onDecision?.(decision);
  if (decision.decision === 'rejected') throw new SchemaGuardRejectedError(decision);
  const gate = evaluateActionGate({
    decision,
    action: options.action,
    context: options.context,
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.approvalSecret ? { approval_secret: options.approvalSecret } : {}),
    ...(options.idempotencyLedger ? { idempotency_ledger: options.idempotencyLedger } : {}),
  });
  await options.onActionDecision?.(gate);
  if (gate.status !== 'allowed') throw new SchemaGuardActionRejectedError(gate);
  const allowedGate = { ...gate, status: 'allowed' as const };

  const reservationKey = allowedGate.reservation ? options.context.idempotency_key : undefined;
  let result: T;
  try {
    result = await options.execute(decision.valid_arguments);
  } catch (error) {
    if (reservationKey && options.idempotencyLedger)
      options.idempotencyLedger.release(reservationKey, allowedGate.execution_fingerprint);
    throw error;
  }
  if (reservationKey && options.idempotencyLedger) {
    try {
      options.idempotencyLedger.complete(reservationKey, allowedGate.execution_fingerprint);
    } catch (error) {
      throw new SchemaGuardActionCompletionError(error);
    }
  }
  return { result, decision, actionDecision: allowedGate };
}

export async function executeManagedApprovedAction<T>(options: {
  client: SchemaGuardClient;
  decision: GuardDecision;
  toolName: string;
  environment: string;
  approval: ApprovalEvidence;
  idempotencyKey: string;
  execute: (validArguments: JsonObject) => Promise<T> | T;
  onActionDecision?: (decision: ActionGateDecision) => void | Promise<void>;
}): Promise<{
  result: T;
  actionDecision: ActionGateDecision & { status: 'allowed' };
}> {
  if (options.decision.decision === 'rejected')
    throw new SchemaGuardRejectedError(options.decision);
  const gate = await options.client.evaluateManagedAction({
    decision: options.decision,
    tool_name: options.toolName,
    environment: options.environment,
    approval: options.approval,
    idempotency_key: options.idempotencyKey,
  });
  await options.onActionDecision?.(gate);
  if (gate.status !== 'allowed') throw new SchemaGuardActionRejectedError(gate);
  const allowedGate = { ...gate, status: 'allowed' as const };
  let result: T;
  try {
    result = await options.execute(options.decision.valid_arguments);
  } catch (error) {
    await options.client
      .releaseManagedAction(options.idempotencyKey, allowedGate.execution_fingerprint)
      .catch(() => undefined);
    throw error;
  }
  try {
    await options.client.completeManagedAction(
      options.idempotencyKey,
      allowedGate.execution_fingerprint,
    );
  } catch (error) {
    throw new SchemaGuardActionCompletionError(
      error,
      allowedGate.reservation?.reservation_id,
      allowedGate.execution_fingerprint,
    );
  }
  return { result, actionDecision: allowedGate };
}

async function guardArguments(input: {
  adapter: AdapterName;
  declaration: unknown;
  rawArguments: JsonObject | string;
  options?: SchemaGuardIntegrationOptions;
}): Promise<Extract<GuardDecision, { decision: 'valid' | 'valid_with_repair' }>> {
  const normalized = normalizeTool(input.adapter, input.declaration);
  const options = input.options ?? {};
  const decision = await (options.client ?? new SchemaGuardClient()).validate({
    tool_name: normalized.tool_name,
    tool_schema: normalized.tool_schema,
    raw_arguments: input.rawArguments,
    ...(options.policy ? { policy: options.policy } : {}),
    context: {
      ...options.context,
      adapter: input.adapter,
    },
  });
  await options.onDecision?.(decision);
  if (decision.decision === 'rejected') throw new SchemaGuardRejectedError(decision);
  return decision;
}

export interface OpenAIAgentsFunctionToolLike {
  type: 'function';
  name: string;
  parameters: Record<string, unknown>;
  invoke(runContext: unknown, input: string, details?: unknown): Promise<unknown>;
}

/**
 * Returns an OpenAI Agents-compatible function tool whose native `invoke`
 * boundary is guarded. The original tool remains unchanged.
 */
export function guardOpenAIAgentsTool<T extends OpenAIAgentsFunctionToolLike>(
  tool: T,
  options: SchemaGuardIntegrationOptions = {},
): T {
  const originalInvoke = tool.invoke.bind(tool);
  const guarded = Object.create(
    Reflect.getPrototypeOf(tool),
    Object.getOwnPropertyDescriptors(tool),
  ) as T;
  guarded.invoke = async (runContext: unknown, input: string, details?: unknown) => {
    const decision = await guardArguments({
      adapter: 'openai_agents',
      declaration: { name: tool.name, parameters: tool.parameters },
      rawArguments: input,
      options: {
        ...options,
        context: { framework: 'openai-agents-js', ...options.context },
      },
    });
    return originalInvoke(runContext, JSON.stringify(decision.valid_arguments), details);
  };
  return guarded;
}

export interface McpToolLike {
  name: string;
  inputSchema: Record<string, unknown>;
}

export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolLike[]; [key: string]: unknown }>;
  callTool(
    params: { name: string; arguments?: JsonObject; [key: string]: unknown },
    ...args: never[]
  ): Promise<unknown>;
}

type Tail<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest] ? Rest : [];

/**
 * Wraps an MCP client. `listTools()` automatically populates the schema
 * registry; `callTool()` refreshes once on a cache miss and never calls the
 * downstream server unless Schema Guard accepts the arguments.
 */
export class GuardedMcpClient<T extends McpClientLike> {
  private readonly schemas = new Map<string, McpToolLike>();

  constructor(
    public readonly client: T,
    private readonly options: SchemaGuardIntegrationOptions = {},
  ) {}

  async listTools(): Promise<Awaited<ReturnType<T['listTools']>>> {
    const result = (await this.client.listTools()) as Awaited<ReturnType<T['listTools']>>;
    for (const tool of result.tools) {
      if (typeof tool.name !== 'string' || !tool.inputSchema) continue;
      const previous = this.schemas.get(tool.name);
      if (previous) {
        const report = detectSchemaDrift(previous.inputSchema, tool.inputSchema);
        if (report.changed) await this.options.onDrift?.({ toolName: tool.name, report });
      }
      this.schemas.set(tool.name, tool);
    }
    return result;
  }

  async callTool(
    params: Parameters<T['callTool']>[0],
    ...args: Tail<Parameters<T['callTool']>>
  ): Promise<Awaited<ReturnType<T['callTool']>>> {
    let declaration = this.schemas.get(params.name);
    if (!declaration) {
      await this.listTools();
      declaration = this.schemas.get(params.name);
    }
    if (!declaration) {
      throw new SchemaGuardConfigurationError(
        `MCP tool ${JSON.stringify(params.name)} is absent from tools/list; execution denied`,
      );
    }
    const decision = await guardArguments({
      adapter: 'mcp',
      declaration,
      rawArguments: params.arguments ?? {},
      options: {
        ...this.options,
        context: { framework: 'mcp', ...this.options.context },
      },
    });
    return (await this.client.callTool(
      { ...params, arguments: decision.valid_arguments },
      ...args,
    )) as Awaited<ReturnType<T['callTool']>>;
  }
}
