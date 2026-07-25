#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createApprovalChallenge, sha256, validateToolCall } from '../packages/core/dist/index.js';
import { hmac } from '../packages/managed/dist/crypto.js';
import { environmentValue } from '../packages/managed/dist/environment.js';
import { ManagedStore } from '../packages/managed/dist/store.js';

const countedTables = [
  'tenants',
  'api_keys',
  'audit_events',
  'audit_chain_anchors',
  'tool_schemas',
  'usage_monthly',
  'failure_clusters',
  'conformance_runs',
  'environments',
  'tenant_lifecycle',
  'action_controls',
  'action_approvals',
  'action_descriptors',
  'action_idempotency',
  'action_idempotency_manifests',
  'checkpoint_anchor_deliveries',
  'action_reconciliations',
  'tenant_rulesets',
  'alerts',
  'alert_webhooks',
  'alert_deliveries',
  'schema_releases',
];

function argumentsFrom(argv, masterSecret) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--source') options.source = argv[++index];
    else if (item === '--backup') options.backup = argv[++index];
    else if (item === '--report') options.report = argv[++index];
    else throw new TypeError(`unknown argument: ${item}`);
  }
  if (options.source && !masterSecret)
    throw new TypeError(
      'SCHEMA_GUARD_MASTER_SECRET or SCHEMA_GUARD_MASTER_SECRET_FILE is required with --source',
    );
  if (options.source && !existsSync(resolve(options.source)))
    throw new TypeError('the --source database does not exist');
  if (options.backup && existsSync(resolve(options.backup)))
    throw new TypeError('refusing to overwrite the --backup destination');
  return options;
}

function countRows(database) {
  const present = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => String(row.name)),
  );
  return Object.fromEntries(
    countedTables.map((table) => [
      table,
      present.has(table)
        ? Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)
        : 0,
    ]),
  );
}

function principalFrom(row) {
  return {
    tenantId: String(row.id),
    tenantName: String(row.name),
    keyId: 'recovery-drill',
    scopes: ['admin', 'reconcile:action'],
    plan: String(row.plan),
    monthlyLimit: Number(row.monthly_limit),
    retentionDays: Number(row.retention_days),
    policy: JSON.parse(String(row.policy_json)),
  };
}

function integrityEvidence(store) {
  const tenants = store.db
    .prepare(
      'SELECT id,name,plan,monthly_limit,retention_days,policy_json FROM tenants ORDER BY id',
    )
    .all();
  return tenants.map((row) => {
    const principal = principalFrom(row);
    return {
      tenant_id: principal.tenantId,
      control_plane: store.verifyControlPlaneIntegrity(principal),
      action_idempotency_checkpoint: store.actionIdempotencyCheckpoint(principal),
      audit_chain: store.verifyAuditChain(principal),
      action_reconciliation_chain: store.verifyActionReconciliationHistory(principal),
      schema_release_chain: store.verifySchemaReleaseHistory(principal),
    };
  });
}

