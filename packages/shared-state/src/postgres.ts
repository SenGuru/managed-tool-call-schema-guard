import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { TransactionalAlertWriter } from './alerts.js';
import {
  canonicalJson,
  approveChallenge,
  sha256,
  verifyRepairReceipt,
  type ActionDescriptor,
  type ApprovalChallenge,
  type ApprovalEvidence,
  type GuardDecision,
} from '@schema-guard/core';

const ZERO = Buffer.alloc(32);
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
};
const hmac = (secret: string, purpose: string, value: unknown): string =>
  `hmac-sha256:${createHmac('sha256', secret).update(purpose).update('\0').update(canonical(value)).digest('hex')}`;
const equal = (left: string, right: string): boolean => {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
};
const member = (keyHash: string, controlHmac: string): Buffer =>
  createHash('sha256')
    .update(canonical({ key_hash: keyHash, control_hmac: controlHmac }))
    .digest();
const xor = (left: Buffer, right: Buffer): Buffer => {
  const result = Buffer.alloc(32);
  for (let index = 0; index < 32; index += 1) result[index] = left[index]! ^ right[index]!;
  return result;
};

export interface SharedActionCheckpoint {
  checkpoint_version: '1';
  tenant_ref: string;
  revision: number;
  row_count: number;
  accumulator: string;
  updated_at: string;
  checkpoint_hash: string;
}

export interface SharedActionCheckpointComparison {
  status: 'same' | 'advanced' | 'rollback_detected' | 'integrity_conflict';
  anchored_revision: number;
  current_revision: number;
  current_checkpoint: SharedActionCheckpoint;
}

export interface SharedPendingActionReservation {
  reservation_id: string;
  execution_fingerprint: string;
  audit_id: string;
  tool_name_hash: string;
  environment: string;
  created_at: string;
  updated_at: string;
  age_seconds: number;
}

export interface SharedActionReconciliationRecord {
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

export interface SharedCheckpointAnchorDelivery {
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

export interface SharedCheckpointAnchorClaim {
  deliveryId: string;
  leaseId: string;
  payload: string;
  attemptCount: number;
}

export interface SharedReservationMetadata {
  auditId?: string;
  toolNameHash?: string;
  environment?: string;
}

export interface SharedReservationResult {
  state: 'new' | 'duplicate' | 'conflict';
  reservation_id?: string;
  revision?: number;
}

export interface TransactionalAcceptedDecisionWriter {
  recordAcceptedDecisionWithClient(
    client: PoolClient,
    tenantId: string,
    decision: GuardDecision,
  ): Promise<void>;
}

export interface ActionState {
  readonly recordsReconciliationAlerts?: boolean;
  readonly recordsAcceptedDecisions?: boolean;
  migrate(): Promise<void>;
  ready(): Promise<boolean>;
  recordAcceptedDecision(tenantId: string, decision: GuardDecision): Promise<void>;
  verifyAcceptedDecision(
    tenantId: string,
    decision: GuardDecision,
    toolName: string,
  ): Promise<boolean>;
  upsertActionDescriptor(
    tenantId: string,
    toolName: string,
    environment: string,
    riskLevel: ActionDescriptor['risk_level'],
    sideEffect: ActionDescriptor['side_effect'],
  ): Promise<ActionDescriptor & { environment: string }>;
  actionDescriptor(
    tenantId: string,
    toolName: string,
    environment: string,
  ): Promise<ActionDescriptor & { environment: string }>;
  recordActionChallenge(tenantId: string, challenge: ApprovalChallenge): Promise<void>;
  approveActionChallenge(
    tenantId: string,
    challengeId: string,
    approverId: string,
  ): Promise<ApprovalEvidence>;
  revokeActionChallenge(tenantId: string, challengeId: string): Promise<boolean>;
  verifyRecordedApproval(tenantId: string, evidence: ApprovalEvidence): Promise<boolean>;
  reserve(
    tenantId: string,
    key: string,
    executionFingerprint: string,
    metadata?: SharedReservationMetadata,
  ): Promise<SharedReservationResult>;
  complete(tenantId: string, key: string, executionFingerprint: string): Promise<number>;
  release(tenantId: string, key: string, executionFingerprint: string): Promise<number>;
  checkpoint(tenantId: string): Promise<SharedActionCheckpoint>;
  compareCheckpoint(
    tenantId: string,
    anchored: SharedActionCheckpoint,
  ): Promise<SharedActionCheckpointComparison>;
  pending(tenantId: string, olderThanSeconds: number): Promise<SharedPendingActionReservation[]>;
  reconcile(
    tenantId: string,
    reservationId: string,
    outcome: SharedActionReconciliationRecord['outcome'],
    evidenceReference: string,
    operatorId: string,
    minimumAgeSeconds: number,
  ): Promise<SharedActionReconciliationRecord>;
  reconciliationHistory(tenantId: string): Promise<SharedActionReconciliationRecord[]>;
  verifyReconciliations(tenantId: string): Promise<{ valid: boolean; checked: number }>;
  claimCheckpointAnchorDeliveries(limit: number): Promise<SharedCheckpointAnchorClaim[]>;
  finishCheckpointAnchorDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): Promise<'delivered' | 'pending' | 'dead' | undefined>;
  checkpointAnchorAcknowledged(tenantId: string): Promise<boolean>;
  listCheckpointAnchorDeliveries(
    tenantId: string,
    limit: number,
  ): Promise<SharedCheckpointAnchorDelivery[]>;
  redriveCheckpointAnchorDelivery(tenantId: string, deliveryId: string): Promise<boolean>;
  close(): Promise<void>;
}

type ReservationRow = {
  tenant_id: string;
  key_hash: string;
  execution_fingerprint: string;
  state: 'pending' | 'completed';
  reservation_id: string;
  audit_id: string | null;
  tool_name_hash: string | null;
  environment: string | null;
  created_at: Date;
  updated_at: Date;
  control_hmac: string;
};
type ManifestRow = {
  tenant_id: string;
  revision: string;
  row_count: string;
  accumulator: Buffer;
  updated_at: Date;
  control_hmac: string;
};
type ReconciliationRow = {
  sequence: string;
  tenant_id: string;
  reconciliation_id: string;
  reservation_id: string;
  key_hash: string;
  execution_fingerprint: string;
  audit_id: string;
  tool_name_hash: string;
  environment: string;
  outcome: 'confirmed_executed' | 'confirmed_not_executed';
  evidence_hash: string;
  reconciled_by_hash: string;
  reconciled_at: Date;
  previous_hash: string;
  record_hash: string;
};
type ReconciliationManifestRow = {
  tenant_id: string;
  revision: string;
  row_count: string;
  tip_hash: string;
  updated_at: Date;
  control_hmac: string;
};
type CheckpointDeliveryRow = {
  delivery_id: string;
  tenant_id: string;
  revision: string;
  checkpoint_hash: string;
  payload_json: string;
  status: 'pending' | 'processing' | 'delivered' | 'dead';
  attempt_count: number;
  next_attempt_at: Date;
  last_attempt_at: Date | null;
  delivered_at: Date | null;
  response_status: number | null;
  error_code: string | null;
  lease_id: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  control_hmac: string;
};
type AcceptedDecisionRow = {
  tenant_id: string;
  audit_id: string;
  decision: 'valid' | 'valid_with_repair';
  audit_json: string;
  occurred_at: Date;
  control_hmac: string;
};
type ActionDescriptorRow = {
  tenant_id: string;
  tool_name_hash: string;
  environment: string;
  risk_level: ActionDescriptor['risk_level'];
  side_effect: ActionDescriptor['side_effect'];
  created_at: Date;
  updated_at: Date;
  control_hmac: string;
};
type ActionApprovalRow = {
  tenant_id: string;
  challenge_id: string;
  binding_hash: string;
  challenge_json: string;
  status: 'pending' | 'approved' | 'revoked';
  evidence_json: string | null;
  created_at: Date;
  expires_at: Date;
  approved_at: Date | null;
  control_hmac: string;
};

export class SharedStateIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedStateIntegrityError';
  }
}

