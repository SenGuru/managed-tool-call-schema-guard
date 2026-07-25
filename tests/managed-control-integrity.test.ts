import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { createApprovalChallenge, validateToolCall } from '../packages/core/src/index.js';
import { hashApiKey } from '../packages/managed/src/crypto.js';
import { migrations } from '../packages/managed/src/migrations.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedError, ManagedStore } from '../packages/managed/src/store.js';

const secret = 'managed-control-integrity-secret-at-least-32-characters';

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-control-integrity-')), 'managed.db');
}

describe('managed control-plane integrity', () => {
  it('backfills existing version-11 control and operational rows only during migration', async () => {
    const path = await database();
    const legacy = new Database(path);
    for (const migration of migrations.filter(({ version }) => version <= 11)) {
      legacy.exec(migration.sql);
      legacy.pragma(`user_version = ${migration.version}`);
    }
    const timestamp = '2026-07-20T00:00:00.000Z';
    legacy
      .prepare(
        `INSERT INTO tenants(id,name,plan,monthly_limit,retention_days,created_at,policy_json) VALUES('a','A','team',100000,30,?,'{}')`,
      )
      .run(timestamp);
    legacy
      .prepare(
        `INSERT INTO api_keys(id,tenant_id,key_hash,prefix,scopes_json,created_at,revoked_at) VALUES('key-a','a',?,'legacy-key','["admin"]',?,NULL)`,
      )
      .run(hashApiKey(secret, 'legacy-key'), timestamp);
    legacy
      .prepare(
        `INSERT INTO environments(id,tenant_id,name,policy_json,created_at,updated_at,schema_enforcement) VALUES('env-a','a','production','{}',?,?,'observe')`,
      )
      .run(timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO action_descriptors(tenant_id,tool_name_hash,environment,risk_level,side_effect,created_at,updated_at) VALUES('a','tool-hash','production','high','reversible',?,?)`,
      )
      .run(timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO action_approvals(challenge_id,tenant_id,binding_hash,challenge_json,status,created_at,expires_at) VALUES('ach_legacy','a','binding','{}','pending',?,?)`,
      )
      .run(timestamp, '2027-07-20T00:00:00.000Z');
    legacy
      .prepare(
        `INSERT INTO action_idempotency(tenant_id,key_hash,execution_fingerprint,state,created_at,updated_at,reservation_id,audit_id,tool_name_hash,environment) VALUES('a','idempotency-hash','fingerprint','completed',?,?,'res_11111111-1111-4111-8111-111111111111','aud_legacy','tool-hash','production')`,
      )
      .run(timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO alert_webhooks(webhook_id,tenant_id,label,endpoint_hash,encrypted_endpoint,encrypted_signing_secret,created_at) VALUES('wh_legacy','a','oncall','endpoint-hash','sealed-endpoint','sealed-secret',?)`,
      )
      .run(timestamp);
    const alertId = Number(
      legacy
        .prepare(
          `INSERT INTO alerts(tenant_id,kind,severity,detail_json,created_at) VALUES('a','test','warning','{}',?)`,
        )
        .run(timestamp).lastInsertRowid,
    );
    legacy
      .prepare(
        `INSERT INTO alert_deliveries(delivery_id,tenant_id,webhook_id,alert_id,payload_json,status,next_attempt_at,created_at) VALUES('delivery_legacy','a','wh_legacy',?,'{}','dead',?,?)`,
      )
      .run(alertId, timestamp, timestamp);
    legacy.close();

    const store = new ManagedStore({ databasePath: path, masterSecret: secret });
    const principal = store.authenticate('legacy-key')!;
    expect(store.db.pragma('user_version', { simple: true })).toBe(17);
    expect(store.tenantLifecycle(principal)).toMatchObject({ status: 'active' });
    expect(store.verifyControlPlaneIntegrity(principal)).toEqual({ valid: true, checked: 12 });
    expect(
      store.db
        .prepare(
          `SELECT COUNT(*) count FROM pragma_table_info('action_idempotency') WHERE name='control_hmac'`,
        )
        .get(),
    ).toEqual({ count: 1 });
    store.close();
  });

  it('never treats post-migration null signing-key or audit-anchor trust as a backfill request', async () => {
    const signingPath = await database();
    new ManagedStore({ databasePath: signingPath, masterSecret: secret }).close();
    const signingRaw = new Database(signingPath);
    signingRaw.prepare('UPDATE signing_keys SET trust_hmac=NULL').run();
    signingRaw.close();
    expect(() => new ManagedStore({ databasePath: signingPath, masterSecret: secret })).toThrow(
      /signing-key trust record failed/u,
    );

    const anchorPath = await database();
    const anchorStore = new ManagedStore({ databasePath: anchorPath, masterSecret: secret });
    anchorStore.bootstrapTenant({
      id: 'a',
      name: 'A',
      plan: 'team',
      apiKey: 'admin-a',
      retentionDays: 1,
    });
    const principal = anchorStore.authenticate('admin-a')!;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    anchorStore.recordValidation(
      principal,
      validateToolCall({
        tool_name: 'search',
        tool_schema: { type: 'object', properties: {} },
        raw_arguments: {},
      }),
    );
    vi.useRealTimers();
    expect(anchorStore.purgeExpired(principal)).toBe(1);
    anchorStore.close();
    const anchorRaw = new Database(anchorPath);
    anchorRaw.prepare('UPDATE audit_chain_anchors SET signature=NULL').run();
    anchorRaw.close();
    expect(() => new ManagedStore({ databasePath: anchorPath, masterSecret: secret })).toThrow(
      /audit anchor failed integrity verification/u,
    );
  });

  it('authenticates API-key scopes and makes tampering visible to readiness and operators', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
      alertWebhookPollIntervalMs: 60_000,
    });
    try {
      service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
      const admin = service.store.authenticate('admin-a')!;
      const validator = service.store.issueApiKey(admin, ['validate']);
      service.store.db
        .prepare('UPDATE api_keys SET scopes_json=? WHERE id=?')
        .run('["admin"]', validator.key_id);
      expect(service.store.authenticate(validator.api_key)).toBeUndefined();
      expect(service.store.verifyControlPlaneIntegrity(admin)).toMatchObject({
        valid: false,
        first_invalid_table: 'api_keys',
        first_invalid_id: validator.key_id,
      });
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const base = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${base}/readyz`)).status).toBe(503);
      const integrity = await fetch(`${base}/v1/admin/control-plane-integrity`, {
        headers: { authorization: 'Bearer admin-a' },
      });
      expect(integrity.status).toBe(200);
      expect(await integrity.json()).toMatchObject({
        valid: false,
        first_invalid_table: 'api_keys',
      });
    } finally {
      await service.close();
    }
  });

  it('fails closed on tenant-policy, environment, and action-risk substitution', async () => {
    const tenantStore = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    tenantStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const tenantPrincipal = tenantStore.authenticate('admin-a')!;
    tenantStore.db
      .prepare("UPDATE tenants SET policy_json='{\"max_repairs\":0}' WHERE id='a'")
      .run();
    expect(tenantStore.authenticate('admin-a')).toBeUndefined();
    expect(tenantStore.verifyControlPlaneIntegrity(tenantPrincipal)).toMatchObject({
      valid: false,
      first_invalid_table: 'tenants',
    });
    tenantStore.close();

    const environmentStore = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
    });
    environmentStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const environmentPrincipal = environmentStore.authenticate('admin-a')!;
    environmentStore.db
      .prepare(
        "UPDATE environments SET schema_enforcement='enforce' WHERE tenant_id='a' AND name='production'",
      )
      .run();
    expect(() =>
      environmentStore.schemaAdmission(environmentPrincipal, 'production', 'search', {
        type: 'object',
      }),
    ).toThrow(ManagedError);
    environmentStore.close();

    const actionStore = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    actionStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const actionPrincipal = actionStore.authenticate('admin-a')!;
    actionStore.registerActionDescriptor(
      actionPrincipal,
      'transfer',
      'production',
      'critical',
      'irreversible',
    );
    actionStore.db
      .prepare(
        "UPDATE action_descriptors SET risk_level='read',side_effect='none' WHERE tenant_id='a'",
      )
      .run();
    expect(() => actionStore.actionDescriptor(actionPrincipal, 'transfer', 'production')).toThrow(
      ManagedError,
    );
    actionStore.close();
  });

  it('keeps legitimate mutations trusted and refuses post-migration null trust on restart', async () => {
    const path = await database();
    const store = new ManagedStore({ databasePath: path, masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    const issued = store.issueApiKey(principal, ['validate']);
    store.updateTenantPolicy(principal, { max_repairs: 2 });
    store.updatePlan(principal, 'trial');
    const staging = store
      .listEnvironments(principal)
      .find((environment) => environment.name === 'staging')!;
    store.updateEnvironmentPolicy(principal, String(staging.id), { require_closed_schema: true });
    store.updateEnvironmentSchemaEnforcement(principal, String(staging.id), 'enforce');
    store.registerActionDescriptor(principal, 'search', 'staging', 'high', 'reversible');
    expect(store.revokeApiKey(principal, issued.key_id)).toBe(true);
    expect(store.verifyControlPlaneIntegrity(principal)).toEqual({ valid: true, checked: 11 });
    store.close();

    const raw = new Database(path);
    raw
      .prepare("UPDATE environments SET control_hmac=NULL WHERE tenant_id='a' AND name='staging'")
      .run();
    raw.close();
    expect(() => new ManagedStore({ databasePath: path, masterSecret: secret })).toThrow(
      /control-plane integrity/u,
    );
  });

  it('keeps tenant-scoped integrity details isolated while readiness remains global', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    store.bootstrapTenant({ id: 'b', name: 'B', plan: 'team', apiKey: 'admin-b' });
    const tenantA = store.authenticate('admin-a')!;
    const tenantB = store.authenticate('admin-b')!;
    store.db
      .prepare(
        "UPDATE environments SET schema_enforcement='enforce' WHERE tenant_id='b' AND name='production'",
      )
      .run();
    expect(store.verifyControlPlaneIntegrity(tenantA)).toEqual({ valid: true, checked: 9 });
    expect(store.verifyControlPlaneIntegrity(tenantB)).toMatchObject({
      valid: false,
      first_invalid_table: 'environments',
    });
    expect(store.readinessCheck()).toBe(false);
    store.close();
  });

  it('rejects approval revival and idempotency-state substitution', async () => {
    const approvalStore = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
    });
    approvalStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = approvalStore.authenticate('admin-a')!;
    approvalStore.registerActionDescriptor(principal, 'search', 'production', 'high', 'reversible');
    const decision = approvalStore.recordValidation(
      principal,
      validateToolCall({
        tool_name: 'search',
        tool_schema: {
          type: 'object',
          additionalProperties: false,
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        raw_arguments: { query: 'status' },
      }),
    );
    const created = new Date();
    const challenge = createApprovalChallenge({
      decision,
      action: approvalStore.actionDescriptor(principal, 'search', 'production'),
      environment: 'production',
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + 60_000).toISOString(),
    });
    approvalStore.recordActionChallenge(principal, challenge);
    approvalStore.approveActionChallenge(principal, challenge.challenge_id);
    approvalStore.revokeActionChallenge(principal, challenge.challenge_id);
    approvalStore.db
      .prepare("UPDATE action_approvals SET status='approved' WHERE challenge_id=?")
      .run(challenge.challenge_id);
    expect(() => approvalStore.approveActionChallenge(principal, challenge.challenge_id)).toThrow(
      /integrity verification failed/u,
    );
    expect(approvalStore.verifyControlPlaneIntegrity(principal)).toMatchObject({
      valid: false,
      first_invalid_table: 'action_approvals',
    });
    approvalStore.close();

    const idempotencyStore = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
    });
    idempotencyStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const idempotencyPrincipal = idempotencyStore.authenticate('admin-a')!;
    const ledger = idempotencyStore.actionIdempotencyLedger(idempotencyPrincipal);
    expect(ledger.reserve('mutation-1', `sha256:${'1'.repeat(64)}`)).toBe('new');
    idempotencyStore.db.prepare("UPDATE action_idempotency SET state='completed'").run();
    expect(() => ledger.reserve('mutation-1', `sha256:${'1'.repeat(64)}`)).toThrow(
      /integrity verification failed/u,
    );
    expect(idempotencyStore.verifyControlPlaneIntegrity(idempotencyPrincipal)).toMatchObject({
      valid: false,
      first_invalid_table: 'action_idempotency',
    });
    idempotencyStore.close();
  });

  it('detects deleted idempotency memory both live and during restart', async () => {
    const livePath = await database();
    const liveStore = new ManagedStore({ databasePath: livePath, masterSecret: secret });
    liveStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    liveStore.bootstrapTenant({ id: 'b', name: 'B', plan: 'team', apiKey: 'admin-b' });
    const tenantA = liveStore.authenticate('admin-a')!;
    const tenantB = liveStore.authenticate('admin-b')!;
    const tenantBLedger = liveStore.actionIdempotencyLedger(tenantB);
    const fingerprint = `sha256:${'8'.repeat(64)}`;
    expect(tenantBLedger.reserve('completed-mutation', fingerprint)).toBe('new');
    tenantBLedger.complete('completed-mutation', fingerprint);

    const externalWriter = new Database(livePath);
    externalWriter.prepare("DELETE FROM action_idempotency WHERE tenant_id='b'").run();
    externalWriter.close();
    expect(() =>
      liveStore
        .actionIdempotencyLedger(tenantA)
        .reserve('unrelated-mutation', `sha256:${'9'.repeat(64)}`),
    ).toThrow(/deletion or substitution was detected/u);
    expect(liveStore.verifyControlPlaneIntegrity(tenantB)).toMatchObject({
      valid: false,
      first_invalid_table: 'action_idempotency_manifests',
    });
    liveStore.close();

    const restartPath = await database();
    const restartStore = new ManagedStore({ databasePath: restartPath, masterSecret: secret });
    restartStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const restartPrincipal = restartStore.authenticate('admin-a')!;
    const restartLedger = restartStore.actionIdempotencyLedger(restartPrincipal);
    expect(restartLedger.reserve('completed-mutation', fingerprint)).toBe('new');
    restartLedger.complete('completed-mutation', fingerprint);
    restartStore.close();
    const offlineWriter = new Database(restartPath);
    offlineWriter.prepare('DELETE FROM action_idempotency').run();
    offlineWriter.close();
    expect(() => new ManagedStore({ databasePath: restartPath, masterSecret: secret })).toThrow(
      /idempotency manifest failed integrity verification/u,
    );
  });

  it('detects restoration of an older internally valid idempotency checkpoint', async () => {
    const sourcePath = await database();
    const olderBackupPath = await database();
    const source = new ManagedStore({ databasePath: sourcePath, masterSecret: secret });
    source.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = source.authenticate('admin-a')!;
    const ledger = source.actionIdempotencyLedger(principal);
    const fingerprint = `sha256:${'7'.repeat(64)}`;
    expect(ledger.reserve('mutation', fingerprint)).toBe('new');
    await source.backup(olderBackupPath);
    ledger.complete('mutation', fingerprint);
    const externallyRetained = source.actionIdempotencyCheckpoint(principal);
    expect(externallyRetained.revision).toBe(2);
    source.close();

    const restored = new ManagedStore({ databasePath: olderBackupPath, masterSecret: secret });
    const restoredPrincipal = restored.authenticate('admin-a')!;
    expect(
      restored.compareActionIdempotencyCheckpoint(restoredPrincipal, externallyRetained),
    ).toMatchObject({
      status: 'rollback_detected',
      anchored_revision: 2,
      current_revision: 1,
    });
    restored.close();
  });

  it('detects divergent same-revision idempotency histories', async () => {
    const sourcePath = await database();
    const forkPath = await database();
    const source = new ManagedStore({ databasePath: sourcePath, masterSecret: secret });
    source.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    await source.backup(forkPath);
    const sourcePrincipal = source.authenticate('admin-a')!;
    expect(
      source
        .actionIdempotencyLedger(sourcePrincipal)
        .reserve('source-mutation', `sha256:${'4'.repeat(64)}`),
    ).toBe('new');
    const sourceCheckpoint = source.actionIdempotencyCheckpoint(sourcePrincipal);
    expect(sourceCheckpoint.revision).toBe(1);

    const fork = new ManagedStore({ databasePath: forkPath, masterSecret: secret });
    const forkPrincipal = fork.authenticate('admin-a')!;
    expect(
      fork
        .actionIdempotencyLedger(forkPrincipal)
        .reserve('fork-mutation', `sha256:${'5'.repeat(64)}`),
    ).toBe('new');
    expect(fork.compareActionIdempotencyCheckpoint(forkPrincipal, sourceCheckpoint)).toMatchObject({
      status: 'integrity_conflict',
      anchored_revision: 1,
      current_revision: 1,
    });
    fork.close();
    source.close();
  });

  it('rejects webhook enablement and queued-payload substitution', async () => {
    const webhookStore = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    webhookStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = webhookStore.authenticate('admin-a')!;
    const webhook = webhookStore.createAlertWebhook(
      principal,
      'oncall',
      'https://alerts.example.com/schema-guard',
    );
    webhookStore.disableAlertWebhook(principal, webhook.webhook_id);
    webhookStore.db
      .prepare('UPDATE alert_webhooks SET disabled_at=NULL WHERE webhook_id=?')
      .run(webhook.webhook_id);
    expect(() => webhookStore.listAlertWebhooks(principal)).toThrow(
      /integrity verification failed/u,
    );
    expect(webhookStore.readinessCheck()).toBe(false);
    webhookStore.close();

    const deliveryStore = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
    });
    deliveryStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const deliveryPrincipal = deliveryStore.authenticate('admin-a')!;
    deliveryStore.createAlertWebhook(
      deliveryPrincipal,
      'oncall',
      'https://alerts.example.com/schema-guard',
    );
    deliveryStore.recordValidation(
      deliveryPrincipal,
      validateToolCall({
        tool_name: 'search',
        tool_schema: {
          type: 'object',
          additionalProperties: false,
          properties: { count: { type: 'integer' } },
          required: ['count'],
        },
        raw_arguments: { count: 'not-an-integer' },
      }),
    );
    deliveryStore.db.prepare("UPDATE alert_deliveries SET payload_json='{}'").run();
    expect(() => deliveryStore.listAlertWebhookDeliveries(deliveryPrincipal)).toThrow(
      /payload integrity verification failed/u,
    );
    expect(deliveryStore.verifyControlPlaneIntegrity(deliveryPrincipal)).toMatchObject({
      valid: false,
      first_invalid_table: 'alert_deliveries',
    });
    deliveryStore.close();
  });
});
