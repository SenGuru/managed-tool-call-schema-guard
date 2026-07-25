import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  canonicalJson,
  actionControlPolicyValidationError,
  policyValidationError,
  sha256,
  type AuditEnvelope,
  type ActionControlPolicy,
  type GuardDecision,
  type GuardPolicy,
} from '@schema-guard/core';
import { SharedStateIntegrityError, type TransactionalAcceptedDecisionWriter } from './postgres.js';
import type { TransactionalAlertWriter } from './alerts.js';
import type { SharedObservationContext, TransactionalIntelligenceWriter } from './intelligence.js';
import { BILLING_MIGRATION_NAME, BILLING_MIGRATION_VERSION, BILLING_SCHEMA } from './billing.js';

export type SharedPlanId = 'trial' | 'team';
export type SharedTenantLifecycleStatus = 'active' | 'suspended' | 'canceled' | 'deletion_pending';

export interface SharedTenantLifecycle {
  status: SharedTenantLifecycleStatus;
  reason_code: string | null;
  deletion_requested_at: string | null;
  updated_at: string;
}

export interface SharedActionControl {
  hold: boolean;
  reason_code: string | null;
  enforced_policy: ActionControlPolicy;
  shadow_policy: ActionControlPolicy | null;
  updated_at: string;
  updated_by_hash: string;
}

export type SharedScope =
  | 'validate'
  | 'compile'
  | 'evaluate:action'
  | 'approve:action'
  | 'reconcile:action'
  | 'manage:webhooks'
  | 'promote:schema'
  | 'read:audit'
  | 'read:alerts'
  | 'read:billing'
  | 'read:environment'
  | 'read:intelligence'
  | 'read:ruleset'
  | 'read:usage'
  | 'write:schema'
  | 'admin';

export const SHARED_SCOPES: readonly SharedScope[] = [
  'validate',
  'compile',
  'evaluate:action',
  'approve:action',
  'reconcile:action',
  'manage:webhooks',
  'promote:schema',
  'read:audit',
  'read:alerts',
  'read:billing',
  'read:environment',
  'read:intelligence',
  'read:ruleset',
  'read:usage',
  'write:schema',
  'admin',
];

export interface SharedPrincipal {
  tenantId: string;
  tenantName: string;
  keyId: string;
  scopes: SharedScope[];
  plan: SharedPlanId;
  monthlyLimit: number;
  retentionDays: number;
  policy: GuardPolicy;
  lifecycleStatus: SharedTenantLifecycleStatus;
}

export interface SharedUsage {
  tenant_id: string;
  month: string;
  validation_count: number;
  repair_count: number;
  rejection_count: number;
  drift_count: number;
}

export interface SharedApiKeySummary {
  key_id: string;
  prefix: string;
  scopes: SharedScope[];
  created_at: string;
  revoked_at: string | null;
  current: boolean;
}

export interface SharedAuditRecord {
  [key: string]: unknown;
  sequence: number;
  audit_id: string;
  occurred_at: string;
  decision: GuardDecision['decision'];
  reason_code: string | null;
  repair_rules: string[];
  envelope: AuditEnvelope;
  event_hash: string;
  previous_hash: string;
  signature: string;
}

export interface SharedAuditVerification {
  valid: boolean;
  checked: number;
  first_invalid_sequence?: number;
  anchor_invalid?: boolean;
  manifest_invalid?: boolean;
}

export interface SharedTenantBootstrap {
  id: string;
  name: string;
  plan: SharedPlanId;
  apiKey: string;
  scopes?: SharedScope[];
  retentionDays?: number;
  policy?: GuardPolicy;
}

export interface SharedQuotaOperationalMetrics {
  healthy: number;
  warning: number;
  exhausted: number;
}

export type SharedNotificationKind =
  | 'account_invitation'
  | 'account_recovery'
  | 'security_alert'
  | 'billing_notice'
  | 'support_update';
const TRANSACTIONAL_NOTIFICATION_KINDS: readonly SharedNotificationKind[] = [
  'account_invitation',
  'account_recovery',
  'security_alert',
  'billing_notice',
  'support_update',
];
export type SharedNotificationStatus = 'pending' | 'processing' | 'delivered' | 'dead';
export interface SharedNotificationSummary {
  notification_id: string;
  kind: SharedNotificationKind;
  recipient_hash: string;
  idempotency_hash: string;
  request_hash: string;
  status: SharedNotificationStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  submitted_at: string | null;
  provider_message_id: string | null;
  error_code: string | null;
  created_at: string;
}
export interface SharedClaimedNotification {
  notificationId: string;
  tenantId: string;
  kind: SharedNotificationKind;
  payloadCiphertext: string;
  leaseId: string;
  attemptCount: number;
}
export interface SharedNotificationProviderEvent {
  provider: 'postmark';
  eventId: string;
  eventType: 'delivered' | 'bounced';
  messageId: string;
  recipientHash: string;
  occurredAt: string;
  bounceType: string | null;
  inactive: boolean;
}

export interface ControlState {
  readonly recordsValidationAlerts?: boolean;
  readonly recordsValidationIntelligence?: boolean;
  readonly recordsAcceptedActionDecisions?: boolean;
  migrate(): Promise<void>;
  ready(): Promise<boolean>;
  bootstrapTenant(input: SharedTenantBootstrap): Promise<void>;
  authenticate(apiKey: string): Promise<SharedPrincipal | undefined>;
  principalForTenant(
    tenantId: string,
    principalId: string,
    scopes: SharedScope[],
  ): Promise<SharedPrincipal | undefined>;
  enqueueNotification(input: {
    tenantId: string;
    notificationId: string;
    kind: SharedNotificationKind;
    recipientHash: string;
    idempotencyHash: string;
    requestHash: string;
    payloadCiphertext: string;
  }): Promise<{ notification_id: string; created: boolean }>;
  listNotifications(tenantId: string, limit?: number): Promise<SharedNotificationSummary[]>;
  claimNotifications(limit?: number): Promise<SharedClaimedNotification[]>;
  finishNotification(input: {
    notificationId: string;
    leaseId: string;
    delivered: boolean;
    providerMessageId?: string;
    submittedAt?: string;
    errorCode?: string;
    maxAttempts?: number;
  }): Promise<SharedNotificationStatus | undefined>;
  redriveNotification(tenantId: string, notificationId: string): Promise<boolean>;
  recordNotificationProviderEvent(event: SharedNotificationProviderEvent): Promise<boolean>;
  issueApiKey(
    tenantId: string,
    scopes: SharedScope[],
  ): Promise<{ key_id: string; api_key: string; scopes: SharedScope[] }>;
  listApiKeys(tenantId: string, currentKeyId: string): Promise<SharedApiKeySummary[]>;
  revokeApiKey(tenantId: string, currentKeyId: string, keyId: string): Promise<boolean>;
  tenantLifecycle(tenantId: string): Promise<SharedTenantLifecycle>;
  updateTenantLifecycle(
    tenantId: string,
    status: SharedTenantLifecycleStatus,
    reasonCode: string | null,
  ): Promise<SharedTenantLifecycle>;
  updateTenantPolicy(tenantId: string, policy: GuardPolicy): Promise<void>;
  actionControl(tenantId: string): Promise<SharedActionControl>;
  updateActionControl(
    tenantId: string,
    operatorId: string,
    input: {
      hold: boolean;
      reason_code: string | null;
      enforced_policy: ActionControlPolicy;
      shadow_policy: ActionControlPolicy | null;
    },
  ): Promise<SharedActionControl>;
  updatePlan(tenantId: string, plan: SharedPlanId): Promise<void>;
  consumeRateLimit(
    tenantId: string,
    keyId: string,
    limit: number,
    currentTime?: Date,
  ): Promise<void>;
  recordValidation(
    tenantId: string,
    decision: GuardDecision,
    context?: SharedObservationContext,
  ): Promise<SharedUsage>;
  listAudits(tenantId: string, limit: number): Promise<SharedAuditRecord[]>;
  verifyAuditChain(tenantId: string): Promise<SharedAuditVerification>;
  purgeExpiredAudits(tenantId: string, retentionDays: number): Promise<number>;
  recordDrift(tenantId: string): Promise<SharedUsage>;
  usage(tenantId: string): Promise<SharedUsage>;
  operationalMetrics?(): Promise<SharedQuotaOperationalMetrics>;
  close(): Promise<void>;
}

type TenantRow = {
  id: string;
  name: string;
  plan: SharedPlanId;
  monthly_limit: number;
  retention_days: number;
  policy_json: string;
  usage_month: string;
  validation_count: number;
  repair_count: number;
  rejection_count: number;
  drift_count: number;
  created_at: Date;
  updated_at: Date;
  control_hmac: string;
};
type ApiKeyRow = {
  id: string;
  tenant_id: string;
  key_hash: string;
  prefix: string;
  scopes_json: string;
  rate_window_started_at: Date;
  rate_window_count: number;
  created_at: Date;
  revoked_at: Date | null;
  control_hmac: string;
};
type TenantLifecycleRow = {
  tenant_id: string;
  status: SharedTenantLifecycleStatus;
  reason_code: string | null;
  deletion_requested_at: Date | null;
  updated_at: Date;
  control_hmac: string;
};
type TenantDeletionReceiptRow = {
  tenant_ref: string;
  export_sha256: string;
  deleted_at: Date;
  receipt_hmac: string;
};
type ActionControlRow = {
  tenant_id: string;
  hold: boolean;
  reason_code: string | null;
  enforced_policy_json: string;
  shadow_policy_json: string | null;
  updated_at: Date;
  updated_by_hash: string;
  control_hmac: string;
};
type NotificationRow = {
  notification_id: string;
  tenant_id: string;
  kind: SharedNotificationKind;
  recipient_hash: string;
  idempotency_hash: string;
  request_hash: string;
  payload_ciphertext: string;
  status: SharedNotificationStatus;
  attempt_count: number;
  next_attempt_at: Date;
  lease_id: string | null;
  lease_expires_at: Date | null;
  last_attempt_at: Date | null;
  submitted_at: Date | null;
  provider_message_id: string | null;
  error_code: string | null;
  created_at: Date;
  payload_hmac: string;
};
type NotificationEventRow = {
  event_id: string;
  notification_id: string;
  tenant_id: string;
  event_type: 'delivered' | 'bounced';
  occurred_at: Date;
  bounce_type: string | null;
  inactive: boolean;
  event_hmac: string;
};
type AuditRow = {
  sequence: string;
  tenant_id: string;
  audit_id: string;
  occurred_at: Date;
  decision: GuardDecision['decision'];
  reason_code: string | null;
  repair_rules_json: string;
  envelope_json: string;
  previous_hash: string;
  event_hash: string;
  signature: string;
};
type AuditAnchorRow = {
  tenant_id: string;
  last_deleted_hash: string;
  deleted_through_sequence: string;
  deleted_event_count: string;
  updated_at: Date;
  control_hmac: string;
};
type AuditManifestRow = {
  tenant_id: string;
  revision: string;
  retained_row_count: string;
  total_event_count: string;
  tip_hash: string;
  updated_at: Date;
  control_hmac: string;
};

