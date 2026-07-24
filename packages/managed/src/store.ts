import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  approveChallenge,
  canonicalJson,
  detectSchemaDrift,
  evaluateActionGate,
  policyValidationError,
  repairReceiptHash,
  sha256,
  verifyRepairReceipt,
  type ActionDescriptor,
  type ActionGateContext,
  type ActionGateDecision,
  type ApprovalChallenge,
  type ApprovalEvidence,
  type AdapterName,
  type AuditEnvelope,
  type DriftReport,
  type GuardDecision,
  type GuardPolicy,
  type IdempotencyLedger,
} from '@schema-guard/core';
import {
  constantTimeEqual,
  createEncryptedSigningKey,
  generateApiKey,
  hashApiKey,
  hmac,
  openSealedValue,
  sealValue,
  signRuleset,
  verifyRulesetSignature,
} from './crypto.js';
import { migrations } from './migrations.js';
import {
  aggregateCompatibilityMatrix,
  extractFailureSignature,
  recommendFixes,
  scoreSchemaQuality,
  type ConformanceRun,
  type FailureCluster,
} from './intelligence.js';
import {
  ALL_SCOPES,
  type ManagedConfig,
  type ActionCheckpointAnchorDelivery,
  type ActionIdempotencyCheckpoint,
  type ActionIdempotencyCheckpointComparison,
  type ActionReconciliationRecord,
  type AlertWebhookDelivery,
  type AlertWebhookEndpoint,
  type ManagedSchemaRelease,
  type PendingActionReservation,
  type PlanId,
  type Principal,
  type SchemaAdmissionResult,
  type SchemaEnforcementMode,
  type Scope,
  type SignedRuleSet,
  type TenantLifecycle,
  type TenantLifecycleStatus,
} from './types.js';
import { managedPlan } from './plans.js';

type Row = Record<string, unknown>;
const now = (): string => new Date().toISOString();
const month = (): string => new Date().toISOString().slice(0, 7);
const parse = (value: unknown): unknown => JSON.parse(typeof value === 'string' ? value : 'null');
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const EMPTY_IDEMPOTENCY_ACCUMULATOR = `xor256:${'0'.repeat(64)}`;
const TENANT_EXPORT_TABLES = [
  'action_approvals',
  'action_descriptors',
  'action_idempotency',
  'action_idempotency_manifests',
  'action_reconciliations',
  'alert_deliveries',
  'alert_webhooks',
  'alerts',
  'api_keys',
  'audit_chain_anchors',
  'audit_events',
  'checkpoint_anchor_deliveries',
  'compatibility_signatures',
  'conformance_runs',
  'environments',
  'failure_clusters',
  'schema_releases',
  'tenant_lifecycle',
  'tenant_rulesets',
  'tool_schemas',
  'usage_monthly',
] as const;
const TENANT_EXPORT_SECRET_COLUMNS = new Set([
  'acknowledgement_hmac',
  'control_hmac',
  'encrypted_endpoint',
  'encrypted_signing_secret',
  'key_hash',
  'payload_hmac',
]);

function xorIdempotencyAccumulators(left: string, right: string): string {
  if (!/^xor256:[0-9a-f]{64}$/u.test(left) || !/^xor256:[0-9a-f]{64}$/u.test(right))
    throw new TypeError('action idempotency accumulator is malformed');
  const leftBytes = Buffer.from(left.slice(7), 'hex');
  const rightBytes = Buffer.from(right.slice(7), 'hex');
  const output = Buffer.alloc(32);
  for (let index = 0; index < output.length; index += 1)
    output[index] = leftBytes[index]! ^ rightBytes[index]!;
  return `xor256:${output.toString('hex')}`;
}

function actionIdempotencyAccumulatorMember(row: Row): string {
  const digest = sha256({ key_hash: row.key_hash, control_hmac: row.control_hmac });
  return `xor256:${digest.slice('sha256:'.length)}`;
}

export function normalizedPublicWebhookEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ManagedError(400, 'invalid_webhook_endpoint', 'webhook endpoint must be an URL');
  }
  const hostname = endpoint.hostname.toLowerCase();
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.hash !== '' ||
    (endpoint.port !== '' && endpoint.port !== '443') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    !hostname.includes('.') ||
    /^\[.*\]$/u.test(hostname) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)
  )
    throw new ManagedError(
      400,
      'invalid_webhook_endpoint',
      'webhook endpoint must use public HTTPS on port 443 without credentials or fragments',
    );
  return endpoint.toString();
}

function privacySafeAlertDetail(kind: string, detail: unknown): Record<string, unknown> {
  const source =
    detail !== null && typeof detail === 'object' && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : {};
  const allowedByKind: Record<string, string[]> = {
    action_reconciled: [
      'reservation_id',
      'reconciliation_id',
      'audit_id',
      'outcome',
      'evidence_hash',
    ],
    breaking_schema_drift: ['tool_name_hash', 'changes'],
    schema_promoted: [
      'release_id',
      'tool_name_hash',
      'environment',
      'schema_hash',
      'compatibility',
    ],
    schema_enforcement_changed: ['environment', 'mode'],
    validation_rejected: ['audit_id', 'reason_code'],
  };
  const safe: Record<string, unknown> = {};
  for (const key of allowedByKind[kind] ?? []) {
    const value = source[key];
    if (typeof value === 'string' && value.length <= 512) safe[key] = value;
    else if (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every((item) => typeof item === 'string' && item.length <= 128)
    )
      safe[key] = value;
  }
  return safe;
}

function tenantExportRow(row: Row): Row {
  const safe: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (TENANT_EXPORT_SECRET_COLUMNS.has(key) || key.endsWith('_key_hash')) continue;
    if (key.endsWith('_json') && typeof value === 'string') {
      try {
        safe[key.slice(0, -'_json'.length)] = JSON.parse(value) as unknown;
        continue;
      } catch {
        throw new ManagedError(
          503,
          'tenant_export_integrity_invalid',
          `tenant export encountered malformed ${key}`,
        );
      }
    }
    safe[key] = value;
  }
  return safe;
}

export interface ObservationContext {
  adapter?: AdapterName;
  provider?: string;
  provider_version?: string;
  framework?: string;
  framework_version?: string;
}

export interface ClaimedAlertDelivery {
  deliveryId: string;
  leaseId: string;
  endpoint: string;
  signingSecret: string;
  payload: string;
  attemptCount: number;
}

export type ClaimedCheckpointAnchorDelivery = ClaimedAlertDelivery;

export class ManagedStore {
  readonly db: Database.Database;
  private observedDataVersion = 0;
  constructor(private readonly config: ManagedConfig) {
    if (!config.databasePath || config.masterSecret.length < 32)
      throw new TypeError('databasePath and a 32+ character masterSecret are required');
    if (
      config.aggregateTenantThreshold !== undefined &&
      (!Number.isInteger(config.aggregateTenantThreshold) || config.aggregateTenantThreshold < 2)
    )
      throw new TypeError('aggregateTenantThreshold must be an integer of at least 2');
    if (
      config.actionReconciliationMinAgeSeconds !== undefined &&
      (!Number.isInteger(config.actionReconciliationMinAgeSeconds) ||
        config.actionReconciliationMinAgeSeconds < 60 ||
        config.actionReconciliationMinAgeSeconds > 86_400)
    )
      throw new TypeError(
        'actionReconciliationMinAgeSeconds must be an integer from 60 through 86400',
      );
    if (
      config.alertWebhookMaxAttempts !== undefined &&
      (!Number.isInteger(config.alertWebhookMaxAttempts) ||
        config.alertWebhookMaxAttempts < 1 ||
        config.alertWebhookMaxAttempts > 20)
    )
      throw new TypeError('alertWebhookMaxAttempts must be an integer from 1 through 20');
    if (
      (config.actionCheckpointAnchorUrl === undefined) !==
      (config.actionCheckpointAnchorSigningSecret === undefined)
    )
      throw new TypeError(
        'action checkpoint anchor URL and signing secret must be configured together',
      );
    if (config.actionCheckpointAnchorUrl !== undefined)
      normalizedPublicWebhookEndpoint(config.actionCheckpointAnchorUrl);
    if (
      config.actionCheckpointAnchorSigningSecret !== undefined &&
      config.actionCheckpointAnchorSigningSecret.length < 32
    )
      throw new TypeError('action checkpoint anchor signing secret must be at least 32 characters');
    if (
      config.actionCheckpointAnchorMaxAttempts !== undefined &&
      (!Number.isInteger(config.actionCheckpointAnchorMaxAttempts) ||
        config.actionCheckpointAnchorMaxAttempts < 1 ||
        config.actionCheckpointAnchorMaxAttempts > 20)
    )
      throw new TypeError('actionCheckpointAnchorMaxAttempts must be an integer from 1 through 20');
    this.db = new Database(config.databasePath);
    this.secureDatabaseFiles();
    this.db.pragma('journal_mode = WAL');
    this.secureDatabaseFiles();
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    const controlIntegrity = this.inspectControlPlaneIntegrity();
    if (!controlIntegrity.valid) {
      this.db.close();
      throw new TypeError(
        `managed control-plane integrity failed for ${controlIntegrity.first_invalid_table ?? 'unknown'} record`,
      );
    }
    if (!this.inspectTenantDeletionReceipts()) {
      this.db.close();
      throw new TypeError('managed tenant deletion receipt integrity failed');
    }
    const actionManifestIntegrity = this.inspectActionIdempotencyManifests();
    if (!actionManifestIntegrity.valid) {
      this.db.close();
      throw new TypeError('managed action idempotency manifest failed integrity verification');
    }
    this.ensureConfiguredCheckpointAnchorDeliveries();
    this.ensureSigningKey();
    this.ensureAuditAnchorsTrusted();
    this.observedDataVersion = this.dataVersion();
  }