export class PostgresActionState implements ActionState {
  readonly pool: Pool;
  readonly recordsReconciliationAlerts: boolean;
  readonly recordsAcceptedDecisions = true;
  constructor(
    connectionString: string,
    private readonly masterSecret: string,
    pool?: Pool,
    private readonly options: {
      checkpointAnchoring?: boolean;
      checkpointAnchorMaxAttempts?: number;
      alertWriter?: TransactionalAlertWriter;
    } = {},
  ) {
    if (!connectionString || masterSecret.length < 32)
      throw new TypeError('PostgreSQL URL and a 32+ character master secret are required');
    this.pool = pool ?? new Pool({ connectionString, max: 20, statement_timeout: 10_000 });
    this.recordsReconciliationAlerts = options.alertWriter !== undefined;
  }
  async migrate(): Promise<void> {
    const schema = `
      CREATE TABLE IF NOT EXISTS sg_action_manifests (
        tenant_id TEXT PRIMARY KEY,
        revision BIGINT NOT NULL CHECK(revision >= 0),
        row_count BIGINT NOT NULL CHECK(row_count >= 0),
        accumulator BYTEA NOT NULL CHECK(octet_length(accumulator)=32),
        updated_at TIMESTAMPTZ NOT NULL,
        control_hmac TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sg_action_reservations (
        tenant_id TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        execution_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','completed')),
        reservation_id TEXT NOT NULL CHECK(reservation_id ~ '^res_[0-9a-f-]{36}$'),
        audit_id TEXT,
        tool_name_hash TEXT,
        environment TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        control_hmac TEXT NOT NULL,
        PRIMARY KEY(tenant_id,key_hash),
        UNIQUE(tenant_id,reservation_id)
      );
      CREATE INDEX IF NOT EXISTS sg_action_reservations_state
        ON sg_action_reservations(tenant_id,state,updated_at);
      CREATE TABLE IF NOT EXISTS sg_action_reconciliation_manifests (
        tenant_id TEXT PRIMARY KEY,
        revision BIGINT NOT NULL CHECK(revision >= 0),
        row_count BIGINT NOT NULL CHECK(row_count >= 0),
        tip_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        control_hmac TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sg_action_reconciliations (
        sequence BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        reconciliation_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        execution_fingerprint TEXT NOT NULL,
        audit_id TEXT NOT NULL,
        tool_name_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('confirmed_executed','confirmed_not_executed')),
        evidence_hash TEXT NOT NULL,
        reconciled_by_hash TEXT NOT NULL,
        reconciled_at TIMESTAMPTZ NOT NULL,
        previous_hash TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        UNIQUE(tenant_id,reconciliation_id),
        UNIQUE(tenant_id,reservation_id)
      );
      CREATE INDEX IF NOT EXISTS sg_action_reconciliations_tenant_sequence
        ON sg_action_reconciliations(tenant_id,sequence);
      CREATE TABLE IF NOT EXISTS sg_checkpoint_anchor_deliveries (
        delivery_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        revision BIGINT NOT NULL CHECK(revision >= 0),
        checkpoint_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','processing','delivered','dead')),
        attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
        next_attempt_at TIMESTAMPTZ NOT NULL,
        last_attempt_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        response_status INTEGER,
        error_code TEXT,
        lease_id TEXT,
        lease_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        control_hmac TEXT NOT NULL,
        UNIQUE(tenant_id,revision)
      );
      CREATE INDEX IF NOT EXISTS sg_checkpoint_anchor_deliveries_due
        ON sg_checkpoint_anchor_deliveries(status,next_attempt_at,lease_expires_at);
      CREATE TABLE IF NOT EXISTS sg_accepted_action_decisions (
        tenant_id TEXT NOT NULL,
        audit_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('valid','valid_with_repair')),
        audit_json TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        control_hmac TEXT NOT NULL,
        PRIMARY KEY(tenant_id,audit_id)
      );
      CREATE INDEX IF NOT EXISTS sg_accepted_action_decisions_time
        ON sg_accepted_action_decisions(tenant_id,occurred_at DESC);
      CREATE TABLE IF NOT EXISTS sg_action_descriptors (
        tenant_id TEXT NOT NULL,
        tool_name_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        risk_level TEXT NOT NULL CHECK(risk_level IN ('read','low','medium','high','critical')),
        side_effect TEXT NOT NULL CHECK(side_effect IN ('none','reversible','irreversible')),
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        control_hmac TEXT NOT NULL,
        PRIMARY KEY(tenant_id,tool_name_hash,environment)
      );
      CREATE TABLE IF NOT EXISTS sg_action_approvals (
        tenant_id TEXT NOT NULL,
        challenge_id TEXT NOT NULL,
        binding_hash TEXT NOT NULL,
        challenge_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','revoked')),
        evidence_json TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        approved_at TIMESTAMPTZ,
        control_hmac TEXT NOT NULL,
        PRIMARY KEY(tenant_id,challenge_id)
      );
      CREATE INDEX IF NOT EXISTS sg_action_approvals_status
        ON sg_action_approvals(tenant_id,status,expires_at);
    `;
    const checksum = `sha256:${createHash('sha256').update(schema).digest('hex')}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(741839274103)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS sg_schema_migrations (
          version INTEGER PRIMARY KEY CHECK(version > 0),
          migration_name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL
        )
      `);
      const recorded = await client.query<{ version: number; checksum: string }>(
        'SELECT version,checksum FROM sg_schema_migrations ORDER BY version',
      );
      if (recorded.rows.some((row) => row.version !== 1 || row.checksum !== checksum))
        throw new SharedStateIntegrityError('shared-state migration history is incompatible');
      await client.query(schema);
      if (recorded.rows.length === 0)
        await client.query(
          `INSERT INTO sg_schema_migrations(version,migration_name,checksum,applied_at) VALUES(1,'initial_action_state',$1,$2)`,
          [checksum, new Date()],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  async ready(): Promise<boolean> {
    try {
      await this.transaction(async (client) => {
        const tenants = await client.query<{ tenant_id: string }>(
          'SELECT tenant_id FROM sg_action_manifests ORDER BY tenant_id',
        );
        for (const tenant of tenants.rows) {
          const manifest = await this.lockedManifest(client, tenant.tenant_id);
          await this.verifyLocked(client, manifest);
          await this.verifyReconciliationsLocked(client, tenant.tenant_id);
        }
        const decisions = await client.query<AcceptedDecisionRow>(
          'SELECT * FROM sg_accepted_action_decisions ORDER BY tenant_id,audit_id',
        );
        for (const row of decisions.rows) this.assertAcceptedDecision(row);
        const descriptors = await client.query<ActionDescriptorRow>(
          'SELECT * FROM sg_action_descriptors ORDER BY tenant_id,tool_name_hash,environment',
        );
        for (const row of descriptors.rows) this.assertActionDescriptor(row);
        const approvals = await client.query<ActionApprovalRow>(
          'SELECT * FROM sg_action_approvals ORDER BY tenant_id,challenge_id',
        );
        for (const row of approvals.rows) this.assertActionApproval(row);
      });
      return true;
    } catch {
      return false;
    }
  }
  private tenantAuditHash(tenantId: string, field: string, digest: string): string {
    return hmac(this.masterSecret, 'tenant-audit-field-v1', {
      tenant_id: tenantId,
      field,
      digest,
    });
  }
  private acceptedDecisionHmac(row: Omit<AcceptedDecisionRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-accepted-action-decision-v1', {
      ...row,
      occurred_at: row.occurred_at.toISOString(),
    });
  }
  private assertAcceptedDecision(row: AcceptedDecisionRow): void {
    const unsigned = {
      tenant_id: row.tenant_id,
      audit_id: row.audit_id,
      decision: row.decision,
      audit_json: row.audit_json,
      occurred_at: row.occurred_at,
    };
    if (!equal(row.control_hmac, this.acceptedDecisionHmac(unsigned)))
      throw new SharedStateIntegrityError('shared accepted decision integrity failed');
  }
  async recordAcceptedDecisionWithClient(
    client: PoolClient,
    tenantId: string,
    decision: GuardDecision,
  ): Promise<void> {
    if (decision.decision === 'rejected' || !decision.audit.validated_arguments_hash)
      throw new TypeError('only accepted decisions can enter shared action state');
    const occurredAt = new Date(decision.audit.timestamp);
    if (!Number.isFinite(occurredAt.getTime()))
      throw new TypeError('decision timestamp is invalid');
    const unsigned: Omit<AcceptedDecisionRow, 'control_hmac'> = {
      tenant_id: tenantId,
      audit_id: decision.audit_id,
      decision: decision.decision,
      audit_json: canonicalJson(decision.audit),
      occurred_at: occurredAt,
    };
    await client.query(
      `INSERT INTO sg_accepted_action_decisions(tenant_id,audit_id,decision,audit_json,occurred_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,audit_id) DO NOTHING`,
      [...Object.values(unsigned), this.acceptedDecisionHmac(unsigned)],
    );
    const row = (
      await client.query<AcceptedDecisionRow>(
        'SELECT * FROM sg_accepted_action_decisions WHERE tenant_id=$1 AND audit_id=$2 FOR UPDATE',
        [tenantId, decision.audit_id],
      )
    ).rows[0];
    if (!row) throw new SharedStateIntegrityError('shared accepted decision insert failed');
    this.assertAcceptedDecision(row);
    if (
      row.decision !== decision.decision ||
      row.audit_json !== unsigned.audit_json ||
      row.occurred_at.toISOString() !== occurredAt.toISOString()
    )
      throw new SharedStateIntegrityError('shared accepted decision conflict');
  }
  recordAcceptedDecision(tenantId: string, decision: GuardDecision): Promise<void> {
    return this.transaction((client) =>
      this.recordAcceptedDecisionWithClient(client, tenantId, decision),
    );
  }
  async verifyAcceptedDecision(
    tenantId: string,
    decision: GuardDecision,
    toolName: string,
  ): Promise<boolean> {
    if (decision.decision === 'rejected' || !decision.audit.validated_arguments_hash) return false;
    const result = await this.pool.query<AcceptedDecisionRow>(
      'SELECT * FROM sg_accepted_action_decisions WHERE tenant_id=$1 AND audit_id=$2',
      [tenantId, decision.audit_id],
    );
    const row = result.rows[0];
    if (!row) return false;
    this.assertAcceptedDecision(row);
    const expectedToolHash = this.tenantAuditHash(tenantId, 'tool_name', sha256(toolName));
    const expectedArgumentsHash = this.tenantAuditHash(
      tenantId,
      'validated_arguments',
      sha256(decision.valid_arguments),
    );
    return (
      row.decision === decision.decision &&
      row.audit_json === canonicalJson(decision.audit) &&
      decision.audit_id === decision.audit.audit_id &&
      decision.audit.decision === decision.decision &&
      decision.audit.tool_name_hash === expectedToolHash &&
      decision.audit.validated_arguments_hash === expectedArgumentsHash &&
      decision.policy_result.outcome === 'allowed' &&
      decision.policy_result.applied_policy_hash === decision.audit.policy_hash &&
      canonicalJson(decision.repaired_fields.map((repair) => repair.rule_id)) ===
        canonicalJson(decision.audit.repair_rule_ids) &&
      canonicalJson(decision.repaired_fields.map((repair) => repair.receipt_hash)) ===
        canonicalJson(decision.audit.repair_receipt_hashes) &&
      (decision.decision === 'valid'
        ? decision.repaired_fields.length === 0
        : decision.repaired_fields.length > 0 &&
          decision.repaired_fields.every(
            (repair) =>
              verifyRepairReceipt(repair) &&
              repair.post_validation.schema === 'passed' &&
              repair.post_validation.policy === 'allowed',
          ))
    );
  }
  private actionDescriptorHmac(row: Omit<ActionDescriptorRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-action-descriptor-v1', {
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    });
  }
  private assertActionDescriptor(row: ActionDescriptorRow): void {
    const unsigned = {
      tenant_id: row.tenant_id,
      tool_name_hash: row.tool_name_hash,
      environment: row.environment,
      risk_level: row.risk_level,
      side_effect: row.side_effect,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (!equal(row.control_hmac, this.actionDescriptorHmac(unsigned)))
      throw new SharedStateIntegrityError('shared action descriptor integrity failed');
  }
  async upsertActionDescriptor(
    tenantId: string,
    toolName: string,
    environment: string,
    riskLevel: ActionDescriptor['risk_level'],
    sideEffect: ActionDescriptor['side_effect'],
  ): Promise<ActionDescriptor & { environment: string }> {
    if (
      !toolName ||
      toolName.length > 256 ||
      !environment ||
      !['read', 'low', 'medium', 'high', 'critical'].includes(riskLevel) ||
      !['none', 'reversible', 'irreversible'].includes(sideEffect)
    )
      throw new TypeError('shared action descriptor is invalid');
    const toolNameHash = this.tenantAuditHash(tenantId, 'tool_name', sha256(toolName));
    await this.transaction(async (client) => {
      const manifest = await this.lockedManifest(client, tenantId);
      await this.verifyLocked(client, manifest);
      await this.verifyReconciliationsLocked(client, tenantId);
      const existing = (
        await client.query<ActionDescriptorRow>(
          'SELECT * FROM sg_action_descriptors WHERE tenant_id=$1 AND tool_name_hash=$2 AND environment=$3 FOR UPDATE',
          [tenantId, toolNameHash, environment],
        )
      ).rows[0];
      if (existing) this.assertActionDescriptor(existing);
      const timestamp = new Date();
      const unsigned: Omit<ActionDescriptorRow, 'control_hmac'> = {
        tenant_id: tenantId,
        tool_name_hash: toolNameHash,
        environment,
        risk_level: riskLevel,
        side_effect: sideEffect,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      };
      await client.query(
        `INSERT INTO sg_action_descriptors(tenant_id,tool_name_hash,environment,risk_level,side_effect,created_at,updated_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(tenant_id,tool_name_hash,environment) DO UPDATE SET risk_level=excluded.risk_level,side_effect=excluded.side_effect,updated_at=excluded.updated_at,control_hmac=excluded.control_hmac`,
        [...Object.values(unsigned), this.actionDescriptorHmac(unsigned)],
      );
    });
    return { tool_name: toolName, risk_level: riskLevel, side_effect: sideEffect, environment };
  }
  async actionDescriptor(
    tenantId: string,
    toolName: string,
    environment: string,
  ): Promise<ActionDescriptor & { environment: string }> {
    const toolNameHash = this.tenantAuditHash(tenantId, 'tool_name', sha256(toolName));
    const row = (
      await this.pool.query<ActionDescriptorRow>(
        'SELECT * FROM sg_action_descriptors WHERE tenant_id=$1 AND tool_name_hash=$2 AND environment=$3',
        [tenantId, toolNameHash, environment],
      )
    ).rows[0];
    if (!row) throw new TypeError('shared action descriptor is required');
    this.assertActionDescriptor(row);
    return {
      tool_name: toolName,
      risk_level: row.risk_level,
      side_effect: row.side_effect,
      environment: row.environment,
    };
  }
  private actionApprovalSecret(tenantId: string): string {
    return hmac(this.masterSecret, 'tenant-action-approval-secret-v1', {
      tenant_id: tenantId,
    });
  }
  private actionApprovalUnsigned(row: ActionApprovalRow): Omit<ActionApprovalRow, 'control_hmac'> {
    return {
      tenant_id: row.tenant_id,
      challenge_id: row.challenge_id,
      binding_hash: row.binding_hash,
      challenge_json: row.challenge_json,
      status: row.status,
      evidence_json: row.evidence_json,
      created_at: row.created_at,
      expires_at: row.expires_at,
      approved_at: row.approved_at,
    };
  }
  private actionApprovalHmac(row: Omit<ActionApprovalRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-action-approval-v1', {
      ...row,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      approved_at: row.approved_at?.toISOString() ?? null,
    });
  }
  private assertActionApproval(row: ActionApprovalRow): void {
    if (!equal(row.control_hmac, this.actionApprovalHmac(this.actionApprovalUnsigned(row))))
      throw new SharedStateIntegrityError('shared action approval integrity failed');
  }
  async recordActionChallenge(tenantId: string, challenge: ApprovalChallenge): Promise<void> {
    const createdAt = new Date(challenge.created_at);
    const expiresAt = new Date(challenge.expires_at);
    if (
      !challenge.challenge_id ||
      !Number.isFinite(createdAt.getTime()) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt <= createdAt
    )
      throw new TypeError('shared action challenge is invalid');
    const unsigned: Omit<ActionApprovalRow, 'control_hmac'> = {
      tenant_id: tenantId,
      challenge_id: challenge.challenge_id,
      binding_hash: challenge.binding_hash,
      challenge_json: canonicalJson(challenge),
      status: 'pending',
      evidence_json: null,
      created_at: createdAt,
      expires_at: expiresAt,
      approved_at: null,
    };
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO sg_action_approvals(tenant_id,challenge_id,binding_hash,challenge_json,status,evidence_json,created_at,expires_at,approved_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id,challenge_id) DO NOTHING`,
        [...Object.values(unsigned), this.actionApprovalHmac(unsigned)],
      );
      const row = (
        await client.query<ActionApprovalRow>(
          'SELECT * FROM sg_action_approvals WHERE tenant_id=$1 AND challenge_id=$2 FOR UPDATE',
          [tenantId, challenge.challenge_id],
        )
      ).rows[0];
      if (!row) throw new SharedStateIntegrityError('shared action challenge insert failed');
      this.assertActionApproval(row);
      if (
        row.binding_hash !== challenge.binding_hash ||
        row.challenge_json !== unsigned.challenge_json ||
        row.created_at.toISOString() !== createdAt.toISOString() ||
        row.expires_at.toISOString() !== expiresAt.toISOString()
      )
        throw new SharedStateIntegrityError('shared action challenge conflict');
    });
  }
  async approveActionChallenge(
    tenantId: string,
    challengeId: string,
    approverId: string,
  ): Promise<ApprovalEvidence> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<ActionApprovalRow>(
          'SELECT * FROM sg_action_approvals WHERE tenant_id=$1 AND challenge_id=$2 FOR UPDATE',
          [tenantId, challengeId],
        )
      ).rows[0];
      if (!row) throw new TypeError('shared approval challenge was not found');
      this.assertActionApproval(row);
      if (row.status === 'revoked') throw new TypeError('shared approval challenge was revoked');
      if (row.status === 'approved' && row.evidence_json)
        return JSON.parse(row.evidence_json) as ApprovalEvidence;
      const approvedAt = new Date();
      if (row.expires_at < approvedAt) throw new TypeError('shared approval challenge has expired');
      const evidence = approveChallenge({
        challenge: JSON.parse(row.challenge_json) as ApprovalChallenge,
        approver_id: approverId,
        approved_at: approvedAt.toISOString(),
        secret: this.actionApprovalSecret(tenantId),
      });
      const unsigned = {
        ...this.actionApprovalUnsigned(row),
        status: 'approved' as const,
        evidence_json: canonicalJson(evidence),
        approved_at: approvedAt,
      };
      const updated = await client.query(
        `UPDATE sg_action_approvals SET status='approved',evidence_json=$3,approved_at=$4,control_hmac=$5 WHERE tenant_id=$1 AND challenge_id=$2 AND status='pending'`,
        [
          tenantId,
          challengeId,
          unsigned.evidence_json,
          approvedAt,
          this.actionApprovalHmac(unsigned),
        ],
      );
      if (updated.rowCount !== 1)
        throw new SharedStateIntegrityError('shared approval challenge state changed');
      return evidence;
    });
  }
  async revokeActionChallenge(tenantId: string, challengeId: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<ActionApprovalRow>(
          'SELECT * FROM sg_action_approvals WHERE tenant_id=$1 AND challenge_id=$2 FOR UPDATE',
          [tenantId, challengeId],
        )
      ).rows[0];
      if (!row) return false;
      this.assertActionApproval(row);
      const unsigned = {
        ...this.actionApprovalUnsigned(row),
        status: 'revoked' as const,
        evidence_json: null,
      };
      const updated = await client.query(
        `UPDATE sg_action_approvals SET status='revoked',evidence_json=NULL,control_hmac=$3 WHERE tenant_id=$1 AND challenge_id=$2`,
        [tenantId, challengeId, this.actionApprovalHmac(unsigned)],
      );
      return updated.rowCount === 1;
    });
  }
  async verifyRecordedApproval(tenantId: string, evidence: ApprovalEvidence): Promise<boolean> {
    const row = (
      await this.pool.query<ActionApprovalRow>(
        'SELECT * FROM sg_action_approvals WHERE tenant_id=$1 AND challenge_id=$2',
        [tenantId, evidence.challenge.challenge_id],
      )
    ).rows[0];
    if (!row) return false;
    this.assertActionApproval(row);
    return (
      row.status === 'approved' &&
      row.evidence_json !== null &&
      row.evidence_json === canonicalJson(evidence)
    );
  }
  private keyHash(tenantId: string, key: string): string {
    return hmac(this.masterSecret, 'shared-action-idempotency-key-v1', {
      tenant_id: tenantId,
      key,
    });
  }
  private reservationHmac(row: Omit<ReservationRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-action-reservation-v1', {
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    });
  }
  private manifestHmac(row: Omit<ManifestRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-action-manifest-v1', {
      tenant_id: row.tenant_id,
      revision: Number(row.revision),
      row_count: Number(row.row_count),
      accumulator: `xor256:${row.accumulator.toString('hex')}`,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private reconciliationManifestHmac(row: Omit<ReconciliationManifestRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-action-reconciliation-manifest-v1', {
      tenant_id: row.tenant_id,
      revision: Number(row.revision),
      row_count: Number(row.row_count),
      tip_hash: row.tip_hash,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private reconciliationRecordHash(
    row: Omit<ReconciliationRow, 'sequence' | 'record_hash'>,
  ): string {
    return hmac(this.masterSecret, 'shared-action-reconciliation-record-v1', {
      ...row,
      reconciled_at: row.reconciled_at.toISOString(),
    });
  }
  private reconciliationUnsigned(
    row: ReconciliationRow,
  ): Omit<ReconciliationRow, 'sequence' | 'record_hash'> {
    return {
      tenant_id: row.tenant_id,
      reconciliation_id: row.reconciliation_id,
      reservation_id: row.reservation_id,
      key_hash: row.key_hash,
      execution_fingerprint: row.execution_fingerprint,
      audit_id: row.audit_id,
      tool_name_hash: row.tool_name_hash,
      environment: row.environment,
      outcome: row.outcome,
      evidence_hash: row.evidence_hash,
      reconciled_by_hash: row.reconciled_by_hash,
      reconciled_at: row.reconciled_at,
      previous_hash: row.previous_hash,
    };
  }
  private checkpointFromManifest(tenantId: string, manifest: ManifestRow): SharedActionCheckpoint {
    const value = {
      checkpoint_version: '1' as const,
      tenant_ref: hmac(this.masterSecret, 'shared-action-checkpoint-tenant-v1', {
        tenant_id: tenantId,
      }),
      revision: Number(manifest.revision),
      row_count: Number(manifest.row_count),
      accumulator: `xor256:${manifest.accumulator.toString('hex')}`,
      updated_at: manifest.updated_at.toISOString(),
    };
    return {
      ...value,
      checkpoint_hash: hmac(this.masterSecret, 'shared-action-checkpoint-v1', value),
    };
  }
  private checkpointDeliveryHmac(row: Omit<CheckpointDeliveryRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-checkpoint-anchor-delivery-v1', {
      ...row,
      revision: Number(row.revision),
      next_attempt_at: row.next_attempt_at.toISOString(),
      last_attempt_at: row.last_attempt_at?.toISOString() ?? null,
      delivered_at: row.delivered_at?.toISOString() ?? null,
      lease_expires_at: row.lease_expires_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    });
  }
  private async verifyAnchorCoverageLocked(
    client: PoolClient,
    manifest: ManifestRow,
    allowDead = false,
  ): Promise<void> {
    if (!this.options.checkpointAnchoring || Number(manifest.revision) === 0) return;
    const result = await client.query<CheckpointDeliveryRow>(
      'SELECT * FROM sg_checkpoint_anchor_deliveries WHERE tenant_id=$1 ORDER BY revision',
      [manifest.tenant_id],
    );
    for (const row of result.rows) {
      const { control_hmac: controlHmac, ...unsigned } = row;
      if (!equal(controlHmac, this.checkpointDeliveryHmac(unsigned)))
        throw new SharedStateIntegrityError('shared checkpoint delivery integrity failed');
    }
    const current = result.rows.find((row) => Number(row.revision) === Number(manifest.revision));
    if (
      !current ||
      current.checkpoint_hash !==
        this.checkpointFromManifest(manifest.tenant_id, manifest).checkpoint_hash
    )
      throw new SharedStateIntegrityError('shared checkpoint delivery coverage was deleted');
    if (current.status === 'dead' && !allowDead)
      throw new SharedStateIntegrityError('current shared checkpoint delivery is dead');
  }
  private async queueCheckpointAnchor(client: PoolClient, manifest: ManifestRow): Promise<void> {
    if (!this.options.checkpointAnchoring) return;
    const checkpoint = this.checkpointFromManifest(manifest.tenant_id, manifest);
    const payload = {
      schema_version: '2026-07-20',
      event_type: 'schema_guard.action_idempotency_checkpoint',
      event_id: hmac(this.masterSecret, 'shared-action-checkpoint-event-v1', {
        tenant_ref: checkpoint.tenant_ref,
        revision: checkpoint.revision,
        checkpoint_hash: checkpoint.checkpoint_hash,
      }),
      checkpoint,
    };
    const timestamp = new Date();
    const unsigned: Omit<CheckpointDeliveryRow, 'control_hmac'> = {
      delivery_id: `anchor_${randomUUID()}`,
      tenant_id: manifest.tenant_id,
      revision: manifest.revision,
      checkpoint_hash: checkpoint.checkpoint_hash,
      payload_json: canonical(payload),
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: timestamp,
      last_attempt_at: null,
      delivered_at: null,
      response_status: null,
      error_code: null,
      lease_id: null,
      lease_expires_at: null,
      created_at: timestamp,
    };
    await client.query(
      `INSERT INTO sg_checkpoint_anchor_deliveries(delivery_id,tenant_id,revision,checkpoint_hash,payload_json,status,attempt_count,next_attempt_at,last_attempt_at,delivered_at,response_status,error_code,lease_id,lease_expires_at,created_at,control_hmac)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(tenant_id,revision) DO NOTHING`,
      [...Object.values(unsigned), this.checkpointDeliveryHmac(unsigned)],
    );
    const stored = (
      await client.query<CheckpointDeliveryRow>(
        'SELECT * FROM sg_checkpoint_anchor_deliveries WHERE tenant_id=$1 AND revision=$2',
        [manifest.tenant_id, manifest.revision],
      )
    ).rows[0];
    if (!stored) throw new SharedStateIntegrityError('shared checkpoint delivery was not queued');
    const { control_hmac: storedHmac, ...storedUnsigned } = stored;
    if (
      !equal(storedHmac, this.checkpointDeliveryHmac(storedUnsigned)) ||
      stored.checkpoint_hash !== checkpoint.checkpoint_hash
    )
      throw new SharedStateIntegrityError('shared checkpoint delivery queue conflict');
  }
  private async lockedReconciliationManifest(
    client: PoolClient,
    tenantId: string,
  ): Promise<ReconciliationManifestRow> {
    const timestamp = new Date();
    const initial = {
      tenant_id: tenantId,
      revision: '0',
      row_count: '0',
      tip_hash: 'GENESIS',
      updated_at: timestamp,
    };
    await client.query(
      `INSERT INTO sg_action_reconciliation_manifests(tenant_id,revision,row_count,tip_hash,updated_at,control_hmac)
       VALUES($1,0,0,'GENESIS',$2,$3) ON CONFLICT(tenant_id) DO NOTHING`,
      [tenantId, timestamp, this.reconciliationManifestHmac(initial)],
    );
    const result = await client.query<ReconciliationManifestRow>(
      'SELECT * FROM sg_action_reconciliation_manifests WHERE tenant_id=$1 FOR UPDATE',
      [tenantId],
    );
    const manifest = result.rows[0];
    if (!manifest || !equal(manifest.control_hmac, this.reconciliationManifestHmac(manifest)))
      throw new SharedStateIntegrityError('shared action reconciliation manifest integrity failed');
    return manifest;
  }
  private async verifyReconciliationsLocked(
    client: PoolClient,
    tenantId: string,
  ): Promise<{ manifest: ReconciliationManifestRow; rows: ReconciliationRow[] }> {
    const manifest = await this.lockedReconciliationManifest(client, tenantId);
    const result = await client.query<ReconciliationRow>(
      'SELECT * FROM sg_action_reconciliations WHERE tenant_id=$1 ORDER BY sequence',
      [tenantId],
    );
    let previous = 'GENESIS';
    for (const row of result.rows) {
      if (
        row.previous_hash !== previous ||
        !equal(row.record_hash, this.reconciliationRecordHash(this.reconciliationUnsigned(row)))
      )
        throw new SharedStateIntegrityError('shared action reconciliation chain integrity failed');
      previous = row.record_hash;
    }
    if (result.rows.length !== Number(manifest.row_count) || manifest.tip_hash !== previous)
      throw new SharedStateIntegrityError('shared action reconciliation deletion was detected');
    return { manifest, rows: result.rows };
  }
  private async lockedManifest(client: PoolClient, tenantId: string): Promise<ManifestRow> {
    const timestamp = new Date();
    const initial = {
      tenant_id: tenantId,
      revision: '0',
      row_count: '0',
      accumulator: ZERO,
      updated_at: timestamp,
    };
    await client.query(
      `INSERT INTO sg_action_manifests(tenant_id,revision,row_count,accumulator,updated_at,control_hmac)
       VALUES($1,0,0,$2,$3,$4) ON CONFLICT(tenant_id) DO NOTHING`,
      [tenantId, ZERO, timestamp, this.manifestHmac(initial)],
    );
    const result = await client.query<ManifestRow>(
      'SELECT * FROM sg_action_manifests WHERE tenant_id=$1 FOR UPDATE',
      [tenantId],
    );
    const manifest = result.rows[0];
    if (!manifest || !equal(manifest.control_hmac, this.manifestHmac(manifest)))
      throw new SharedStateIntegrityError('shared action manifest integrity failed');
    return manifest;
  }
  private async verifyLocked(
    client: PoolClient,
    manifest: ManifestRow,
    allowDeadAnchor = false,
  ): Promise<ReservationRow[]> {
    const result = await client.query<ReservationRow>(
      'SELECT * FROM sg_action_reservations WHERE tenant_id=$1 ORDER BY key_hash',
      [manifest.tenant_id],
    );
    let accumulator: Buffer = Buffer.from(ZERO);
    for (const row of result.rows) {
      const { control_hmac: controlHmac, ...unsigned } = row;
      if (!equal(controlHmac, this.reservationHmac(unsigned)))
        throw new SharedStateIntegrityError('shared action reservation integrity failed');
      accumulator = xor(accumulator, member(row.key_hash, controlHmac));
    }
    if (
      result.rows.length !== Number(manifest.row_count) ||
      !timingSafeEqual(accumulator, manifest.accumulator)
    )
      throw new SharedStateIntegrityError('shared action reservation deletion was detected');
    await this.verifyAnchorCoverageLocked(client, manifest, allowDeadAnchor);
    return result.rows;
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async writeManifest(
    client: PoolClient,
    manifest: ManifestRow,
    accumulator: Buffer,
    rowCount: number,
  ): Promise<number> {
    const next = {
      tenant_id: manifest.tenant_id,
      revision: String(Number(manifest.revision) + 1),
      row_count: String(rowCount),
      accumulator,
      updated_at: new Date(),
    };
    await client.query(
      `UPDATE sg_action_manifests SET revision=$2,row_count=$3,accumulator=$4,updated_at=$5,control_hmac=$6 WHERE tenant_id=$1`,
      [
        next.tenant_id,
        next.revision,
        next.row_count,
        accumulator,
        next.updated_at,
        this.manifestHmac(next),
      ],
    );
    await this.queueCheckpointAnchor(client, {
      ...next,
      control_hmac: this.manifestHmac(next),
    });
    return Number(next.revision);
  }
  async reserve(
    tenantId: string,
    key: string,
    executionFingerprint: string,
    metadata: SharedReservationMetadata = {},
  ): Promise<SharedReservationResult> {
    return this.transaction(async (client) => {
      const manifest = await this.lockedManifest(client, tenantId);
      const rows = await this.verifyLocked(client, manifest);
      await this.verifyReconciliationsLocked(client, tenantId);
      const keyHash = this.keyHash(tenantId, key);
      const existing = rows.find((row) => row.key_hash === keyHash);
      if (existing)
        return {
          state: existing.execution_fingerprint === executionFingerprint ? 'duplicate' : 'conflict',
          reservation_id: existing.reservation_id,
        };
      const timestamp = new Date();
      const unsigned: Omit<ReservationRow, 'control_hmac'> = {
        tenant_id: tenantId,
        key_hash: keyHash,
        execution_fingerprint: executionFingerprint,
        state: 'pending',
        reservation_id: `res_${randomUUID()}`,
        audit_id: metadata.auditId ?? null,
        tool_name_hash: metadata.toolNameHash ?? null,
        environment: metadata.environment ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      };
      const controlHmac = this.reservationHmac(unsigned);
      await client.query(
        `INSERT INTO sg_action_reservations(tenant_id,key_hash,execution_fingerprint,state,reservation_id,audit_id,tool_name_hash,environment,created_at,updated_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [...Object.values(unsigned), controlHmac],
      );
      const revision = await this.writeManifest(
        client,
        manifest,
        xor(manifest.accumulator, member(keyHash, controlHmac)),
        Number(manifest.row_count) + 1,
      );
      return { state: 'new', reservation_id: unsigned.reservation_id, revision };
    });
  }
  async complete(tenantId: string, key: string, executionFingerprint: string): Promise<number> {
    return this.transition(tenantId, key, executionFingerprint, 'complete');
  }
  async release(tenantId: string, key: string, executionFingerprint: string): Promise<number> {
    return this.transition(tenantId, key, executionFingerprint, 'release');
  }
  private async transition(
    tenantId: string,
    key: string,
    fingerprint: string,
    operation: 'complete' | 'release',
  ): Promise<number> {
    return this.transaction(async (client) => {
      const manifest = await this.lockedManifest(client, tenantId);
      const rows = await this.verifyLocked(client, manifest);
      await this.verifyReconciliationsLocked(client, tenantId);
      const keyHash = this.keyHash(tenantId, key);
      const row = rows.find((item) => item.key_hash === keyHash);
      if (!row || row.execution_fingerprint !== fingerprint || row.state !== 'pending')
        throw new TypeError(`shared action ${operation} did not match a pending reservation`);
      const removed = member(row.key_hash, row.control_hmac);
      if (operation === 'release') {
        await client.query(
          'DELETE FROM sg_action_reservations WHERE tenant_id=$1 AND key_hash=$2',
          [tenantId, keyHash],
        );
        return this.writeManifest(
          client,
          manifest,
          xor(manifest.accumulator, removed),
          Number(manifest.row_count) - 1,
        );
      }
      const unsignedRow: Omit<ReservationRow, 'control_hmac'> = {
        tenant_id: row.tenant_id,
        key_hash: row.key_hash,
        execution_fingerprint: row.execution_fingerprint,
        state: row.state,
        reservation_id: row.reservation_id,
        audit_id: row.audit_id,
        tool_name_hash: row.tool_name_hash,
        environment: row.environment,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      const updated = { ...unsignedRow, state: 'completed' as const, updated_at: new Date() };
      const controlHmac = this.reservationHmac(updated);
      await client.query(
        `UPDATE sg_action_reservations SET state='completed',updated_at=$3,control_hmac=$4 WHERE tenant_id=$1 AND key_hash=$2`,
        [tenantId, keyHash, updated.updated_at, controlHmac],
      );
      const accumulator = xor(xor(manifest.accumulator, removed), member(keyHash, controlHmac));
      return this.writeManifest(client, manifest, accumulator, Number(manifest.row_count));
    });
  }
  async checkpoint(tenantId: string): Promise<SharedActionCheckpoint> {
    return this.transaction(async (client) => {
      const manifest = await this.lockedManifest(client, tenantId);
      await this.verifyLocked(client, manifest);
      await this.verifyReconciliationsLocked(client, tenantId);
      return this.checkpointFromManifest(tenantId, manifest);
    });
  }
  async compareCheckpoint(
    tenantId: string,
    anchored: SharedActionCheckpoint,
  ): Promise<SharedActionCheckpointComparison> {
    const body = {
      checkpoint_version: anchored.checkpoint_version,
      tenant_ref: anchored.tenant_ref,
      revision: anchored.revision,
      row_count: anchored.row_count,
      accumulator: anchored.accumulator,
      updated_at: anchored.updated_at,
    };
    const expectedTenantRef = hmac(this.masterSecret, 'shared-action-checkpoint-tenant-v1', {
      tenant_id: tenantId,
    });
    const expectedHash = hmac(this.masterSecret, 'shared-action-checkpoint-v1', body);
    if (
      anchored.checkpoint_version !== '1' ||
      typeof anchored.tenant_ref !== 'string' ||
      !equal(anchored.tenant_ref, expectedTenantRef) ||
      !Number.isInteger(anchored.revision) ||
      anchored.revision < 0 ||
      !Number.isInteger(anchored.row_count) ||
      anchored.row_count < 0 ||
      typeof anchored.accumulator !== 'string' ||
      !/^xor256:[0-9a-f]{64}$/u.test(anchored.accumulator) ||
      typeof anchored.updated_at !== 'string' ||
      !Number.isFinite(Date.parse(anchored.updated_at)) ||
      typeof anchored.checkpoint_hash !== 'string' ||
      !equal(anchored.checkpoint_hash, expectedHash)
    )
      throw new TypeError('shared anchored checkpoint is invalid for this tenant');
    const current = await this.checkpoint(tenantId);
    const status =
      current.revision < anchored.revision
        ? 'rollback_detected'
        : current.revision > anchored.revision
          ? 'advanced'
          : equal(current.checkpoint_hash, anchored.checkpoint_hash)
            ? 'same'
            : 'integrity_conflict';
    return {
      status,
      anchored_revision: anchored.revision,
      current_revision: current.revision,
      current_checkpoint: current,
    };
  }
  async pending(
    tenantId: string,
    olderThanSeconds: number,
  ): Promise<SharedPendingActionReservation[]> {
    if (!Number.isInteger(olderThanSeconds) || olderThanSeconds < 0)
      throw new TypeError('shared pending age must be a non-negative integer');
    return this.transaction(async (client) => {
      const manifest = await this.lockedManifest(client, tenantId);
      const rows = await this.verifyLocked(client, manifest);
      await this.verifyReconciliationsLocked(client, tenantId);
      const current = Date.now();
      return rows
        .filter(
          (row) =>
            row.state === 'pending' &&
            row.audit_id !== null &&
            row.tool_name_hash !== null &&
            row.environment !== null &&
            current - row.updated_at.getTime() >= olderThanSeconds * 1_000,
        )
        .sort((left, right) => left.updated_at.getTime() - right.updated_at.getTime())
        .map((row) => ({
          reservation_id: row.reservation_id,
          execution_fingerprint: row.execution_fingerprint,
          audit_id: row.audit_id!,
          tool_name_hash: row.tool_name_hash!,
          environment: row.environment!,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
          age_seconds: Math.max(0, Math.floor((current - row.updated_at.getTime()) / 1_000)),
        }));
    });
  }
  private reconciliationFromRow(row: ReconciliationRow): SharedActionReconciliationRecord {
    return {
      reconciliation_id: row.reconciliation_id,
      reservation_id: row.reservation_id,
      execution_fingerprint: row.execution_fingerprint,
      audit_id: row.audit_id,
      tool_name_hash: row.tool_name_hash,
      environment: row.environment,
      outcome: row.outcome,
      evidence_hash: row.evidence_hash,
      reconciled_by_hash: row.reconciled_by_hash,
      reconciled_at: row.reconciled_at.toISOString(),
      previous_hash: row.previous_hash,
      record_hash: row.record_hash,
    };
  }
  async reconcile(
    tenantId: string,
    reservationId: string,
    outcome: SharedActionReconciliationRecord['outcome'],
    evidenceReference: string,
    operatorId: string,
    minimumAgeSeconds: number,
  ): Promise<SharedActionReconciliationRecord> {
    if (!/^res_[0-9a-f-]{36}$/u.test(reservationId))
      throw new TypeError('shared reservation identifier is invalid');
    if (outcome !== 'confirmed_executed' && outcome !== 'confirmed_not_executed')
      throw new TypeError('shared reconciliation outcome is invalid');
    if (!evidenceReference || evidenceReference.length > 512 || !operatorId)
      throw new TypeError('shared reconciliation evidence and operator are required');
    if (!Number.isInteger(minimumAgeSeconds) || minimumAgeSeconds < 0)
      throw new TypeError('shared reconciliation minimum age is invalid');
    const evidenceHash = hmac(this.masterSecret, 'shared-action-reconciliation-evidence-v1', {
      tenant_id: tenantId,
      evidence_reference: evidenceReference,
    });
    return this.transaction(async (client) => {
      const actionManifest = await this.lockedManifest(client, tenantId);
      const reservations = await this.verifyLocked(client, actionManifest);
      const reconciliation = await this.verifyReconciliationsLocked(client, tenantId);
      const existing = reconciliation.rows.find((row) => row.reservation_id === reservationId);
      if (existing) {
        if (existing.outcome === outcome && existing.evidence_hash === evidenceHash)
          return this.reconciliationFromRow(existing);
        throw new TypeError('shared reservation was already reconciled differently');
      }
      const row = reservations.find(
        (reservation) =>
          reservation.reservation_id === reservationId && reservation.state === 'pending',
      );
      if (!row || row.audit_id === null || row.tool_name_hash === null || row.environment === null)
        throw new TypeError('shared pending reservation was not found');
      if (Date.now() - row.updated_at.getTime() < minimumAgeSeconds * 1_000)
        throw new TypeError('shared reservation is too recent to reconcile');
      const timestamp = new Date();
      const unsigned: Omit<ReconciliationRow, 'sequence' | 'record_hash'> = {
        tenant_id: tenantId,
        reconciliation_id: `rec_${randomUUID()}`,
        reservation_id: reservationId,
        key_hash: row.key_hash,
        execution_fingerprint: row.execution_fingerprint,
        audit_id: row.audit_id,
        tool_name_hash: row.tool_name_hash,
        environment: row.environment,
        outcome,
        evidence_hash: evidenceHash,
        reconciled_by_hash: hmac(this.masterSecret, 'shared-action-reconciliation-operator-v1', {
          tenant_id: tenantId,
          operator_id: operatorId,
        }),
        reconciled_at: timestamp,
        previous_hash: reconciliation.manifest.tip_hash,
      };
      const recordHash = this.reconciliationRecordHash(unsigned);
      const inserted = await client.query<ReconciliationRow>(
        `INSERT INTO sg_action_reconciliations(tenant_id,reconciliation_id,reservation_id,key_hash,execution_fingerprint,audit_id,tool_name_hash,environment,outcome,evidence_hash,reconciled_by_hash,reconciled_at,previous_hash,record_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [...Object.values(unsigned), recordHash],
      );
      const nextReconciliationManifest = {
        tenant_id: tenantId,
        revision: String(Number(reconciliation.manifest.revision) + 1),
        row_count: String(Number(reconciliation.manifest.row_count) + 1),
        tip_hash: recordHash,
        updated_at: timestamp,
      };
      await client.query(
        `UPDATE sg_action_reconciliation_manifests SET revision=$2,row_count=$3,tip_hash=$4,updated_at=$5,control_hmac=$6 WHERE tenant_id=$1`,
        [
          tenantId,
          nextReconciliationManifest.revision,
          nextReconciliationManifest.row_count,
          recordHash,
          timestamp,
          this.reconciliationManifestHmac(nextReconciliationManifest),
        ],
      );
      const removed = member(row.key_hash, row.control_hmac);
      if (outcome === 'confirmed_not_executed') {
        await client.query(
          'DELETE FROM sg_action_reservations WHERE tenant_id=$1 AND key_hash=$2',
          [tenantId, row.key_hash],
        );
        await this.writeManifest(
          client,
          actionManifest,
          xor(actionManifest.accumulator, removed),
          Number(actionManifest.row_count) - 1,
        );
      } else {
        const updated = {
          tenant_id: row.tenant_id,
          key_hash: row.key_hash,
          execution_fingerprint: row.execution_fingerprint,
          state: 'completed' as const,
          reservation_id: row.reservation_id,
          audit_id: row.audit_id,
          tool_name_hash: row.tool_name_hash,
          environment: row.environment,
          created_at: row.created_at,
          updated_at: timestamp,
        };
        const controlHmac = this.reservationHmac(updated);
        await client.query(
          `UPDATE sg_action_reservations SET state='completed',updated_at=$3,control_hmac=$4 WHERE tenant_id=$1 AND key_hash=$2`,
          [tenantId, row.key_hash, timestamp, controlHmac],
        );
        await this.writeManifest(
          client,
          actionManifest,
          xor(xor(actionManifest.accumulator, removed), member(row.key_hash, controlHmac)),
          Number(actionManifest.row_count),
        );
      }
      const record = inserted.rows[0];
      if (!record) throw new SharedStateIntegrityError('shared reconciliation insert failed');
      await this.options.alertWriter?.recordAlertWithClient(
        client,
        tenantId,
        'action_reconciled',
        'critical',
        {
          reservation_id: reservationId,
          reconciliation_id: unsigned.reconciliation_id,
          audit_id: unsigned.audit_id,
          outcome,
          evidence_hash: evidenceHash,
        },
        `action-reconciliation:${unsigned.reconciliation_id}`,
      );
      return this.reconciliationFromRow(record);
    });
  }
  async reconciliationHistory(tenantId: string): Promise<SharedActionReconciliationRecord[]> {
    return this.transaction(async (client) => {
      const actionManifest = await this.lockedManifest(client, tenantId);
      await this.verifyLocked(client, actionManifest);
      const { rows } = await this.verifyReconciliationsLocked(client, tenantId);
      return rows
        .slice(-1_000)
        .reverse()
        .map((row) => this.reconciliationFromRow(row));
    });
  }
  async verifyReconciliations(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return this.transaction(async (client) => {
      const actionManifest = await this.lockedManifest(client, tenantId);
      await this.verifyLocked(client, actionManifest);
      const { rows } = await this.verifyReconciliationsLocked(client, tenantId);
      return { valid: true, checked: rows.length };
    });
  }
  private checkpointDeliveryUnsigned(
    row: CheckpointDeliveryRow,
  ): Omit<CheckpointDeliveryRow, 'control_hmac'> {
    return {
      delivery_id: row.delivery_id,
      tenant_id: row.tenant_id,
      revision: row.revision,
      checkpoint_hash: row.checkpoint_hash,
      payload_json: row.payload_json,
      status: row.status,
      attempt_count: row.attempt_count,
      next_attempt_at: row.next_attempt_at,
      last_attempt_at: row.last_attempt_at,
      delivered_at: row.delivered_at,
      response_status: row.response_status,
      error_code: row.error_code,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      created_at: row.created_at,
    };
  }
  private checkpointDeliveryFromRow(row: CheckpointDeliveryRow): SharedCheckpointAnchorDelivery {
    return {
      delivery_id: row.delivery_id,
      revision: Number(row.revision),
      checkpoint_hash: row.checkpoint_hash,
      status: row.status,
      attempt_count: row.attempt_count,
      next_attempt_at: row.next_attempt_at.toISOString(),
      last_attempt_at: row.last_attempt_at?.toISOString() ?? null,
      delivered_at: row.delivered_at?.toISOString() ?? null,
      response_status: row.response_status,
      error_code: row.error_code,
      created_at: row.created_at.toISOString(),
    };
  }
  private assertCheckpointDelivery(row: CheckpointDeliveryRow): void {
    if (!equal(row.control_hmac, this.checkpointDeliveryHmac(this.checkpointDeliveryUnsigned(row))))
      throw new SharedStateIntegrityError('shared checkpoint delivery integrity failed');
  }
  private async updateCheckpointDelivery(
    client: PoolClient,
    row: Omit<CheckpointDeliveryRow, 'control_hmac'>,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE sg_checkpoint_anchor_deliveries SET status=$2,attempt_count=$3,next_attempt_at=$4,last_attempt_at=$5,delivered_at=$6,response_status=$7,error_code=$8,lease_id=$9,lease_expires_at=$10,control_hmac=$11 WHERE delivery_id=$1`,
      [
        row.delivery_id,
        row.status,
        row.attempt_count,
        row.next_attempt_at,
        row.last_attempt_at,
        row.delivered_at,
        row.response_status,
        row.error_code,
        row.lease_id,
        row.lease_expires_at,
        this.checkpointDeliveryHmac(row),
      ],
    );
    return result.rowCount === 1;
  }
  async claimCheckpointAnchorDeliveries(limit: number): Promise<SharedCheckpointAnchorClaim[]> {
    if (!this.options.checkpointAnchoring) return [];
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
    return this.transaction(async (client) => {
      const claimedAt = new Date();
      const result = await client.query<CheckpointDeliveryRow>(
        `SELECT * FROM sg_checkpoint_anchor_deliveries
         WHERE (status='pending' AND next_attempt_at<=$1)
            OR (status='processing' AND lease_expires_at<=$1)
         ORDER BY revision,created_at FOR UPDATE SKIP LOCKED LIMIT $2`,
        [claimedAt, bounded],
      );
      const claims: SharedCheckpointAnchorClaim[] = [];
      for (const row of result.rows) {
        this.assertCheckpointDelivery(row);
        const leaseId = `lease_${randomUUID()}`;
        const unsigned = {
          ...this.checkpointDeliveryUnsigned(row),
          status: 'processing' as const,
          attempt_count: row.attempt_count + 1,
          last_attempt_at: claimedAt,
          lease_id: leaseId,
          lease_expires_at: new Date(claimedAt.getTime() + 30_000),
        };
        if (!(await this.updateCheckpointDelivery(client, unsigned))) continue;
        claims.push({
          deliveryId: row.delivery_id,
          leaseId,
          payload: row.payload_json,
          attemptCount: unsigned.attempt_count,
        });
      }
      return claims;
    });
  }
  async finishCheckpointAnchorDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): Promise<'delivered' | 'pending' | 'dead' | undefined> {
    if (!this.options.checkpointAnchoring) return;
    return this.transaction(async (client) => {
      const selected = await client.query<CheckpointDeliveryRow>(
        `SELECT * FROM sg_checkpoint_anchor_deliveries WHERE delivery_id=$1 AND status='processing' AND lease_id=$2 FOR UPDATE`,
        [input.deliveryId, input.leaseId],
      );
      const row = selected.rows[0];
      if (!row) return;
      this.assertCheckpointDelivery(row);
      const responseStatus = input.responseStatus ?? null;
      const errorCode = (input.errorCode ?? (input.delivered ? null : 'delivery_failed'))?.slice(
        0,
        128,
      );
      let status: 'delivered' | 'pending' | 'dead';
      let nextAttemptAt = row.next_attempt_at;
      let deliveredAt: Date | null = null;
      if (input.delivered) {
        status = 'delivered';
        deliveredAt = new Date();
      } else if (
        input.retryable &&
        row.attempt_count < (this.options.checkpointAnchorMaxAttempts ?? 8)
      ) {
        status = 'pending';
        const delaySeconds = Math.min(3_600, 2 ** Math.min(row.attempt_count, 11));
        nextAttemptAt = new Date(Date.now() + delaySeconds * 1_000);
      } else status = 'dead';
      const updated = {
        ...this.checkpointDeliveryUnsigned(row),
        status,
        next_attempt_at: nextAttemptAt,
        delivered_at: deliveredAt,
        response_status: responseStatus,
        error_code: input.delivered ? null : (errorCode ?? 'delivery_failed'),
        lease_id: null,
        lease_expires_at: null,
      };
      return (await this.updateCheckpointDelivery(client, updated)) ? status : undefined;
    });
  }
  async checkpointAnchorAcknowledged(tenantId: string): Promise<boolean> {
    if (!this.options.checkpointAnchoring) return true;
    return this.transaction(async (client) => {
      const manifest = await this.lockedManifest(client, tenantId);
      await this.verifyLocked(client, manifest);
      await this.verifyReconciliationsLocked(client, tenantId);
      if (Number(manifest.revision) === 0) return false;
      const result = await client.query<CheckpointDeliveryRow>(
        'SELECT * FROM sg_checkpoint_anchor_deliveries WHERE tenant_id=$1 AND revision=$2',
        [tenantId, manifest.revision],
      );
      const row = result.rows[0];
      if (!row) return false;
      this.assertCheckpointDelivery(row);
      return row.status === 'delivered';
    });
  }
  async listCheckpointAnchorDeliveries(
    tenantId: string,
    limit: number,
  ): Promise<SharedCheckpointAnchorDelivery[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    return this.transaction(async (client) => {
      const manifest = await this.lockedManifest(client, tenantId);
      await this.verifyLocked(client, manifest, true);
      await this.verifyReconciliationsLocked(client, tenantId);
      const result = await client.query<CheckpointDeliveryRow>(
        'SELECT * FROM sg_checkpoint_anchor_deliveries WHERE tenant_id=$1 ORDER BY revision DESC LIMIT $2',
        [tenantId, bounded],
      );
      for (const row of result.rows) this.assertCheckpointDelivery(row);
      return result.rows.map((row) => this.checkpointDeliveryFromRow(row));
    });
  }
  async redriveCheckpointAnchorDelivery(tenantId: string, deliveryId: string): Promise<boolean> {
    if (!this.options.checkpointAnchoring) return false;
    return this.transaction(async (client) => {
      const result = await client.query<CheckpointDeliveryRow>(
        'SELECT * FROM sg_checkpoint_anchor_deliveries WHERE tenant_id=$1 AND delivery_id=$2 FOR UPDATE',
        [tenantId, deliveryId],
      );
      const row = result.rows[0];
      if (!row || row.status !== 'dead') return false;
      this.assertCheckpointDelivery(row);
      return this.updateCheckpointDelivery(client, {
        ...this.checkpointDeliveryUnsigned(row),
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: new Date(),
        last_attempt_at: null,
        delivered_at: null,
        response_status: null,
        error_code: null,
        lease_id: null,
        lease_expires_at: null,
      });
    });
  }
}
