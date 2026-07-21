import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  canonicalJson,
  policyValidationError,
  sha256,
  type AuditEnvelope,
  type GuardDecision,
  type GuardPolicy,
} from '@schema-guard/core';
import { SharedStateIntegrityError, type TransactionalAcceptedDecisionWriter } from './postgres.js';
import type { TransactionalAlertWriter } from './alerts.js';
import type { SharedObservationContext, TransactionalIntelligenceWriter } from './intelligence.js';

export type SharedPlanId = 'trial' | 'team';
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
}

export interface SharedUsage {
  tenant_id: string;
  month: string;
  validation_count: number;
  repair_count: number;
  rejection_count: number;
  drift_count: number;
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

export interface ControlState {
  readonly recordsValidationAlerts?: boolean;
  readonly recordsValidationIntelligence?: boolean;
  readonly recordsAcceptedActionDecisions?: boolean;
  migrate(): Promise<void>;
  ready(): Promise<boolean>;
  bootstrapTenant(input: SharedTenantBootstrap): Promise<void>;
  authenticate(apiKey: string): Promise<SharedPrincipal | undefined>;
  issueApiKey(
    tenantId: string,
    scopes: SharedScope[],
  ): Promise<{ key_id: string; api_key: string; scopes: SharedScope[] }>;
  revokeApiKey(tenantId: string, currentKeyId: string, keyId: string): Promise<boolean>;
  updateTenantPolicy(tenantId: string, policy: GuardPolicy): Promise<void>;
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
const defaultLimits: Record<SharedPlanId, number> = { trial: 1_000, team: 100_000 };
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
      const rows = await client.query<{ version: number; checksum: string }>(
        'SELECT version,checksum FROM sg_control_schema_migrations ORDER BY version',
      );
      if (rows.rows.some((row) => row.version !== 1 || row.checksum !== checksum))
        throw new SharedStateIntegrityError('shared control migration history is incompatible');
      if (rows.rows.length === 0)
        await client.query(
          `INSERT INTO sg_control_schema_migrations(version,migration_name,checksum,applied_at)
           VALUES(1,'initial_managed_control_state',$1,$2)`,
          [checksum, new Date()],
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
        if (!(await this.verifyAuditWithClient(client, tenant.id)).valid)
          throw new SharedStateIntegrityError('shared audit readiness failed');
      }
      const keys = await client.query<ApiKeyRow>('SELECT * FROM sg_control_api_keys');
      for (const key of keys.rows) this.assertApiKey(key);
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
          existing.retention_days !== (input.retentionDays ?? 30) ||
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
          retention_days: input.retentionDays ?? 30,
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
      }
    >(
      `SELECT k.*,t.name tenant_name,t.plan,t.monthly_limit,t.retention_days,t.policy_json,t.usage_month,
              t.validation_count,t.repair_count,t.rejection_count,t.drift_count,t.created_at tenant_created_at,
              t.updated_at tenant_updated_at,t.control_hmac tenant_control_hmac
       FROM sg_control_api_keys k JOIN sg_control_tenants t ON t.id=k.tenant_id
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
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      keyId: row.id,
      scopes: this.parseScopes(row.scopes_json),
      plan: tenant.plan,
      monthlyLimit: tenant.monthly_limit,
      retentionDays: tenant.retention_days,
      policy: this.parsePolicy(tenant.policy_json),
    };
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