const month = (): string => new Date().toISOString().slice(0, 7);
const defaultLimits: Record<SharedPlanId, number> = { trial: 1_000, team: 250_000 };
const defaultRetentionDays: Record<SharedPlanId, number> = { trial: 7, team: 30 };
const hmac = (secret: string, purpose: string, value: unknown): string =>
  `hmac-sha256:${createHmac('sha256', secret)
    .update(purpose)
    .update('\0')
    .update(canonicalJson(value))
    .digest('hex')}`;
const equal = (left: string, right: string): boolean => {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
};
const hashApiKey = (secret: string, key: string): string => hmac(secret, 'api-key-v1', key);
const generateApiKey = (): string => `sg_live_${randomBytes(24).toString('base64url')}`;
const AUDIT_KEYS = new Set([
  'audit_id',
  'timestamp',
  'protocol_version',
  'engine_version',
  'ruleset_version',
  'tool_name_hash',
  'schema_hash',
  'arguments_hash',
  'validated_arguments_hash',
  'argument_shape',
  'decision',
  'reason_code',
  'repair_rule_ids',
  'repair_receipt_hashes',
  'policy_hash',
]);
const auditHash = (value: unknown): boolean =>
  typeof value === 'string' && /^(?:sha256|hmac-sha256):[0-9a-f]{64}$/u.test(value);