function ageReservation(store, masterSecret, tenantId, reservationId, ageMs) {
  const xor = (left, right) => {
    const a = Buffer.from(left.slice(7), 'hex');
    const b = Buffer.from(right.slice(7), 'hex');
    const output = Buffer.alloc(32);
    for (let index = 0; index < output.length; index += 1) output[index] = a[index] ^ b[index];
    return `xor256:${output.toString('hex')}`;
  };
  const member = (keyHash, controlHmac) =>
    `xor256:${sha256({ key_hash: keyHash, control_hmac: controlHmac }).slice(7)}`;
  store.db.transaction(() => {
    const row = store.db
      .prepare('SELECT * FROM action_idempotency WHERE tenant_id=? AND reservation_id=?')
      .get(tenantId, reservationId);
    const manifest = store.db
      .prepare('SELECT * FROM action_idempotency_manifests WHERE tenant_id=?')
      .get(tenantId);
    if (!row || !manifest) throw new Error('recovery drill reservation manifest missing');
    const expectedManifestHmac = hmac(masterSecret, 'managed-action-idempotency-manifest-v1', {
      tenant_id: manifest.tenant_id,
      revision: Number(manifest.revision),
      row_count: Number(manifest.row_count),
      accumulator: manifest.accumulator,
      updated_at: manifest.updated_at,
    });
    if (manifest.control_hmac !== expectedManifestHmac)
      throw new Error('recovery drill reservation manifest was invalid before aging');
    const updatedAt = new Date(Date.now() - ageMs).toISOString();
    const controlHmac = hmac(masterSecret, 'managed-action-idempotency-control-v1', {
      tenant_id: row.tenant_id,
      key_hash: row.key_hash,
      execution_fingerprint: row.execution_fingerprint,
      state: row.state,
      created_at: row.created_at,
      updated_at: updatedAt,
      reservation_id: row.reservation_id ?? null,
      audit_id: row.audit_id ?? null,
      tool_name_hash: row.tool_name_hash ?? null,
      environment: row.environment ?? null,
    });
    const accumulator = xor(
      xor(String(manifest.accumulator), member(row.key_hash, row.control_hmac)),
      member(row.key_hash, controlHmac),
    );
    const revision = Number(manifest.revision) + 1;
    const manifestHmac = hmac(masterSecret, 'managed-action-idempotency-manifest-v1', {
      tenant_id: manifest.tenant_id,
      revision,
      row_count: Number(manifest.row_count),
      accumulator,
      updated_at: updatedAt,
    });
    store.db
      .prepare(
        'UPDATE action_idempotency SET updated_at=?,control_hmac=? WHERE tenant_id=? AND reservation_id=?',
      )
      .run(updatedAt, controlHmac, tenantId, reservationId);
    store.db
      .prepare(
        'UPDATE action_idempotency_manifests SET revision=?,accumulator=?,updated_at=?,control_hmac=? WHERE tenant_id=?',
      )
      .run(revision, accumulator, updatedAt, manifestHmac, tenantId);
  })();
}

function seed(store, masterSecret) {
  store.bootstrapTenant({
    id: 'recovery-drill',
    name: 'Recovery Drill',
    plan: 'trial',
    apiKey: 'recovery-drill-admin-key',
  });
  const principal = store.authenticate('recovery-drill-admin-key');
  if (!principal) throw new Error('recovery drill could not authenticate its seeded tenant');
  store.createAlertWebhook(
    principal,
    'recovery-drill-webhook',
    'https://alerts.example.com/recovery-drill',
  );
  const request = {
    tool_name: 'transfer',
    tool_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { amount: { type: 'integer', minimum: 1 } },
      required: ['amount'],
    },
    raw_arguments: { amount: '7' },
  };
  const decision = store.recordValidation(principal, validateToolCall(request), {
    adapter: 'json_schema',
    provider: 'recovery-drill',
    framework: 'operator-drill',
  });
  const registered = store.registerSchema(principal, {
    tool_name: 'transfer',
    adapter: 'json_schema',
    version: 'drill-v1',
    schema: request.tool_schema,
  });
  store.promoteSchemaRelease(principal, {
    tool_name: 'transfer',
    version: 'drill-v1',
    environment: 'production',
    expected_schema_hash: registered.schema_hash,
  });
  store.registerActionDescriptor(principal, 'transfer', 'production', 'high', 'irreversible');
  const created = new Date();
  const challenge = createApprovalChallenge({
    decision,
    action: store.actionDescriptor(principal, 'transfer', 'production'),
    environment: 'production',
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + 3_600_000).toISOString(),
  });
  store.recordActionChallenge(principal, challenge);
  const approval = store.approveActionChallenge(principal, challenge.challenge_id);
  const gate = store.evaluateManagedAction({
    principal,
    decision,
    toolName: 'transfer',
    environment: 'production',
    context: { approval, idempotency_key: 'recovery-drill-idempotency-key' },
  });
  if (gate.status !== 'allowed' || !gate.reservation?.reservation_id)
    throw new Error('recovery drill could not create a managed reservation');
  ageReservation(store, masterSecret, principal.tenantId, gate.reservation.reservation_id, 600_000);
  store.reconcileActionReservation(
    principal,
    gate.reservation.reservation_id,
    'confirmed_executed',
    'self-contained-recovery-drill-evidence',
  );
}

