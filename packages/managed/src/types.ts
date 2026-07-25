import type { ActionControlPolicy, GuardPolicy } from '@schema-guard/core';

export type PlanId = 'trial' | 'team';
export type TenantLifecycleStatus = 'active' | 'suspended' | 'canceled' | 'deletion_pending';

export interface TenantLifecycle {
  status: TenantLifecycleStatus;
  reason_code: string | null;
  deletion_requested_at: string | null;
  updated_at: string;
}

export interface ManagedActionControl {
  hold: boolean;
  reason_code: string | null;
  enforced_policy: ActionControlPolicy;
  shadow_policy: ActionControlPolicy | null;
  updated_at: string;
  updated_by_hash: string;
}

export type Scope =
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
export const ALL_SCOPES: Scope[] = [
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

export interface Principal {
  tenantId: string;
  tenantName: string;
  keyId: string;
  scopes: Scope[];
  plan: PlanId;
  monthlyLimit: number;
  retentionDays: number;
  policy: GuardPolicy;
  lifecycleStatus: TenantLifecycleStatus;
}

export interface ManagedConfig {
  databasePath: string;
  masterSecret: string;
  host?: string;
  port?: number;
  publicMode?: boolean;
  instanceCount?: number;
  sharedActionDatabaseUrl?: string;
  sharedControlDatabaseUrl?: string;
  externalUrl?: string;
  trustProxy?: boolean;
  accessLog?: boolean;
  metricsBearerToken?: string;
  rateLimitPerMinute?: number;
  aggregateTenantThreshold?: number;
  alertFile?: string;
  alertWebhookPollIntervalMs?: number;
  alertWebhookRequestTimeoutMs?: number;
  alertWebhookMaxAttempts?: number;
  actionCheckpointAnchorUrl?: string;
  actionCheckpointAnchorSigningSecret?: string;
  actionCheckpointAnchorPollIntervalMs?: number;
  actionCheckpointAnchorRequestTimeoutMs?: number;
  actionCheckpointAnchorMaxAttempts?: number;
  requestTimeoutMs?: number;
  actionReconciliationMinAgeSeconds?: number;
  stripeSecretKey?: string;
  stripeMode?: 'sandbox';
  stripeWebhookSecret?: string;
  stripeTeamPriceId?: string;
  stripeCheckoutSuccessUrl?: string;
  stripeCheckoutCancelUrl?: string;
  stripePortalReturnUrl?: string;
  workosApiKey?: string;
  workosClientId?: string;
  workosCookiePassword?: string;
  workosRedirectUri?: string;
  workosLogoutReturnUrl?: string;
  workosOrganizationTenantMap?: Record<string, string>;
  postmarkServerToken?: string;
  postmarkFrom?: string;
  postmarkMessageStream?: string;
  postmarkWebhookUsername?: string;
  postmarkWebhookPassword?: string;
  notificationPollIntervalMs?: number;
  notificationMaxAttempts?: number;
}

export interface DeliveryOperationalMetrics {
  pending: number;
  processing: number;
  dead: number;
  oldest_pending_age_seconds: number;
}

export interface ManagedOperationalMetrics {
  quota_tenants: {
    healthy: number;
    warning: number;
    exhausted: number;
  };
  alert_deliveries: DeliveryOperationalMetrics;
  anchor_deliveries: DeliveryOperationalMetrics;
  pending_action_reservations: number;
  oldest_pending_action_age_seconds: number;
  sources_ready: {
    quota: boolean;
    alert: boolean;
    action: boolean;
  };
}

export interface AlertWebhookEndpoint {
  webhook_id: string;
  label: string;
  endpoint_hash: string;
  created_at: string;
  disabled_at: string | null;
}

export interface AlertWebhookDelivery {
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

export type SchemaEnforcementMode = 'observe' | 'enforce';

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
}

export interface SchemaAdmissionResult {
  mode: SchemaEnforcementMode;
  allowed: boolean;
  reason?: 'schema_not_promoted' | 'schema_release_mismatch' | 'schema_release_integrity_invalid';
  environment: string;
  tool_name_hash: string;
  submitted_schema_hash: string;
  promoted_schema_hash?: string;
  release_id?: string;
}

export interface PendingActionReservation {
  reservation_id: string;
  execution_fingerprint: string;
  audit_id: string;
  tool_name_hash: string;
  environment: string;
  created_at: string;
  updated_at: string;
  age_seconds: number;
}

export interface ActionIdempotencyCheckpoint {
  checkpoint_version: '1';
  tenant_ref: string;
  revision: number;
  row_count: number;
  accumulator: string;
  updated_at: string;
  checkpoint_hash: string;
}

export interface ActionIdempotencyCheckpointComparison {
  status: 'same' | 'advanced' | 'rollback_detected' | 'integrity_conflict';
  anchored_revision: number;
  current_revision: number;
  current_checkpoint: ActionIdempotencyCheckpoint;
}

export interface ActionCheckpointAnchorDelivery {
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

export interface ActionReconciliationRecord {
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
}

export interface SignedRuleSet {
  version: string;
  issued_at: string;
  expires_at: string;
  rules: { id: string; enabled_by_default: boolean; description: string }[];
  key_id: string;
  public_key: string;
  signature: string;
}