const CONTROL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sg_control_schema_migrations (
    version INTEGER PRIMARY KEY,
    migration_name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_control_tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL CHECK(plan IN ('trial','team')),
    monthly_limit INTEGER NOT NULL CHECK(monthly_limit >= 0),
    retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 0 AND 3650),
    policy_json TEXT NOT NULL,
    usage_month TEXT NOT NULL,
    validation_count INTEGER NOT NULL DEFAULT 0 CHECK(validation_count >= 0),
    repair_count INTEGER NOT NULL DEFAULT 0 CHECK(repair_count >= 0),
    rejection_count INTEGER NOT NULL DEFAULT 0 CHECK(rejection_count >= 0),
    drift_count INTEGER NOT NULL DEFAULT 0 CHECK(drift_count >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_control_api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scopes_json TEXT NOT NULL,
    rate_window_started_at TIMESTAMPTZ NOT NULL,
    rate_window_count INTEGER NOT NULL CHECK(rate_window_count >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    control_hmac TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sg_control_api_keys_tenant ON sg_control_api_keys(tenant_id,id);
  CREATE TABLE IF NOT EXISTS sg_control_audit_anchors (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    last_deleted_hash TEXT NOT NULL,
    deleted_through_sequence BIGINT NOT NULL CHECK(deleted_through_sequence >= 0),
    deleted_event_count BIGINT NOT NULL CHECK(deleted_event_count > 0),
    updated_at TIMESTAMPTZ NOT NULL,
    control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_control_audit_manifests (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK(revision >= 0),
    retained_row_count BIGINT NOT NULL CHECK(retained_row_count >= 0),
    total_event_count BIGINT NOT NULL CHECK(total_event_count >= 0),
    tip_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_control_audit_events (
    sequence BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    audit_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('valid','valid_with_repair','rejected')),
    reason_code TEXT,
    repair_rules_json TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    UNIQUE(tenant_id,audit_id)
  );
  CREATE INDEX IF NOT EXISTS sg_control_audit_tenant_sequence
    ON sg_control_audit_events(tenant_id,sequence DESC);
`;

const CONTROL_LIFECYCLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sg_tenant_lifecycle (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    status TEXT NOT NULL
      CHECK(status IN ('active','suspended','canceled','deletion_pending')),
    reason_code TEXT,
    deletion_requested_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_tenant_deletion_receipts (
    tenant_ref TEXT PRIMARY KEY,
    export_sha256 TEXT NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL,
    receipt_hmac TEXT NOT NULL
  );
`;
const ACTION_CONTROL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sg_action_controls (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    hold BOOLEAN NOT NULL DEFAULT FALSE,
    reason_code TEXT,
    enforced_policy_json TEXT NOT NULL DEFAULT '{}',
    shadow_policy_json TEXT,
    updated_at TIMESTAMPTZ NOT NULL,
    updated_by_hash TEXT NOT NULL,
    control_hmac TEXT NOT NULL
  );
`;
const NOTIFICATION_OUTBOX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sg_notification_outbox (
    notification_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
      CHECK(kind IN ('account_invitation','account_recovery','security_alert','billing_notice','support_update')),
    recipient_hash TEXT NOT NULL,
    idempotency_hash TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    payload_ciphertext TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','processing','delivered','dead')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL,
    lease_id TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    provider_message_id TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    payload_hmac TEXT NOT NULL,
    UNIQUE(tenant_id,idempotency_hash)
  );
  CREATE INDEX IF NOT EXISTS sg_notification_outbox_due
    ON sg_notification_outbox(status,next_attempt_at,lease_expires_at);
  CREATE INDEX IF NOT EXISTS sg_notification_outbox_tenant_time
    ON sg_notification_outbox(tenant_id,created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS sg_notification_outbox_message
    ON sg_notification_outbox(provider_message_id)
    WHERE provider_message_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS sg_notification_events (
    event_id TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL REFERENCES sg_notification_outbox(notification_id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN ('delivered','bounced')),
    occurred_at TIMESTAMPTZ NOT NULL,
    bounce_type TEXT,
    inactive BOOLEAN NOT NULL,
    event_hmac TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sg_notification_events_tenant_time
    ON sg_notification_events(tenant_id,occurred_at DESC);
`;

export class PostgresControlState implements ControlState {
  readonly pool: Pool;
  private readonly ownsPool: boolean;
  readonly recordsValidationAlerts: boolean;
  readonly recordsValidationIntelligence: boolean;
  readonly recordsAcceptedActionDecisions: boolean;
  private readonly planLimits: Record<SharedPlanId, number>;
  constructor(
    databaseUrl: string,
    private readonly masterSecret: string,
    pool?: Pool,
    private readonly options: {
      trialMonthlyLimit?: number;
      teamMonthlyLimit?: number;
      alertWriter?: TransactionalAlertWriter;
      intelligenceWriter?: TransactionalIntelligenceWriter;
      acceptedDecisionWriter?: TransactionalAcceptedDecisionWriter;
    } = {},
  ) {
    this.ownsPool = pool === undefined;
    this.pool = pool ?? new Pool({ connectionString: databaseUrl, max: 10 });
    this.planLimits = {
      trial: options.trialMonthlyLimit ?? defaultLimits.trial,
      team: options.teamMonthlyLimit ?? defaultLimits.team,
    };
    this.recordsValidationAlerts = options.alertWriter !== undefined;
    this.recordsValidationIntelligence = options.intelligenceWriter !== undefined;
    this.recordsAcceptedActionDecisions = options.acceptedDecisionWriter !== undefined;
    if (
      Object.values(this.planLimits).some(
        (limit) => !Number.isSafeInteger(limit) || limit < 1 || limit > 100_000_000,
      )
    )
      throw new TypeError('shared control plan limits are invalid');
  }

  private tenantUnsigned(row: TenantRow): Omit<TenantRow, 'control_hmac'> {
    return {
      id: row.id,
      name: row.name,
      plan: row.plan,
      monthly_limit: row.monthly_limit,
      retention_days: row.retention_days,
      policy_json: row.policy_json,
      usage_month: row.usage_month,
      validation_count: row.validation_count,
      repair_count: row.repair_count,
      rejection_count: row.rejection_count,
      drift_count: row.drift_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
  private apiKeyUnsigned(row: ApiKeyRow): Omit<ApiKeyRow, 'control_hmac'> {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      key_hash: row.key_hash,
      prefix: row.prefix,
      scopes_json: row.scopes_json,
      rate_window_started_at: row.rate_window_started_at,
      rate_window_count: row.rate_window_count,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
    };
  }
  private tenantLifecycleUnsigned(
    row: TenantLifecycleRow,
  ): Omit<TenantLifecycleRow, 'control_hmac'> {
    return {
      tenant_id: row.tenant_id,
      status: row.status,
      reason_code: row.reason_code,
      deletion_requested_at: row.deletion_requested_at,
      updated_at: row.updated_at,
    };
  }

  private tenantHmac(row: Omit<TenantRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-tenant-control-v1', {
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    });
  }
  private apiKeyHmac(row: Omit<ApiKeyRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-api-key-control-v1', {
      ...row,
      rate_window_started_at: row.rate_window_started_at.toISOString(),
      created_at: row.created_at.toISOString(),
      revoked_at: row.revoked_at?.toISOString() ?? null,
    });
  }
  private tenantLifecycleHmac(row: Omit<TenantLifecycleRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-tenant-lifecycle-control-v1', {
      ...row,
      deletion_requested_at: row.deletion_requested_at?.toISOString() ?? null,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private tenantDeletionReceiptHmac(row: Omit<TenantDeletionReceiptRow, 'receipt_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-tenant-deletion-receipt-v1', {
      tenant_ref: row.tenant_ref,
      export_sha256: row.export_sha256,
      deleted_at: row.deleted_at.toISOString(),
    });
  }
  private actionControlUnsigned(row: ActionControlRow): Omit<ActionControlRow, 'control_hmac'> {
    return {
      tenant_id: row.tenant_id,
      hold: row.hold,
      reason_code: row.reason_code,
      enforced_policy_json: row.enforced_policy_json,
      shadow_policy_json: row.shadow_policy_json,
      updated_at: row.updated_at,
      updated_by_hash: row.updated_by_hash,
    };
  }
  private actionControlHmac(row: Omit<ActionControlRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-action-control-v1', {
      ...row,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private actionControlOperatorHash(tenantId: string, operatorId: string): string {
    return hmac(this.masterSecret, 'shared-managed-action-control-operator-v1', {
      tenant_id: tenantId,
      operator_id: operatorId,
    });
  }
  private notificationPayloadHmac(
    row: Pick<
      NotificationRow,
      | 'notification_id'
      | 'tenant_id'
      | 'kind'
      | 'recipient_hash'
      | 'idempotency_hash'
      | 'request_hash'
      | 'payload_ciphertext'
      | 'created_at'
    >,
  ): string {
    return hmac(this.masterSecret, 'shared-managed-notification-payload-v1', {
      notification_id: row.notification_id,
      tenant_id: row.tenant_id,
      kind: row.kind,
      recipient_hash: row.recipient_hash,
      idempotency_hash: row.idempotency_hash,
      request_hash: row.request_hash,
      payload_ciphertext: row.payload_ciphertext,
      created_at: row.created_at.toISOString(),
    });
  }
  private assertNotificationPayload(row: NotificationRow): void {
    if (!equal(row.payload_hmac, this.notificationPayloadHmac(row)))
      throw new SharedStateIntegrityError('shared notification payload integrity failed');
  }
  private notificationEventHmac(row: Omit<NotificationEventRow, 'event_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-notification-event-v1', {
      ...row,
      occurred_at: row.occurred_at.toISOString(),
    });
  }
  private auditAnchorHmac(row: Omit<AuditAnchorRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-audit-anchor-v1', {
      ...row,
      deleted_through_sequence: Number(row.deleted_through_sequence),
      deleted_event_count: Number(row.deleted_event_count),
      updated_at: row.updated_at.toISOString(),
    });
  }
  private auditManifestHmac(row: Omit<AuditManifestRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-managed-audit-manifest-v1', {
      ...row,
      revision: Number(row.revision),
      retained_row_count: Number(row.retained_row_count),
      total_event_count: Number(row.total_event_count),
      updated_at: row.updated_at.toISOString(),
    });
  }
  private assertAuditAnchor(row: AuditAnchorRow): void {
    const unsigned = {
      tenant_id: row.tenant_id,
      last_deleted_hash: row.last_deleted_hash,
      deleted_through_sequence: row.deleted_through_sequence,
      deleted_event_count: row.deleted_event_count,
      updated_at: row.updated_at,
    };
    if (!equal(row.control_hmac, this.auditAnchorHmac(unsigned)))
      throw new SharedStateIntegrityError('shared audit anchor integrity failed');
  }
  private assertAuditManifest(row: AuditManifestRow): void {
    const unsigned = {
      tenant_id: row.tenant_id,
      revision: row.revision,
      retained_row_count: row.retained_row_count,
      total_event_count: row.total_event_count,
      tip_hash: row.tip_hash,
      updated_at: row.updated_at,
    };
    if (!equal(row.control_hmac, this.auditManifestHmac(unsigned)))
      throw new SharedStateIntegrityError('shared audit manifest integrity failed');
  }
  private auditEventHash(tenantId: string, envelope: AuditEnvelope, previousHash: string): string {
    return hmac(this.masterSecret, 'shared-managed-audit-event-hash-v1', {
      tenant_id: tenantId,
      audit: envelope,
      previous_hash: previousHash,
    });
  }
  private auditEventSignature(eventHash: string, previousHash: string): string {
    return hmac(this.masterSecret, 'shared-managed-audit-event-signature-v1', {
      event_hash: eventHash,
      previous_hash: previousHash,
    });
  }
  private parseEnvelope(value: string): AuditEnvelope {
    try {
      const envelope = JSON.parse(value) as AuditEnvelope;
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        Object.keys(envelope).some((key) => !AUDIT_KEYS.has(key)) ||
        !/^aud_[0-9a-f-]{36}$/u.test(envelope.audit_id) ||
        typeof envelope.timestamp !== 'string' ||
        typeof envelope.protocol_version !== 'string' ||
        typeof envelope.engine_version !== 'string' ||
        typeof envelope.ruleset_version !== 'string' ||
        !auditHash(envelope.tool_name_hash) ||
        !auditHash(envelope.schema_hash) ||
        !auditHash(envelope.arguments_hash) ||
        (envelope.validated_arguments_hash !== undefined &&
          !auditHash(envelope.validated_arguments_hash)) ||
        !Array.isArray(envelope.argument_shape) ||
        envelope.argument_shape.some((path) => typeof path !== 'string') ||
        !['valid', 'valid_with_repair', 'rejected'].includes(envelope.decision) ||
        (envelope.reason_code !== undefined && typeof envelope.reason_code !== 'string') ||
        !Array.isArray(envelope.repair_rule_ids) ||
        envelope.repair_rule_ids.some((rule) => typeof rule !== 'string') ||
        !Array.isArray(envelope.repair_receipt_hashes) ||
        envelope.repair_receipt_hashes.some(
          (hash) => typeof hash !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(hash),
        ) ||
        !auditHash(envelope.policy_hash)
      )
        throw new Error('invalid');
      return envelope;
    } catch {
      throw new SharedStateIntegrityError('shared audit envelope is invalid');
    }
  }
  private assertAuditRow(row: AuditRow, expectedPreviousHash: string): AuditEnvelope {
    const envelope = this.parseEnvelope(row.envelope_json);
    const eventHash = this.auditEventHash(row.tenant_id, envelope, expectedPreviousHash);
    if (
      row.previous_hash !== expectedPreviousHash ||
      row.event_hash !== eventHash ||
      row.signature !== this.auditEventSignature(eventHash, expectedPreviousHash) ||
      row.audit_id !== envelope.audit_id ||
      row.occurred_at.toISOString() !== envelope.timestamp ||
      row.decision !== envelope.decision ||
      row.reason_code !== (envelope.reason_code ?? null) ||
      row.repair_rules_json !== canonicalJson(envelope.repair_rule_ids)
    )
      throw new SharedStateIntegrityError('shared audit event integrity failed');
    return envelope;
  }
  private assertTenant(row: TenantRow): void {
    const unsigned = this.tenantUnsigned(row);
    if (!equal(row.control_hmac, this.tenantHmac(unsigned)))
      throw new SharedStateIntegrityError('shared tenant control integrity failed');
    this.parsePolicy(row.policy_json);
    if (!/^\d{4}-\d{2}$/u.test(row.usage_month))
      throw new SharedStateIntegrityError('shared tenant usage month is invalid');
  }
  private assertApiKey(row: ApiKeyRow): void {
    const unsigned = this.apiKeyUnsigned(row);
    if (!equal(row.control_hmac, this.apiKeyHmac(unsigned)))
      throw new SharedStateIntegrityError('shared API key control integrity failed');
    this.parseScopes(row.scopes_json);
  }
  private assertTenantLifecycle(row: TenantLifecycleRow): void {
    if (
      !equal(row.control_hmac, this.tenantLifecycleHmac(this.tenantLifecycleUnsigned(row))) ||
      !['active', 'suspended', 'canceled', 'deletion_pending'].includes(row.status) ||
      (row.reason_code !== null && !/^[a-z0-9][a-z0-9_.-]{0,63}$/u.test(row.reason_code)) ||
      (row.status === 'deletion_pending') !== (row.deletion_requested_at !== null)
    )
      throw new SharedStateIntegrityError('shared tenant lifecycle integrity failed');
  }
  private assertTenantDeletionReceipt(row: TenantDeletionReceiptRow): void {
    if (
      !equal(
        row.receipt_hmac,
        this.tenantDeletionReceiptHmac({
          tenant_ref: row.tenant_ref,
          export_sha256: row.export_sha256,
          deleted_at: row.deleted_at,
        }),
      ) ||
      !/^hmac-sha256:[0-9a-f]{64}$/u.test(row.tenant_ref) ||
      !/^sha256:[0-9a-f]{64}$/u.test(row.export_sha256)
    )
      throw new SharedStateIntegrityError('shared tenant deletion receipt integrity failed');
  }
  private assertActionControl(row: ActionControlRow): void {
    let enforced: unknown;
    let shadow: unknown = null;
    try {
      enforced = JSON.parse(row.enforced_policy_json) as unknown;
      if (row.shadow_policy_json !== null) shadow = JSON.parse(row.shadow_policy_json) as unknown;
    } catch {
      throw new SharedStateIntegrityError('shared action control policy is malformed');
    }
    if (
      !equal(row.control_hmac, this.actionControlHmac(this.actionControlUnsigned(row))) ||
      (row.reason_code !== null && !/^[a-z0-9][a-z0-9_.-]{0,63}$/u.test(row.reason_code)) ||
      (row.hold && row.reason_code === null) ||
      actionControlPolicyValidationError(enforced) ||
      (shadow !== null && actionControlPolicyValidationError(shadow))
    )
      throw new SharedStateIntegrityError('shared action control integrity failed');
  }
  private publicActionControl(row: ActionControlRow): SharedActionControl {
    this.assertActionControl(row);
    return {
      hold: row.hold,
      reason_code: row.reason_code,
      enforced_policy: JSON.parse(row.enforced_policy_json) as ActionControlPolicy,
      shadow_policy:
        row.shadow_policy_json === null
          ? null
          : (JSON.parse(row.shadow_policy_json) as ActionControlPolicy),
      updated_at: row.updated_at.toISOString(),
      updated_by_hash: row.updated_by_hash,
    };
  }
  private parsePolicy(value: string): GuardPolicy {
    try {
      const policy = JSON.parse(value) as GuardPolicy;
      if (policyValidationError(policy)) throw new Error('invalid');
      return policy;
    } catch {
      throw new SharedStateIntegrityError('shared tenant policy is invalid');
    }
  }
  private parseScopes(value: string): SharedScope[] {
    try {
      const scopes = JSON.parse(value) as unknown;
      if (!Array.isArray(scopes)) throw new Error('invalid');
      this.assertScopes(scopes as SharedScope[]);
      return scopes as SharedScope[];
    } catch {
      throw new SharedStateIntegrityError('shared API key scopes are invalid');
    }
  }
  private assertScopes(scopes: SharedScope[]): void {
    if (
      scopes.length === 0 ||
      scopes.some((scope) => !SHARED_SCOPES.includes(scope)) ||
      new Set(scopes).size !== scopes.length
    )
      throw new TypeError('shared API key scopes are invalid');
  }
  private async transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  private async verifyAuditWithClient(
    client: PoolClient,
    tenantId: string,
    lock = false,
  ): Promise<SharedAuditVerification> {
    const anchor = (
      await client.query<AuditAnchorRow>(
        `SELECT * FROM sg_control_audit_anchors WHERE tenant_id=$1${lock ? ' FOR UPDATE' : ''}`,
        [tenantId],
      )
    ).rows[0];
    const manifest = (
      await client.query<AuditManifestRow>(
        `SELECT * FROM sg_control_audit_manifests WHERE tenant_id=$1${lock ? ' FOR UPDATE' : ''}`,
        [tenantId],
      )
    ).rows[0];
    if (!manifest) return { valid: false, checked: 0, manifest_invalid: true };
    try {
      this.assertAuditManifest(manifest);
      if (anchor) this.assertAuditAnchor(anchor);
    } catch {
      return {
        valid: false,
        checked: 0,
        ...(anchor ? { anchor_invalid: true } : { manifest_invalid: true }),
      };
    }
    const rows = (
      await client.query<AuditRow>(
        `SELECT * FROM sg_control_audit_events WHERE tenant_id=$1 ORDER BY sequence ASC${
          lock ? ' FOR UPDATE' : ''
        }`,
        [tenantId],
      )
    ).rows;
    if (rows.length !== Number(manifest.retained_row_count))
      return { valid: false, checked: 0, manifest_invalid: true };
    let previousHash = anchor?.last_deleted_hash ?? 'GENESIS';
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      try {
        this.assertAuditRow(row, previousHash);
      } catch {
        return { valid: false, checked: index, first_invalid_sequence: Number(row.sequence) };
      }
      previousHash = row.event_hash;
    }
    if (
      manifest.tip_hash !== previousHash ||
      Number(manifest.total_event_count) !==
        Number(manifest.retained_row_count) + Number(anchor?.deleted_event_count ?? 0)
    )
      return { valid: false, checked: rows.length, manifest_invalid: true };
    return { valid: true, checked: rows.length };
  }
  private usageFrom(row: TenantRow): SharedUsage {
    return {
      tenant_id: row.id,
      month: row.usage_month,
      validation_count: row.validation_count,
      repair_count: row.repair_count,
      rejection_count: row.rejection_count,
      drift_count: row.drift_count,
    };
  }
  private resetMonth(row: TenantRow, timestamp: Date): Omit<TenantRow, 'control_hmac'> {
    const unsigned = this.tenantUnsigned(row);
    if (row.usage_month === month()) return unsigned;
    return {
      ...unsigned,
      usage_month: month(),
      validation_count: 0,
      repair_count: 0,
      rejection_count: 0,
      drift_count: 0,
      updated_at: timestamp,
    };
  }

  async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('schema-guard-control-migrations-v1'))",
      );
      await client.query(CONTROL_SCHEMA);
      const checksum = sha256(CONTROL_SCHEMA);
      const lifecycleChecksum = sha256(CONTROL_LIFECYCLE_SCHEMA);
      const actionControlChecksum = sha256(ACTION_CONTROL_SCHEMA);
      const notificationOutboxChecksum = sha256(NOTIFICATION_OUTBOX_SCHEMA);
      const billingChecksum = sha256(BILLING_SCHEMA);
      const rows = await client.query<{ version: number; checksum: string }>(
        'SELECT version,checksum FROM sg_control_schema_migrations ORDER BY version',
      );
      const expectedChecksums = new Map([
        [1, checksum],
        [2, lifecycleChecksum],
        [3, actionControlChecksum],
        [4, notificationOutboxChecksum],
      ]);
      if (
        rows.rows.some(
          (row) =>
            !expectedChecksums.has(row.version) ||
            expectedChecksums.get(row.version) !== row.checksum,
        )
      )
        throw new SharedStateIntegrityError('shared control migration history is incompatible');
      if (!rows.rows.some((row) => row.version === 1))
        await client.query(
          `INSERT INTO sg_control_schema_migrations(version,migration_name,checksum,applied_at)
           VALUES(1,'initial_managed_control_state',$1,$2)`,
          [checksum, new Date()],
        );
      await client.query(CONTROL_LIFECYCLE_SCHEMA);
      if (!rows.rows.some((row) => row.version === 2)) {
        const timestamp = new Date();
        const tenants = await client.query<{ id: string }>(
          'SELECT id FROM sg_control_tenants ORDER BY id FOR UPDATE',
        );
        for (const tenant of tenants.rows) {
          const unsigned: Omit<TenantLifecycleRow, 'control_hmac'> = {
            tenant_id: tenant.id,
            status: 'active',
            reason_code: null,
            deletion_requested_at: null,
            updated_at: timestamp,
          };
          await client.query(
            `INSERT INTO sg_tenant_lifecycle(tenant_id,status,reason_code,deletion_requested_at,updated_at,control_hmac)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [...Object.values(unsigned), this.tenantLifecycleHmac(unsigned)],
          );
        }
        await client.query(
          `INSERT INTO sg_control_schema_migrations(version,migration_name,checksum,applied_at)
           VALUES(2,'tenant_lifecycle',$1,$2)`,
          [lifecycleChecksum, timestamp],
        );
      }
      await client.query(ACTION_CONTROL_SCHEMA);
      if (!rows.rows.some((row) => row.version === 3)) {
        const timestamp = new Date();
        const tenants = await client.query<{ id: string }>(
          'SELECT id FROM sg_control_tenants ORDER BY id FOR UPDATE',
        );
        for (const tenant of tenants.rows) {
          const unsigned: Omit<ActionControlRow, 'control_hmac'> = {
            tenant_id: tenant.id,
            hold: false,
            reason_code: null,
            enforced_policy_json: '{}',
            shadow_policy_json: null,
            updated_at: timestamp,
            updated_by_hash: this.actionControlOperatorHash(tenant.id, 'migration'),
          };
          await client.query(
            `INSERT INTO sg_action_controls(tenant_id,hold,reason_code,enforced_policy_json,shadow_policy_json,updated_at,updated_by_hash,control_hmac)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [...Object.values(unsigned), this.actionControlHmac(unsigned)],
          );
        }
        await client.query(
          `INSERT INTO sg_control_schema_migrations(version,migration_name,checksum,applied_at)
           VALUES(3,'tenant_action_controls',$1,$2)`,
          [actionControlChecksum, timestamp],
        );
      }
      await client.query(NOTIFICATION_OUTBOX_SCHEMA);
      if (!rows.rows.some((row) => row.version === 4))
        await client.query(
          `INSERT INTO sg_control_schema_migrations(version,migration_name,checksum,applied_at)
           VALUES(4,'transactional_notification_outbox',$1,$2)`,
          [notificationOutboxChecksum, new Date()],
        );
      await client.query(BILLING_SCHEMA);
      const billingRows = await client.query<{ version: number; checksum: string }>(
        'SELECT version,checksum FROM sg_billing_schema_migrations ORDER BY version',
      );
      if (
        billingRows.rows.some(
          (row) => row.version !== BILLING_MIGRATION_VERSION || row.checksum !== billingChecksum,
        )
      )
        throw new SharedStateIntegrityError('shared billing migration history is incompatible');
      if (!billingRows.rows.some((row) => row.version === BILLING_MIGRATION_VERSION))
        await client.query(
          `INSERT INTO sg_billing_schema_migrations(version,migration_name,checksum,applied_at)
           VALUES($1,$2,$3,$4)`,
          [BILLING_MIGRATION_VERSION, BILLING_MIGRATION_NAME, billingChecksum, new Date()],
        );
    });
  }

  async ready(): Promise<boolean> {
    const client = await this.pool.connect().catch(() => undefined);
    if (!client) return false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const tenants = await client.query<TenantRow>('SELECT * FROM sg_control_tenants');
      for (const tenant of tenants.rows) {
        this.assertTenant(tenant);
        const lifecycle = (
          await client.query<TenantLifecycleRow>(
            'SELECT * FROM sg_tenant_lifecycle WHERE tenant_id=$1',
            [tenant.id],
          )
        ).rows[0];
        if (!lifecycle) throw new SharedStateIntegrityError('shared tenant lifecycle is missing');
        this.assertTenantLifecycle(lifecycle);
        const actionControl = (
          await client.query<ActionControlRow>(
            'SELECT * FROM sg_action_controls WHERE tenant_id=$1',
            [tenant.id],
          )
        ).rows[0];
        if (!actionControl)
          throw new SharedStateIntegrityError('shared tenant action control is missing');
        this.assertActionControl(actionControl);
        if (!(await this.verifyAuditWithClient(client, tenant.id)).valid)
          throw new SharedStateIntegrityError('shared audit readiness failed');
      }
      const keys = await client.query<ApiKeyRow>('SELECT * FROM sg_control_api_keys');
      for (const key of keys.rows) this.assertApiKey(key);
      const receipts = await client.query<TenantDeletionReceiptRow>(
        'SELECT * FROM sg_tenant_deletion_receipts',
      );
      for (const receipt of receipts.rows) this.assertTenantDeletionReceipt(receipt);
      const notifications = await client.query<NotificationRow>(
        'SELECT * FROM sg_notification_outbox',
      );
      for (const notification of notifications.rows) this.assertNotificationPayload(notification);
      const notificationEvents = await client.query<NotificationEventRow>(
        'SELECT * FROM sg_notification_events',
      );
      for (const event of notificationEvents.rows)
        if (
          !equal(
            event.event_hmac,
            this.notificationEventHmac({
              event_id: event.event_id,
              notification_id: event.notification_id,
              tenant_id: event.tenant_id,
              event_type: event.event_type,
              occurred_at: event.occurred_at,
              bounce_type: event.bounce_type,
              inactive: event.inactive,
            }),
          )
        )
          throw new SharedStateIntegrityError('shared notification event integrity failed');
      await client.query('COMMIT');
      return true;
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      return false;
    } finally {
      client.release();
    }
  }

  async bootstrapTenant(input: SharedTenantBootstrap): Promise<void> {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/u.test(input.id) ||
      input.name.length === 0 ||
      input.name.length > 256 ||
      input.apiKey.length === 0 ||
      input.apiKey.length > 4096 ||
      (input.retentionDays !== undefined &&
        (!Number.isInteger(input.retentionDays) ||
          input.retentionDays < 0 ||
          input.retentionDays > 3650))
    )
      throw new TypeError('shared tenant bootstrap fields are invalid');
    const scopes = input.scopes ?? [...SHARED_SCOPES];
    this.assertScopes(scopes);
    const policy = input.policy ?? {};
    if (policyValidationError(policy)) throw new TypeError('shared tenant policy is invalid');
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `schema-guard-tenant:${input.id}`,
      ]);
      const existing = (
        await client.query<TenantRow>('SELECT * FROM sg_control_tenants WHERE id=$1 FOR UPDATE', [
          input.id,
        ])
      ).rows[0];
      const timestamp = new Date();
      const policyJson = canonicalJson(policy);
      if (existing) {
        this.assertTenant(existing);
        if (
          existing.name !== input.name ||
          existing.plan !== input.plan ||
          existing.monthly_limit !== this.planLimits[input.plan] ||
          existing.retention_days !== (input.retentionDays ?? defaultRetentionDays[input.plan]) ||
          existing.policy_json !== policyJson
        )
          throw new SharedStateIntegrityError(
            'shared tenant bootstrap conflicts with existing tenant',
          );
      } else {
        const unsigned: Omit<TenantRow, 'control_hmac'> = {
          id: input.id,
          name: input.name,
          plan: input.plan,
          monthly_limit: this.planLimits[input.plan],
          retention_days: input.retentionDays ?? defaultRetentionDays[input.plan],
          policy_json: policyJson,
          usage_month: month(),
          validation_count: 0,
          repair_count: 0,
          rejection_count: 0,
          drift_count: 0,
          created_at: timestamp,
          updated_at: timestamp,
        };
        await client.query(
          `INSERT INTO sg_control_tenants(id,name,plan,monthly_limit,retention_days,policy_json,usage_month,validation_count,repair_count,rejection_count,drift_count,created_at,updated_at,control_hmac)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [...Object.values(unsigned), this.tenantHmac(unsigned)],
        );
      }
      if (!existing) {
        const lifecycle: Omit<TenantLifecycleRow, 'control_hmac'> = {
          tenant_id: input.id,
          status: 'active',
          reason_code: null,
          deletion_requested_at: null,
          updated_at: timestamp,
        };
        await client.query(
          `INSERT INTO sg_tenant_lifecycle(tenant_id,status,reason_code,deletion_requested_at,updated_at,control_hmac)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [...Object.values(lifecycle), this.tenantLifecycleHmac(lifecycle)],
        );
      } else {
        const lifecycle = (
          await client.query<TenantLifecycleRow>(
            'SELECT * FROM sg_tenant_lifecycle WHERE tenant_id=$1 FOR UPDATE',
            [input.id],
          )
        ).rows[0];
        if (!lifecycle) throw new SharedStateIntegrityError('shared tenant lifecycle is missing');
        this.assertTenantLifecycle(lifecycle);
      }
      if (!existing) {
        const actionControl: Omit<ActionControlRow, 'control_hmac'> = {
          tenant_id: input.id,
          hold: false,
          reason_code: null,
          enforced_policy_json: '{}',
          shadow_policy_json: null,
          updated_at: timestamp,
          updated_by_hash: this.actionControlOperatorHash(input.id, 'bootstrap'),
        };
        await client.query(
          `INSERT INTO sg_action_controls(tenant_id,hold,reason_code,enforced_policy_json,shadow_policy_json,updated_at,updated_by_hash,control_hmac)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [...Object.values(actionControl), this.actionControlHmac(actionControl)],
        );
      } else {
        const actionControl = (
          await client.query<ActionControlRow>(
            'SELECT * FROM sg_action_controls WHERE tenant_id=$1 FOR UPDATE',
            [input.id],
          )
        ).rows[0];
        if (!actionControl)
          throw new SharedStateIntegrityError('shared tenant action control is missing');
        this.assertActionControl(actionControl);
      }
      if (!existing) {
        const manifest: Omit<AuditManifestRow, 'control_hmac'> = {
          tenant_id: input.id,
          revision: '0',
          retained_row_count: '0',
          total_event_count: '0',
          tip_hash: 'GENESIS',
          updated_at: timestamp,
        };
        await client.query(
          `INSERT INTO sg_control_audit_manifests(tenant_id,revision,retained_row_count,total_event_count,tip_hash,updated_at,control_hmac)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [...Object.values(manifest), this.auditManifestHmac(manifest)],
        );
      } else {
        const manifest = (
          await client.query<AuditManifestRow>(
            'SELECT * FROM sg_control_audit_manifests WHERE tenant_id=$1 FOR UPDATE',
            [input.id],
          )
        ).rows[0];
        if (!manifest)
          throw new SharedStateIntegrityError('shared tenant audit manifest is missing');
        this.assertAuditManifest(manifest);
      }
      const keyHash = hashApiKey(this.masterSecret, input.apiKey);
      const key = (
        await client.query<ApiKeyRow>(
          'SELECT * FROM sg_control_api_keys WHERE key_hash=$1 FOR UPDATE',
          [keyHash],
        )
      ).rows[0];
      const keyId = `key_${sha256(input.id + input.apiKey).slice(-16)}`;
      const scopesJson = canonicalJson(scopes);
      if (key) {
        this.assertApiKey(key);
        if (
          key.id !== keyId ||
          key.tenant_id !== input.id ||
          key.scopes_json !== scopesJson ||
          key.revoked_at !== null
        )
          throw new SharedStateIntegrityError(
            'shared bootstrap API key conflicts with existing key',
          );
      } else {
        const unsigned: Omit<ApiKeyRow, 'control_hmac'> = {
          id: keyId,
          tenant_id: input.id,
          key_hash: keyHash,
          prefix: input.apiKey.slice(0, 12),
          scopes_json: scopesJson,
          rate_window_started_at: timestamp,
          rate_window_count: 0,
          created_at: timestamp,
          revoked_at: null,
        };
        await client.query(
          `INSERT INTO sg_control_api_keys(id,tenant_id,key_hash,prefix,scopes_json,rate_window_started_at,rate_window_count,created_at,revoked_at,control_hmac)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [...Object.values(unsigned), this.apiKeyHmac(unsigned)],
        );
      }
    });
  }

  async authenticate(apiKey: string): Promise<SharedPrincipal | undefined> {
    const result = await this.pool.query<
      ApiKeyRow & {
        tenant_name: string;
        plan: SharedPlanId;
        monthly_limit: number;
        retention_days: number;
        policy_json: string;
        usage_month: string;
        validation_count: number;
        repair_count: number;
        rejection_count: number;
        drift_count: number;
        tenant_created_at: Date;
        tenant_updated_at: Date;
        tenant_control_hmac: string;
        lifecycle_status: SharedTenantLifecycleStatus;
        lifecycle_reason_code: string | null;
        lifecycle_deletion_requested_at: Date | null;
        lifecycle_updated_at: Date;
        lifecycle_control_hmac: string;
      }
    >(
      `SELECT k.*,t.name tenant_name,t.plan,t.monthly_limit,t.retention_days,t.policy_json,t.usage_month,
              t.validation_count,t.repair_count,t.rejection_count,t.drift_count,t.created_at tenant_created_at,
              t.updated_at tenant_updated_at,t.control_hmac tenant_control_hmac,
              l.status lifecycle_status,l.reason_code lifecycle_reason_code,
              l.deletion_requested_at lifecycle_deletion_requested_at,
              l.updated_at lifecycle_updated_at,l.control_hmac lifecycle_control_hmac
       FROM sg_control_api_keys k JOIN sg_control_tenants t ON t.id=k.tenant_id
       JOIN sg_tenant_lifecycle l ON l.tenant_id=t.id
       WHERE k.key_hash=$1 AND k.revoked_at IS NULL`,
      [hashApiKey(this.masterSecret, apiKey)],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    this.assertApiKey(row);
    const tenant: TenantRow = {
      id: row.tenant_id,
      name: row.tenant_name,
      plan: row.plan,
      monthly_limit: row.monthly_limit,
      retention_days: row.retention_days,
      policy_json: row.policy_json,
      usage_month: row.usage_month,
      validation_count: row.validation_count,
      repair_count: row.repair_count,
      rejection_count: row.rejection_count,
      drift_count: row.drift_count,
      created_at: row.tenant_created_at,
      updated_at: row.tenant_updated_at,
      control_hmac: row.tenant_control_hmac,
    };
    this.assertTenant(tenant);
    const lifecycle: TenantLifecycleRow = {
      tenant_id: tenant.id,
      status: row.lifecycle_status,
      reason_code: row.lifecycle_reason_code,
      deletion_requested_at: row.lifecycle_deletion_requested_at,
      updated_at: row.lifecycle_updated_at,
      control_hmac: row.lifecycle_control_hmac,
    };
    this.assertTenantLifecycle(lifecycle);
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      keyId: row.id,
      scopes: this.parseScopes(row.scopes_json),
      plan: tenant.plan,
      monthlyLimit: tenant.monthly_limit,
      retentionDays: tenant.retention_days,
      policy: this.parsePolicy(tenant.policy_json),
      lifecycleStatus: lifecycle.status,
    };
  }

  async principalForTenant(
    tenantId: string,
    principalId: string,
    scopes: SharedScope[],
  ): Promise<SharedPrincipal | undefined> {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/u.test(tenantId) ||
      !/^human_[A-Za-z0-9_-]{16,128}$/u.test(principalId)
    )
      return undefined;
    this.assertScopes(scopes);
    const result = await this.pool.query<{
      id: string;
      name: string;
      plan: SharedPlanId;
      monthly_limit: number;
      retention_days: number;
      policy_json: string;
      usage_month: string;
      validation_count: number;
      repair_count: number;
      rejection_count: number;
      drift_count: number;
      created_at: Date;
      updated_at: Date;
      control_hmac: string;
      lifecycle_status: SharedTenantLifecycleStatus;
      lifecycle_reason_code: string | null;
      lifecycle_deletion_requested_at: Date | null;
      lifecycle_updated_at: Date;
      lifecycle_control_hmac: string;
    }>(
      `SELECT t.*,l.status lifecycle_status,l.reason_code lifecycle_reason_code,
              l.deletion_requested_at lifecycle_deletion_requested_at,
              l.updated_at lifecycle_updated_at,l.control_hmac lifecycle_control_hmac
       FROM sg_control_tenants t
       JOIN sg_tenant_lifecycle l ON l.tenant_id=t.id
       WHERE t.id=$1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const tenant: TenantRow = {
      id: row.id,
      name: row.name,
      plan: row.plan,
      monthly_limit: row.monthly_limit,
      retention_days: row.retention_days,
      policy_json: row.policy_json,
      usage_month: row.usage_month,
      validation_count: row.validation_count,
      repair_count: row.repair_count,
      rejection_count: row.rejection_count,
      drift_count: row.drift_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      control_hmac: row.control_hmac,
    };
    const lifecycle: TenantLifecycleRow = {
      tenant_id: row.id,
      status: row.lifecycle_status,
      reason_code: row.lifecycle_reason_code,
      deletion_requested_at: row.lifecycle_deletion_requested_at,
      updated_at: row.lifecycle_updated_at,
      control_hmac: row.lifecycle_control_hmac,
    };
    this.assertTenant(tenant);
    this.assertTenantLifecycle(lifecycle);
    const policy = this.parsePolicy(row.policy_json);
    return {
      tenantId: row.id,
      tenantName: row.name,
      keyId: principalId,
      scopes: [...scopes],
      plan: row.plan,
      monthlyLimit: row.monthly_limit,
      retentionDays: row.retention_days,
      policy,
      lifecycleStatus: row.lifecycle_status,
    };
  }

  async enqueueNotification(input: {
    tenantId: string;
    notificationId: string;
    kind: SharedNotificationKind;
    recipientHash: string;
    idempotencyHash: string;
    requestHash: string;
    payloadCiphertext: string;
  }): Promise<{ notification_id: string; created: boolean }> {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/u.test(input.tenantId) ||
      !/^notification_[A-Za-z0-9_-]{16,128}$/u.test(input.notificationId) ||
      !TRANSACTIONAL_NOTIFICATION_KINDS.includes(input.kind) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.recipientHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.idempotencyHash) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.requestHash) ||
      input.payloadCiphertext.length < 29 ||
      input.payloadCiphertext.length > 131_072
    )
      throw new TypeError('shared notification input is invalid');
    return this.transaction(async (client) => {
      const existing = (
        await client.query<NotificationRow>(
          'SELECT * FROM sg_notification_outbox WHERE tenant_id=$1 AND idempotency_hash=$2 FOR UPDATE',
          [input.tenantId, input.idempotencyHash],
        )
      ).rows[0];
      if (existing) {
        this.assertNotificationPayload(existing);
        if (
          existing.kind !== input.kind ||
          existing.recipient_hash !== input.recipientHash ||
          existing.request_hash !== input.requestHash
        )
          throw new SharedStateIntegrityError('shared notification idempotency conflict');
        return { notification_id: existing.notification_id, created: false };
      }
      const timestamp = new Date();
      const row = {
        notification_id: input.notificationId,
        tenant_id: input.tenantId,
        kind: input.kind,
        recipient_hash: input.recipientHash,
        idempotency_hash: input.idempotencyHash,
        request_hash: input.requestHash,
        payload_ciphertext: input.payloadCiphertext,
        created_at: timestamp,
      };
      await client.query(
        `INSERT INTO sg_notification_outbox(
           notification_id,tenant_id,kind,recipient_hash,idempotency_hash,request_hash,payload_ciphertext,
           status,attempt_count,next_attempt_at,created_at,payload_hmac
         ) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',0,$8,$8,$9)`,
        [
          row.notification_id,
          row.tenant_id,
          row.kind,
          row.recipient_hash,
          row.idempotency_hash,
          row.request_hash,
          row.payload_ciphertext,
          timestamp,
          this.notificationPayloadHmac(row),
        ],
      );
      return { notification_id: input.notificationId, created: true };
    });
  }

  async listNotifications(tenantId: string, limit = 100): Promise<SharedNotificationSummary[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    const rows = (
      await this.pool.query<NotificationRow>(
        'SELECT * FROM sg_notification_outbox WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2',
        [tenantId, bounded],
      )
    ).rows;
    return rows.map((row) => {
      this.assertNotificationPayload(row);
      return {
        notification_id: row.notification_id,
        kind: row.kind,
        recipient_hash: row.recipient_hash,
        idempotency_hash: row.idempotency_hash,
        request_hash: row.request_hash,
        status: row.status,
        attempt_count: row.attempt_count,
        next_attempt_at: row.next_attempt_at.toISOString(),
        last_attempt_at: row.last_attempt_at?.toISOString() ?? null,
        submitted_at: row.submitted_at?.toISOString() ?? null,
        provider_message_id: row.provider_message_id,
        error_code: row.error_code,
        created_at: row.created_at.toISOString(),
      };
    });
  }

  async claimNotifications(limit = 25): Promise<SharedClaimedNotification[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
    return this.transaction(async (client) => {
      const timestamp = new Date();
      const leaseExpiresAt = new Date(timestamp.getTime() + 30_000);
      const rows = (
        await client.query<NotificationRow>(
          `SELECT * FROM sg_notification_outbox
           WHERE (status='pending' AND next_attempt_at<=$1)
              OR (status='processing' AND lease_expires_at<=$1)
           ORDER BY created_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [timestamp, bounded],
        )
      ).rows;
      const claims: SharedClaimedNotification[] = [];
      for (const row of rows) {
        this.assertNotificationPayload(row);
        const leaseId = `lease_${randomBytes(18).toString('base64url')}`;
        const updated = await client.query(
          `UPDATE sg_notification_outbox
             SET status='processing',attempt_count=attempt_count+1,last_attempt_at=$1,
                 lease_id=$2,lease_expires_at=$3
           WHERE notification_id=$4
             AND ((status='pending' AND next_attempt_at<=$1)
               OR (status='processing' AND lease_expires_at<=$1))`,
          [timestamp, leaseId, leaseExpiresAt, row.notification_id],
        );
        if (updated.rowCount !== 1) continue;
        claims.push({
          notificationId: row.notification_id,
          tenantId: row.tenant_id,
          kind: row.kind,
          payloadCiphertext: row.payload_ciphertext,
          leaseId,
          attemptCount: row.attempt_count + 1,
        });
      }
      return claims;
    });
  }

  async finishNotification(input: {
    notificationId: string;
    leaseId: string;
    delivered: boolean;
    providerMessageId?: string;
    submittedAt?: string;
    errorCode?: string;
    maxAttempts?: number;
  }): Promise<SharedNotificationStatus | undefined> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<NotificationRow>(
          `SELECT * FROM sg_notification_outbox
           WHERE notification_id=$1 AND status='processing' AND lease_id=$2 FOR UPDATE`,
          [input.notificationId, input.leaseId],
        )
      ).rows[0];
      if (!row) return undefined;
      this.assertNotificationPayload(row);
      const maxAttempts = Math.min(Math.max(input.maxAttempts ?? 8, 1), 20);
      if (input.delivered) {
        if (
          !input.providerMessageId ||
          !/^[A-Za-z0-9-]{8,128}$/u.test(input.providerMessageId) ||
          !input.submittedAt ||
          !Number.isFinite(Date.parse(input.submittedAt))
        )
          throw new TypeError('shared notification acknowledgement is invalid');
        const result = await client.query(
          `UPDATE sg_notification_outbox
             SET status='delivered',submitted_at=$1,provider_message_id=$2,error_code=NULL,
                 lease_id=NULL,lease_expires_at=NULL
           WHERE notification_id=$3 AND status='processing' AND lease_id=$4`,
          [
            new Date(input.submittedAt),
            input.providerMessageId,
            input.notificationId,
            input.leaseId,
          ],
        );
        return result.rowCount === 1 ? 'delivered' : undefined;
      }
      const dead = row.attempt_count >= maxAttempts;
      const nextAttemptAt = new Date(
        Date.now() + Math.min(60_000 * 2 ** Math.min(row.attempt_count, 6), 3_600_000),
      );
      const result = await client.query(
        `UPDATE sg_notification_outbox
           SET status=$1,next_attempt_at=$2,error_code=$3,lease_id=NULL,lease_expires_at=NULL
         WHERE notification_id=$4 AND status='processing' AND lease_id=$5`,
        [
          dead ? 'dead' : 'pending',
          nextAttemptAt,
          (input.errorCode ?? 'provider_error').slice(0, 128),
          input.notificationId,
          input.leaseId,
        ],
      );
      return result.rowCount === 1 ? (dead ? 'dead' : 'pending') : undefined;
    });
  }

  async redriveNotification(tenantId: string, notificationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE sg_notification_outbox
         SET status='pending',attempt_count=0,next_attempt_at=$1,lease_id=NULL,
             lease_expires_at=NULL,last_attempt_at=NULL,submitted_at=NULL,
             provider_message_id=NULL,error_code=NULL
       WHERE tenant_id=$2 AND notification_id=$3 AND status='dead'`,
      [new Date(), tenantId, notificationId],
    );
    return result.rowCount === 1;
  }

  async recordNotificationProviderEvent(event: SharedNotificationProviderEvent): Promise<boolean> {
    if (
      !/^sha256:[0-9a-f]{64}$/u.test(event.eventId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(event.recipientHash) ||
      !/^[A-Za-z0-9-]{8,128}$/u.test(event.messageId) ||
      !Number.isFinite(Date.parse(event.occurredAt))
    )
      throw new TypeError('shared notification provider event is invalid');
    return this.transaction(async (client) => {
      const existing = (
        await client.query<NotificationEventRow>(
          'SELECT * FROM sg_notification_events WHERE event_id=$1 FOR UPDATE',
          [event.eventId],
        )
      ).rows[0];
      if (existing) {
        if (
          !equal(
            existing.event_hmac,
            this.notificationEventHmac({
              event_id: existing.event_id,
              notification_id: existing.notification_id,
              tenant_id: existing.tenant_id,
              event_type: existing.event_type,
              occurred_at: existing.occurred_at,
              bounce_type: existing.bounce_type,
              inactive: existing.inactive,
            }),
          )
        )
          throw new SharedStateIntegrityError('shared notification event integrity failed');
        return true;
      }
      const notification = (
        await client.query<NotificationRow>(
          'SELECT * FROM sg_notification_outbox WHERE provider_message_id=$1 FOR UPDATE',
          [event.messageId],
        )
      ).rows[0];
      if (!notification || notification.recipient_hash !== event.recipientHash) return false;
      this.assertNotificationPayload(notification);
      const row: Omit<NotificationEventRow, 'event_hmac'> = {
        event_id: event.eventId,
        notification_id: notification.notification_id,
        tenant_id: notification.tenant_id,
        event_type: event.eventType,
        occurred_at: new Date(event.occurredAt),
        bounce_type: event.bounceType,
        inactive: event.inactive,
      };
      const inserted = await client.query(
        `INSERT INTO sg_notification_events(
           event_id,notification_id,tenant_id,event_type,occurred_at,bounce_type,inactive,event_hmac
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(event_id) DO NOTHING`,
        [...Object.values(row), this.notificationEventHmac(row)],
      );
      return inserted.rowCount === 1;
    });
  }

  async issueApiKey(
    tenantId: string,
    scopes: SharedScope[],
  ): Promise<{ key_id: string; api_key: string; scopes: SharedScope[] }> {
    this.assertScopes(scopes);
    const apiKey = generateApiKey();
    const timestamp = new Date();
    const unsigned: Omit<ApiKeyRow, 'control_hmac'> = {
      id: `key_${sha256(tenantId + apiKey).slice(-16)}`,
      tenant_id: tenantId,
      key_hash: hashApiKey(this.masterSecret, apiKey),
      prefix: apiKey.slice(0, 12),
      scopes_json: canonicalJson(scopes),
      rate_window_started_at: timestamp,
      rate_window_count: 0,
      created_at: timestamp,
      revoked_at: null,
    };
    await this.transaction(async (client) => {
      const tenant = (
        await client.query<TenantRow>('SELECT * FROM sg_control_tenants WHERE id=$1 FOR UPDATE', [
          tenantId,
        ])
      ).rows[0];
      if (!tenant) throw new SharedStateIntegrityError('shared tenant does not exist');
      this.assertTenant(tenant);
      await client.query(
        `INSERT INTO sg_control_api_keys(id,tenant_id,key_hash,prefix,scopes_json,rate_window_started_at,rate_window_count,created_at,revoked_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [...Object.values(unsigned), this.apiKeyHmac(unsigned)],
      );
    });
    return { key_id: unsigned.id, api_key: apiKey, scopes };
  }

  async listApiKeys(tenantId: string, currentKeyId: string): Promise<SharedApiKeySummary[]> {
    const rows = (
      await this.pool.query<ApiKeyRow>(
        'SELECT * FROM sg_control_api_keys WHERE tenant_id=$1 ORDER BY created_at DESC,id',
        [tenantId],
      )
    ).rows;
    return rows.map((row) => {
      this.assertApiKey(row);
      return {
        key_id: row.id,
        prefix: row.prefix,
        scopes: this.parseScopes(row.scopes_json),
        created_at: row.created_at.toISOString(),
        revoked_at: row.revoked_at?.toISOString() ?? null,
        current: row.id === currentKeyId,
      };
    });
  }

  async revokeApiKey(tenantId: string, currentKeyId: string, keyId: string): Promise<boolean> {
    if (keyId === currentKeyId) throw new TypeError('cannot revoke current API key');
    return this.transaction(async (client) => {
      const row = (
        await client.query<ApiKeyRow>(
          'SELECT * FROM sg_control_api_keys WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE',
          [tenantId, keyId],
        )
      ).rows[0];
      if (!row) return false;
      this.assertApiKey(row);
      const current = this.apiKeyUnsigned(row);
      const updated = { ...current, revoked_at: new Date() };
      await client.query(
        'UPDATE sg_control_api_keys SET revoked_at=$1,control_hmac=$2 WHERE tenant_id=$3 AND id=$4',
        [updated.revoked_at, this.apiKeyHmac(updated), tenantId, keyId],
      );
      return true;
    });
  }

  async tenantLifecycle(tenantId: string): Promise<SharedTenantLifecycle> {
    const row = (
      await this.pool.query<TenantLifecycleRow>(
        'SELECT * FROM sg_tenant_lifecycle WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0];
    if (!row) throw new SharedStateIntegrityError('shared tenant lifecycle is missing');
    this.assertTenantLifecycle(row);
    return {
      status: row.status,
      reason_code: row.reason_code,
      deletion_requested_at: row.deletion_requested_at?.toISOString() ?? null,
      updated_at: row.updated_at.toISOString(),
    };
  }

  async updateTenantLifecycle(
    tenantId: string,
    status: SharedTenantLifecycleStatus,
    reasonCode: string | null,
  ): Promise<SharedTenantLifecycle> {
    if (
      !['active', 'suspended', 'canceled', 'deletion_pending'].includes(status) ||
      (reasonCode !== null && !/^[a-z0-9][a-z0-9_.-]{0,63}$/u.test(reasonCode))
    )
      throw new TypeError('shared tenant lifecycle input is invalid');
    return this.transaction(async (client) => {
      const existing = (
        await client.query<TenantLifecycleRow>(
          'SELECT * FROM sg_tenant_lifecycle WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!existing) throw new SharedStateIntegrityError('shared tenant lifecycle is missing');
      this.assertTenantLifecycle(existing);
      const timestamp = new Date();
      const unsigned: Omit<TenantLifecycleRow, 'control_hmac'> = {
        tenant_id: tenantId,
        status,
        reason_code: reasonCode,
        deletion_requested_at:
          status === 'deletion_pending' ? (existing.deletion_requested_at ?? timestamp) : null,
        updated_at: timestamp,
      };
      await client.query(
        `UPDATE sg_tenant_lifecycle
         SET status=$1,reason_code=$2,deletion_requested_at=$3,updated_at=$4,control_hmac=$5
         WHERE tenant_id=$6`,
        [
          unsigned.status,
          unsigned.reason_code,
          unsigned.deletion_requested_at,
          unsigned.updated_at,
          this.tenantLifecycleHmac(unsigned),
          tenantId,
        ],
      );
      return {
        status,
        reason_code: reasonCode,
        deletion_requested_at: unsigned.deletion_requested_at?.toISOString() ?? null,
        updated_at: timestamp.toISOString(),
      };
    });
  }

  async consumeRateLimit(
    tenantId: string,
    keyId: string,
    limit: number,
    currentTime = new Date(),
  ): Promise<void> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1_000_000 ||
      Number.isNaN(currentTime.getTime())
    )
      throw new TypeError('shared rate limit input is invalid');
    await this.transaction(async (client) => {
      const row = (
        await client.query<ApiKeyRow>(
          'SELECT * FROM sg_control_api_keys WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE',
          [tenantId, keyId],
        )
      ).rows[0];
      if (!row)
        throw new SharedStateIntegrityError('shared API key is unavailable during rate limiting');
      this.assertApiKey(row);
      const current = this.apiKeyUnsigned(row);
      const reset = currentTime.getTime() - row.rate_window_started_at.getTime() >= 60_000;
      if (!reset && row.rate_window_count >= limit) throw new SharedRateLimitExceededError();
      const updated = {
        ...current,
        rate_window_started_at: reset ? currentTime : row.rate_window_started_at,
        rate_window_count: reset ? 1 : row.rate_window_count + 1,
      };
      await client.query(
        'UPDATE sg_control_api_keys SET rate_window_started_at=$1,rate_window_count=$2,control_hmac=$3 WHERE tenant_id=$4 AND id=$5',
        [
          updated.rate_window_started_at,
          updated.rate_window_count,
          this.apiKeyHmac(updated),
          tenantId,
          keyId,
        ],
      );
    });
  }

  private async updateTenant(
    tenantId: string,
    change: (row: Omit<TenantRow, 'control_hmac'>) => Omit<TenantRow, 'control_hmac'>,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const row = (
        await client.query<TenantRow>('SELECT * FROM sg_control_tenants WHERE id=$1 FOR UPDATE', [
          tenantId,
        ])
      ).rows[0];
      if (!row) throw new SharedStateIntegrityError('shared tenant does not exist');
      this.assertTenant(row);
      const unsigned = this.tenantUnsigned(row);
      const updated = change(unsigned);
      await client.query(
        `UPDATE sg_control_tenants SET name=$1,plan=$2,monthly_limit=$3,retention_days=$4,policy_json=$5,
           usage_month=$6,validation_count=$7,repair_count=$8,rejection_count=$9,drift_count=$10,
           created_at=$11,updated_at=$12,control_hmac=$13 WHERE id=$14`,
        [
          updated.name,
          updated.plan,
          updated.monthly_limit,
          updated.retention_days,
          updated.policy_json,
          updated.usage_month,
          updated.validation_count,
          updated.repair_count,
          updated.rejection_count,
          updated.drift_count,
          updated.created_at,
          updated.updated_at,
          this.tenantHmac(updated),
          tenantId,
        ],
      );
    });
  }

  async updateTenantPolicy(tenantId: string, policy: GuardPolicy): Promise<void> {
    if (policyValidationError(policy)) throw new TypeError('shared tenant policy is invalid');
    await this.updateTenant(tenantId, (row) => ({
      ...row,
      policy_json: canonicalJson(policy),
      updated_at: new Date(),
    }));
  }
  async actionControl(tenantId: string): Promise<SharedActionControl> {
    const row = (
      await this.pool.query<ActionControlRow>(
        'SELECT * FROM sg_action_controls WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0];
    if (!row) throw new SharedStateIntegrityError('shared tenant action control is missing');
    return this.publicActionControl(row);
  }
  async updateActionControl(
    tenantId: string,
    operatorId: string,
    input: {
      hold: boolean;
      reason_code: string | null;
      enforced_policy: ActionControlPolicy;
      shadow_policy: ActionControlPolicy | null;
    },
  ): Promise<SharedActionControl> {
    if (
      !operatorId ||
      operatorId.length > 256 ||
      typeof input.hold !== 'boolean' ||
      (input.reason_code !== null && !/^[a-z0-9][a-z0-9_.-]{0,63}$/u.test(input.reason_code)) ||
      (input.hold && input.reason_code === null)
    )
      throw new TypeError('shared action control is invalid');
    const enforcedError = actionControlPolicyValidationError(input.enforced_policy);
    const shadowError = actionControlPolicyValidationError(input.shadow_policy ?? undefined);
    if (enforcedError || shadowError)
      throw new TypeError(enforcedError ?? shadowError ?? 'shared action policy is invalid');
    return this.transaction(async (client) => {
      const current = (
        await client.query<ActionControlRow>(
          'SELECT * FROM sg_action_controls WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!current) throw new SharedStateIntegrityError('shared tenant action control is missing');
      this.assertActionControl(current);
      const updated: Omit<ActionControlRow, 'control_hmac'> = {
        tenant_id: tenantId,
        hold: input.hold,
        reason_code: input.reason_code,
        enforced_policy_json: canonicalJson(input.enforced_policy),
        shadow_policy_json:
          input.shadow_policy === null ? null : canonicalJson(input.shadow_policy),
        updated_at: new Date(),
        updated_by_hash: this.actionControlOperatorHash(tenantId, operatorId),
      };
      await client.query(
        `UPDATE sg_action_controls
         SET hold=$1,reason_code=$2,enforced_policy_json=$3,shadow_policy_json=$4,updated_at=$5,updated_by_hash=$6,control_hmac=$7
         WHERE tenant_id=$8`,
        [
          updated.hold,
          updated.reason_code,
          updated.enforced_policy_json,
          updated.shadow_policy_json,
          updated.updated_at,
          updated.updated_by_hash,
          this.actionControlHmac(updated),
          tenantId,
        ],
      );
      if (this.options.alertWriter)
        await this.options.alertWriter.recordAlertWithClient(
          client,
          tenantId,
          'action_control_changed',
          'critical',
          {
            hold: input.hold,
            reason_code: input.reason_code,
            enforced_policy_hash: sha256(input.enforced_policy),
            shadow_policy_hash: input.shadow_policy === null ? null : sha256(input.shadow_policy),
          },
          `action-control:${updated.updated_at.toISOString()}`,
        );
      return this.publicActionControl({
        ...updated,
        control_hmac: this.actionControlHmac(updated),
      });
    });
  }
  async updatePlan(tenantId: string, plan: SharedPlanId): Promise<void> {
    await this.updateTenant(tenantId, (row) => ({
      ...row,
      plan,
      monthly_limit: this.planLimits[plan],
      updated_at: new Date(),
    }));
  }

  private async incrementDrift(tenantId: string): Promise<SharedUsage> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<TenantRow>('SELECT * FROM sg_control_tenants WHERE id=$1 FOR UPDATE', [
          tenantId,
        ])
      ).rows[0];
      if (!row) throw new SharedStateIntegrityError('shared tenant does not exist');
      this.assertTenant(row);
      const timestamp = new Date();
      const current = this.resetMonth(row, timestamp);
      const updated: Omit<TenantRow, 'control_hmac'> = {
        ...current,
        drift_count: current.drift_count + 1,
        updated_at: timestamp,
      };
      await client.query(
        `UPDATE sg_control_tenants SET usage_month=$1,validation_count=$2,repair_count=$3,rejection_count=$4,
         drift_count=$5,updated_at=$6,control_hmac=$7 WHERE id=$8`,
        [
          updated.usage_month,
          updated.validation_count,
          updated.repair_count,
          updated.rejection_count,
          updated.drift_count,
          updated.updated_at,
          this.tenantHmac(updated),
          tenantId,
        ],
      );
      return this.usageFrom({ ...updated, control_hmac: this.tenantHmac(updated) });
    });
  }
  async recordValidation(
    tenantId: string,
    decision: GuardDecision,
    context: SharedObservationContext = {},
  ): Promise<SharedUsage> {
    const envelope = decision.audit;
    if (
      decision.audit_id !== envelope.audit_id ||
      decision.decision !== envelope.decision ||
      canonicalJson(decision.repaired_fields.map((repair) => repair.rule_id)) !==
        canonicalJson(envelope.repair_rule_ids) ||
      (decision.decision === 'rejected' ? decision.reason_code : undefined) !==
        envelope.reason_code ||
      !Number.isFinite(Date.parse(envelope.timestamp)) ||
      new Date(envelope.timestamp).toISOString() !== envelope.timestamp
    )
      throw new SharedStateIntegrityError('shared validation decision audit binding is invalid');
    const envelopeJson = canonicalJson(envelope);
    this.parseEnvelope(envelopeJson);
    return this.transaction(async (client) => {
      const row = (
        await client.query<TenantRow>('SELECT * FROM sg_control_tenants WHERE id=$1 FOR UPDATE', [
          tenantId,
        ])
      ).rows[0];
      if (!row) throw new SharedStateIntegrityError('shared tenant does not exist');
      this.assertTenant(row);
      const verification = await this.verifyAuditWithClient(client, tenantId, true);
      if (!verification.valid)
        throw new SharedStateIntegrityError('shared audit history integrity failed');
      const existing = (
        await client.query<AuditRow>(
          'SELECT * FROM sg_control_audit_events WHERE tenant_id=$1 AND audit_id=$2 FOR UPDATE',
          [tenantId, decision.audit_id],
        )
      ).rows[0];
      if (existing) {
        const priorEnvelope = this.assertAuditRow(existing, existing.previous_hash);
        if (canonicalJson(priorEnvelope) !== envelopeJson)
          throw new SharedStateIntegrityError(
            'shared audit ID conflicts with an existing decision',
          );
        await this.options.intelligenceWriter?.recordObservationWithClient(
          client,
          tenantId,
          decision,
          context,
        );
        if (decision.decision !== 'rejected')
          await this.options.acceptedDecisionWriter?.recordAcceptedDecisionWithClient(
            client,
            tenantId,
            decision,
          );
        return this.usageFrom(row);
      }
      const timestamp = new Date();
      const current = this.resetMonth(row, timestamp);
      if (current.validation_count >= current.monthly_limit) throw new SharedQuotaExceededError();
      const manifest = (
        await client.query<AuditManifestRow>(
          'SELECT * FROM sg_control_audit_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!manifest) throw new SharedStateIntegrityError('shared audit manifest is missing');
      this.assertAuditManifest(manifest);
      const previousHash = manifest.tip_hash;
      const eventHash = this.auditEventHash(tenantId, envelope, previousHash);
      await client.query(
        `INSERT INTO sg_control_audit_events(tenant_id,audit_id,occurred_at,decision,reason_code,repair_rules_json,envelope_json,previous_hash,event_hash,signature)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          tenantId,
          decision.audit_id,
          new Date(envelope.timestamp),
          decision.decision,
          envelope.reason_code ?? null,
          canonicalJson(envelope.repair_rule_ids),
          envelopeJson,
          previousHash,
          eventHash,
          this.auditEventSignature(eventHash, previousHash),
        ],
      );
      const updatedManifest: Omit<AuditManifestRow, 'control_hmac'> = {
        tenant_id: tenantId,
        revision: String(Number(manifest.revision) + 1),
        retained_row_count: String(Number(manifest.retained_row_count) + 1),
        total_event_count: String(Number(manifest.total_event_count) + 1),
        tip_hash: eventHash,
        updated_at: timestamp,
      };
      await client.query(
        `UPDATE sg_control_audit_manifests SET revision=$1,retained_row_count=$2,total_event_count=$3,
         tip_hash=$4,updated_at=$5,control_hmac=$6 WHERE tenant_id=$7`,
        [
          updatedManifest.revision,
          updatedManifest.retained_row_count,
          updatedManifest.total_event_count,
          updatedManifest.tip_hash,
          updatedManifest.updated_at,
          this.auditManifestHmac(updatedManifest),
          tenantId,
        ],
      );
      const updatedTenant: Omit<TenantRow, 'control_hmac'> = {
        ...current,
        validation_count: current.validation_count + 1,
        repair_count: current.repair_count + (decision.decision === 'valid_with_repair' ? 1 : 0),
        rejection_count: current.rejection_count + (decision.decision === 'rejected' ? 1 : 0),
        updated_at: timestamp,
      };
      await client.query(
        `UPDATE sg_control_tenants SET usage_month=$1,validation_count=$2,repair_count=$3,rejection_count=$4,
         drift_count=$5,updated_at=$6,control_hmac=$7 WHERE id=$8`,
        [
          updatedTenant.usage_month,
          updatedTenant.validation_count,
          updatedTenant.repair_count,
          updatedTenant.rejection_count,
          updatedTenant.drift_count,
          updatedTenant.updated_at,
          this.tenantHmac(updatedTenant),
          tenantId,
        ],
      );
      if (decision.decision === 'rejected' && this.options.alertWriter)
        await this.options.alertWriter.recordAlertWithClient(
          client,
          tenantId,
          'validation_rejected',
          'warning',
          { audit_id: decision.audit_id, reason_code: decision.reason_code },
          `validation:${decision.audit_id}`,
        );
      await this.options.intelligenceWriter?.recordObservationWithClient(
        client,
        tenantId,
        decision,
        context,
      );
      if (decision.decision !== 'rejected')
        await this.options.acceptedDecisionWriter?.recordAcceptedDecisionWithClient(
          client,
          tenantId,
          decision,
        );
      return this.usageFrom({ ...updatedTenant, control_hmac: this.tenantHmac(updatedTenant) });
    });
  }
  async listAudits(tenantId: string, limit: number): Promise<SharedAuditRecord[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1_000) : 100;
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const verification = await this.verifyAuditWithClient(client, tenantId);
      if (!verification.valid)
        throw new SharedStateIntegrityError('shared audit history integrity failed');
      const rows = (
        await client.query<AuditRow>(
          'SELECT * FROM sg_control_audit_events WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT $2',
          [tenantId, bounded],
        )
      ).rows;
      return rows.map((row) => {
        const envelope = this.parseEnvelope(row.envelope_json);
        return {
          sequence: Number(row.sequence),
          audit_id: envelope.audit_id,
          occurred_at: envelope.timestamp,
          decision: envelope.decision,
          reason_code: envelope.reason_code ?? null,
          repair_rules: [...envelope.repair_rule_ids],
          envelope,
          event_hash: row.event_hash,
          previous_hash: row.previous_hash,
          signature: row.signature,
        };
      });
    });
  }
  async verifyAuditChain(tenantId: string): Promise<SharedAuditVerification> {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return this.verifyAuditWithClient(client, tenantId);
    });
  }
  async purgeExpiredAudits(tenantId: string, retentionDays: number): Promise<number> {
    if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 3_650)
      throw new TypeError('shared audit retention is invalid');
    return this.transaction(async (client) => {
      const tenant = (
        await client.query<TenantRow>('SELECT * FROM sg_control_tenants WHERE id=$1 FOR UPDATE', [
          tenantId,
        ])
      ).rows[0];
      if (!tenant) throw new SharedStateIntegrityError('shared tenant does not exist');
      this.assertTenant(tenant);
      const verification = await this.verifyAuditWithClient(client, tenantId, true);
      if (!verification.valid)
        throw new SharedStateIntegrityError('shared audit history integrity failed');
      const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
      const boundary = (
        await client.query<Pick<AuditRow, 'sequence' | 'event_hash'>>(
          `SELECT sequence,event_hash FROM sg_control_audit_events
           WHERE tenant_id=$1 AND occurred_at<$2 ORDER BY sequence DESC LIMIT 1`,
          [tenantId, cutoff],
        )
      ).rows[0];
      if (!boundary) return 0;
      const deleted = await client.query(
        'DELETE FROM sg_control_audit_events WHERE tenant_id=$1 AND sequence<=$2',
        [tenantId, boundary.sequence],
      );
      const deletedCount = deleted.rowCount ?? 0;
      if (deletedCount === 0) return 0;
      const previousAnchor = (
        await client.query<AuditAnchorRow>(
          'SELECT * FROM sg_control_audit_anchors WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (previousAnchor) this.assertAuditAnchor(previousAnchor);
      const timestamp = new Date();
      const anchor: Omit<AuditAnchorRow, 'control_hmac'> = {
        tenant_id: tenantId,
        last_deleted_hash: boundary.event_hash,
        deleted_through_sequence: boundary.sequence,
        deleted_event_count: String(
          Number(previousAnchor?.deleted_event_count ?? 0) + deletedCount,
        ),
        updated_at: timestamp,
      };
      await client.query(
        `INSERT INTO sg_control_audit_anchors(tenant_id,last_deleted_hash,deleted_through_sequence,deleted_event_count,updated_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id) DO UPDATE SET
         last_deleted_hash=excluded.last_deleted_hash,deleted_through_sequence=excluded.deleted_through_sequence,
         deleted_event_count=excluded.deleted_event_count,updated_at=excluded.updated_at,control_hmac=excluded.control_hmac`,
        [...Object.values(anchor), this.auditAnchorHmac(anchor)],
      );
      const manifest = (
        await client.query<AuditManifestRow>(
          'SELECT * FROM sg_control_audit_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!manifest) throw new SharedStateIntegrityError('shared audit manifest is missing');
      this.assertAuditManifest(manifest);
      const updatedManifest: Omit<AuditManifestRow, 'control_hmac'> = {
        tenant_id: tenantId,
        revision: String(Number(manifest.revision) + 1),
        retained_row_count: String(Number(manifest.retained_row_count) - deletedCount),
        total_event_count: manifest.total_event_count,
        tip_hash: manifest.tip_hash,
        updated_at: timestamp,
      };
      await client.query(
        `UPDATE sg_control_audit_manifests SET revision=$1,retained_row_count=$2,total_event_count=$3,
         tip_hash=$4,updated_at=$5,control_hmac=$6 WHERE tenant_id=$7`,
        [
          updatedManifest.revision,
          updatedManifest.retained_row_count,
          updatedManifest.total_event_count,
          updatedManifest.tip_hash,
          updatedManifest.updated_at,
          this.auditManifestHmac(updatedManifest),
          tenantId,
        ],
      );
      const after = await this.verifyAuditWithClient(client, tenantId);
      if (!after.valid) throw new SharedStateIntegrityError('shared audit purge integrity failed');
      return deletedCount;
    });
  }
  recordDrift(tenantId: string): Promise<SharedUsage> {
    return this.incrementDrift(tenantId);
  }
  async usage(tenantId: string): Promise<SharedUsage> {
    const row = (
      await this.pool.query<TenantRow>('SELECT * FROM sg_control_tenants WHERE id=$1', [tenantId])
    ).rows[0];
    if (!row) throw new SharedStateIntegrityError('shared tenant does not exist');
    this.assertTenant(row);
    if (row.usage_month !== month())
      return {
        tenant_id: tenantId,
        month: month(),
        validation_count: 0,
        repair_count: 0,
        rejection_count: 0,
        drift_count: 0,
      };
    return this.usageFrom(row);
  }
  async operationalMetrics(): Promise<SharedQuotaOperationalMetrics> {
    const result = await this.pool.query<{
      healthy: string;
      warning: string;
      exhausted: string;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE (CASE WHEN t.usage_month=$1 THEN t.validation_count ELSE 0 END)
             < t.monthly_limit * 0.8
         )::text healthy,
         COUNT(*) FILTER (
           WHERE (CASE WHEN t.usage_month=$1 THEN t.validation_count ELSE 0 END)
             >= t.monthly_limit * 0.8
             AND (CASE WHEN t.usage_month=$1 THEN t.validation_count ELSE 0 END)
             < t.monthly_limit
         )::text warning,
         COUNT(*) FILTER (
           WHERE (CASE WHEN t.usage_month=$1 THEN t.validation_count ELSE 0 END)
             >= t.monthly_limit
         )::text exhausted
       FROM sg_control_tenants t
       JOIN sg_tenant_lifecycle l ON l.tenant_id=t.id AND l.status='active'`,
      [month()],
    );
    const row = result.rows[0] ?? { healthy: '0', warning: '0', exhausted: '0' };
    return {
      healthy: Number(row.healthy),
      warning: Number(row.warning),
      exhausted: Number(row.exhausted),
    };
  }
  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

export class SharedQuotaExceededError extends Error {
  constructor() {
    super('monthly validation quota exceeded');
    this.name = 'SharedQuotaExceededError';
  }
}

export class SharedRateLimitExceededError extends Error {
  constructor() {
    super('shared per-key rate limit exceeded');
    this.name = 'SharedRateLimitExceededError';
  }
}