  close(): void {
    this.db.close();
  }
  integrityCheck(): boolean {
    const rows = this.db.pragma('integrity_check') as { integrity_check: string }[];
    return rows.length === 1 && rows[0]?.integrity_check === 'ok';
  }
  readinessCheck(): boolean {
    try {
      const expectedVersion = migrations.at(-1)?.version ?? 0;
      const actualVersion = Number(this.db.pragma('user_version', { simple: true }));
      const foreignKeys = Number(this.db.pragma('foreign_keys', { simple: true }));
      const query = this.db.prepare('SELECT 1 ready').get() as Row | undefined;
      return (
        actualVersion === expectedVersion &&
        foreignKeys === 1 &&
        query?.ready === 1 &&
        this.inspectControlPlaneIntegrity(undefined, false).valid &&
        this.inspectTenantDeletionReceipts() &&
        this.inspectCheckpointAnchorCoverage().valid &&
        this.checkpointAnchorOperational()
      );
    } catch {
      return false;
    }
  }
  async backup(destination: string): Promise<void> {
    await this.db.backup(destination);
    chmodSync(destination, 0o600);
  }
  private secureDatabaseFiles(): void {
    if (this.config.databasePath === ':memory:') return;
    for (const path of [
      this.config.databasePath,
      `${this.config.databasePath}-wal`,
      `${this.config.databasePath}-shm`,
    ])
      if (existsSync(path)) chmodSync(path, 0o600);
  }
  private migrate(): void {
    let current = Number(this.db.pragma('user_version', { simple: true }));
    for (const migration of migrations)
      if (migration.version > current) {
        this.db.transaction(() => {
          this.db.exec(migration.sql);
          if (migration.version === 4) this.backfillSigningKeyTrust();
          if (migration.version === 5) this.backfillAuditAnchorTrust();
          if (migration.version === 12) this.backfillControlPlaneIntegrity();
          if (migration.version === 13) this.backfillActionIdempotencyManifests();
          if (migration.version === 15) this.backfillTenantLifecycle();
          this.db.pragma(`user_version = ${migration.version}`);
        })();
        current = migration.version;
      }
  }
  private backfillSigningKeyTrust(): void {
    const rows = this.db
      .prepare('SELECT id,public_key_pem FROM signing_keys WHERE trust_hmac IS NULL')
      .all() as Row[];
    const update = this.db.prepare('UPDATE signing_keys SET trust_hmac=? WHERE id=?');
    for (const row of rows)
      update.run(
        hmac(this.config.masterSecret, 'signing-key-trust-v1', {
          id: row.id,
          public_key: row.public_key_pem,
        }),
        row.id,
      );
  }
  private backfillAuditAnchorTrust(): void {
    const rows = this.db
      .prepare(
        'SELECT tenant_id,last_deleted_hash,deleted_through_sequence FROM audit_chain_anchors WHERE signature IS NULL',
      )
      .all() as Row[];
    const update = this.db.prepare(
      'UPDATE audit_chain_anchors SET signature=? WHERE tenant_id=? AND signature IS NULL',
    );
    for (const row of rows)
      update.run(
        this.auditAnchorSignature(
          text(row.tenant_id),
          text(row.last_deleted_hash),
          Number(row.deleted_through_sequence),
        ),
        row.tenant_id,
      );
  }
  private tenantControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-tenant-control-v1', {
      id: row.id,
      name: row.name,
      plan: row.plan,
      monthly_limit: Number(row.monthly_limit),
      retention_days: Number(row.retention_days),
      policy_json: row.policy_json,
      created_at: row.created_at,
    });
  }
  private tenantLifecycleControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-tenant-lifecycle-control-v1', {
      tenant_id: row.tenant_id,
      status: row.status,
      reason_code: row.reason_code ?? null,
      deletion_requested_at: row.deletion_requested_at ?? null,
      updated_at: row.updated_at,
    });
  }
  private tenantDeletionReceiptHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-tenant-deletion-receipt-v1', {
      tenant_ref: row.tenant_ref,
      export_sha256: row.export_sha256,
      deleted_at: row.deleted_at,
    });
  }
  private inspectTenantDeletionReceipts(): boolean {
    for (const row of this.db
      .prepare('SELECT * FROM tenant_deletion_receipts')
      .iterate() as Iterable<Row>)
      if (!constantTimeEqual(text(row.receipt_hmac), this.tenantDeletionReceiptHmac(row)))
        return false;
    return true;
  }
  private backfillTenantLifecycle(): void {
    const timestamp = now();
    const insert = this.db.prepare(
      `INSERT INTO tenant_lifecycle(tenant_id,status,reason_code,deletion_requested_at,updated_at,control_hmac)
       VALUES(?,?,?,?,?,?)`,
    );
    for (const tenant of this.db.prepare('SELECT id FROM tenants ORDER BY id').all() as Row[]) {
      const row: Row = {
        tenant_id: tenant.id,
        status: 'active',
        reason_code: null,
        deletion_requested_at: null,
        updated_at: timestamp,
      };
      insert.run(
        row.tenant_id,
        row.status,
        row.reason_code,
        row.deletion_requested_at,
        row.updated_at,
        this.tenantLifecycleControlHmac(row),
      );
    }
  }
  private apiKeyControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-api-key-control-v1', {
      id: row.id,
      tenant_id: row.tenant_id,
      key_hash: row.key_hash,
      prefix: row.prefix,
      scopes_json: row.scopes_json,
      created_at: row.created_at,
      revoked_at: row.revoked_at ?? null,
    });
  }
  private environmentControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-environment-control-v1', {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      policy_json: row.policy_json,
      schema_enforcement: row.schema_enforcement,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
  private actionDescriptorControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-action-descriptor-control-v1', {
      tenant_id: row.tenant_id,
      tool_name_hash: row.tool_name_hash,
      environment: row.environment,
      risk_level: row.risk_level,
      side_effect: row.side_effect,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
  private actionApprovalControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-action-approval-control-v1', {
      challenge_id: row.challenge_id,
      tenant_id: row.tenant_id,
      binding_hash: row.binding_hash,
      challenge_json: row.challenge_json,
      status: row.status,
      evidence_json: row.evidence_json ?? null,
      created_at: row.created_at,
      expires_at: row.expires_at,
      approved_at: row.approved_at ?? null,
    });
  }
  private actionIdempotencyControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-action-idempotency-control-v1', {
      tenant_id: row.tenant_id,
      key_hash: row.key_hash,
      execution_fingerprint: row.execution_fingerprint,
      state: row.state,
      created_at: row.created_at,
      updated_at: row.updated_at,
      reservation_id: row.reservation_id ?? null,
      audit_id: row.audit_id ?? null,
      tool_name_hash: row.tool_name_hash ?? null,
      environment: row.environment ?? null,
    });
  }
  private actionIdempotencyManifestHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-action-idempotency-manifest-v1', {
      tenant_id: row.tenant_id,
      revision: Number(row.revision),
      row_count: Number(row.row_count),
      accumulator: row.accumulator,
      updated_at: row.updated_at,
    });
  }
  private dataVersion(): number {
    return Number(this.db.pragma('data_version', { simple: true }));
  }
  private actionIdempotencyAccumulator(rows: Row[]): string {
    let accumulator = EMPTY_IDEMPOTENCY_ACCUMULATOR;
    for (const row of rows)
      accumulator = xorIdempotencyAccumulators(
        accumulator,
        actionIdempotencyAccumulatorMember(row),
      );
    return accumulator;
  }
  private backfillActionIdempotencyManifests(): void {
    const tenants = this.db.prepare('SELECT id FROM tenants ORDER BY id').all() as Row[];
    const insert = this.db.prepare(
      `INSERT INTO action_idempotency_manifests(tenant_id,revision,row_count,accumulator,updated_at,control_hmac) VALUES(?,?,?,?,?,?)`,
    );
    for (const tenant of tenants) {
      const tenantId = text(tenant.id);
      const rows = this.db
        .prepare('SELECT key_hash,control_hmac FROM action_idempotency WHERE tenant_id=?')
        .all(tenantId) as Row[];
      const manifest: Row = {
        tenant_id: tenantId,
        revision: 0,
        row_count: rows.length,
        accumulator: this.actionIdempotencyAccumulator(rows),
        updated_at: now(),
      };
      insert.run(
        manifest.tenant_id,
        manifest.revision,
        manifest.row_count,
        manifest.accumulator,
        manifest.updated_at,
        this.actionIdempotencyManifestHmac(manifest),
      );
    }
  }
  private inspectActionIdempotencyManifests(tenantId?: string): {
    valid: boolean;
    checked: number;
    first_invalid_table?: string;
    first_invalid_id?: string;
  } {
    const tenants = this.db
      .prepare(`SELECT id FROM tenants${tenantId === undefined ? '' : ' WHERE id=?'} ORDER BY id`)
      .all(...(tenantId === undefined ? [] : [tenantId])) as Row[];
    let checked = 0;
    for (const tenant of tenants) {
      const id = text(tenant.id);
      const manifest = this.db
        .prepare('SELECT * FROM action_idempotency_manifests WHERE tenant_id=?')
        .get(id) as Row | undefined;
      if (
        !manifest ||
        !constantTimeEqual(
          text(manifest.control_hmac),
          this.actionIdempotencyManifestHmac(manifest),
        )
      )
        return {
          valid: false,
          checked,
          first_invalid_table: 'action_idempotency_manifests',
          first_invalid_id: id,
        };
      const rows = this.db
        .prepare('SELECT * FROM action_idempotency WHERE tenant_id=? ORDER BY key_hash')
        .all(id) as Row[];
      for (const row of rows)
        if (!constantTimeEqual(text(row.control_hmac), this.actionIdempotencyControlHmac(row)))
          return {
            valid: false,
            checked,
            first_invalid_table: 'action_idempotency',
            first_invalid_id: text(row.reservation_id, text(row.key_hash)),
          };
      if (
        Number(manifest.row_count) !== rows.length ||
        !constantTimeEqual(text(manifest.accumulator), this.actionIdempotencyAccumulator(rows))
      )
        return {
          valid: false,
          checked,
          first_invalid_table: 'action_idempotency_manifests',
          first_invalid_id: id,
        };
      checked += 1;
    }
    return { valid: true, checked };
  }
  private assertActionIdempotencyManifestFresh(): void {
    const currentDataVersion = this.dataVersion();
    if (currentDataVersion === this.observedDataVersion) return;
    const integrity = this.inspectActionIdempotencyManifests();
    if (!integrity.valid)
      throw new ManagedError(
        503,
        'action_idempotency_manifest_invalid',
        'action idempotency deletion or substitution was detected; execution is unavailable',
      );
    const anchorCoverage = this.inspectCheckpointAnchorCoverage();
    if (!anchorCoverage.valid)
      throw new ManagedError(
        503,
        'checkpoint_anchor_coverage_invalid',
        'checkpoint anchor delivery deletion or substitution was detected; execution is unavailable',
      );
    this.observedDataVersion = currentDataVersion;
  }
  private updateActionIdempotencyManifest(tenantId: string, removed: Row[], added: Row[]): void {
    const manifest = this.db
      .prepare('SELECT * FROM action_idempotency_manifests WHERE tenant_id=?')
      .get(tenantId) as Row | undefined;
    if (!manifest)
      throw new ManagedError(
        503,
        'action_idempotency_manifest_invalid',
        'action idempotency manifest is missing; execution is unavailable',
      );
    this.assertControlHmac(
      manifest,
      this.actionIdempotencyManifestHmac(manifest),
      'action idempotency manifest',
    );
    let accumulator = text(manifest.accumulator);
    for (const row of [...removed, ...added])
      accumulator = xorIdempotencyAccumulators(
        accumulator,
        actionIdempotencyAccumulatorMember(row),
      );
    const rowCount = Number(manifest.row_count) - removed.length + added.length;
    if (rowCount < 0)
      throw new ManagedError(
        503,
        'action_idempotency_manifest_invalid',
        'action idempotency manifest count is invalid; execution is unavailable',
      );
    const updated: Row = {
      ...manifest,
      revision: Number(manifest.revision) + 1,
      row_count: rowCount,
      accumulator,
      updated_at: now(),
    };
    updated.control_hmac = this.actionIdempotencyManifestHmac(updated);
    const result = this.db
      .prepare(
        'UPDATE action_idempotency_manifests SET revision=?,row_count=?,accumulator=?,updated_at=?,control_hmac=? WHERE tenant_id=?',
      )
      .run(
        updated.revision,
        updated.row_count,
        updated.accumulator,
        updated.updated_at,
        updated.control_hmac,
        tenantId,
      );
    if (result.changes !== 1)
      throw new ManagedError(
        503,
        'action_idempotency_manifest_invalid',
        'action idempotency manifest update failed; execution is unavailable',
      );
    this.enqueueCheckpointAnchorDelivery(tenantId, updated);
  }
  private actionIdempotencyCheckpointFromManifest(
    tenantId: string,
    manifest: Row,
  ): ActionIdempotencyCheckpoint {
    const body = {
      checkpoint_version: '1' as const,
      tenant_ref: hmac(this.config.masterSecret, 'action-idempotency-checkpoint-tenant-v1', {
        tenant_id: tenantId,
      }),
      revision: Number(manifest.revision),
      row_count: Number(manifest.row_count),
      accumulator: text(manifest.accumulator),
      updated_at: text(manifest.updated_at),
    };
    return {
      ...body,
      checkpoint_hash: hmac(this.config.masterSecret, 'action-idempotency-checkpoint-v1', body),
    };
  }
  private enqueueCheckpointAnchorDelivery(tenantId: string, manifest: Row): void {
    if (!this.config.actionCheckpointAnchorUrl) return;
    this.assertControlHmac(
      manifest,
      this.actionIdempotencyManifestHmac(manifest),
      'action idempotency manifest',
    );
    const checkpoint = this.actionIdempotencyCheckpointFromManifest(tenantId, manifest);
    const createdAt = now();
    const payload = JSON.stringify({
      schema_version: '2026-07-20',
      event_type: 'schema_guard.action_idempotency_checkpoint',
      event_id: hmac(this.config.masterSecret, 'action-idempotency-checkpoint-event-v1', {
        tenant_id: tenantId,
        revision: checkpoint.revision,
        checkpoint_hash: checkpoint.checkpoint_hash,
      }),
      checkpoint,
    });
    const delivery: Row = {
      delivery_id: `anchor_${randomUUID()}`,
      tenant_id: tenantId,
      revision: checkpoint.revision,
      checkpoint_hash: checkpoint.checkpoint_hash,
      payload_json: payload,
      created_at: createdAt,
    };
    this.db
      .prepare(
        `INSERT OR IGNORE INTO checkpoint_anchor_deliveries(delivery_id,tenant_id,revision,checkpoint_hash,payload_json,status,next_attempt_at,created_at,payload_hmac) VALUES(?,?,?,?,?,'pending',?,?,?)`,
      )
      .run(
        delivery.delivery_id,
        delivery.tenant_id,
        delivery.revision,
        delivery.checkpoint_hash,
        delivery.payload_json,
        createdAt,
        createdAt,
        this.checkpointAnchorDeliveryPayloadHmac(delivery),
      );
  }
  private ensureConfiguredCheckpointAnchorDeliveries(): void {
    if (!this.config.actionCheckpointAnchorUrl) return;
    this.db.transaction(() => {
      const manifests = this.db
        .prepare('SELECT * FROM action_idempotency_manifests ORDER BY tenant_id')
        .all() as Row[];
      for (const manifest of manifests)
        this.enqueueCheckpointAnchorDelivery(text(manifest.tenant_id), manifest);
    })();
  }
  private inspectCheckpointAnchorCoverage(tenantId?: string): {
    valid: boolean;
    checked: number;
    first_invalid_id?: string;
  } {
    if (!this.config.actionCheckpointAnchorUrl) return { valid: true, checked: 0 };
    const manifests = this.db
      .prepare(
        `SELECT * FROM action_idempotency_manifests${tenantId === undefined ? '' : ' WHERE tenant_id=?'} ORDER BY tenant_id`,
      )
      .all(...(tenantId === undefined ? [] : [tenantId])) as Row[];
    let checked = 0;
    for (const manifest of manifests) {
      const delivery = this.db
        .prepare('SELECT * FROM checkpoint_anchor_deliveries WHERE tenant_id=? AND revision=?')
        .get(manifest.tenant_id, manifest.revision) as Row | undefined;
      if (!delivery) return { valid: false, checked, first_invalid_id: text(manifest.tenant_id) };
      this.assertCheckpointAnchorDeliveryPayloadHmac(delivery);
      const checkpoint = this.actionIdempotencyCheckpointFromManifest(
        text(manifest.tenant_id),
        manifest,
      );
      if (!constantTimeEqual(text(delivery.checkpoint_hash), checkpoint.checkpoint_hash))
        return { valid: false, checked, first_invalid_id: text(manifest.tenant_id) };
      checked += 1;
    }
    return { valid: true, checked };
  }
  private alertWebhookControlHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-alert-webhook-control-v1', {
      webhook_id: row.webhook_id,
      tenant_id: row.tenant_id,
      label: row.label,
      endpoint_hash: row.endpoint_hash,
      encrypted_endpoint: row.encrypted_endpoint,
      encrypted_signing_secret: row.encrypted_signing_secret,
      created_at: row.created_at,
      disabled_at: row.disabled_at ?? null,
    });
  }
  private alertDeliveryPayloadHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-alert-delivery-payload-v1', {
      delivery_id: row.delivery_id,
      tenant_id: row.tenant_id,
      webhook_id: row.webhook_id,
      alert_id: Number(row.alert_id),
      payload_json: row.payload_json,
      created_at: row.created_at,
    });
  }
  private checkpointAnchorDeliveryPayloadHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-checkpoint-anchor-delivery-payload-v1', {
      delivery_id: row.delivery_id,
      tenant_id: row.tenant_id,
      revision: Number(row.revision),
      checkpoint_hash: row.checkpoint_hash,
      payload_json: row.payload_json,
      created_at: row.created_at,
    });
  }
  private checkpointAnchorAcknowledgementHmac(row: Row): string {
    return hmac(this.config.masterSecret, 'managed-checkpoint-anchor-acknowledgement-v1', {
      delivery_id: row.delivery_id,
      tenant_id: row.tenant_id,
      revision: Number(row.revision),
      checkpoint_hash: row.checkpoint_hash,
      delivered_at: row.delivered_at,
      response_status: Number(row.response_status),
    });
  }
  private backfillControlPlaneIntegrity(): void {
    const definitions = [
      {
        table: 'tenants',
        id: (row: Row) => [row.id],
        where: 'id=?',
        digest: (row: Row) => this.tenantControlHmac(row),
      },
      {
        table: 'api_keys',
        id: (row: Row) => [row.id],
        where: 'id=?',
        digest: (row: Row) => this.apiKeyControlHmac(row),
      },
      {
        table: 'environments',
        id: (row: Row) => [row.id],
        where: 'id=?',
        digest: (row: Row) => this.environmentControlHmac(row),
      },
      {
        table: 'action_descriptors',
        id: (row: Row) => [row.tenant_id, row.tool_name_hash, row.environment],
        where: 'tenant_id=? AND tool_name_hash=? AND environment=?',
        digest: (row: Row) => this.actionDescriptorControlHmac(row),
      },
      {
        table: 'action_approvals',
        id: (row: Row) => [row.tenant_id, row.challenge_id],
        where: 'tenant_id=? AND challenge_id=?',
        digest: (row: Row) => this.actionApprovalControlHmac(row),
      },
      {
        table: 'action_idempotency',
        id: (row: Row) => [row.tenant_id, row.key_hash],
        where: 'tenant_id=? AND key_hash=?',
        digest: (row: Row) => this.actionIdempotencyControlHmac(row),
      },
      {
        table: 'alert_webhooks',
        id: (row: Row) => [row.tenant_id, row.webhook_id],
        where: 'tenant_id=? AND webhook_id=?',
        digest: (row: Row) => this.alertWebhookControlHmac(row),
      },
    ] as const;
    for (const definition of definitions) {
      const rows = this.db.prepare(`SELECT * FROM ${definition.table}`).all() as Row[];
      const update = this.db.prepare(
        `UPDATE ${definition.table} SET control_hmac=? WHERE ${definition.where}`,
      );
      for (const row of rows) update.run(definition.digest(row), ...definition.id(row));
    }
    const deliveries = this.db.prepare('SELECT * FROM alert_deliveries').all() as Row[];
    const updateDelivery = this.db.prepare(
      'UPDATE alert_deliveries SET payload_hmac=? WHERE delivery_id=?',
    );
    for (const row of deliveries)
      updateDelivery.run(this.alertDeliveryPayloadHmac(row), row.delivery_id);
  }
  private inspectControlPlaneIntegrity(
    tenantId?: string,
    includeOperational = true,
  ): {
    valid: boolean;
    checked: number;
    first_invalid_table?: string;
    first_invalid_id?: string;
  } {
    const definitions = [
      {
        table: 'tenants',
        tenantColumn: 'id',
        digest: (row: Row) => this.tenantControlHmac(row),
        id: 'id',
        signature: 'control_hmac',
      },
      {
        table: 'tenant_lifecycle',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.tenantLifecycleControlHmac(row),
        id: 'tenant_id',
        signature: 'control_hmac',
      },
      {
        table: 'action_idempotency_manifests',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.actionIdempotencyManifestHmac(row),
        id: 'tenant_id',
        signature: 'control_hmac',
      },
      {
        table: 'api_keys',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.apiKeyControlHmac(row),
        id: 'id',
        signature: 'control_hmac',
      },
      {
        table: 'environments',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.environmentControlHmac(row),
        id: 'id',
        signature: 'control_hmac',
      },
      {
        table: 'action_descriptors',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.actionDescriptorControlHmac(row),
        id: 'tool_name_hash',
        signature: 'control_hmac',
      },
      {
        table: 'alert_webhooks',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.alertWebhookControlHmac(row),
        id: 'webhook_id',
        signature: 'control_hmac',
      },
    ] as const;
    const operationalDefinitions = [
      {
        table: 'action_approvals',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.actionApprovalControlHmac(row),
        id: 'challenge_id',
        signature: 'control_hmac',
      },
      {
        table: 'action_idempotency',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.actionIdempotencyControlHmac(row),
        id: 'reservation_id',
        signature: 'control_hmac',
      },
      {
        table: 'alert_deliveries',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.alertDeliveryPayloadHmac(row),
        id: 'delivery_id',
        signature: 'payload_hmac',
      },
      {
        table: 'checkpoint_anchor_deliveries',
        tenantColumn: 'tenant_id',
        digest: (row: Row) => this.checkpointAnchorDeliveryPayloadHmac(row),
        id: 'delivery_id',
        signature: 'payload_hmac',
      },
    ] as const;
    let checked = 0;
    for (const definition of includeOperational
      ? [...definitions, ...operationalDefinitions]
      : definitions)
      for (const row of this.db
        .prepare(
          `SELECT * FROM ${definition.table}${tenantId === undefined ? '' : ` WHERE ${definition.tenantColumn}=?`}`,
        )
        .iterate(...(tenantId === undefined ? [] : [tenantId])) as Iterable<Row>) {
        const expected = definition.digest(row);
        if (!constantTimeEqual(text(row[definition.signature]), expected))
          return {
            valid: false,
            checked,
            first_invalid_table: definition.table,
            first_invalid_id: text(row[definition.id]),
          };
        checked += 1;
      }
    if (includeOperational)
      for (const row of this.db
        .prepare("SELECT * FROM checkpoint_anchor_deliveries WHERE status='delivered'")
        .iterate() as Iterable<Row>) {
        if (
          typeof row.delivered_at !== 'string' ||
          !Number.isInteger(row.response_status) ||
          !constantTimeEqual(
            text(row.acknowledgement_hmac),
            this.checkpointAnchorAcknowledgementHmac(row),
          )
        )
          return {
            valid: false,
            checked,
            first_invalid_table: 'checkpoint_anchor_deliveries',
            first_invalid_id: text(row.delivery_id),
          };
        checked += 1;
      }
    return { valid: true, checked };
  }
  verifyControlPlaneIntegrity(principal: Principal): {
    valid: boolean;
    checked: number;
    first_invalid_table?: string;
    first_invalid_id?: string;
  } {
    this.requireScope(principal, 'admin');
    const control = this.inspectControlPlaneIntegrity(principal.tenantId);
    if (!control.valid) return control;
    const manifest = this.inspectActionIdempotencyManifests(principal.tenantId);
    if (!manifest.valid) return { ...manifest, checked: control.checked + manifest.checked };
    const anchor = this.inspectCheckpointAnchorCoverage(principal.tenantId);
    return anchor.valid
      ? { valid: true, checked: control.checked + manifest.checked + anchor.checked }
      : {
          valid: false,
          checked: control.checked + manifest.checked + anchor.checked,
          first_invalid_table: 'checkpoint_anchor_deliveries',
          ...(anchor.first_invalid_id ? { first_invalid_id: anchor.first_invalid_id } : {}),
        };
  }
  private assertControlHmac(row: Row, expected: string, kind: string): void {
    if (!constantTimeEqual(text(row.control_hmac), expected))
      throw new ManagedError(
        503,
        'control_plane_integrity_invalid',
        `${kind} integrity verification failed; managed enforcement is unavailable`,
      );
  }
  private assertDeliveryPayloadHmac(row: Row): void {
    if (!constantTimeEqual(text(row.payload_hmac), this.alertDeliveryPayloadHmac(row)))
      throw new ManagedError(
        503,
        'alert_delivery_integrity_invalid',
        'alert delivery payload integrity verification failed; delivery is unavailable',
      );
  }
  private assertCheckpointAnchorDeliveryPayloadHmac(row: Row): void {
    if (!constantTimeEqual(text(row.payload_hmac), this.checkpointAnchorDeliveryPayloadHmac(row)))
      throw new ManagedError(
        503,
        'checkpoint_anchor_delivery_integrity_invalid',
        'checkpoint anchor payload integrity verification failed; anchoring is unavailable',
      );
    if (row.status === 'delivered') this.assertCheckpointAnchorAcknowledgementHmac(row);
  }
  private assertCheckpointAnchorAcknowledgementHmac(row: Row): void {
    if (
      typeof row.delivered_at !== 'string' ||
      !Number.isInteger(row.response_status) ||
      !constantTimeEqual(
        text(row.acknowledgement_hmac),
        this.checkpointAnchorAcknowledgementHmac(row),
      )
    )
      throw new ManagedError(
        503,
        'checkpoint_anchor_acknowledgement_integrity_invalid',
        'checkpoint anchor acknowledgement integrity verification failed; execution is unavailable',
      );
  }
  private ensureSigningKey(): void {
    const existing = this.db
      .prepare('SELECT id,public_key_pem,trust_hmac FROM signing_keys LIMIT 1')
      .get() as Row | undefined;
    if (existing) {
      const expected = hmac(this.config.masterSecret, 'signing-key-trust-v1', {
        id: existing.id,
        public_key: existing.public_key_pem,
      });
      if (!constantTimeEqual(text(existing.trust_hmac), expected)) {
        this.db.close();
        throw new TypeError('managed signing-key trust record failed integrity verification');
      }
      return;
    }
    const key = createEncryptedSigningKey(this.config.masterSecret);
    this.db
      .prepare(
        'INSERT INTO signing_keys(id,public_key_pem,encrypted_private_key,created_at,trust_hmac) VALUES(?,?,?,?,?)',
      )
      .run(
        key.keyId,
        key.publicKey,
        key.encryptedPrivateKey,
        now(),
        hmac(this.config.masterSecret, 'signing-key-trust-v1', {
          id: key.keyId,
          public_key: key.publicKey,
        }),
      );
  }
  private auditAnchorSignature(
    tenantId: string,
    lastDeletedHash: string,
    sequence: number,
  ): string {
    return hmac(this.config.masterSecret, 'audit-chain-anchor-v1', {
      tenant_id: tenantId,
      last_deleted_hash: lastDeletedHash,
      deleted_through_sequence: sequence,
    });
  }
  private ensureAuditAnchorsTrusted(): void {
    const rows = this.db
      .prepare(
        'SELECT tenant_id,last_deleted_hash,deleted_through_sequence,signature FROM audit_chain_anchors',
      )
      .all() as Row[];
    for (const row of rows) {
      const expected = this.auditAnchorSignature(
        text(row.tenant_id),
        text(row.last_deleted_hash),
        Number(row.deleted_through_sequence),
      );
      if (!constantTimeEqual(text(row.signature), expected)) {
        this.db.close();
        throw new TypeError('managed audit anchor failed integrity verification');
      }
    }
  }

  bootstrapTenant(input: {
    id: string;
    name: string;
    plan: PlanId;
    apiKey: string;
    scopes?: Scope[];
    retentionDays?: number;
    policy?: GuardPolicy;
  }): void {
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
      throw new ManagedError(400, 'invalid_tenant', 'tenant bootstrap fields are invalid');
    const scopes = input.scopes ?? [...ALL_SCOPES];
    this.assertScopes(scopes);
    const policyError = policyValidationError(input.policy);
    if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
    this.db.transaction(() => {
      const tenantCreatedAt = now();
      const tenantRow: Row = {
        id: input.id,
        name: input.name,
        plan: input.plan,
        monthly_limit: managedPlan(input.plan).entitlements.validations_per_month,
        retention_days: input.retentionDays ?? managedPlan(input.plan).entitlements.retention_days,
        policy_json: JSON.stringify(input.policy ?? {}),
        created_at: tenantCreatedAt,
      };
      this.db
        .prepare(
          'INSERT OR IGNORE INTO tenants(id,name,plan,monthly_limit,retention_days,created_at,policy_json,control_hmac) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          tenantRow.id,
          tenantRow.name,
          tenantRow.plan,
          tenantRow.monthly_limit,
          tenantRow.retention_days,
          tenantRow.created_at,
          tenantRow.policy_json,
          this.tenantControlHmac(tenantRow),
        );
      const lifecycleRow: Row = {
        tenant_id: input.id,
        status: 'active',
        reason_code: null,
        deletion_requested_at: null,
        updated_at: tenantCreatedAt,
      };
      this.db
        .prepare(
          `INSERT OR IGNORE INTO tenant_lifecycle(tenant_id,status,reason_code,deletion_requested_at,updated_at,control_hmac)
           VALUES(?,?,?,?,?,?)`,
        )
        .run(
          lifecycleRow.tenant_id,
          lifecycleRow.status,
          lifecycleRow.reason_code,
          lifecycleRow.deletion_requested_at,
          lifecycleRow.updated_at,
          this.tenantLifecycleControlHmac(lifecycleRow),
        );
      const manifest: Row = {
        tenant_id: input.id,
        revision: 0,
        row_count: 0,
        accumulator: EMPTY_IDEMPOTENCY_ACCUMULATOR,
        updated_at: tenantCreatedAt,
      };
      this.db
        .prepare(
          `INSERT OR IGNORE INTO action_idempotency_manifests(tenant_id,revision,row_count,accumulator,updated_at,control_hmac) VALUES(?,?,?,?,?,?)`,
        )
        .run(
          manifest.tenant_id,
          manifest.revision,
          manifest.row_count,
          manifest.accumulator,
          manifest.updated_at,
          this.actionIdempotencyManifestHmac(manifest),
        );
      const storedManifest = this.db
        .prepare('SELECT * FROM action_idempotency_manifests WHERE tenant_id=?')
        .get(input.id) as Row | undefined;
      if (storedManifest) this.enqueueCheckpointAnchorDelivery(input.id, storedManifest);
      const insertEnvironment = this.db.prepare(
        'INSERT OR IGNORE INTO environments(id,tenant_id,name,policy_json,schema_enforcement,created_at,updated_at,control_hmac) VALUES(?,?,?,?,?,?,?,?)',
      );
      for (const name of ['development', 'staging', 'production']) {
        const timestamp = now();
        const environmentRow: Row = {
          id: `env_${sha256({ tenant: input.id, name }).slice(-16)}`,
          tenant_id: input.id,
          name,
          policy_json: '{}',
          schema_enforcement: 'observe',
          created_at: timestamp,
          updated_at: timestamp,
        };
        insertEnvironment.run(
          environmentRow.id,
          environmentRow.tenant_id,
          environmentRow.name,
          environmentRow.policy_json,
          environmentRow.schema_enforcement,
          environmentRow.created_at,
          environmentRow.updated_at,
          this.environmentControlHmac(environmentRow),
        );
      }
      const keyCreatedAt = now();
      const keyRow: Row = {
        id: `key_${sha256(input.id + input.apiKey).slice(-16)}`,
        tenant_id: input.id,
        key_hash: hashApiKey(this.config.masterSecret, input.apiKey),
        prefix: input.apiKey.slice(0, 12),
        scopes_json: JSON.stringify(scopes),
        created_at: keyCreatedAt,
        revoked_at: null,
      };
      this.db
        .prepare(
          'INSERT OR IGNORE INTO api_keys(id,tenant_id,key_hash,prefix,scopes_json,created_at,revoked_at,control_hmac) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          keyRow.id,
          keyRow.tenant_id,
          keyRow.key_hash,
          keyRow.prefix,
          keyRow.scopes_json,
          keyRow.created_at,
          keyRow.revoked_at,
          this.apiKeyControlHmac(keyRow),
        );
      const persistedTenant = this.db.prepare('SELECT * FROM tenants WHERE id=?').get(input.id) as
        Row | undefined;
      if (!persistedTenant) throw new Error('tenant bootstrap insert failed');
      this.assertControlHmac(persistedTenant, this.tenantControlHmac(persistedTenant), 'tenant');
    })();
  }

  authenticate(apiKey: string): Principal | undefined {
    const keyHash = hashApiKey(this.config.masterSecret, apiKey);
    const row = this.db
      .prepare(
        `SELECT k.id key_id,k.tenant_id key_tenant_id,k.key_hash,k.prefix,k.scopes_json,k.created_at key_created_at,k.revoked_at,k.control_hmac key_control_hmac,t.id tenant_id,t.name tenant_name,t.plan,t.monthly_limit,t.retention_days,t.policy_json,t.created_at tenant_created_at,t.control_hmac tenant_control_hmac,l.status lifecycle_status,l.reason_code lifecycle_reason_code,l.deletion_requested_at lifecycle_deletion_requested_at,l.updated_at lifecycle_updated_at,l.control_hmac lifecycle_control_hmac FROM api_keys k JOIN tenants t ON t.id=k.tenant_id JOIN tenant_lifecycle l ON l.tenant_id=t.id WHERE k.key_hash=? AND k.revoked_at IS NULL`,
      )
      .get(keyHash) as Row | undefined;
    if (!row) return undefined;
    const keyRow: Row = {
      id: row.key_id,
      tenant_id: row.key_tenant_id,
      key_hash: row.key_hash,
      prefix: row.prefix,
      scopes_json: row.scopes_json,
      created_at: row.key_created_at,
      revoked_at: row.revoked_at,
      control_hmac: row.key_control_hmac,
    };
    const tenantRow: Row = {
      id: row.tenant_id,
      name: row.tenant_name,
      plan: row.plan,
      monthly_limit: row.monthly_limit,
      retention_days: row.retention_days,
      policy_json: row.policy_json,
      created_at: row.tenant_created_at,
      control_hmac: row.tenant_control_hmac,
    };
    const lifecycleRow: Row = {
      tenant_id: row.tenant_id,
      status: row.lifecycle_status,
      reason_code: row.lifecycle_reason_code,
      deletion_requested_at: row.lifecycle_deletion_requested_at,
      updated_at: row.lifecycle_updated_at,
      control_hmac: row.lifecycle_control_hmac,
    };
    if (
      !constantTimeEqual(text(keyRow.control_hmac), this.apiKeyControlHmac(keyRow)) ||
      !constantTimeEqual(text(tenantRow.control_hmac), this.tenantControlHmac(tenantRow)) ||
      !constantTimeEqual(
        text(lifecycleRow.control_hmac),
        this.tenantLifecycleControlHmac(lifecycleRow),
      )
    )
      return undefined;
    try {
      const scopes = parse(row.scopes_json) as Scope[];
      this.assertScopes(scopes);
      const policy = parse(row.policy_json) as GuardPolicy;
      if (policyValidationError(policy)) return undefined;
      return {
        tenantId: String(row.tenant_id),
        tenantName: String(row.tenant_name),
        keyId: String(row.key_id),
        scopes,
        plan: String(row.plan) as PlanId,
        monthlyLimit: Number(row.monthly_limit),
        retentionDays: Number(row.retention_days),
        policy,
        lifecycleStatus: String(row.lifecycle_status) as TenantLifecycleStatus,
      };
    } catch {
      return undefined;
    }
  }

  issueApiKey(
    principal: Principal,
    scopes: Scope[],
  ): { key_id: string; api_key: string; scopes: Scope[] } {
    this.requireScope(principal, 'admin');
    this.assertScopes(scopes);
    const apiKey = generateApiKey();
    const keyId = `key_${sha256(principal.tenantId + apiKey).slice(-16)}`;
    const keyRow: Row = {
      id: keyId,
      tenant_id: principal.tenantId,
      key_hash: hashApiKey(this.config.masterSecret, apiKey),
      prefix: apiKey.slice(0, 12),
      scopes_json: JSON.stringify(scopes),
      created_at: now(),
      revoked_at: null,
    };
    this.db
      .prepare(
        'INSERT INTO api_keys(id,tenant_id,key_hash,prefix,scopes_json,created_at,revoked_at,control_hmac) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        keyRow.id,
        keyRow.tenant_id,
        keyRow.key_hash,
        keyRow.prefix,
        keyRow.scopes_json,
        keyRow.created_at,
        keyRow.revoked_at,
        this.apiKeyControlHmac(keyRow),
      );
    return { key_id: keyId, api_key: apiKey, scopes };
  }
  listApiKeys(principal: Principal): Row[] {
    this.requireScope(principal, 'admin');
    return (
      this.db
        .prepare('SELECT * FROM api_keys WHERE tenant_id=? ORDER BY created_at DESC,id')
        .all(principal.tenantId) as Row[]
    ).map((row) => {
      this.assertControlHmac(row, this.apiKeyControlHmac(row), 'API key');
      const scopes = parse(row.scopes_json) as Scope[];
      this.assertScopes(scopes);
      return {
        key_id: row.id,
        prefix: row.prefix,
        scopes,
        created_at: row.created_at,
        revoked_at: row.revoked_at ?? null,
        current: row.id === principal.keyId,
      };
    });
  }
  revokeApiKey(principal: Principal, keyId: string): boolean {
    this.requireScope(principal, 'admin');
    if (keyId === principal.keyId)
      throw new ManagedError(
        409,
        'cannot_revoke_current_key',
        'use another admin key to revoke the current key',
      );
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM api_keys WHERE tenant_id=? AND id=? AND revoked_at IS NULL')
        .get(principal.tenantId, keyId) as Row | undefined;
      if (!row) return false;
      this.assertControlHmac(row, this.apiKeyControlHmac(row), 'API key');
      const revokedAt = now();
      const updated = { ...row, revoked_at: revokedAt };
      return (
        this.db
          .prepare(
            'UPDATE api_keys SET revoked_at=?,control_hmac=? WHERE tenant_id=? AND id=? AND revoked_at IS NULL',
          )
          .run(revokedAt, this.apiKeyControlHmac(updated), principal.tenantId, keyId).changes === 1
      );
    })();
  }
  tenantLifecycle(principal: Principal): TenantLifecycle {
    this.requireScope(principal, 'admin');
    const row = this.db
      .prepare('SELECT * FROM tenant_lifecycle WHERE tenant_id=?')
      .get(principal.tenantId) as Row | undefined;
    if (!row)
      throw new ManagedError(503, 'tenant_lifecycle_unavailable', 'tenant lifecycle is missing');
    this.assertControlHmac(row, this.tenantLifecycleControlHmac(row), 'tenant lifecycle');
    return {
      status: text(row.status) as TenantLifecycleStatus,
      reason_code: typeof row.reason_code === 'string' ? row.reason_code : null,
      deletion_requested_at:
        typeof row.deletion_requested_at === 'string' ? row.deletion_requested_at : null,
      updated_at: text(row.updated_at),
    };
  }
  updateTenantLifecycle(
    principal: Principal,
    status: TenantLifecycleStatus,
    reasonCode: string | null,
  ): TenantLifecycle {
    this.requireScope(principal, 'admin');
    if (
      !['active', 'suspended', 'canceled', 'deletion_pending'].includes(status) ||
      (reasonCode !== null && !/^[a-z0-9][a-z0-9_.-]{0,63}$/u.test(reasonCode))
    )
      throw new ManagedError(
        400,
        'invalid_tenant_lifecycle',
        'tenant lifecycle status or reason code is invalid',
      );
    return this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM tenant_lifecycle WHERE tenant_id=?')
        .get(principal.tenantId) as Row | undefined;
      if (!existing)
        throw new ManagedError(503, 'tenant_lifecycle_unavailable', 'tenant lifecycle is missing');
      this.assertControlHmac(
        existing,
        this.tenantLifecycleControlHmac(existing),
        'tenant lifecycle',
      );
      const timestamp = now();
      const updated: Row = {
        ...existing,
        status,
        reason_code: reasonCode,
        deletion_requested_at:
          status === 'deletion_pending' ? (existing.deletion_requested_at ?? timestamp) : null,
        updated_at: timestamp,
      };
      this.db
        .prepare(
          `UPDATE tenant_lifecycle
           SET status=?,reason_code=?,deletion_requested_at=?,updated_at=?,control_hmac=?
           WHERE tenant_id=?`,
        )
        .run(
          updated.status,
          updated.reason_code,
          updated.deletion_requested_at,
          updated.updated_at,
          this.tenantLifecycleControlHmac(updated),
          principal.tenantId,
        );
      return {
        status,
        reason_code: reasonCode,
        deletion_requested_at:
          typeof updated.deletion_requested_at === 'string' ? updated.deletion_requested_at : null,
        updated_at: timestamp,
      };
    })();
  }
  exportTenantData(principal: Principal): Row {
    this.requireScope(principal, 'admin');
    const controlIntegrity = this.verifyControlPlaneIntegrity(principal);
    const auditIntegrity = this.verifyAuditChain(principal);
    const schemaReleaseIntegrity = this.verifySchemaReleaseHistory(principal);
    const reconciliationIntegrity = this.verifyActionReconciliationHistory(principal);
    if (
      !controlIntegrity.valid ||
      !auditIntegrity.valid ||
      !schemaReleaseIntegrity.valid ||
      !reconciliationIntegrity.valid
    )
      throw new ManagedError(
        503,
        'tenant_export_integrity_invalid',
        'tenant export was refused because retained evidence failed integrity verification',
      );
    const tenant = this.db.prepare('SELECT * FROM tenants WHERE id=?').get(principal.tenantId) as
      Row | undefined;
    if (!tenant) throw new ManagedError(404, 'tenant_not_found', 'tenant does not exist');
    const tables: Record<string, Row[]> = {};
    for (const table of TENANT_EXPORT_TABLES)
      tables[table] = (
        this.db
          .prepare(`SELECT * FROM ${table} WHERE tenant_id=? ORDER BY rowid`)
          .all(principal.tenantId) as Row[]
      ).map(tenantExportRow);
    const content = {
      tenant: tenantExportRow(tenant),
      tables,
    };
    const contentHash = sha256(content);
    return {
      export_version: 1,
      generated_at: now(),
      tenant_id: principal.tenantId,
      content_sha256: contentHash,
      integrity: {
        control_plane: controlIntegrity,
        audit_chain: auditIntegrity,
        schema_release_chain: schemaReleaseIntegrity,
        action_reconciliation_chain: reconciliationIntegrity,
      },
      ...content,
    };
  }
  private operatorPrincipal(tenantId: string): Principal {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(tenantId))
      throw new ManagedError(400, 'invalid_tenant', 'tenant ID is invalid');
    const tenant = this.db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId) as
      Row | undefined;
    const lifecycle = this.db
      .prepare('SELECT * FROM tenant_lifecycle WHERE tenant_id=?')
      .get(tenantId) as Row | undefined;
    if (!tenant || !lifecycle)
      throw new ManagedError(404, 'tenant_not_found', 'tenant does not exist');
    this.assertControlHmac(tenant, this.tenantControlHmac(tenant), 'tenant');
    this.assertControlHmac(
      lifecycle,
      this.tenantLifecycleControlHmac(lifecycle),
      'tenant lifecycle',
    );
    const policy = parse(tenant.policy_json) as GuardPolicy;
    if (policyValidationError(policy))
      throw new ManagedError(
        503,
        'control_plane_integrity_invalid',
        'tenant policy integrity verification failed',
      );
    return {
      tenantId,
      tenantName: text(tenant.name),
      keyId: 'operator',
      scopes: ['admin'],
      plan: text(tenant.plan) as PlanId,
      monthlyLimit: Number(tenant.monthly_limit),
      retentionDays: Number(tenant.retention_days),
      policy,
      lifecycleStatus: text(lifecycle.status) as TenantLifecycleStatus,
    };
  }
  operatorTenantLifecycle(tenantId: string): TenantLifecycle {
    return this.tenantLifecycle(this.operatorPrincipal(tenantId));
  }
  operatorUpdateTenantLifecycle(
    tenantId: string,
    status: TenantLifecycleStatus,
    reasonCode: string | null,
  ): TenantLifecycle {
    return this.updateTenantLifecycle(this.operatorPrincipal(tenantId), status, reasonCode);
  }
  operatorExportTenantData(tenantId: string): Row {
    return this.exportTenantData(this.operatorPrincipal(tenantId));
  }
  operatorDeleteTenant(
    tenantId: string,
    expectedExportSha256: string,
  ): {
    tenant_ref: string;
    export_sha256: string;
    deleted_at: string;
    receipt_hmac: string;
  } {
    if (!/^sha256:[0-9a-f]{64}$/u.test(expectedExportSha256))
      throw new ManagedError(
        400,
        'invalid_export_hash',
        'expected export hash must be a sha256 digest',
      );
    return this.db
      .transaction(() => {
        const principal = this.operatorPrincipal(tenantId);
        const lifecycle = this.tenantLifecycle(principal);
        if (lifecycle.status !== 'deletion_pending')
          throw new ManagedError(
            409,
            'tenant_deletion_not_pending',
            'tenant must be deletion_pending before deletion',
          );
        const exported = this.exportTenantData(principal);
        if (exported.content_sha256 !== expectedExportSha256)
          throw new ManagedError(
            409,
            'tenant_export_changed',
            'tenant data changed after export; create and review a new export',
          );
        const row: Row = {
          tenant_ref: hmac(
            this.config.masterSecret,
            'managed-tenant-deletion-reference-v1',
            tenantId,
          ),
          export_sha256: expectedExportSha256,
          deleted_at: now(),
        };
        if (this.db.prepare('DELETE FROM tenants WHERE id=?').run(tenantId).changes !== 1)
          throw new ManagedError(404, 'tenant_not_found', 'tenant does not exist');
        const receiptHmac = this.tenantDeletionReceiptHmac(row);
        this.db
          .prepare(
            `INSERT INTO tenant_deletion_receipts(tenant_ref,export_sha256,deleted_at,receipt_hmac)
             VALUES(?,?,?,?)`,
          )
          .run(row.tenant_ref, row.export_sha256, row.deleted_at, receiptHmac);
        return {
          tenant_ref: text(row.tenant_ref),
          export_sha256: expectedExportSha256,
          deleted_at: text(row.deleted_at),
          receipt_hmac: receiptHmac,
        };
      })
      .immediate();
  }
  operatorUpdatePlan(tenantId: string, plan: PlanId): void {
    this.updatePlan(this.operatorPrincipal(tenantId), plan);
  }
  updateTenantPolicy(principal: Principal, policy: GuardPolicy): void {
    this.requireScope(principal, 'admin');
    const error = policyValidationError(policy);
    if (error) throw new ManagedError(400, 'invalid_policy', error);
    const row = this.db.prepare('SELECT * FROM tenants WHERE id=?').get(principal.tenantId) as
      Row | undefined;
    if (!row) throw new ManagedError(404, 'tenant_not_found', 'tenant does not exist');
    this.assertControlHmac(row, this.tenantControlHmac(row), 'tenant');
    const policyJson = JSON.stringify(policy);
    this.db
      .prepare('UPDATE tenants SET policy_json=?,control_hmac=? WHERE id=?')
      .run(
        policyJson,
        this.tenantControlHmac({ ...row, policy_json: policyJson }),
        principal.tenantId,
      );
  }
  updatePlan(principal: Principal, plan: PlanId): void {
    this.requireScope(principal, 'admin');
    const row = this.db.prepare('SELECT * FROM tenants WHERE id=?').get(principal.tenantId) as
      Row | undefined;
    if (!row) throw new ManagedError(404, 'tenant_not_found', 'tenant does not exist');
    this.assertControlHmac(row, this.tenantControlHmac(row), 'tenant');
    const monthlyLimit = managedPlan(plan).entitlements.validations_per_month;
    const updated = { ...row, plan, monthly_limit: monthlyLimit };
    this.db
      .prepare('UPDATE tenants SET plan=?,monthly_limit=?,control_hmac=? WHERE id=?')
      .run(plan, monthlyLimit, this.tenantControlHmac(updated), principal.tenantId);
  }

  listEnvironments(principal: Principal): Row[] {
    const rows = this.db
      .prepare('SELECT * FROM environments WHERE tenant_id=? ORDER BY name ASC')
      .all(principal.tenantId) as Row[];
    return rows.map((row) => {
      this.assertControlHmac(row, this.environmentControlHmac(row), 'environment');
      return {
        id: row.id,
        name: row.name,
        policy: parse(row.policy_json),
        schema_enforcement: row.schema_enforcement,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
  }

  createEnvironment(principal: Principal, name: string, policy: GuardPolicy = {}): Row {
    this.requireScope(principal, 'admin');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(name))
      throw new ManagedError(
        400,
        'invalid_environment',
        'environment name must be 1-64 letters, digits, underscores, or hyphens',
      );
    const policyError = policyValidationError(policy);
    if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
    const id = `env_${sha256({ tenant: principal.tenantId, name }).slice(-16)}`;
    const timestamp = now();
    const row: Row = {
      id,
      tenant_id: principal.tenantId,
      name,
      policy_json: JSON.stringify(policy),
      schema_enforcement: 'observe',
      created_at: timestamp,
      updated_at: timestamp,
    };
    try {
      this.db
        .prepare(
          'INSERT INTO environments(id,tenant_id,name,policy_json,schema_enforcement,created_at,updated_at,control_hmac) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          row.id,
          row.tenant_id,
          row.name,
          row.policy_json,
          row.schema_enforcement,
          row.created_at,
          row.updated_at,
          this.environmentControlHmac(row),
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
        throw new ManagedError(409, 'environment_exists', 'environment name already exists');
      throw error;
    }
    return {
      id,
      name,
      policy,
      schema_enforcement: 'observe',
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  updateEnvironmentPolicy(principal: Principal, environmentId: string, policy: GuardPolicy): void {
    this.requireScope(principal, 'admin');
    const policyError = policyValidationError(policy);
    if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
    const row = this.environmentRecord(principal, environmentId);
    const policyJson = JSON.stringify(policy);
    const updatedAt = now();
    this.db
      .prepare(
        'UPDATE environments SET policy_json=?,updated_at=?,control_hmac=? WHERE tenant_id=? AND id=?',
      )
      .run(
        policyJson,
        updatedAt,
        this.environmentControlHmac({ ...row, policy_json: policyJson, updated_at: updatedAt }),
        principal.tenantId,
        environmentId,
      );
  }

  updateEnvironmentSchemaEnforcement(
    principal: Principal,
    environmentId: string,
    mode: SchemaEnforcementMode,
  ): void {
    this.requireScope(principal, 'promote:schema');
    if (mode !== 'observe' && mode !== 'enforce')
      throw new ManagedError(
        400,
        'invalid_schema_enforcement',
        'schema enforcement must be observe or enforce',
      );
    this.db.transaction(() => {
      const row = this.environmentRecord(principal, environmentId);
      const updatedAt = now();
      const result = this.db
        .prepare(
          'UPDATE environments SET schema_enforcement=?,updated_at=?,control_hmac=? WHERE tenant_id=? AND id=?',
        )
        .run(
          mode,
          updatedAt,
          this.environmentControlHmac({
            ...row,
            schema_enforcement: mode,
            updated_at: updatedAt,
          }),
          principal.tenantId,
          environmentId,
        );
      if (result.changes !== 1)
        throw new ManagedError(404, 'environment_not_found', 'environment does not exist');
      const environment = this.environmentRecord(principal, environmentId);
      this.insertAlert(principal.tenantId, 'schema_enforcement_changed', 'critical', {
        environment: environment.name,
        mode,
      });
    })();
  }

  environmentPolicy(principal: Principal, idOrName: string): GuardPolicy {
    const row = this.environmentRecord(principal, idOrName);
    return parse(row.policy_json) as GuardPolicy;
  }

  private environmentName(principal: Principal, idOrName: string): string {
    return String(this.environmentRecord(principal, idOrName).name);
  }

  private environmentRecord(principal: Principal, idOrName: string): Row {
    const row = this.db
      .prepare('SELECT * FROM environments WHERE tenant_id=? AND (id=? OR name=?) LIMIT 1')
      .get(principal.tenantId, idOrName, idOrName) as Row | undefined;
    if (!row) throw new ManagedError(404, 'environment_not_found', 'environment does not exist');
    this.assertControlHmac(row, this.environmentControlHmac(row), 'environment');
    return row;
  }

  registerActionDescriptor(
    principal: Principal,
    toolName: string,
    environment: string,
    riskLevel: ActionDescriptor['risk_level'],
    sideEffect: ActionDescriptor['side_effect'],
  ): ActionDescriptor & { environment: string } {
    this.requireScope(principal, 'admin');
    if (!toolName || toolName.length > 256)
      throw new ManagedError(400, 'invalid_tool_name', 'tool_name must contain 1-256 characters');
    if (!['read', 'low', 'medium', 'high', 'critical'].includes(riskLevel))
      throw new ManagedError(400, 'invalid_risk_level', 'risk_level is invalid');
    if (!['none', 'reversible', 'irreversible'].includes(sideEffect))
      throw new ManagedError(400, 'invalid_side_effect', 'side_effect is invalid');
    const trustedEnvironment = this.environmentName(principal, environment);
    const toolNameHash = this.tenantAuditHash(principal, 'tool_name', sha256(toolName));
    const timestamp = now();
    const existing = this.db
      .prepare(
        'SELECT * FROM action_descriptors WHERE tenant_id=? AND tool_name_hash=? AND environment=?',
      )
      .get(principal.tenantId, toolNameHash, trustedEnvironment) as Row | undefined;
    if (existing)
      this.assertControlHmac(
        existing,
        this.actionDescriptorControlHmac(existing),
        'action descriptor',
      );
    const row: Row = {
      tenant_id: principal.tenantId,
      tool_name_hash: toolNameHash,
      environment: trustedEnvironment,
      risk_level: riskLevel,
      side_effect: sideEffect,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
    };
    this.db
      .prepare(
        `INSERT INTO action_descriptors(tenant_id,tool_name_hash,environment,risk_level,side_effect,created_at,updated_at,control_hmac) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,tool_name_hash,environment) DO UPDATE SET risk_level=excluded.risk_level,side_effect=excluded.side_effect,updated_at=excluded.updated_at,control_hmac=excluded.control_hmac`,
      )
      .run(
        row.tenant_id,
        row.tool_name_hash,
        row.environment,
        row.risk_level,
        row.side_effect,
        row.created_at,
        row.updated_at,
        this.actionDescriptorControlHmac(row),
      );
    return {
      tool_name: toolName,
      risk_level: riskLevel,
      side_effect: sideEffect,
      environment: trustedEnvironment,
    };
  }

  actionDescriptor(
    principal: Principal,
    toolName: string,
    environment: string,
  ): ActionDescriptor & { environment: string } {
    const trustedEnvironment = this.environmentName(principal, environment);
    const toolNameHash = this.tenantAuditHash(principal, 'tool_name', sha256(toolName));
    const row = this.db
      .prepare(
        'SELECT * FROM action_descriptors WHERE tenant_id=? AND tool_name_hash=? AND environment=?',
      )
      .get(principal.tenantId, toolNameHash, trustedEnvironment) as Row | undefined;
    if (!row)
      throw new ManagedError(
        403,
        'action_descriptor_required',
        'tool action risk must be registered by an administrator before evaluation',
      );
    this.assertControlHmac(row, this.actionDescriptorControlHmac(row), 'action descriptor');
    return {
      tool_name: toolName,
      risk_level: String(row.risk_level) as ActionDescriptor['risk_level'],
      side_effect: String(row.side_effect) as ActionDescriptor['side_effect'],
      environment: trustedEnvironment,
    };
  }

  listActionDescriptors(principal: Principal): Row[] {
    this.requireScope(principal, 'admin');
    return (
      this.db
        .prepare(
          `SELECT * FROM action_descriptors
           WHERE tenant_id=? ORDER BY updated_at DESC,tool_name_hash,environment`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row) => {
      this.assertControlHmac(row, this.actionDescriptorControlHmac(row), 'action descriptor');
      return {
        tool_name_hash: text(row.tool_name_hash),
        environment: text(row.environment),
        risk_level: text(row.risk_level),
        side_effect: text(row.side_effect),
        created_at: text(row.created_at),
        updated_at: text(row.updated_at),
      };
    });
  }

  verifyActionDecision(principal: Principal, decision: GuardDecision, toolName: string): boolean {
    if (decision.decision === 'rejected' || !decision.audit.validated_arguments_hash) return false;
    const row = this.db
      .prepare('SELECT envelope_json FROM audit_events WHERE tenant_id=? AND audit_id=?')
      .get(principal.tenantId, decision.audit_id) as Row | undefined;
    if (!row || canonicalJson(parse(row.envelope_json)) !== canonicalJson(decision.audit))
      return false;
    const expectedToolHash = this.tenantAuditHash(principal, 'tool_name', sha256(toolName));
    const expectedArgumentsHash = this.tenantAuditHash(
      principal,
      'validated_arguments',
      sha256(decision.valid_arguments),
    );
    return (
      decision.audit_id === decision.audit.audit_id &&
      decision.audit.decision === decision.decision &&
      decision.audit.tool_name_hash === expectedToolHash &&
      decision.audit.validated_arguments_hash === expectedArgumentsHash &&
      decision.policy_result.outcome === 'allowed' &&
      decision.policy_result.applied_policy_hash === decision.audit.policy_hash &&
      sameStringArray(
        decision.repaired_fields.map((repair) => repair.rule_id),
        decision.audit.repair_rule_ids,
      ) &&
      sameStringArray(
        decision.repaired_fields.map((repair) => repair.receipt_hash),
        decision.audit.repair_receipt_hashes,
      ) &&
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

  private actionApprovalSecret(principal: Principal): string {
    return hmac(this.config.masterSecret, 'tenant-action-approval-secret-v1', {
      tenant_id: principal.tenantId,
    });
  }

  recordActionChallenge(principal: Principal, challenge: ApprovalChallenge): void {
    const challengeRow: Row = {
      challenge_id: challenge.challenge_id,
      tenant_id: principal.tenantId,
      binding_hash: challenge.binding_hash,
      challenge_json: JSON.stringify(challenge),
      status: 'pending',
      evidence_json: null,
      created_at: challenge.created_at,
      expires_at: challenge.expires_at,
      approved_at: null,
    };
    try {
      this.db
        .prepare(
          `INSERT INTO action_approvals(challenge_id,tenant_id,binding_hash,challenge_json,status,created_at,expires_at,control_hmac) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          challengeRow.challenge_id,
          challengeRow.tenant_id,
          challengeRow.binding_hash,
          challengeRow.challenge_json,
          challengeRow.status,
          challengeRow.created_at,
          challengeRow.expires_at,
          this.actionApprovalControlHmac(challengeRow),
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
        throw new ManagedError(
          409,
          'approval_challenge_exists',
          'approval challenge already exists',
        );
      throw error;
    }
  }

  listActionChallenges(
    principal: Principal,
    status: 'pending' | 'approved' | 'revoked' | undefined,
    limit: number,
  ): Row[] {
    this.requireScope(principal, 'approve:action');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new ManagedError(
        400,
        'invalid_action_challenge_limit',
        'action challenge limit must be 1-500',
      );
    const rows = (
      status
        ? this.db
            .prepare(
              `SELECT * FROM action_approvals
               WHERE tenant_id=? AND status=? ORDER BY created_at DESC,challenge_id LIMIT ?`,
            )
            .all(principal.tenantId, status, limit)
        : this.db
            .prepare(
              `SELECT * FROM action_approvals
               WHERE tenant_id=? ORDER BY created_at DESC,challenge_id LIMIT ?`,
            )
            .all(principal.tenantId, limit)
    ) as Row[];
    return rows.map((row) => {
      this.assertControlHmac(row, this.actionApprovalControlHmac(row), 'action approval');
      return {
        challenge_id: text(row.challenge_id),
        status: text(row.status),
        challenge: parse(row.challenge_json),
        evidence: row.evidence_json === null ? null : parse(row.evidence_json),
        created_at: text(row.created_at),
        expires_at: text(row.expires_at),
        approved_at: row.approved_at === null ? null : text(row.approved_at),
      };
    });
  }

  approveActionChallenge(principal: Principal, challengeId: string): ApprovalEvidence {
    this.requireScope(principal, 'approve:action');
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM action_approvals WHERE tenant_id=? AND challenge_id=?')
        .get(principal.tenantId, challengeId) as Row | undefined;
      if (!row)
        throw new ManagedError(404, 'approval_challenge_not_found', 'approval challenge not found');
      this.assertControlHmac(row, this.actionApprovalControlHmac(row), 'action approval');
      if (row.status === 'revoked')
        throw new ManagedError(409, 'approval_challenge_revoked', 'approval challenge was revoked');
      if (row.status === 'approved' && row.evidence_json)
        return parse(row.evidence_json) as ApprovalEvidence;
      const approvedAt = now();
      if (Date.parse(String(row.expires_at)) < Date.parse(approvedAt))
        throw new ManagedError(409, 'approval_challenge_expired', 'approval challenge has expired');
      const evidence = approveChallenge({
        challenge: parse(row.challenge_json) as ApprovalChallenge,
        approver_id: principal.keyId,
        approved_at: approvedAt,
        secret: this.actionApprovalSecret(principal),
      });
      const evidenceJson = JSON.stringify(evidence);
      const updated = {
        ...row,
        status: 'approved',
        evidence_json: evidenceJson,
        approved_at: approvedAt,
      };
      const result = this.db
        .prepare(
          `UPDATE action_approvals SET status='approved',evidence_json=?,approved_at=?,control_hmac=? WHERE tenant_id=? AND challenge_id=? AND status='pending'`,
        )
        .run(
          evidenceJson,
          approvedAt,
          this.actionApprovalControlHmac(updated),
          principal.tenantId,
          challengeId,
        );
      if (result.changes !== 1)
        throw new ManagedError(
          409,
          'approval_challenge_state_changed',
          'approval challenge state changed before approval completed',
        );
      return evidence;
    })();
  }

  revokeActionChallenge(principal: Principal, challengeId: string): void {
    this.requireScope(principal, 'approve:action');
    this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM action_approvals WHERE tenant_id=? AND challenge_id=?')
        .get(principal.tenantId, challengeId) as Row | undefined;
      if (!row)
        throw new ManagedError(404, 'approval_challenge_not_found', 'approval challenge not found');
      this.assertControlHmac(row, this.actionApprovalControlHmac(row), 'action approval');
      const updated = { ...row, status: 'revoked', evidence_json: null };
      this.db
        .prepare(
          `UPDATE action_approvals SET status='revoked',evidence_json=NULL,control_hmac=? WHERE tenant_id=? AND challenge_id=?`,
        )
        .run(this.actionApprovalControlHmac(updated), principal.tenantId, challengeId);
    })();
  }

  private idempotencyKeyHash(principal: Principal, key: string): string {
    return hmac(this.config.masterSecret, 'tenant-action-idempotency-key-v1', {
      tenant_id: principal.tenantId,
      key,
    });
  }

  actionIdempotencyCheckpoint(principal: Principal): ActionIdempotencyCheckpoint {
    this.requireScope(principal, 'reconcile:action');
    const integrity = this.inspectActionIdempotencyManifests(principal.tenantId);
    if (!integrity.valid)
      throw new ManagedError(
        503,
        'action_idempotency_manifest_invalid',
        'action idempotency checkpoint cannot be issued from an invalid manifest',
      );
    const manifest = this.db
      .prepare('SELECT * FROM action_idempotency_manifests WHERE tenant_id=?')
      .get(principal.tenantId) as Row | undefined;
    if (!manifest)
      throw new ManagedError(
        503,
        'action_idempotency_manifest_invalid',
        'action idempotency manifest is missing',
      );
    return this.actionIdempotencyCheckpointFromManifest(principal.tenantId, manifest);
  }

  compareActionIdempotencyCheckpoint(
    principal: Principal,
    anchored: ActionIdempotencyCheckpoint,
  ): ActionIdempotencyCheckpointComparison {
    this.requireScope(principal, 'reconcile:action');
    const expectedTenantRef = hmac(
      this.config.masterSecret,
      'action-idempotency-checkpoint-tenant-v1',
      { tenant_id: principal.tenantId },
    );
    const body = {
      checkpoint_version: anchored.checkpoint_version,
      tenant_ref: anchored.tenant_ref,
      revision: anchored.revision,
      row_count: anchored.row_count,
      accumulator: anchored.accumulator,
      updated_at: anchored.updated_at,
    };
    const expectedHash = hmac(this.config.masterSecret, 'action-idempotency-checkpoint-v1', body);
    if (
      anchored.checkpoint_version !== '1' ||
      typeof anchored.tenant_ref !== 'string' ||
      !constantTimeEqual(anchored.tenant_ref, expectedTenantRef) ||
      !Number.isInteger(anchored.revision) ||
      anchored.revision < 0 ||
      !Number.isInteger(anchored.row_count) ||
      anchored.row_count < 0 ||
      typeof anchored.accumulator !== 'string' ||
      !/^xor256:[0-9a-f]{64}$/u.test(anchored.accumulator) ||
      typeof anchored.updated_at !== 'string' ||
      !Number.isFinite(Date.parse(anchored.updated_at)) ||
      typeof anchored.checkpoint_hash !== 'string' ||
      !constantTimeEqual(anchored.checkpoint_hash, expectedHash)
    )
      throw new ManagedError(
        409,
        'anchored_checkpoint_invalid',
        'the externally retained idempotency checkpoint is invalid for this tenant',
      );
    const current = this.actionIdempotencyCheckpoint(principal);
    const status =
      current.revision < anchored.revision
        ? 'rollback_detected'
        : current.revision > anchored.revision
          ? 'advanced'
          : constantTimeEqual(current.checkpoint_hash, anchored.checkpoint_hash)
            ? 'same'
            : 'integrity_conflict';
    return {
      status,
      anchored_revision: anchored.revision,
      current_revision: current.revision,
      current_checkpoint: current,
    };
  }

  actionIdempotencyLedger(
    principal: Principal,
    metadata?: {
      auditId: string;
      toolNameHash: string;
      environment: string;
    },
  ): IdempotencyLedger {
    return {
      reserve: (key, executionFingerprint) =>
        this.db
          .transaction(() => {
            this.assertActionIdempotencyManifestFresh();
            const keyHash = this.idempotencyKeyHash(principal, key);
            const existing = this.db
              .prepare('SELECT * FROM action_idempotency WHERE tenant_id=? AND key_hash=?')
              .get(principal.tenantId, keyHash) as Row | undefined;
            if (existing) {
              this.assertControlHmac(
                existing,
                this.actionIdempotencyControlHmac(existing),
                'action idempotency reservation',
              );
              return existing.execution_fingerprint === executionFingerprint
                ? ('duplicate' as const)
                : ('conflict' as const);
            }
            const timestamp = now();
            const reservationId = `res_${randomUUID()}`;
            const reservation: Row = {
              tenant_id: principal.tenantId,
              key_hash: keyHash,
              execution_fingerprint: executionFingerprint,
              state: 'pending',
              created_at: timestamp,
              updated_at: timestamp,
              reservation_id: reservationId,
              audit_id: metadata?.auditId ?? null,
              tool_name_hash: metadata?.toolNameHash ?? null,
              environment: metadata?.environment ?? null,
            };
            const controlHmac = this.actionIdempotencyControlHmac(reservation);
            const signedReservation = { ...reservation, control_hmac: controlHmac };
            this.db
              .prepare(
                `INSERT INTO action_idempotency(tenant_id,key_hash,execution_fingerprint,state,created_at,updated_at,reservation_id,audit_id,tool_name_hash,environment,control_hmac) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(
                reservation.tenant_id,
                reservation.key_hash,
                reservation.execution_fingerprint,
                reservation.state,
                reservation.created_at,
                reservation.updated_at,
                reservation.reservation_id,
                reservation.audit_id,
                reservation.tool_name_hash,
                reservation.environment,
                controlHmac,
              );
            this.updateActionIdempotencyManifest(principal.tenantId, [], [signedReservation]);
            return 'new' as const;
          })
          .immediate(),
      complete: (key, executionFingerprint) =>
        this.db
          .transaction(() => {
            this.assertActionIdempotencyManifestFresh();
            const keyHash = this.idempotencyKeyHash(principal, key);
            const row = this.db
              .prepare(
                `SELECT * FROM action_idempotency WHERE tenant_id=? AND key_hash=? AND execution_fingerprint=? AND state='pending'`,
              )
              .get(principal.tenantId, keyHash, executionFingerprint) as Row | undefined;
            if (!row)
              throw new ManagedError(
                409,
                'idempotency_completion_invalid',
                'idempotency completion did not match a pending reservation',
              );
            this.assertControlHmac(
              row,
              this.actionIdempotencyControlHmac(row),
              'action idempotency reservation',
            );
            const updatedAt = now();
            const updated = { ...row, state: 'completed', updated_at: updatedAt };
            const updatedControlHmac = this.actionIdempotencyControlHmac(updated);
            const signedUpdated = { ...updated, control_hmac: updatedControlHmac };
            const result = this.db
              .prepare(
                `UPDATE action_idempotency SET state='completed',updated_at=?,control_hmac=? WHERE tenant_id=? AND key_hash=? AND execution_fingerprint=? AND state='pending'`,
              )
              .run(
                updatedAt,
                updatedControlHmac,
                principal.tenantId,
                keyHash,
                executionFingerprint,
              );
            if (result.changes !== 1)
              throw new ManagedError(
                409,
                'idempotency_completion_invalid',
                'idempotency completion did not match a pending reservation',
              );
            this.updateActionIdempotencyManifest(principal.tenantId, [row], [signedUpdated]);
          })
          .immediate(),
      release: (key, executionFingerprint) =>
        this.db
          .transaction(() => {
            this.assertActionIdempotencyManifestFresh();
            const keyHash = this.idempotencyKeyHash(principal, key);
            const row = this.db
              .prepare(
                `SELECT * FROM action_idempotency WHERE tenant_id=? AND key_hash=? AND execution_fingerprint=? AND state='pending'`,
              )
              .get(principal.tenantId, keyHash, executionFingerprint) as Row | undefined;
            if (!row)
              throw new ManagedError(
                409,
                'idempotency_release_invalid',
                'idempotency release did not match a pending reservation',
              );
            this.assertControlHmac(
              row,
              this.actionIdempotencyControlHmac(row),
              'action idempotency reservation',
            );
            const result = this.db
              .prepare(
                `DELETE FROM action_idempotency WHERE tenant_id=? AND key_hash=? AND execution_fingerprint=? AND state='pending'`,
              )
              .run(principal.tenantId, keyHash, executionFingerprint);
            if (result.changes !== 1)
              throw new ManagedError(
                409,
                'idempotency_release_invalid',
                'idempotency release did not match a pending reservation',
              );
            this.updateActionIdempotencyManifest(principal.tenantId, [row], []);
          })
          .immediate(),
    };
  }

  evaluateManagedAction(input: {
    principal: Principal;
    decision: GuardDecision;
    toolName: string;
    environment: string;
    context: Omit<ActionGateContext, 'environment'>;
  }): ActionGateDecision {
    return this.evaluateManagedActionInternal(input, false);
  }

  evaluateManagedActionForServer(input: {
    principal: Principal;
    decision: GuardDecision;
    toolName: string;
    environment: string;
    context: Omit<ActionGateContext, 'environment'>;
  }): ActionGateDecision {
    return this.evaluateManagedActionInternal(input, true);
  }

  evaluateManagedActionPreflightForSharedState(input: {
    principal: Principal;
    decision: GuardDecision;
    toolName: string;
    environment: string;
    context: Omit<ActionGateContext, 'environment'>;
    trustedAction: ActionDescriptor & { environment: string };
    approvalAlreadyVerified?: boolean;
  }): ActionGateDecision {
    return this.evaluateManagedActionInternal(
      input,
      true,
      true,
      input.trustedAction,
      true,
      input.approvalAlreadyVerified ?? false,
    );
  }

  private evaluateManagedActionInternal(
    input: {
      principal: Principal;
      decision: GuardDecision;
      toolName: string;
      environment: string;
      context: Omit<ActionGateContext, 'environment'>;
    },
    serverWillConfirmAnchor: boolean,
    sharedStatePreflight = false,
    trustedAction?: ActionDescriptor & { environment: string },
    decisionAlreadyVerified = false,
    approvalAlreadyVerified = false,
  ): ActionGateDecision {
    this.requireScope(input.principal, 'evaluate:action');
    if (
      !decisionAlreadyVerified &&
      !this.verifyActionDecision(input.principal, input.decision, input.toolName)
    )
      throw new ManagedError(
        409,
        'action_decision_invalid',
        'action decision does not match a stored accepted audit',
      );
    const action =
      trustedAction ?? this.actionDescriptor(input.principal, input.toolName, input.environment);
    const approval = input.context.approval;
    if (approval && !approvalAlreadyVerified) {
      const row = this.db
        .prepare(
          `SELECT * FROM action_approvals WHERE tenant_id=? AND challenge_id=? AND status='approved'`,
        )
        .get(input.principal.tenantId, approval.challenge.challenge_id) as Row | undefined;
      if (row) this.assertControlHmac(row, this.actionApprovalControlHmac(row), 'action approval');
      if (!row || canonicalJson(parse(row.evidence_json)) !== canonicalJson(approval))
        throw new ManagedError(
          409,
          'approval_evidence_unrecognized',
          'approval evidence is not an approved tenant challenge',
        );
    }
    const gate = evaluateActionGate({
      decision: input.decision,
      action,
      context: { ...input.context, environment: action.environment },
      approval_secret: this.actionApprovalSecret(input.principal),
      idempotency_ledger: sharedStatePreflight
        ? {
            reserve: () => 'new' as const,
            complete: () => {
              throw new TypeError('shared-state preflight cannot complete a reservation');
            },
            release: () => {
              throw new TypeError('shared-state preflight cannot release a reservation');
            },
          }
        : this.actionIdempotencyLedger(input.principal, {
            auditId: input.decision.audit_id,
            toolNameHash: input.decision.audit.tool_name_hash,
            environment: action.environment,
          }),
    });
    if (sharedStatePreflight) return gate;
    if (
      gate.status === 'allowed' &&
      gate.reservation &&
      typeof input.context.idempotency_key === 'string'
    ) {
      const row = this.db
        .prepare('SELECT * FROM action_idempotency WHERE tenant_id=? AND key_hash=?')
        .get(
          input.principal.tenantId,
          this.idempotencyKeyHash(input.principal, input.context.idempotency_key),
        ) as Row | undefined;
      if (row)
        this.assertControlHmac(
          row,
          this.actionIdempotencyControlHmac(row),
          'action idempotency reservation',
        );
      if (!row?.reservation_id)
        throw new ManagedError(
          500,
          'reservation_identity_missing',
          'managed reservation was created without an operator-safe identifier',
        );
      const managedGate: ActionGateDecision = {
        ...gate,
        reservation: { ...gate.reservation, reservation_id: text(row.reservation_id) },
      };
      if (this.config.actionCheckpointAnchorUrl && !serverWillConfirmAnchor)
        throw new ManagedError(
          503,
          'checkpoint_anchor_acknowledgement_required',
          'anchored action evaluation must use the managed HTTP boundary; the reservation remains pending',
        );
      return managedGate;
    }
    return gate;
  }

  private reconciliationEvidenceHash(principal: Principal, evidenceReference: string): string {
    return hmac(this.config.masterSecret, 'tenant-action-reconciliation-evidence-v1', {
      tenant_id: principal.tenantId,
      evidence_reference: evidenceReference,
    });
  }

  private reconciliationOperatorHash(principal: Principal): string {
    return hmac(this.config.masterSecret, 'tenant-action-reconciliation-operator-v1', {
      tenant_id: principal.tenantId,
      key_id: principal.keyId,
    });
  }

  private reconciliationRecordHash(
    tenantId: string,
    record: Omit<ActionReconciliationRecord, 'record_hash'> & { key_hash: string },
  ): string {
    return hmac(this.config.masterSecret, 'action-reconciliation-record-v1', {
      tenant_id: tenantId,
      ...record,
    });
  }

  pendingActionReservations(
    principal: Principal,
    olderThanSeconds = this.config.actionReconciliationMinAgeSeconds ?? 300,
  ): PendingActionReservation[] {
    this.requireScope(principal, 'reconcile:action');
    this.assertActionIdempotencyManifestFresh();
    const minimum = this.config.actionReconciliationMinAgeSeconds ?? 300;
    if (
      !Number.isInteger(olderThanSeconds) ||
      olderThanSeconds < minimum ||
      olderThanSeconds > 2_592_000
    )
      throw new ManagedError(
        400,
        'invalid_reconciliation_age',
        `older_than_seconds must be an integer from ${minimum} through 2592000`,
      );
    const current = Date.now();
    const cutoff = new Date(current - olderThanSeconds * 1_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT *
           FROM action_idempotency
           WHERE tenant_id=? AND state='pending' AND reservation_id IS NOT NULL
             AND audit_id IS NOT NULL AND tool_name_hash IS NOT NULL AND environment IS NOT NULL
             AND julianday(updated_at)<=julianday(?)
           ORDER BY julianday(updated_at) ASC,reservation_id ASC`,
      )
      .all(principal.tenantId, cutoff) as Row[];
    return rows.map((row) => {
      this.assertControlHmac(
        row,
        this.actionIdempotencyControlHmac(row),
        'action idempotency reservation',
      );
      return {
        reservation_id: text(row.reservation_id),
        execution_fingerprint: text(row.execution_fingerprint),
        audit_id: text(row.audit_id),
        tool_name_hash: text(row.tool_name_hash),
        environment: text(row.environment),
        created_at: text(row.created_at),
        updated_at: text(row.updated_at),
        age_seconds: Math.max(0, Math.floor((current - Date.parse(text(row.updated_at))) / 1_000)),
      };
    });
  }

  reconcileActionReservation(
    principal: Principal,
    reservationId: string,
    outcome: ActionReconciliationRecord['outcome'],
    evidenceReference: string,
  ): ActionReconciliationRecord {
    this.requireScope(principal, 'reconcile:action');
    if (!/^res_[0-9a-f-]{36}$/u.test(reservationId))
      throw new ManagedError(400, 'invalid_reservation_id', 'reservation_id is invalid');
    if (!['confirmed_executed', 'confirmed_not_executed'].includes(outcome))
      throw new ManagedError(400, 'invalid_reconciliation_outcome', 'outcome is invalid');
    if (!evidenceReference || evidenceReference.length > 512)
      throw new ManagedError(
        400,
        'invalid_reconciliation_evidence',
        'evidence_reference must contain 1-512 characters',
      );
    const evidenceHash = this.reconciliationEvidenceHash(principal, evidenceReference);
    return this.db
      .transaction(() => {
        this.assertActionIdempotencyManifestFresh();
        const existing = this.db
          .prepare('SELECT * FROM action_reconciliations WHERE tenant_id=? AND reservation_id=?')
          .get(principal.tenantId, reservationId) as Row | undefined;
        if (existing) {
          const record = this.actionReconciliationFromRow(existing);
          const { record_hash: recordHash, ...recordWithoutHash } = record;
          if (
            record.outcome === outcome &&
            record.evidence_hash === evidenceHash &&
            recordHash ===
              this.reconciliationRecordHash(principal.tenantId, {
                ...recordWithoutHash,
                key_hash: text(existing.key_hash),
              })
          )
            return record;
          throw new ManagedError(
            409,
            'reservation_already_reconciled',
            'reservation has already been reconciled with different evidence or outcome',
          );
        }
        const row = this.db
          .prepare(
            `SELECT * FROM action_idempotency WHERE tenant_id=? AND reservation_id=? AND state='pending'`,
          )
          .get(principal.tenantId, reservationId) as Row | undefined;
        if (!row)
          throw new ManagedError(
            404,
            'pending_reservation_not_found',
            'pending reservation not found',
          );
        this.assertControlHmac(
          row,
          this.actionIdempotencyControlHmac(row),
          'action idempotency reservation',
        );
        const minimumAge = this.config.actionReconciliationMinAgeSeconds ?? 300;
        if (Date.now() - Date.parse(text(row.updated_at)) < minimumAge * 1_000)
          throw new ManagedError(
            409,
            'reservation_too_recent',
            `reservation must remain pending for at least ${minimumAge} seconds before reconciliation`,
          );
        const recordWithoutHash = {
          reconciliation_id: `rec_${randomUUID()}`,
          reservation_id: reservationId,
          execution_fingerprint: text(row.execution_fingerprint),
          audit_id: text(row.audit_id),
          tool_name_hash: text(row.tool_name_hash),
          environment: text(row.environment),
          outcome,
          evidence_hash: evidenceHash,
          reconciled_by_hash: this.reconciliationOperatorHash(principal),
          reconciled_at: now(),
          previous_hash: text(
            (
              this.db
                .prepare(
                  'SELECT record_hash FROM action_reconciliations WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1',
                )
                .get(principal.tenantId) as Row | undefined
            )?.record_hash,
            'GENESIS',
          ),
        } satisfies Omit<ActionReconciliationRecord, 'record_hash'>;
        const recordHash = this.reconciliationRecordHash(principal.tenantId, {
          ...recordWithoutHash,
          key_hash: text(row.key_hash),
        });
        this.db
          .prepare(
            `INSERT INTO action_reconciliations(reconciliation_id,tenant_id,reservation_id,key_hash,execution_fingerprint,audit_id,tool_name_hash,environment,outcome,evidence_hash,reconciled_by_hash,reconciled_at,previous_hash,record_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            recordWithoutHash.reconciliation_id,
            principal.tenantId,
            reservationId,
            row.key_hash,
            recordWithoutHash.execution_fingerprint,
            recordWithoutHash.audit_id,
            recordWithoutHash.tool_name_hash,
            recordWithoutHash.environment,
            outcome,
            evidenceHash,
            recordWithoutHash.reconciled_by_hash,
            recordWithoutHash.reconciled_at,
            recordWithoutHash.previous_hash,
            recordHash,
          );
        if (outcome === 'confirmed_executed') {
          const updatedAt = now();
          const updated = { ...row, state: 'completed', updated_at: updatedAt };
          const updatedControlHmac = this.actionIdempotencyControlHmac(updated);
          const signedUpdated = { ...updated, control_hmac: updatedControlHmac };
          this.db
            .prepare(
              `UPDATE action_idempotency SET state='completed',updated_at=?,control_hmac=? WHERE tenant_id=? AND reservation_id=? AND state='pending'`,
            )
            .run(updatedAt, updatedControlHmac, principal.tenantId, reservationId);
          this.updateActionIdempotencyManifest(principal.tenantId, [row], [signedUpdated]);
        } else {
          this.db
            .prepare(
              `DELETE FROM action_idempotency WHERE tenant_id=? AND reservation_id=? AND state='pending'`,
            )
            .run(principal.tenantId, reservationId);
          this.updateActionIdempotencyManifest(principal.tenantId, [row], []);
        }
        this.insertAlert(principal.tenantId, 'action_reconciled', 'critical', {
          reservation_id: reservationId,
          reconciliation_id: recordWithoutHash.reconciliation_id,
          audit_id: recordWithoutHash.audit_id,
          outcome,
          evidence_hash: evidenceHash,
        });
        return { ...recordWithoutHash, record_hash: recordHash };
      })
      .immediate();
  }

  private actionReconciliationFromRow(row: Row): ActionReconciliationRecord {
    return {
      reconciliation_id: text(row.reconciliation_id),
      reservation_id: text(row.reservation_id),
      execution_fingerprint: text(row.execution_fingerprint),
      audit_id: text(row.audit_id),
      tool_name_hash: text(row.tool_name_hash),
      environment: text(row.environment),
      outcome: text(row.outcome) as ActionReconciliationRecord['outcome'],
      evidence_hash: text(row.evidence_hash),
      reconciled_by_hash: text(row.reconciled_by_hash),
      reconciled_at: text(row.reconciled_at),
      previous_hash: text(row.previous_hash),
      record_hash: text(row.record_hash),
    };
  }

  actionReconciliationHistory(principal: Principal): Array<
    ActionReconciliationRecord & {
      integrity_valid: boolean;
    }
  > {
    this.requireScope(principal, 'reconcile:action');
    return (
      this.db
        .prepare(
          'SELECT * FROM action_reconciliations WHERE tenant_id=? ORDER BY reconciled_at DESC,reconciliation_id DESC LIMIT 1000',
        )
        .all(principal.tenantId) as Row[]
    ).map((row) => {
      const record = this.actionReconciliationFromRow(row);
      const { record_hash: recordHash, ...recordWithoutHash } = record;
      return {
        ...record,
        integrity_valid:
          recordHash ===
          this.reconciliationRecordHash(principal.tenantId, {
            ...recordWithoutHash,
            key_hash: text(row.key_hash),
          }),
      };
    });
  }

  verifyActionReconciliationHistory(principal: Principal): {
    valid: boolean;
    checked: number;
    first_invalid_reconciliation_id?: string;
  } {
    this.requireScope(principal, 'reconcile:action');
    const rows = this.db
      .prepare('SELECT * FROM action_reconciliations WHERE tenant_id=? ORDER BY sequence ASC')
      .all(principal.tenantId) as Row[];
    let previousHash = 'GENESIS';
    for (const [index, row] of rows.entries()) {
      const record = this.actionReconciliationFromRow(row);
      const { record_hash: recordHash, ...recordWithoutHash } = record;
      if (
        record.previous_hash !== previousHash ||
        recordHash !==
          this.reconciliationRecordHash(principal.tenantId, {
            ...recordWithoutHash,
            key_hash: text(row.key_hash),
          })
      )
        return {
          valid: false,
          checked: index,
          first_invalid_reconciliation_id: record.reconciliation_id,
        };
      previousHash = recordHash;
    }
    return { valid: true, checked: rows.length };
  }

  requireScope(principal: Principal, scope: Scope): void {
    if (!principal.scopes.includes(scope) && !principal.scopes.includes('admin'))
      throw new ManagedError(403, 'scope_denied', `scope ${scope} is required`);
  }
  private assertScopes(scopes: Scope[]): void {
    if (
      !scopes.length ||
      scopes.some((scope) => !ALL_SCOPES.includes(scope)) ||
      new Set(scopes).size !== scopes.length
    )
      throw new ManagedError(400, 'invalid_scopes', 'scopes contain an unknown or empty value');
  }

  consumeValidation(principal: Principal): void {
    const transaction = this.db.transaction(() => {
      const current = this.db
        .prepare('SELECT validation_count FROM usage_monthly WHERE tenant_id=? AND month=?')
        .get(principal.tenantId, month()) as Row | undefined;
      if (Number(current?.validation_count ?? 0) >= principal.monthlyLimit)
        throw new ManagedError(429, 'monthly_quota_exceeded', 'monthly validation quota exceeded');
      this.db
        .prepare(
          `INSERT INTO usage_monthly(tenant_id,month,validation_count) VALUES(?,?,1) ON CONFLICT(tenant_id,month) DO UPDATE SET validation_count=validation_count+1`,
        )
        .run(principal.tenantId, month());
    });
    transaction();
  }

  private tenantAuditHash(principal: Principal, field: string, digest: string): string {
    return hmac(this.config.masterSecret, 'tenant-audit-field-v1', {
      tenant_id: principal.tenantId,
      field,
      digest,
    });
  }

  private scopeDecision(principal: Principal, decision: GuardDecision): GuardDecision {
    const repairedFields = decision.repaired_fields.map((repair) => {
      const scoped = {
        ...repair,
        original_value_hash: this.tenantAuditHash(
          principal,
          'repair.original_value',
          repair.original_value_hash,
        ),
        output_value_hash: this.tenantAuditHash(
          principal,
          'repair.output_value',
          repair.output_value_hash,
        ),
        schema_fragment_hash: this.tenantAuditHash(
          principal,
          'repair.schema_fragment',
          repair.schema_fragment_hash,
        ),
      };
      return { ...scoped, receipt_hash: repairReceiptHash(scoped) };
    });
    const policyHash = this.tenantAuditHash(
      principal,
      'policy',
      decision.policy_result.applied_policy_hash,
    );
    const audit = {
      ...decision.audit,
      tool_name_hash: this.tenantAuditHash(principal, 'tool_name', decision.audit.tool_name_hash),
      schema_hash: this.tenantAuditHash(principal, 'schema', decision.audit.schema_hash),
      arguments_hash: this.tenantAuditHash(principal, 'arguments', decision.audit.arguments_hash),
      ...(decision.audit.validated_arguments_hash
        ? {
            validated_arguments_hash: this.tenantAuditHash(
              principal,
              'validated_arguments',
              decision.audit.validated_arguments_hash,
            ),
          }
        : {}),
      repair_receipt_hashes: repairedFields.map((repair) => repair.receipt_hash),
      policy_hash: policyHash,
    };
    return {
      ...decision,
      repaired_fields: repairedFields,
      policy_result: {
        ...decision.policy_result,
        applied_policy_hash: policyHash,
      },
      audit,
    };
  }

  private recordScopedDecision(principal: Principal, decision: GuardDecision): void {
    const envelope = decision.audit;
    this.db.transaction(() => {
      const previous = this.db
        .prepare(
          'SELECT event_hash FROM audit_events WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1',
        )
        .get(principal.tenantId) as Row | undefined;
      const anchor = this.db
        .prepare('SELECT last_deleted_hash FROM audit_chain_anchors WHERE tenant_id=?')
        .get(principal.tenantId) as Row | undefined;
      const previousHash = text(previous?.event_hash, text(anchor?.last_deleted_hash, 'GENESIS'));
      const eventBody = {
        tenant_id: principal.tenantId,
        audit: envelope,
        previous_hash: previousHash,
      };
      const eventHash = hmac(this.config.masterSecret, 'audit-event-hash-v1', eventBody);
      const signature = hmac(this.config.masterSecret, 'audit-event-signature-v1', {
        event_hash: eventHash,
        previous_hash: previousHash,
      });
      this.db
        .prepare(
          `INSERT INTO audit_events(tenant_id,audit_id,occurred_at,decision,reason_code,repair_rules_json,envelope_json,previous_hash,event_hash,signature) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          principal.tenantId,
          envelope.audit_id,
          envelope.timestamp,
          decision.decision,
          decision.decision === 'rejected' ? decision.reason_code : null,
          JSON.stringify(envelope.repair_rule_ids),
          JSON.stringify(envelope),
          previousHash,
          eventHash,
          signature,
        );
      const repaired = decision.decision === 'valid_with_repair' ? 1 : 0;
      const rejected = decision.decision === 'rejected' ? 1 : 0;
      this.db
        .prepare(
          `UPDATE usage_monthly SET repair_count=repair_count+?, rejection_count=rejection_count+? WHERE tenant_id=? AND month=?`,
        )
        .run(repaired, rejected, principal.tenantId, month());
      const category =
        decision.decision === 'valid_with_repair'
          ? `repair:${envelope.repair_rule_ids.join('+')}`
          : decision.decision === 'rejected'
            ? `reject:${decision.reason_code}`
            : 'valid';
      const signatureKey = sha256({ category, rules: envelope.repair_rule_ids });
      this.db
        .prepare(
          `INSERT INTO compatibility_signatures(tenant_id,signature,category,count,last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,signature) DO UPDATE SET count=count+1,last_seen_at=excluded.last_seen_at`,
        )
        .run(principal.tenantId, signatureKey, category, 1, now());
      if (decision.decision === 'rejected')
        this.insertAlert(principal.tenantId, 'validation_rejected', 'warning', {
          audit_id: decision.audit_id,
          reason_code: decision.reason_code,
        });
    })();
  }

  recordDecision(principal: Principal, decision: GuardDecision): GuardDecision {
    const scoped = this.scopeDecision(principal, decision);
    this.recordScopedDecision(principal, scoped);
    return scoped;
  }
  recordValidation(
    principal: Principal,
    decision: GuardDecision,
    context: ObservationContext = {},
  ): GuardDecision {
    const scoped = this.scopeDecision(principal, decision);
    this.db.transaction(() => {
      this.consumeValidation(principal);
      this.recordScopedDecision(principal, scoped);
      this.recordFailureCluster(principal, scoped, context);
    })();
    return scoped;
  }

  scopeValidationForSharedState(principal: Principal, decision: GuardDecision): GuardDecision {
    return this.scopeDecision(principal, decision);
  }

  recordScopedValidationAfterSharedState(
    principal: Principal,
    scopedDecision: GuardDecision,
    context: ObservationContext = {},
    recordIntelligence = true,
  ): void {
    if (
      scopedDecision.audit_id !== scopedDecision.audit.audit_id ||
      scopedDecision.decision !== scopedDecision.audit.decision
    )
      throw new ManagedError(
        500,
        'scoped_audit_binding_invalid',
        'refusing to persist a validation with an invalid scoped audit binding',
      );
    this.db.transaction(() => {
      this.recordScopedDecision(principal, scopedDecision);
      if (recordIntelligence) this.recordFailureCluster(principal, scopedDecision, context);
    })();
  }

  private recordFailureCluster(
    principal: Principal,
    decision: GuardDecision,
    context: ObservationContext,
  ): void {
    const adapter = context.adapter ?? 'json_schema';
    const provider = context.provider ?? 'unspecified';
    const framework = context.framework ?? adapter;
    const signature = extractFailureSignature({
      adapter,
      provider,
      framework,
      decision: decision.decision,
      ...(decision.decision === 'rejected'
        ? {
            reason_code: decision.reason_code,
            validation_issues: decision.validation_errors,
          }
        : {}),
      repair_rule_ids: decision.repaired_fields.map((repair) => repair.rule_id),
    });
    if (!signature) return;
    const existing = this.db
      .prepare(
        'SELECT affected_versions_json FROM failure_clusters WHERE tenant_id=? AND signature=?',
      )
      .get(principal.tenantId, signature.id) as Row | undefined;
    const versions = new Set<string>(
      Array.isArray(parse(existing?.affected_versions_json))
        ? (parse(existing?.affected_versions_json) as string[])
        : [],
    );
    if (context.provider_version) versions.add(context.provider_version);
    const observedAt = now();
    this.db
      .prepare(
        `INSERT INTO failure_clusters(tenant_id,signature,category,adapter,provider,framework,reason_code,repair_rules_json,issue_shapes_json,event_count,first_seen_at,last_seen_at,affected_versions_json)
         VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)
         ON CONFLICT(tenant_id,signature) DO UPDATE SET
           event_count=event_count+1,
           last_seen_at=excluded.last_seen_at,
           affected_versions_json=excluded.affected_versions_json`,
      )
      .run(
        principal.tenantId,
        signature.id,
        signature.category,
        signature.adapter,
        signature.provider,
        signature.framework,
        signature.reason_code ?? null,
        JSON.stringify(signature.repair_rule_ids),
        JSON.stringify(signature.issue_shapes),
        observedAt,
        observedAt,
        JSON.stringify([...versions].sort()),
      );
  }

  listAudits(principal: Principal, limit = 100): Row[] {
    const rows = this.db
      .prepare(
        `SELECT sequence,audit_id,occurred_at,decision,reason_code,repair_rules_json,envelope_json,event_hash,previous_hash,signature FROM audit_events WHERE tenant_id=? ORDER BY sequence DESC LIMIT ?`,
      )
      .all(principal.tenantId, Math.min(Math.max(limit, 1), 1000)) as Row[];
    return rows.map((row) => {
      const envelope = parse(row.envelope_json) as AuditEnvelope;
      return {
        sequence: row.sequence,
        audit_id: envelope.audit_id,
        occurred_at: envelope.timestamp,
        decision: envelope.decision,
        reason_code: envelope.reason_code ?? null,
        repair_rules: envelope.repair_rule_ids,
        envelope,
        event_hash: row.event_hash,
        previous_hash: row.previous_hash,
        signature: row.signature,
      };
    });
  }
  verifyAuditChain(principal: Principal): {
    valid: boolean;
    checked: number;
    first_invalid_sequence?: number;
    anchor_invalid?: boolean;
  } {
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY sequence ASC')
      .all(principal.tenantId) as Row[];
    const anchor = this.db
      .prepare(
        'SELECT last_deleted_hash,deleted_through_sequence,signature FROM audit_chain_anchors WHERE tenant_id=?',
      )
      .get(principal.tenantId) as Row | undefined;
    if (anchor) {
      const expectedAnchorSignature = this.auditAnchorSignature(
        principal.tenantId,
        text(anchor.last_deleted_hash),
        Number(anchor.deleted_through_sequence),
      );
      if (!constantTimeEqual(text(anchor.signature), expectedAnchorSignature))
        return { valid: false, checked: 0, anchor_invalid: true };
    }
    let previousHash = text(anchor?.last_deleted_hash, 'GENESIS');
    for (const row of rows) {
      let envelope: AuditEnvelope;
      try {
        envelope = parse(row.envelope_json) as AuditEnvelope;
      } catch {
        return {
          valid: false,
          checked: rows.indexOf(row),
          first_invalid_sequence: Number(row.sequence),
        };
      }
      const body = { tenant_id: principal.tenantId, audit: envelope, previous_hash: previousHash };
      const expectedHash = hmac(this.config.masterSecret, 'audit-event-hash-v1', body);
      const expectedSignature = hmac(this.config.masterSecret, 'audit-event-signature-v1', {
        event_hash: expectedHash,
        previous_hash: previousHash,
      });
      if (
        !constantTimeEqual(expectedHash, String(row.event_hash)) ||
        !constantTimeEqual(expectedSignature, String(row.signature)) ||
        text(row.previous_hash) !== previousHash ||
        text(row.audit_id) !== envelope.audit_id ||
        text(row.occurred_at) !== envelope.timestamp ||
        text(row.decision) !== envelope.decision ||
        (row.reason_code === null ? undefined : text(row.reason_code)) !== envelope.reason_code ||
        !sameStringArray(parse(row.repair_rules_json), envelope.repair_rule_ids)
      )
        return {
          valid: false,
          checked: rows.indexOf(row),
          first_invalid_sequence: Number(row.sequence),
        };
      previousHash = text(row.event_hash);
    }
    return { valid: true, checked: rows.length };
  }

  registerSchema(
    principal: Principal,
    input: { tool_name: string; adapter: string; version: string; schema: object | boolean },
  ): { schema_hash: string; drift: unknown } {
    const toolHash = hmac(
      this.config.masterSecret,
      `tool-name:${principal.tenantId}`,
      input.tool_name,
    );
    const schemaHash = sha256(input.schema);
    const existing = this.db
      .prepare(
        'SELECT schema_hash,schema_json,adapter,drift_json FROM tool_schemas WHERE tenant_id=? AND tool_name_hash=? AND version=?',
      )
      .get(principal.tenantId, toolHash, input.version) as Row | undefined;
    if (existing) {
      if (
        text(existing.schema_hash) !== schemaHash ||
        sha256(parse(existing.schema_json)) !== schemaHash ||
        text(existing.adapter) !== input.adapter
      )
        throw new ManagedError(
          409,
          'schema_version_conflict',
          'this schema version is already registered with different content or adapter',
        );
      return {
        schema_hash: schemaHash,
        drift: existing.drift_json === null ? null : parse(existing.drift_json),
      };
    }
    const prior = this.db
      .prepare(
        'SELECT schema_json FROM tool_schemas WHERE tenant_id=? AND tool_name_hash=? ORDER BY id DESC LIMIT 1',
      )
      .get(principal.tenantId, toolHash) as Row | undefined;
    const drift = prior
      ? detectSchemaDrift(parse(prior.schema_json) as object | boolean, input.schema)
      : null;
    this.db
      .prepare(
        'INSERT INTO tool_schemas(tenant_id,tool_name_hash,adapter,version,schema_hash,schema_json,drift_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        principal.tenantId,
        toolHash,
        input.adapter,
        input.version,
        schemaHash,
        JSON.stringify(input.schema),
        drift ? JSON.stringify(drift) : null,
        now(),
      );
    if (drift?.changed) {
      this.db
        .prepare(
          `INSERT INTO usage_monthly(tenant_id,month,drift_count) VALUES(?,?,1) ON CONFLICT(tenant_id,month) DO UPDATE SET drift_count=drift_count+1`,
        )
        .run(principal.tenantId, month());
      const category = `drift:${drift.changes
        .map((change) => change.kind)
        .sort()
        .join('+')}`;
      const signature = sha256({ adapter: input.adapter, category });
      this.db
        .prepare(
          `INSERT INTO compatibility_signatures(tenant_id,signature,category,count,last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,signature) DO UPDATE SET count=count+1,last_seen_at=excluded.last_seen_at`,
        )
        .run(principal.tenantId, signature, category, 1, now());
      if (drift.compatibility === 'breaking')
        this.insertAlert(principal.tenantId, 'breaking_schema_drift', 'critical', {
          tool_name_hash: toolHash,
          version: input.version,
          changes: drift.changes.map((change) => change.kind),
        });
    }
    return { schema_hash: schemaHash, drift };
  }

  listLatestSchemas(principal: Principal): Row[] {
    this.requireScope(principal, 'read:environment');
    return (
      this.db
        .prepare(
          `SELECT s.tool_name_hash,s.adapter,s.version,s.schema_hash,s.schema_json,s.drift_json,s.created_at
           FROM tool_schemas s
           WHERE s.tenant_id=? AND NOT EXISTS (
             SELECT 1 FROM tool_schemas newer
             WHERE newer.tenant_id=s.tenant_id AND newer.tool_name_hash=s.tool_name_hash AND newer.id>s.id
           )
           ORDER BY s.created_at DESC,s.id DESC`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row) => ({
      tool_name_hash: text(row.tool_name_hash),
      adapter: text(row.adapter),
      version: text(row.version),
      schema_hash: text(row.schema_hash),
      schema: parse(row.schema_json),
      drift: row.drift_json === null ? null : parse(row.drift_json),
      created_at: text(row.created_at),
    }));
  }

  private schemaReleaseRecordHash(
    tenantId: string,
    record: Omit<ManagedSchemaRelease, 'record_hash'>,
    schemaRowId: number,
  ): string {
    return hmac(this.config.masterSecret, 'schema-release-record-v1', {
      tenant_id: tenantId,
      schema_row_id: schemaRowId,
      ...record,
    });
  }

  private schemaReleaseSourceValid(row: Row): boolean {
    try {
      return (
        text(row.source_tenant_id) === text(row.tenant_id) &&
        text(row.source_tool_name_hash) === text(row.tool_name_hash) &&
        text(row.source_schema_hash) === text(row.schema_hash) &&
        text(row.source_adapter) === text(row.adapter) &&
        text(row.source_version) === text(row.version) &&
        sha256(parse(row.source_schema_json)) === text(row.schema_hash)
      );
    } catch {
      return false;
    }
  }

  private schemaReleaseFromRow(row: Row): ManagedSchemaRelease {
    return {
      release_id: text(row.release_id),
      tool_name_hash: text(row.tool_name_hash),
      environment: text(row.environment),
      schema_hash: text(row.schema_hash),
      adapter: text(row.adapter),
      version: text(row.version),
      compatibility: text(row.compatibility) as ManagedSchemaRelease['compatibility'],
      evidence_hash: text(row.evidence_hash),
      promoted_by_hash: text(row.promoted_by_hash),
      promoted_at: text(row.promoted_at),
      previous_hash: text(row.previous_hash),
      record_hash: text(row.record_hash),
    };
  }

  promoteSchemaRelease(
    principal: Principal,
    input: {
      tool_name: string;
      version: string;
      environment: string;
      expected_schema_hash: string;
      allow_breaking?: boolean;
      evidence_reference?: string;
    },
  ): ManagedSchemaRelease & { drift: DriftReport | null } {
    this.requireScope(principal, 'promote:schema');
    if (
      input.tool_name.length === 0 ||
      input.tool_name.length > 256 ||
      input.version.length === 0 ||
      input.version.length > 128 ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.expected_schema_hash) ||
      (input.evidence_reference !== undefined &&
        (input.evidence_reference.length === 0 || input.evidence_reference.length > 512))
    )
      throw new ManagedError(
        400,
        'invalid_schema_promotion',
        'tool, version, expected schema hash, and optional bounded evidence are required',
      );
    const environment = text(this.environmentRecord(principal, input.environment).name);
    const toolNameHash = hmac(
      this.config.masterSecret,
      `tool-name:${principal.tenantId}`,
      input.tool_name,
    );
    if (!this.verifySchemaReleaseHistory(principal).valid)
      throw new ManagedError(
        409,
        'schema_release_history_invalid',
        'refusing promotion because schema release history failed integrity verification',
      );
    const candidate = this.db
      .prepare(
        `SELECT id,schema_hash,schema_json,adapter,version FROM tool_schemas WHERE tenant_id=? AND tool_name_hash=? AND version=?`,
      )
      .get(principal.tenantId, toolNameHash, input.version) as Row | undefined;
    if (!candidate)
      throw new ManagedError(
        404,
        'registered_schema_not_found',
        'the requested registered schema version does not exist for this tenant and tool',
      );
    if (sha256(parse(candidate.schema_json)) !== text(candidate.schema_hash))
      throw new ManagedError(
        409,
        'registered_schema_integrity_invalid',
        'the registered schema body does not match its stored hash',
      );
    if (text(candidate.schema_hash) !== input.expected_schema_hash)
      throw new ManagedError(
        409,
        'schema_hash_mismatch',
        'expected_schema_hash does not match the registered schema',
      );
    const current = this.db
      .prepare(
        `SELECT r.*,s.schema_json FROM schema_releases r JOIN tool_schemas s ON s.id=r.schema_row_id WHERE r.tenant_id=? AND r.environment=? AND r.tool_name_hash=? ORDER BY r.sequence DESC LIMIT 1`,
      )
      .get(principal.tenantId, environment, toolNameHash) as Row | undefined;
    if (current && Number(current.schema_row_id) === Number(candidate.id))
      return { ...this.schemaReleaseFromRow(current), drift: null };
    const drift = current
      ? detectSchemaDrift(
          parse(current.schema_json) as object | boolean,
          parse(candidate.schema_json) as object | boolean,
        )
      : null;
    const compatibility: ManagedSchemaRelease['compatibility'] = drift
      ? drift.compatibility
      : 'initial';
    if (compatibility === 'breaking' && !input.allow_breaking)
      throw new ManagedError(
        409,
        'breaking_schema_promotion_blocked',
        'breaking schema promotion requires allow_breaking and an evidence reference',
      );
    if (compatibility === 'breaking' && !input.evidence_reference)
      throw new ManagedError(
        400,
        'promotion_evidence_required',
        'breaking schema promotion requires an external review evidence reference',
      );
    return this.db.transaction(() => {
      const promotedAt = now();
      const previousHash = text(
        (
          this.db
            .prepare(
              'SELECT record_hash FROM schema_releases WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1',
            )
            .get(principal.tenantId) as Row | undefined
        )?.record_hash,
        'GENESIS',
      );
      const recordWithoutHash: Omit<ManagedSchemaRelease, 'record_hash'> = {
        release_id: `release_${randomUUID()}`,
        tool_name_hash: toolNameHash,
        environment,
        schema_hash: text(candidate.schema_hash),
        adapter: text(candidate.adapter),
        version: text(candidate.version),
        compatibility,
        evidence_hash: hmac(this.config.masterSecret, 'schema-promotion-evidence-v1', {
          tenant_id: principal.tenantId,
          evidence_reference: input.evidence_reference ?? 'none',
        }),
        promoted_by_hash: hmac(this.config.masterSecret, 'schema-promoter-v1', {
          tenant_id: principal.tenantId,
          key_id: principal.keyId,
        }),
        promoted_at: promotedAt,
        previous_hash: previousHash,
      };
      const recordHash = this.schemaReleaseRecordHash(
        principal.tenantId,
        recordWithoutHash,
        Number(candidate.id),
      );
      this.db
        .prepare(
          `INSERT INTO schema_releases(release_id,tenant_id,tool_name_hash,environment,schema_row_id,schema_hash,adapter,version,compatibility,evidence_hash,promoted_by_hash,promoted_at,previous_hash,record_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          recordWithoutHash.release_id,
          principal.tenantId,
          toolNameHash,
          environment,
          candidate.id,
          recordWithoutHash.schema_hash,
          recordWithoutHash.adapter,
          recordWithoutHash.version,
          compatibility,
          recordWithoutHash.evidence_hash,
          recordWithoutHash.promoted_by_hash,
          promotedAt,
          previousHash,
          recordHash,
        );
      this.insertAlert(principal.tenantId, 'schema_promoted', 'critical', {
        release_id: recordWithoutHash.release_id,
        tool_name_hash: toolNameHash,
        environment,
        schema_hash: recordWithoutHash.schema_hash,
        compatibility,
      });
      return { ...recordWithoutHash, record_hash: recordHash, drift };
    })();
  }

  listSchemaReleases(
    principal: Principal,
    environment?: string,
    limit = 100,
  ): Array<ManagedSchemaRelease & { integrity_valid: boolean }> {
    this.requireScope(principal, 'read:environment');
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    const rows = (
      environment
        ? this.db
            .prepare(
              `SELECT r.*,s.tenant_id source_tenant_id,s.tool_name_hash source_tool_name_hash,s.schema_hash source_schema_hash,s.adapter source_adapter,s.version source_version,s.schema_json source_schema_json FROM schema_releases r LEFT JOIN tool_schemas s ON s.id=r.schema_row_id WHERE r.tenant_id=? AND r.environment=? ORDER BY r.sequence DESC LIMIT ?`,
            )
            .all(principal.tenantId, this.environmentName(principal, environment), bounded)
        : this.db
            .prepare(
              `SELECT r.*,s.tenant_id source_tenant_id,s.tool_name_hash source_tool_name_hash,s.schema_hash source_schema_hash,s.adapter source_adapter,s.version source_version,s.schema_json source_schema_json FROM schema_releases r LEFT JOIN tool_schemas s ON s.id=r.schema_row_id WHERE r.tenant_id=? ORDER BY r.sequence DESC LIMIT ?`,
            )
            .all(principal.tenantId, bounded)
    ) as Row[];
    return rows.map((row) => {
      const record = this.schemaReleaseFromRow(row);
      const { record_hash: recordHash, ...withoutHash } = record;
      return {
        ...record,
        integrity_valid:
          this.schemaReleaseSourceValid(row) &&
          recordHash ===
            this.schemaReleaseRecordHash(
              principal.tenantId,
              withoutHash,
              Number(row.schema_row_id),
            ),
      };
    });
  }

  verifySchemaReleaseHistory(principal: Principal): {
    valid: boolean;
    checked: number;
    first_invalid_release_id?: string;
  } {
    this.requireScope(principal, 'read:environment');
    const rows = this.db
      .prepare(
        `SELECT r.*,s.tenant_id source_tenant_id,s.tool_name_hash source_tool_name_hash,s.schema_hash source_schema_hash,s.adapter source_adapter,s.version source_version,s.schema_json source_schema_json FROM schema_releases r LEFT JOIN tool_schemas s ON s.id=r.schema_row_id WHERE r.tenant_id=? ORDER BY r.sequence ASC`,
      )
      .all(principal.tenantId) as Row[];
    let previousHash = 'GENESIS';
    for (const [index, row] of rows.entries()) {
      const record = this.schemaReleaseFromRow(row);
      const { record_hash: recordHash, ...withoutHash } = record;
      if (
        record.previous_hash !== previousHash ||
        !this.schemaReleaseSourceValid(row) ||
        recordHash !==
          this.schemaReleaseRecordHash(principal.tenantId, withoutHash, Number(row.schema_row_id))
      )
        return {
          valid: false,
          checked: index,
          first_invalid_release_id: record.release_id,
        };
      previousHash = recordHash;
    }
    return { valid: true, checked: rows.length };
  }

  schemaAdmission(
    principal: Principal,
    environmentInput: string,
    toolName: string,
    schema: object | boolean,
  ): SchemaAdmissionResult {
    const environmentRow = this.environmentRecord(principal, environmentInput);
    const environment = text(environmentRow.name);
    const mode = text(environmentRow.schema_enforcement) as SchemaEnforcementMode;
    const toolNameHash = hmac(
      this.config.masterSecret,
      `tool-name:${principal.tenantId}`,
      toolName,
    );
    const submittedSchemaHash = sha256(schema);
    if (mode === 'observe')
      return {
        mode,
        allowed: true,
        environment,
        tool_name_hash: toolNameHash,
        submitted_schema_hash: submittedSchemaHash,
      };
    const promoted = this.db
      .prepare(
        `SELECT r.*,s.tenant_id source_tenant_id,s.tool_name_hash source_tool_name_hash,s.schema_hash source_schema_hash,s.adapter source_adapter,s.version source_version,s.schema_json source_schema_json FROM schema_releases r LEFT JOIN tool_schemas s ON s.id=r.schema_row_id WHERE r.tenant_id=? AND r.environment=? AND r.tool_name_hash=? ORDER BY r.sequence DESC LIMIT 1`,
      )
      .get(principal.tenantId, environment, toolNameHash) as Row | undefined;
    if (!promoted)
      return {
        mode,
        allowed: false,
        reason: 'schema_not_promoted',
        environment,
        tool_name_hash: toolNameHash,
        submitted_schema_hash: submittedSchemaHash,
      };
    const promotedRecord = this.schemaReleaseFromRow(promoted);
    const { record_hash: promotedRecordHash, ...promotedWithoutHash } = promotedRecord;
    if (
      !this.schemaReleaseSourceValid(promoted) ||
      promotedRecordHash !==
        this.schemaReleaseRecordHash(
          principal.tenantId,
          promotedWithoutHash,
          Number(promoted.schema_row_id),
        )
    )
      return {
        mode,
        allowed: false,
        reason: 'schema_release_integrity_invalid',
        environment,
        tool_name_hash: toolNameHash,
        submitted_schema_hash: submittedSchemaHash,
        release_id: promotedRecord.release_id,
      };
    const promotedSchemaHash = text(promoted.schema_hash);
    return {
      mode,
      allowed: submittedSchemaHash === promotedSchemaHash,
      ...(submittedSchemaHash === promotedSchemaHash
        ? {}
        : { reason: 'schema_release_mismatch' as const }),
      environment,
      tool_name_hash: toolNameHash,
      submitted_schema_hash: submittedSchemaHash,
      promoted_schema_hash: promotedSchemaHash,
      release_id: text(promoted.release_id),
    };
  }

  aggregateIntelligence(): Row[] {
    const threshold = this.config.aggregateTenantThreshold ?? 3;
    return this.db
      .prepare(
        `SELECT signature,category,SUM(count) event_count,COUNT(DISTINCT tenant_id) tenant_count,MAX(last_seen_at) last_seen_at FROM compatibility_signatures GROUP BY signature,category HAVING COUNT(DISTINCT tenant_id)>=? ORDER BY event_count DESC`,
      )
      .all(threshold) as Row[];
  }

  aggregateFailureIntelligence(): Row[] {
    const threshold = this.config.aggregateTenantThreshold ?? 3;
    const rows = this.db
      .prepare(
        `SELECT signature,category,adapter,provider,framework,reason_code,repair_rules_json,issue_shapes_json,event_count,first_seen_at,last_seen_at,affected_versions_json
         FROM failure_clusters
         WHERE signature IN (
           SELECT signature FROM failure_clusters
           GROUP BY signature HAVING COUNT(DISTINCT tenant_id)>=?
         )
         ORDER BY signature ASC`,
      )
      .all(threshold) as Row[];
    const aggregate = new Map<string, Row>();
    for (const row of rows) {
      const signature = text(row.signature);
      const current = aggregate.get(signature);
      const versions = new Set<string>([
        ...((current?.affected_versions as string[] | undefined) ?? []),
        ...(parse(row.affected_versions_json) as string[]),
      ]);
      aggregate.set(signature, {
        id: signature,
        category: row.category,
        adapter: row.adapter,
        provider: row.provider,
        framework: row.framework,
        reason_code: row.reason_code,
        repair_rule_ids: parse(row.repair_rules_json),
        issue_shapes: parse(row.issue_shapes_json),
        event_count: Number(current?.event_count ?? 0) + Number(row.event_count),
        tenant_count: Number(current?.tenant_count ?? 0) + 1,
        first_seen_at:
          current && text(current.first_seen_at) < text(row.first_seen_at)
            ? current.first_seen_at
            : row.first_seen_at,
        last_seen_at:
          current && text(current.last_seen_at) > text(row.last_seen_at)
            ? current.last_seen_at
            : row.last_seen_at,
        affected_versions: [...versions].sort(),
      });
    }
    return [...aggregate.values()].sort(
      (left, right) =>
        Number(right.event_count) - Number(left.event_count) ||
        text(left.id).localeCompare(text(right.id)),
    );
  }

  recordConformanceRun(
    principal: Principal,
    run: ConformanceRun,
  ): {
    recorded: boolean;
    report_hash: string;
  } {
    this.requireScope(principal, 'admin');
    // The aggregator performs the shared count and timestamp validation.
    try {
      aggregateCompatibilityMatrix([run]);
    } catch (error) {
      throw new ManagedError(
        400,
        'invalid_conformance_run',
        error instanceof Error ? error.message : 'conformance run is invalid',
      );
    }
    const fields = [
      run.provider,
      run.provider_version,
      run.framework,
      run.framework_version,
      run.suite_version,
    ];
    if (
      fields.some(
        (value) => typeof value !== 'string' || value.length === 0 || value.length > 128,
      ) ||
      !['json_schema', 'mcp', 'openai_agents', 'pydantic_ai', 'google_adk'].includes(run.adapter) ||
      (run.failure_signature_ids !== undefined && !Array.isArray(run.failure_signature_ids)) ||
      (run.failure_signature_ids ?? []).some(
        (signature) => typeof signature !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(signature),
      )
    )
      throw new ManagedError(
        400,
        'invalid_conformance_run',
        'conformance metadata or failure signatures are invalid',
      );
    const normalized: ConformanceRun = {
      ...run,
      executed_at: new Date(run.executed_at).toISOString(),
      failure_signature_ids: [...new Set(run.failure_signature_ids ?? [])].sort(),
    };
    const reportHash = sha256(normalized);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO conformance_runs(tenant_id,provider,provider_version,framework,framework_version,adapter,suite_version,executed_at,passed,failed,repaired,rejected,failure_signature_ids_json,report_hash,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        principal.tenantId,
        normalized.provider,
        normalized.provider_version,
        normalized.framework,
        normalized.framework_version,
        normalized.adapter,
        normalized.suite_version,
        normalized.executed_at,
        normalized.passed,
        normalized.failed,
        normalized.repaired,
        normalized.rejected,
        JSON.stringify(normalized.failure_signature_ids),
        reportHash,
        now(),
      );
    return { recorded: result.changes === 1, report_hash: reportHash };
  }

  tenantIntelligence(principal: Principal): Row {
    this.requireScope(principal, 'read:intelligence');
    const clusters = (
      this.db
        .prepare(
          `SELECT signature,category,adapter,provider,framework,reason_code,repair_rules_json,issue_shapes_json,event_count,first_seen_at,last_seen_at,affected_versions_json
           FROM failure_clusters WHERE tenant_id=? ORDER BY event_count DESC,last_seen_at DESC,signature ASC`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row): FailureCluster => ({
      id: text(row.signature),
      category: text(row.category) as FailureCluster['category'],
      adapter: text(row.adapter) as AdapterName,
      provider: text(row.provider),
      framework: text(row.framework),
      ...(row.reason_code === null
        ? {}
        : {
            reason_code: text(row.reason_code) as NonNullable<FailureCluster['reason_code']>,
          }),
      repair_rule_ids: parse(row.repair_rules_json) as FailureCluster['repair_rule_ids'],
      issue_shapes: parse(row.issue_shapes_json) as string[],
      event_count: Number(row.event_count),
      first_seen_at: text(row.first_seen_at),
      last_seen_at: text(row.last_seen_at),
      affected_versions: parse(row.affected_versions_json) as string[],
    }));
    const schemas = (
      this.db
        .prepare(
          `SELECT s.tool_name_hash,s.adapter,s.version,s.schema_hash,s.schema_json,s.drift_json,s.created_at
           FROM tool_schemas s
           WHERE s.tenant_id=? AND NOT EXISTS (
             SELECT 1 FROM tool_schemas newer
             WHERE newer.tenant_id=s.tenant_id AND newer.tool_name_hash=s.tool_name_hash AND newer.id>s.id
           )
           ORDER BY s.created_at DESC,s.id DESC`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row) => {
      const quality = scoreSchemaQuality(parse(row.schema_json) as object | boolean);
      const drift = row.drift_json === null ? null : (parse(row.drift_json) as DriftReport);
      return {
        tool_name_hash: row.tool_name_hash,
        adapter: row.adapter,
        version: row.version,
        schema_hash: row.schema_hash,
        created_at: row.created_at,
        quality,
        drift,
      };
    });
    const runs = (
      this.db
        .prepare(
          `SELECT provider,provider_version,framework,framework_version,adapter,suite_version,executed_at,passed,failed,repaired,rejected,failure_signature_ids_json
           FROM conformance_runs WHERE tenant_id=? ORDER BY executed_at DESC,id DESC`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row): ConformanceRun => ({
      provider: text(row.provider),
      provider_version: text(row.provider_version),
      framework: text(row.framework),
      framework_version: text(row.framework_version),
      adapter: text(row.adapter) as AdapterName,
      suite_version: text(row.suite_version),
      executed_at: text(row.executed_at),
      passed: Number(row.passed),
      failed: Number(row.failed),
      repaired: Number(row.repaired),
      rejected: Number(row.rejected),
      failure_signature_ids: parse(row.failure_signature_ids_json) as string[],
    }));
    const severityRank = { critical: 0, warning: 1, info: 2 } as const;
    const recommendations = [
      ...recommendFixes({ clusters }).map((recommendation) => ({
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
    ]
      .filter(
        (recommendation, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.code === recommendation.code &&
              candidate.path === recommendation.path &&
              candidate.message === recommendation.message &&
              candidate.source === recommendation.source &&
              ('tool_name_hash' in candidate ? candidate.tool_name_hash : undefined) ===
                ('tool_name_hash' in recommendation ? recommendation.tool_name_hash : undefined),
          ) === index,
      )
      .sort(
        (left, right) =>
          severityRank[left.severity] - severityRank[right.severity] ||
          left.code.localeCompare(right.code) ||
          left.path.localeCompare(right.path),
      );
    return {
      failure_clusters: clusters,
      schema_quality: schemas,
      compatibility_matrix: aggregateCompatibilityMatrix(runs),
      recommendations,
    };
  }
  usage(principal: Principal): Row {
    return (
      (this.db
        .prepare('SELECT * FROM usage_monthly WHERE tenant_id=? AND month=?')
        .get(principal.tenantId, month()) as Row | undefined) ?? {
        tenant_id: principal.tenantId,
        month: month(),
        validation_count: 0,
        repair_count: 0,
        rejection_count: 0,
        drift_count: 0,
      }
    );
  }

  publishRuleset(
    principal: Principal,
    input: Omit<SignedRuleSet, 'key_id' | 'public_key' | 'signature'>,
  ): SignedRuleSet {
    this.requireScope(principal, 'admin');
    this.assertRuleset(input);
    const key = this.db
      .prepare(
        'SELECT id,public_key_pem,encrypted_private_key FROM signing_keys ORDER BY created_at DESC LIMIT 1',
      )
      .get() as Row;
    const body = { ...input, key_id: text(key.id), public_key: text(key.public_key_pem) };
    const signed: SignedRuleSet = {
      ...body,
      signature: signRuleset(this.config.masterSecret, text(key.encrypted_private_key), body),
    };
    this.db
      .prepare(
        'INSERT INTO tenant_rulesets(tenant_id,version,body_json,issued_at,expires_at,signature) VALUES(?,?,?,?,?,?)',
      )
      .run(
        principal.tenantId,
        signed.version,
        JSON.stringify(signed),
        signed.issued_at,
        signed.expires_at,
        signed.signature,
      );
    return signed;
  }
  latestRuleset(principal: Principal): SignedRuleSet | undefined {
    const row = this.db
      .prepare(
        'SELECT body_json FROM tenant_rulesets WHERE tenant_id=? AND julianday(issued_at)<=julianday(?) AND julianday(expires_at)>julianday(?) ORDER BY julianday(issued_at) DESC LIMIT 1',
      )
      .get(principal.tenantId, now(), now()) as Row | undefined;
    return row ? (parse(row.body_json) as SignedRuleSet) : undefined;
  }
  verifyRuleset(ruleset: SignedRuleSet): boolean {
    if (Date.parse(ruleset.expires_at) <= Date.now()) return false;
    const key = this.db
      .prepare('SELECT id,public_key_pem,trust_hmac FROM signing_keys WHERE id=?')
      .get(ruleset.key_id) as Row | undefined;
    if (!key || text(key.public_key_pem) !== ruleset.public_key) return false;
    const expectedTrust = hmac(this.config.masterSecret, 'signing-key-trust-v1', {
      id: key.id,
      public_key: key.public_key_pem,
    });
    if (!constantTimeEqual(text(key.trust_hmac), expectedTrust)) return false;
    const { signature } = ruleset;
    const body = {
      version: ruleset.version,
      issued_at: ruleset.issued_at,
      expires_at: ruleset.expires_at,
      rules: ruleset.rules,
      key_id: ruleset.key_id,
      public_key: ruleset.public_key,
    };
    return verifyRulesetSignature(ruleset.public_key, body, signature);
  }
  private assertRuleset(input: Omit<SignedRuleSet, 'key_id' | 'public_key' | 'signature'>): void {
    const issued = Date.parse(input.issued_at);
    const expires = Date.parse(input.expires_at);
    const knownRules = new Set([
      'coerce.string_to_number',
      'coerce.string_to_integer',
      'coerce.string_to_boolean',
      'coerce.singleton_to_array',
    ]);
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      input.version.length === 0 ||
      input.version.length > 128 ||
      issued > Date.now() + 300_000 ||
      expires <= issued ||
      expires <= Date.now() ||
      !input.rules.length ||
      input.rules.some(
        (rule) =>
          !knownRules.has(rule.id) ||
          typeof rule.enabled_by_default !== 'boolean' ||
          typeof rule.description !== 'string' ||
          rule.description.length === 0 ||
          rule.description.length > 500,
      ) ||
      new Set(input.rules.map((rule) => rule.id)).size !== input.rules.length
    )
      throw new ManagedError(
        400,
        'invalid_ruleset',
        'ruleset dates or repair rule declarations are invalid',
      );
  }

  alerts(principal: Principal): Row[] {
    const rows = this.db
      .prepare(
        'SELECT id,kind,severity,detail_json,created_at,acknowledged_at FROM alerts WHERE tenant_id=? ORDER BY id DESC LIMIT 100',
      )
      .all(principal.tenantId) as Row[];
    return rows.map(({ detail_json, ...row }) => ({ ...row, detail: parse(detail_json) }));
  }
  acknowledgeAlert(principal: Principal, alertId: number): boolean {
    this.requireScope(principal, 'admin');
    if (!Number.isSafeInteger(alertId) || alertId < 1) return false;
    const result = this.db
      .prepare(
        `UPDATE alerts
            SET acknowledged_at=COALESCE(acknowledged_at,?)
          WHERE tenant_id=? AND id=?`,
      )
      .run(now(), principal.tenantId, alertId);
    return result.changes === 1;
  }
  private checkpointAnchorOperational(): boolean {
    if (!this.config.actionCheckpointAnchorUrl) return true;
    const current = this.db
      .prepare(
        `SELECT d.*
           FROM action_idempotency_manifests m
           JOIN checkpoint_anchor_deliveries d
             ON d.tenant_id=m.tenant_id AND d.revision=m.revision
          ORDER BY d.tenant_id`,
      )
      .all() as Row[];
    if (current.some((row) => row.status === 'dead')) return false;
    for (const row of current) this.assertCheckpointAnchorDeliveryPayloadHmac(row);
    return true;
  }
  listCheckpointAnchorDeliveries(
    principal: Principal,
    limit = 100,
  ): ActionCheckpointAnchorDelivery[] {
    this.requireScope(principal, 'reconcile:action');
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    const rows = this.db
      .prepare(
        `SELECT * FROM checkpoint_anchor_deliveries WHERE tenant_id=? ORDER BY revision DESC LIMIT ?`,
      )
      .all(principal.tenantId, bounded) as Row[];
    return rows.map((row) => {
      this.assertCheckpointAnchorDeliveryPayloadHmac(row);
      return {
        delivery_id: text(row.delivery_id),
        revision: Number(row.revision),
        checkpoint_hash: text(row.checkpoint_hash),
        status: text(row.status) as ActionCheckpointAnchorDelivery['status'],
        attempt_count: Number(row.attempt_count),
        next_attempt_at: text(row.next_attempt_at),
        last_attempt_at: row.last_attempt_at === null ? null : text(row.last_attempt_at),
        delivered_at: row.delivered_at === null ? null : text(row.delivered_at),
        response_status: row.response_status === null ? null : Number(row.response_status),
        error_code: row.error_code === null ? null : text(row.error_code),
        created_at: text(row.created_at),
      };
    });
  }
  actionCheckpointAnchorAcknowledged(principal: Principal): boolean {
    this.requireScope(principal, 'evaluate:action');
    if (!this.config.actionCheckpointAnchorUrl) return true;
    const manifest = this.db
      .prepare('SELECT * FROM action_idempotency_manifests WHERE tenant_id=?')
      .get(principal.tenantId) as Row | undefined;
    if (!manifest) return false;
    this.assertControlHmac(
      manifest,
      this.actionIdempotencyManifestHmac(manifest),
      'action idempotency manifest',
    );
    const delivery = this.db
      .prepare('SELECT * FROM checkpoint_anchor_deliveries WHERE tenant_id=? AND revision=?')
      .get(principal.tenantId, manifest.revision) as Row | undefined;
    if (!delivery) return false;
    this.assertCheckpointAnchorDeliveryPayloadHmac(delivery);
    return (
      delivery.status === 'delivered' &&
      constantTimeEqual(
        text(delivery.checkpoint_hash),
        this.actionIdempotencyCheckpointFromManifest(principal.tenantId, manifest).checkpoint_hash,
      )
    );
  }
  redriveCheckpointAnchorDelivery(principal: Principal, deliveryId: string): boolean {
    this.requireScope(principal, 'reconcile:action');
    if (!this.config.actionCheckpointAnchorUrl) return false;
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM checkpoint_anchor_deliveries WHERE tenant_id=? AND delivery_id=?')
        .get(principal.tenantId, deliveryId) as Row | undefined;
      if (!row) return false;
      this.assertCheckpointAnchorDeliveryPayloadHmac(row);
      return (
        this.db
          .prepare(
            `UPDATE checkpoint_anchor_deliveries SET status='pending',attempt_count=0,next_attempt_at=?,lease_id=NULL,lease_expires_at=NULL,last_attempt_at=NULL,delivered_at=NULL,response_status=NULL,error_code=NULL,acknowledgement_hmac=NULL WHERE tenant_id=? AND delivery_id=? AND status='dead'`,
          )
          .run(now(), principal.tenantId, deliveryId).changes === 1
      );
    })();
  }
  claimDueCheckpointAnchorDeliveries(limit = 25): ClaimedCheckpointAnchorDelivery[] {
    const endpoint = this.config.actionCheckpointAnchorUrl;
    const signingSecret = this.config.actionCheckpointAnchorSigningSecret;
    if (!endpoint || !signingSecret) return [];
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
    const claimedAt = now();
    const leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM checkpoint_anchor_deliveries WHERE (status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_expires_at<=?) ORDER BY revision,created_at LIMIT ?`,
        )
        .all(claimedAt, claimedAt, bounded) as Row[];
      const claims: ClaimedCheckpointAnchorDelivery[] = [];
      for (const row of rows) {
        this.assertCheckpointAnchorDeliveryPayloadHmac(row);
        const leaseId = `lease_${randomUUID()}`;
        const updated = this.db
          .prepare(
            `UPDATE checkpoint_anchor_deliveries SET status='processing',attempt_count=attempt_count+1,last_attempt_at=?,lease_id=?,lease_expires_at=? WHERE delivery_id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_expires_at<=?))`,
          )
          .run(claimedAt, leaseId, leaseExpiresAt, row.delivery_id, claimedAt, claimedAt).changes;
        if (updated !== 1) continue;
        claims.push({
          deliveryId: text(row.delivery_id),
          leaseId,
          endpoint,
          signingSecret,
          payload: text(row.payload_json),
          attemptCount: Number(row.attempt_count) + 1,
        });
      }
      return claims;
    })();
  }
  finishCheckpointAnchorDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): 'delivered' | 'pending' | 'dead' | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM checkpoint_anchor_deliveries WHERE delivery_id=? AND status='processing' AND lease_id=?`,
      )
      .get(input.deliveryId, input.leaseId) as Row | undefined;
    if (!row) return undefined;
    const attempts = Number(row.attempt_count);
    const maxAttempts = this.config.actionCheckpointAnchorMaxAttempts ?? 8;
    const responseStatus = input.responseStatus ?? null;
    const errorCode = (input.errorCode ?? (input.delivered ? null : 'delivery_failed'))?.slice(
      0,
      128,
    );
    if (input.delivered) {
      const deliveredAt = now();
      const acknowledgementHmac = this.checkpointAnchorAcknowledgementHmac({
        ...row,
        delivered_at: deliveredAt,
        response_status: responseStatus,
      });
      return this.db
        .prepare(
          `UPDATE checkpoint_anchor_deliveries SET status='delivered',delivered_at=?,response_status=?,error_code=NULL,lease_id=NULL,lease_expires_at=NULL,acknowledgement_hmac=? WHERE delivery_id=? AND status='processing' AND lease_id=?`,
        )
        .run(deliveredAt, responseStatus, acknowledgementHmac, input.deliveryId, input.leaseId)
        .changes === 1
        ? 'delivered'
        : undefined;
    }
    if (input.retryable && attempts < maxAttempts) {
      const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 11));
      return this.db
        .prepare(
          `UPDATE checkpoint_anchor_deliveries SET status='pending',next_attempt_at=?,response_status=?,error_code=?,lease_id=NULL,lease_expires_at=NULL WHERE delivery_id=? AND status='processing' AND lease_id=?`,
        )
        .run(
          new Date(Date.now() + delaySeconds * 1_000).toISOString(),
          responseStatus,
          errorCode,
          input.deliveryId,
          input.leaseId,
        ).changes === 1
        ? 'pending'
        : undefined;
    }
    return this.db
      .prepare(
        `UPDATE checkpoint_anchor_deliveries SET status='dead',response_status=?,error_code=?,lease_id=NULL,lease_expires_at=NULL WHERE delivery_id=? AND status='processing' AND lease_id=?`,
      )
      .run(responseStatus, errorCode, input.deliveryId, input.leaseId).changes === 1
      ? 'dead'
      : undefined;
  }
  createAlertWebhook(
    principal: Principal,
    label: string,
    endpointInput: string,
  ): AlertWebhookEndpoint & { signing_secret: string } {
    this.requireScope(principal, 'manage:webhooks');
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/u.test(label))
      throw new ManagedError(
        400,
        'invalid_webhook_label',
        'webhook label must be 1-64 plain display characters',
      );
    if (endpointInput.length > 2048)
      throw new ManagedError(400, 'invalid_webhook_endpoint', 'webhook endpoint is too long');
    const endpoint = normalizedPublicWebhookEndpoint(endpointInput);
    const webhookId = `wh_${randomUUID()}`;
    const signingSecret = `sgwhsec_${randomBytes(32).toString('base64url')}`;
    const endpointHash = hmac(this.config.masterSecret, 'alert-webhook-endpoint-v1', {
      tenant_id: principal.tenantId,
      endpoint,
    });
    const createdAt = now();
    const webhookRow: Row = {
      webhook_id: webhookId,
      tenant_id: principal.tenantId,
      label,
      endpoint_hash: endpointHash,
      encrypted_endpoint: sealValue(
        this.config.masterSecret,
        `alert-webhook-endpoint-v1:${principal.tenantId}:${webhookId}`,
        endpoint,
      ),
      encrypted_signing_secret: sealValue(
        this.config.masterSecret,
        `alert-webhook-secret-v1:${principal.tenantId}:${webhookId}`,
        signingSecret,
      ),
      created_at: createdAt,
      disabled_at: null,
    };
    try {
      this.db
        .prepare(
          `INSERT INTO alert_webhooks(webhook_id,tenant_id,label,endpoint_hash,encrypted_endpoint,encrypted_signing_secret,created_at,control_hmac) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          webhookRow.webhook_id,
          webhookRow.tenant_id,
          webhookRow.label,
          webhookRow.endpoint_hash,
          webhookRow.encrypted_endpoint,
          webhookRow.encrypted_signing_secret,
          webhookRow.created_at,
          this.alertWebhookControlHmac(webhookRow),
        );
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/u.test(error.message))
        throw new ManagedError(
          409,
          'webhook_conflict',
          'a webhook with this label or endpoint already exists',
        );
      throw error;
    }
    return {
      webhook_id: webhookId,
      label,
      endpoint_hash: endpointHash,
      created_at: createdAt,
      disabled_at: null,
      signing_secret: signingSecret,
    };
  }
  listAlertWebhooks(principal: Principal): AlertWebhookEndpoint[] {
    this.requireScope(principal, 'manage:webhooks');
    const rows = this.db
      .prepare(`SELECT * FROM alert_webhooks WHERE tenant_id=? ORDER BY created_at DESC`)
      .all(principal.tenantId) as Row[];
    return rows.map((row) => {
      this.assertControlHmac(row, this.alertWebhookControlHmac(row), 'alert webhook');
      return {
        webhook_id: text(row.webhook_id),
        label: text(row.label),
        endpoint_hash: text(row.endpoint_hash),
        created_at: text(row.created_at),
        disabled_at: row.disabled_at === null ? null : text(row.disabled_at),
      };
    });
  }
  disableAlertWebhook(principal: Principal, webhookId: string): boolean {
    this.requireScope(principal, 'manage:webhooks');
    const disabledAt = now();
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM alert_webhooks WHERE tenant_id=? AND webhook_id=?')
        .get(principal.tenantId, webhookId) as Row | undefined;
      if (!row) return false;
      this.assertControlHmac(row, this.alertWebhookControlHmac(row), 'alert webhook');
      const updated = { ...row, disabled_at: row.disabled_at ?? disabledAt };
      const disabled = this.db
        .prepare(
          `UPDATE alert_webhooks SET disabled_at=COALESCE(disabled_at,?),control_hmac=? WHERE tenant_id=? AND webhook_id=?`,
        )
        .run(
          disabledAt,
          this.alertWebhookControlHmac(updated),
          principal.tenantId,
          webhookId,
        ).changes;
      if (!disabled) return false;
      this.db
        .prepare(
          `UPDATE alert_deliveries SET status='dead',lease_id=NULL,lease_expires_at=NULL,error_code='webhook_disabled' WHERE tenant_id=? AND webhook_id=? AND status IN ('pending','processing')`,
        )
        .run(principal.tenantId, webhookId);
      return true;
    })();
  }
  listAlertWebhookDeliveries(principal: Principal, limit = 100): AlertWebhookDelivery[] {
    this.requireScope(principal, 'manage:webhooks');
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    const rows = this.db
      .prepare(`SELECT * FROM alert_deliveries WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(principal.tenantId, bounded) as Row[];
    return rows.map((row) => {
      this.assertDeliveryPayloadHmac(row);
      return {
        delivery_id: text(row.delivery_id),
        webhook_id: text(row.webhook_id),
        alert_id: Number(row.alert_id),
        status: text(row.status) as AlertWebhookDelivery['status'],
        attempt_count: Number(row.attempt_count),
        next_attempt_at: text(row.next_attempt_at),
        last_attempt_at: row.last_attempt_at === null ? null : text(row.last_attempt_at),
        delivered_at: row.delivered_at === null ? null : text(row.delivered_at),
        response_status: row.response_status === null ? null : Number(row.response_status),
        error_code: row.error_code === null ? null : text(row.error_code),
        created_at: text(row.created_at),
      };
    });
  }
  redriveAlertWebhookDelivery(principal: Principal, deliveryId: string): boolean {
    this.requireScope(principal, 'manage:webhooks');
    return this.db.transaction(() => {
      const delivery = this.db
        .prepare('SELECT * FROM alert_deliveries WHERE tenant_id=? AND delivery_id=?')
        .get(principal.tenantId, deliveryId) as Row | undefined;
      if (!delivery) return false;
      this.assertDeliveryPayloadHmac(delivery);
      const webhook = this.db
        .prepare('SELECT * FROM alert_webhooks WHERE tenant_id=? AND webhook_id=?')
        .get(principal.tenantId, delivery.webhook_id) as Row | undefined;
      if (!webhook) return false;
      this.assertControlHmac(webhook, this.alertWebhookControlHmac(webhook), 'alert webhook');
      if (webhook.disabled_at !== null) return false;
      return (
        this.db
          .prepare(
            `UPDATE alert_deliveries SET status='pending',attempt_count=0,next_attempt_at=?,lease_id=NULL,lease_expires_at=NULL,last_attempt_at=NULL,delivered_at=NULL,response_status=NULL,error_code=NULL WHERE tenant_id=? AND delivery_id=? AND status='dead'`,
          )
          .run(now(), principal.tenantId, deliveryId).changes === 1
      );
    })();
  }
  claimDueAlertWebhookDeliveries(limit = 25): ClaimedAlertDelivery[] {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
    const claimedAt = now();
    const leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT d.*,w.label w_label,w.endpoint_hash w_endpoint_hash,w.encrypted_endpoint w_encrypted_endpoint,w.encrypted_signing_secret w_encrypted_signing_secret,w.created_at w_created_at,w.disabled_at w_disabled_at,w.control_hmac w_control_hmac FROM alert_deliveries d JOIN alert_webhooks w ON w.tenant_id=d.tenant_id AND w.webhook_id=d.webhook_id WHERE w.disabled_at IS NULL AND ((d.status='pending' AND d.next_attempt_at<=?) OR (d.status='processing' AND d.lease_expires_at<=?)) ORDER BY d.next_attempt_at,d.created_at LIMIT ?`,
        )
        .all(claimedAt, claimedAt, bounded) as Row[];
      const claims: ClaimedAlertDelivery[] = [];
      for (const row of rows) {
        this.assertDeliveryPayloadHmac(row);
        const webhookRow: Row = {
          webhook_id: row.webhook_id,
          tenant_id: row.tenant_id,
          label: row.w_label,
          endpoint_hash: row.w_endpoint_hash,
          encrypted_endpoint: row.w_encrypted_endpoint,
          encrypted_signing_secret: row.w_encrypted_signing_secret,
          created_at: row.w_created_at,
          disabled_at: row.w_disabled_at,
          control_hmac: row.w_control_hmac,
        };
        this.assertControlHmac(
          webhookRow,
          this.alertWebhookControlHmac(webhookRow),
          'alert webhook',
        );
        const leaseId = `lease_${randomUUID()}`;
        const updated = this.db
          .prepare(
            `UPDATE alert_deliveries SET status='processing',attempt_count=attempt_count+1,last_attempt_at=?,lease_id=?,lease_expires_at=? WHERE delivery_id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_expires_at<=?))`,
          )
          .run(claimedAt, leaseId, leaseExpiresAt, row.delivery_id, claimedAt, claimedAt).changes;
        if (updated !== 1) continue;
        try {
          const tenantId = text(row.tenant_id);
          const webhookId = text(row.webhook_id);
          claims.push({
            deliveryId: text(row.delivery_id),
            leaseId,
            endpoint: openSealedValue(
              this.config.masterSecret,
              `alert-webhook-endpoint-v1:${tenantId}:${webhookId}`,
              text(row.w_encrypted_endpoint),
            ),
            signingSecret: openSealedValue(
              this.config.masterSecret,
              `alert-webhook-secret-v1:${tenantId}:${webhookId}`,
              text(row.w_encrypted_signing_secret),
            ),
            payload: text(row.payload_json),
            attemptCount: Number(row.attempt_count) + 1,
          });
        } catch {
          this.db
            .prepare(
              `UPDATE alert_deliveries SET status='dead',lease_id=NULL,lease_expires_at=NULL,error_code='credential_decryption_failed' WHERE delivery_id=? AND lease_id=?`,
            )
            .run(row.delivery_id, leaseId);
        }
      }
      return claims;
    })();
  }
  finishAlertWebhookDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): 'delivered' | 'pending' | 'dead' | undefined {
    const row = this.db
      .prepare(
        `SELECT attempt_count FROM alert_deliveries WHERE delivery_id=? AND status='processing' AND lease_id=?`,
      )
      .get(input.deliveryId, input.leaseId) as Row | undefined;
    if (!row) return undefined;
    const attempts = Number(row.attempt_count);
    const maxAttempts = this.config.alertWebhookMaxAttempts ?? 8;
    const responseStatus = input.responseStatus ?? null;
    const errorCode = (input.errorCode ?? (input.delivered ? null : 'delivery_failed'))?.slice(
      0,
      128,
    );
    if (input.delivered)
      return this.db
        .prepare(
          `UPDATE alert_deliveries SET status='delivered',delivered_at=?,response_status=?,error_code=NULL,lease_id=NULL,lease_expires_at=NULL WHERE delivery_id=? AND status='processing' AND lease_id=?`,
        )
        .run(now(), responseStatus, input.deliveryId, input.leaseId).changes === 1
        ? 'delivered'
        : undefined;
    if (input.retryable && attempts < maxAttempts) {
      const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 11));
      return this.db
        .prepare(
          `UPDATE alert_deliveries SET status='pending',next_attempt_at=?,response_status=?,error_code=?,lease_id=NULL,lease_expires_at=NULL WHERE delivery_id=? AND status='processing' AND lease_id=?`,
        )
        .run(
          new Date(Date.now() + delaySeconds * 1_000).toISOString(),
          responseStatus,
          errorCode,
          input.deliveryId,
          input.leaseId,
        ).changes === 1
        ? 'pending'
        : undefined;
    }
    return this.db
      .prepare(
        `UPDATE alert_deliveries SET status='dead',response_status=?,error_code=?,lease_id=NULL,lease_expires_at=NULL WHERE delivery_id=? AND status='processing' AND lease_id=?`,
      )
      .run(responseStatus, errorCode, input.deliveryId, input.leaseId).changes === 1
      ? 'dead'
      : undefined;
  }
  private insertAlert(tenantId: string, kind: string, severity: string, detail: unknown): void {
    const createdAt = now();
    const result = this.db
      .prepare(
        'INSERT INTO alerts(tenant_id,kind,severity,detail_json,created_at) VALUES(?,?,?,?,?)',
      )
      .run(tenantId, kind, severity, JSON.stringify(detail), createdAt);
    const alertId = Number(result.lastInsertRowid);
    const payload = JSON.stringify({
      schema_version: '2026-07-20',
      event_type: 'schema_guard.alert',
      event_id: `alert_${randomUUID()}`,
      tenant_ref: hmac(this.config.masterSecret, 'alert-webhook-tenant-v1', tenantId),
      alert_id: alertId,
      kind,
      severity,
      created_at: createdAt,
      detail: privacySafeAlertDetail(kind, detail),
    });
    const endpoints = this.db
      .prepare(`SELECT * FROM alert_webhooks WHERE tenant_id=? AND disabled_at IS NULL`)
      .all(tenantId) as Row[];
    const enqueue = this.db.prepare(
      `INSERT INTO alert_deliveries(delivery_id,tenant_id,webhook_id,alert_id,payload_json,status,next_attempt_at,created_at,payload_hmac) VALUES(?,?,?,?,?,'pending',?,?,?)`,
    );
    for (const endpoint of endpoints) {
      this.assertControlHmac(endpoint, this.alertWebhookControlHmac(endpoint), 'alert webhook');
      const delivery: Row = {
        delivery_id: `delivery_${randomUUID()}`,
        tenant_id: tenantId,
        webhook_id: endpoint.webhook_id,
        alert_id: alertId,
        payload_json: payload,
        created_at: createdAt,
      };
      enqueue.run(
        delivery.delivery_id,
        delivery.tenant_id,
        delivery.webhook_id,
        delivery.alert_id,
        delivery.payload_json,
        createdAt,
        createdAt,
        this.alertDeliveryPayloadHmac(delivery),
      );
    }
    if (this.config.alertFile)
      void this.appendAlert({ tenant_id: tenantId, kind, severity, detail, created_at: createdAt });
  }
  private async appendAlert(alert: unknown): Promise<void> {
    if (!this.config.alertFile) return;
    await mkdir(dirname(this.config.alertFile), { recursive: true, mode: 0o700 });
    await appendFile(this.config.alertFile, `${JSON.stringify(alert)}\n`, { mode: 0o600 });
    await chmod(this.config.alertFile, 0o600);
  }
  purgeExpired(principal: Principal): number {
    this.requireScope(principal, 'admin');
    if (!this.verifyAuditChain(principal).valid)
      throw new ManagedError(
        409,
        'audit_chain_invalid',
        'refusing to purge an invalid audit chain',
      );
    return this.db.transaction(() => {
      let deleted = 0;
      const cutoff = new Date(Date.now() - principal.retentionDays * 86_400_000).toISOString();
      const boundary = this.db
        .prepare(
          `SELECT sequence,event_hash FROM audit_events WHERE tenant_id=? AND json_valid(envelope_json) AND json_extract(envelope_json,'$.timestamp')<? ORDER BY sequence DESC LIMIT 1`,
        )
        .get(principal.tenantId, cutoff) as Row | undefined;
      if (!boundary) return 0;
      const result = this.db
        .prepare('DELETE FROM audit_events WHERE tenant_id=? AND sequence<=?')
        .run(principal.tenantId, Number(boundary.sequence));
      const anchorSignature = this.auditAnchorSignature(
        principal.tenantId,
        String(boundary.event_hash),
        Number(boundary.sequence),
      );
      this.db
        .prepare(
          `INSERT INTO audit_chain_anchors(tenant_id,last_deleted_hash,deleted_through_sequence,updated_at,signature) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET last_deleted_hash=excluded.last_deleted_hash,deleted_through_sequence=excluded.deleted_through_sequence,updated_at=excluded.updated_at,signature=excluded.signature`,
        )
        .run(
          principal.tenantId,
          String(boundary.event_hash),
          Number(boundary.sequence),
          now(),
          anchorSignature,
        );
      deleted += result.changes;
      return deleted;
    })();
  }
}

function sameStringArray(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export class ManagedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