function digest(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

export async function runManagedRecoveryDrill(argv = process.argv.slice(2)) {
  const configuredMasterSecret = environmentValue('SCHEMA_GUARD_MASTER_SECRET');
  const options = argumentsFrom(argv, configuredMasterSecret);
  const temporary = await mkdtemp(join(tmpdir(), 'schema-guard-recovery-drill.'));
  const sourcePath = resolve(options.source ?? join(temporary, 'source.db'));
  const backupPath = resolve(options.backup ?? join(temporary, 'restored.db'));
  const masterSecret =
    configuredMasterSecret ?? 'self-contained-recovery-drill-master-secret-0123456789-0123456789';
  const managedConfig = (databasePath, withAnchor) => ({
    databasePath,
    masterSecret,
    ...(withAnchor
      ? {
          actionCheckpointAnchorUrl: 'https://anchor.example.com/recovery-drill',
          actionCheckpointAnchorSigningSecret:
            'recovery-drill-anchor-signing-secret-at-least-32-characters',
        }
      : {}),
  });
  await mkdir(dirname(sourcePath), { recursive: true, mode: 0o700 });
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });

  let sourceIntegrity;
  let sourceCounts;
  if (options.source) {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    source.pragma('query_only = ON');
    const rows = source.pragma('integrity_check');
    sourceIntegrity = rows.length === 1 && rows[0]?.integrity_check === 'ok';
    sourceCounts = countRows(source);
    await source.backup(backupPath);
    await chmod(backupPath, 0o600);
    source.close();
  } else {
    const seeding = new ManagedStore(managedConfig(sourcePath, false));
    seed(seeding, masterSecret);
    seeding.close();
    const source = new ManagedStore(managedConfig(sourcePath, true));
    sourceIntegrity = source.integrityCheck();
    await source.backup(backupPath);
    sourceCounts = countRows(source.db);
    source.close();
  }

  const restored = new ManagedStore(managedConfig(backupPath, !options.source));
  const restoredIntegrity = restored.integrityCheck();
  const restoredCounts = countRows(restored.db);
  const chains = integrityEvidence(restored);
  restored.close();

  const mode = statSync(backupPath).mode & 0o777;
  const countsMatch = JSON.stringify(sourceCounts) === JSON.stringify(restoredCounts);
  const chainsValid = chains.every(
    (tenant) =>
      tenant.control_plane.valid &&
      tenant.audit_chain.valid &&
      tenant.action_reconciliation_chain.valid &&
      tenant.schema_release_chain.valid,
  );
  const report = {
    report_version: '1',
    executed_at: new Date().toISOString(),
    mode: options.source ? 'operator_database' : 'self_contained',
    source_label: basename(sourcePath),
    backup_label: basename(backupPath),
    backup_hash: digest(backupPath),
    backup_owner_only: mode === 0o600,
    source_integrity: sourceIntegrity,
    restored_integrity: restoredIntegrity,
    row_counts_match: countsMatch,
    row_counts: restoredCounts,
    tenant_integrity: chains,
    passed: sourceIntegrity && restoredIntegrity && countsMatch && chainsValid && mode === 0o600,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.report) {
    const reportPath = resolve(options.report);
    await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
    await writeFile(reportPath, serialized, { mode: 0o600 });
  }
  process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runManagedRecoveryDrill().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ passed: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  });
