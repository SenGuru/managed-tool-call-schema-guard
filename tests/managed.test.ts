import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateToolCall, verifyRepairReceipt } from '../packages/core/src/index.js';
import { createManagedServer, validateManagedConfig } from '../packages/managed/src/server.js';
import { FixedWindowRateLimiter } from '../packages/managed/src/rate-limit.js';
import { ManagedError, ManagedStore } from '../packages/managed/src/store.js';

const secret = 'test-master-secret-that-is-at-least-32-characters';
const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const service of open.splice(0)) await service.close();
});
async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-managed-')), 'managed.db');
}
describe('managed local control plane', () => {
  it('emits privacy-safe structured access logs and response correlation IDs', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
      accessLog: true,
    });
    open.push(service);
    service.store.bootstrapTenant({ id: 'logs', name: 'Logs', plan: 'trial', apiKey: 'log-key' });
    const principal = service.store.authenticate('log-key')!;
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/v1/admin/api-keys/${principal.keyId}`,
        { method: 'DELETE', headers: { authorization: 'Bearer log-key' } },
      );
      expect(response.status).toBe(409);
      expect(response.headers.get('x-request-id')).toMatch(/^req_[0-9a-f-]{36}$/u);
      const access = log.mock.calls
        .map(([message]) => JSON.parse(String(message)) as Record<string, unknown>)
        .find((entry) => entry.event === 'http_request_completed');
      expect(access).toMatchObject({
        level: 'info',
        service: 'schema-guard-managed',
        method: 'DELETE',
        route: '/v1/admin/api-keys/:id',
        status: 409,
      });
      expect(JSON.stringify(access)).not.toContain(principal.keyId);
    } finally {
      log.mockRestore();
    }
  });

  it('does not let a public tenant self-upgrade without a verified billing workflow', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: 'public-mode-secret-that-is-long-enough-public-mode-secret-that-is-long-enough',
      publicMode: true,
      instanceCount: 1,
      externalUrl: 'https://app.invokeguard.example',
      trustProxy: true,
      actionCheckpointAnchorUrl: 'https://anchor.invokeguard.example/checkpoints',
      actionCheckpointAnchorSigningSecret:
        'public-anchor-signing-secret-that-is-at-least-32-characters',
      actionCheckpointAnchorRequestTimeoutMs: 3_000,
      requestTimeoutMs: 5000,
      rateLimitPerMinute: 600,
    });
    open.push(service);
    service.store.bootstrapTenant({ id: 'billing', name: 'Billing', plan: 'trial', apiKey: 'key' });
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/admin/plan`, {
      method: 'PUT',
      headers: { authorization: 'Bearer key', 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team' }),
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: 'billing_integration_required' });
    expect(service.store.authenticate('key')?.plan).toBe('trial');
  });

  it('fails closed when public-mode production controls are missing', async () => {
    const base = {
      databasePath: await database(),
      masterSecret: 'public-mode-secret-that-is-long-enough-public-mode-secret-that-is-long-enough',
      publicMode: true,
      instanceCount: 1,
      externalUrl: 'https://app.invokeguard.example',
      trustProxy: true,
      actionCheckpointAnchorUrl: 'https://anchor.invokeguard.example/checkpoints',
      actionCheckpointAnchorSigningSecret:
        'public-anchor-signing-secret-that-is-at-least-32-characters',
      actionCheckpointAnchorRequestTimeoutMs: 3_000,
      requestTimeoutMs: 5000,
      rateLimitPerMinute: 600,
    };
    expect(() => validateManagedConfig(base)).not.toThrow();
    expect(() => validateManagedConfig({ ...base, instanceCount: 2 })).toThrow(
      /every managed state path is transactional and shared/u,
    );
    expect(() =>
      validateManagedConfig({
        databasePath: '/tmp/schema-guard-private.db',
        masterSecret: 'private-mode-secret-that-is-at-least-32-characters',
        instanceCount: 2,
      }),
    ).toThrow(/must remain 1/u);
    expect(() =>
      validateManagedConfig({ ...base, sharedActionDatabaseUrl: 'https://database.example' }),
    ).toThrow(/PostgreSQL URL/u);
    expect(() =>
      validateManagedConfig({ ...base, sharedControlDatabaseUrl: 'https://database.example' }),
    ).toThrow(/PostgreSQL URL/u);
    expect(() =>
      validateManagedConfig({
        databasePath: '/tmp/schema-guard-private.db',
        masterSecret: 'private-mode-secret-that-is-at-least-32-characters',
        stripeSecretKey: 'sk_test_partial',
      }),
    ).toThrow(/requires secret key, webhook secret/u);
    const stripe = {
      stripeMode: 'sandbox' as const,
      stripeSecretKey: 'sk_test_configuration',
      stripeWebhookSecret: 'whsec_configuration',
      stripeTeamPriceId: 'price_test_team',
      stripeCheckoutSuccessUrl: 'https://akriven.com/account/billing/success',
      stripeCheckoutCancelUrl: 'https://akriven.com/account/billing',
      stripePortalReturnUrl: 'https://akriven.com/account/billing',
    };
    expect(() =>
      validateManagedConfig({
        databasePath: '/tmp/schema-guard-private.db',
        masterSecret: 'private-mode-secret-that-is-at-least-32-characters',
        ...stripe,
      }),
    ).toThrow(/requires shared PostgreSQL/u);
    expect(() =>
      validateManagedConfig({
        databasePath: '/tmp/schema-guard-private.db',
        masterSecret: 'private-mode-secret-that-is-at-least-32-characters',
        sharedControlDatabaseUrl: 'postgresql://database.example/schema_guard?sslmode=verify-full',
        ...stripe,
      }),
    ).not.toThrow();
    expect(() =>
      validateManagedConfig({
        ...base,
        sharedActionDatabaseUrl: 'postgresql://database.example/schema_guard?sslmode=verify-full',
      }),
    ).not.toThrow();
    expect(() =>
      validateManagedConfig({
        ...base,
        sharedControlDatabaseUrl: 'postgresql://database.example/schema_guard?sslmode=verify-full',
      }),
    ).not.toThrow();
    expect(() =>
      validateManagedConfig({
        ...base,
        sharedActionDatabaseUrl: 'postgresql://database.example/schema_guard',
      }),
    ).toThrow(/sslmode/u);
    expect(() =>
      validateManagedConfig({
        ...base,
        sharedControlDatabaseUrl: 'postgresql://database.example/schema_guard',
      }),
    ).toThrow(/sslmode/u);
    for (const invalid of [0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => validateManagedConfig({ ...base, instanceCount: invalid })).toThrow(
        /INSTANCE_COUNT/u,
      );
    expect(() =>
      validateManagedConfig({ ...base, actionCheckpointAnchorSigningSecret: undefined }),
    ).toThrow(/configured together/u);
    expect(() =>
      validateManagedConfig({ ...base, actionCheckpointAnchorUrl: 'http://localhost/checkpoints' }),
    ).toThrow(/public HTTPS URL/u);
    expect(() =>
      validateManagedConfig({ ...base, actionCheckpointAnchorSigningSecret: 'too-short' }),
    ).toThrow(/at least 32/u);
    expect(() => validateManagedConfig({ ...base, externalUrl: 'http://example.com' })).toThrow(
      /https/u,
    );
    expect(() => validateManagedConfig({ ...base, trustProxy: false })).toThrow(/TRUST_PROXY/u);
    expect(() =>
      validateManagedConfig({
        ...base,
        masterSecret: 'too-short-for-public-mode-but-local-valid',
      }),
    ).toThrow(/64/u);
    expect(() => validateManagedConfig({ ...base, requestTimeoutMs: 20_000 })).toThrow(/timeout/u);
    expect(() =>
      validateManagedConfig({ ...base, actionCheckpointAnchorRequestTimeoutMs: 5_000 }),
    ).toThrow(/must be lower/u);
    expect(() => validateManagedConfig({ ...base, rateLimitPerMinute: 601 })).toThrow(
      /rate limit/u,
    );
    expect(() =>
      validateManagedConfig({ ...base, actionReconciliationMinAgeSeconds: 300 }),
    ).not.toThrow();
    expect(() =>
      validateManagedConfig({
        ...base,
        alertWebhookPollIntervalMs: 5_000,
        alertWebhookRequestTimeoutMs: 5_000,
        alertWebhookMaxAttempts: 8,
      }),
    ).not.toThrow();
    for (const invalid of [59, 86_401, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(() =>
        validateManagedConfig({ ...base, actionReconciliationMinAgeSeconds: invalid }),
      ).toThrow(/ACTION_RECONCILIATION_MIN_AGE/u);
    for (const invalid of [99, 60_001, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(() => validateManagedConfig({ ...base, alertWebhookPollIntervalMs: invalid })).toThrow(
        /ALERT_WEBHOOK_POLL_INTERVAL/u,
      );
    for (const invalid of [499, 10_001, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(() =>
        validateManagedConfig({ ...base, alertWebhookRequestTimeoutMs: invalid }),
      ).toThrow(/ALERT_WEBHOOK_REQUEST_TIMEOUT/u);
    for (const invalid of [0, 21, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(() => validateManagedConfig({ ...base, alertWebhookMaxAttempts: invalid })).toThrow(
        /ALERT_WEBHOOK_MAX_ATTEMPTS/u,
      );
    for (const invalid of [99, 60_001, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(() =>
        validateManagedConfig({ ...base, actionCheckpointAnchorPollIntervalMs: invalid }),
      ).toThrow(/ACTION_CHECKPOINT_ANCHOR_POLL_INTERVAL/u);
    for (const invalid of [499, 10_001, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(() =>
        validateManagedConfig({ ...base, actionCheckpointAnchorRequestTimeoutMs: invalid }),
      ).toThrow(/ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT/u);
    for (const invalid of [0, 21, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(() =>
        validateManagedConfig({ ...base, actionCheckpointAnchorMaxAttempts: invalid }),
      ).toThrow(/ACTION_CHECKPOINT_ANCHOR_MAX_ATTEMPTS/u);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5]) {
      expect(() => validateManagedConfig({ ...base, requestTimeoutMs: invalid })).toThrow(
        /positive finite integer/u,
      );
      expect(() => validateManagedConfig({ ...base, rateLimitPerMinute: invalid })).toThrow(
        /positive finite integer/u,
      );
    }
  });

  it('authenticates keys without storing plaintext and isolates tenant audits', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'Tenant A', plan: 'trial', apiKey: 'sg_live_tenant_a' });
    store.bootstrapTenant({ id: 'b', name: 'Tenant B', plan: 'trial', apiKey: 'sg_live_tenant_b' });
    const a = store.authenticate('sg_live_tenant_a')!;
    const b = store.authenticate('sg_live_tenant_b')!;
    expect(store.authenticate('wrong')).toBeUndefined();
    expect(JSON.stringify(store.db.prepare('SELECT * FROM api_keys').all())).not.toContain(
      'sg_live_tenant_a',
    );
    const decision = validateToolCall({
      tool_name: 'counter',
      tool_schema: {
        type: 'object',
        required: ['count'],
        properties: { count: { type: 'integer' } },
      },
      raw_arguments: { count: '2' },
    });
    store.consumeValidation(a);
    store.recordDecision(a, decision);
    expect(store.listAudits(a)).toHaveLength(1);
    expect(store.listAudits(b)).toHaveLength(0);
    store.close();
  });

  it('uses tenant-scoped audit and repair hashes for identical decisions', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'Tenant A', plan: 'trial', apiKey: 'key-a' });
    store.bootstrapTenant({ id: 'b', name: 'Tenant B', plan: 'trial', apiKey: 'key-b' });
    const request = {
      tool_name: 'counter',
      tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
      raw_arguments: { count: '2' },
    } as const;
    const a = store.recordValidation(store.authenticate('key-a')!, validateToolCall(request));
    const b = store.recordValidation(store.authenticate('key-b')!, validateToolCall(request));
    expect(a.audit.arguments_hash).toMatch(/^hmac-sha256:/u);
    expect(a.audit.arguments_hash).not.toBe(b.audit.arguments_hash);
    expect(a.audit.tool_name_hash).not.toBe(b.audit.tool_name_hash);
    expect(a.audit.schema_hash).not.toBe(b.audit.schema_hash);
    expect(a.policy_result.applied_policy_hash).toBe(a.audit.policy_hash);
    expect(a.repaired_fields[0]?.original_value_hash).not.toBe(
      b.repaired_fields[0]?.original_value_hash,
    );
    expect(a.repaired_fields[0]?.output_value_hash).not.toBe(
      b.repaired_fields[0]?.output_value_hash,
    );
    expect(a.repaired_fields[0]?.schema_fragment_hash).not.toBe(
      b.repaired_fields[0]?.schema_fragment_hash,
    );
    expect(a.repaired_fields.every(verifyRepairReceipt)).toBe(true);
    expect(b.repaired_fields.every(verifyRepairReceipt)).toBe(true);
    store.close();
  });

  it('detects audit tampering and preserves chain verification across retention purge', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a', retentionDays: 1 });
    const principal = store.authenticate('key-a')!;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    store.recordValidation(
      principal,
      validateToolCall({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '1' },
      }),
    );
    vi.useRealTimers();
    store.recordValidation(
      principal,
      validateToolCall({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '2' },
      }),
    );
    expect(store.verifyAuditChain(principal)).toMatchObject({ valid: true, checked: 2 });
    expect(store.purgeExpired(principal)).toBe(1);
    expect(store.verifyAuditChain(principal)).toMatchObject({ valid: true, checked: 1 });
    const anchor = store.db
      .prepare("SELECT signature FROM audit_chain_anchors WHERE tenant_id='a'")
      .get() as { signature: string };
    store.db
      .prepare("UPDATE audit_chain_anchors SET signature='tampered' WHERE tenant_id='a'")
      .run();
    expect(store.verifyAuditChain(principal)).toMatchObject({
      valid: false,
      anchor_invalid: true,
    });
    store.db
      .prepare("UPDATE audit_chain_anchors SET signature=? WHERE tenant_id='a'")
      .run(anchor.signature);
    store.db.prepare("UPDATE audit_events SET envelope_json='{}' WHERE tenant_id='a'").run();
    expect(store.verifyAuditChain(principal).valid).toBe(false);
    store.close();
  });

  it('enforces monthly quotas', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    const principal = { ...store.authenticate('key-a')!, monthlyLimit: 1 };
    store.consumeValidation(principal);
    expect(() => store.consumeValidation(principal)).toThrow(ManagedError);
    store.close();
  });

  it('enforces rate limits and API-key revocation', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    const principal = store.authenticate('key-a')!;
    const issued = store.issueApiKey(principal, ['validate']);
    expect(store.authenticate(issued.api_key)?.scopes).toEqual(['validate']);
    expect(store.revokeApiKey(principal, issued.key_id)).toBe(true);
    expect(store.authenticate(issued.api_key)).toBeUndefined();
    const limiter = new FixedWindowRateLimiter(1);
    limiter.consume(principal, 0);
    expect(() => limiter.consume(principal, 1)).toThrow(ManagedError);
    limiter.consume(principal, 60_000);
    store.close();
  });

  it('releases only compatibility signatures meeting the cross-tenant privacy threshold', async () => {
    const store = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
      aggregateTenantThreshold: 2,
    });
    for (const id of ['a', 'b']) {
      store.bootstrapTenant({ id, name: id, plan: 'trial', apiKey: `key-${id}` });
      const principal = store.authenticate(`key-${id}`)!;
      store.registerSchema(principal, {
        tool_name: 'weather',
        adapter: 'mcp',
        version: '1',
        schema: { type: 'object', properties: { city: { type: 'string' } } },
      });
      store.registerSchema(principal, {
        tool_name: 'weather',
        adapter: 'mcp',
        version: '2',
        schema: {
          type: 'object',
          required: ['country'],
          properties: { city: { type: 'string' }, country: { type: 'string' } },
        },
      });
      if (id === 'a') expect(store.aggregateIntelligence()).toEqual([]);
    }
    expect(store.aggregateIntelligence()).toHaveLength(1);
    store.close();
  });

  it('signs rulesets and rejects tampered signatures', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    const issued = new Date();
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    const principal = store.authenticate('key-a')!;
    const ruleset = store.publishRuleset(principal, {
      version: 'local-1',
      issued_at: issued.toISOString(),
      expires_at: new Date(issued.getTime() + 86_400_000).toISOString(),
      rules: [
        {
          id: 'coerce.string_to_integer',
          enabled_by_default: true,
          description: 'Exact integer strings',
        },
      ],
    });
    expect(store.verifyRuleset(ruleset)).toBe(true);
    expect(store.verifyRuleset({ ...ruleset, version: 'tampered' })).toBe(false);
    store.db
      .prepare("UPDATE signing_keys SET public_key_pem='attacker key' WHERE id=?")
      .run(ruleset.key_id);
    expect(store.verifyRuleset(ruleset)).toBe(false);
    store.close();
  });

  it('scopes retention purges and rulesets to the authenticated tenant', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a', retentionDays: 1 });
    store.bootstrapTenant({ id: 'b', name: 'B', plan: 'trial', apiKey: 'key-b', retentionDays: 1 });
    const a = store.authenticate('key-a')!;
    const b = store.authenticate('key-b')!;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    store.recordValidation(
      a,
      validateToolCall({ tool_name: 'x', tool_schema: { type: 'object' }, raw_arguments: {} }),
    );
    vi.useRealTimers();
    store.recordValidation(
      b,
      validateToolCall({ tool_name: 'x', tool_schema: { type: 'object' }, raw_arguments: {} }),
    );
    expect(store.purgeExpired(a)).toBe(1);
    expect(store.listAudits(a)).toHaveLength(0);
    expect(store.listAudits(b)).toHaveLength(1);
    const issued = new Date();
    store.publishRuleset(a, {
      version: 'tenant-a-1',
      issued_at: issued.toISOString(),
      expires_at: new Date(issued.getTime() + 86_400_000).toISOString(),
      rules: [
        {
          id: 'coerce.string_to_integer',
          enabled_by_default: true,
          description: 'Exact integer strings',
        },
      ],
    });
    expect(store.latestRuleset(a)?.version).toBe('tenant-a-1');
    expect(store.latestRuleset(b)).toBeUndefined();
    store.close();
  });

  it('detects tampering in denormalized audit columns', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    const principal = store.authenticate('key-a')!;
    store.recordValidation(
      principal,
      validateToolCall({ tool_name: 'x', tool_schema: { type: 'object' }, raw_arguments: {} }),
    );
    store.db.prepare("UPDATE audit_events SET decision='rejected' WHERE tenant_id='a'").run();
    expect(store.verifyAuditChain(principal).valid).toBe(false);
    expect(store.listAudits(principal)[0]?.decision).toBe('valid');
    store.close();
  });

  it('backs up and reopens a migrated database without losing authentication', async () => {
    const source = await database();
    const destination = `${source}.backup`;
    const store = new ManagedStore({ databasePath: source, masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    expect(store.integrityCheck()).toBe(true);
    await store.backup(destination);
    expect((await stat(source)).mode & 0o777).toBe(0o600);
    expect((await stat(`${source}-wal`)).mode & 0o777).toBe(0o600);
    expect((await stat(`${source}-shm`)).mode & 0o777).toBe(0o600);
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    store.close();
    const restored = new ManagedStore({ databasePath: destination, masterSecret: secret });
    expect(restored.authenticate('key-a')?.tenantId).toBe('a');
    expect(restored.integrityCheck()).toBe(true);
    restored.close();
  });

  it('repairs permissions on a pre-existing managed alert file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-guard-managed-alert-'));
    const alertFile = join(root, 'alerts.jsonl');
    await writeFile(alertFile, '');
    await chmod(alertFile, 0o644);
    const store = new ManagedStore({
      databasePath: join(root, 'managed.db'),
      masterSecret: secret,
      alertFile,
    });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    const principal = store.authenticate('key-a')!;
    store.recordValidation(
      principal,
      validateToolCall({
        tool_name: 'counter',
        tool_schema: { type: 'object', required: ['count'] },
        raw_arguments: {},
      }),
    );
    await vi.waitFor(async () => expect((await stat(alertFile)).mode & 0o777).toBe(0o600));
    store.close();
  });

  it('serves a ruleset immediately when its ISO timestamps omit milliseconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T03:26:45.500Z'));
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    const principal = store.authenticate('key-a')!;
    store.publishRuleset(principal, {
      version: 'second-precision-1',
      issued_at: '2026-07-19T03:26:45Z',
      expires_at: '2026-07-20T03:26:45Z',
      rules: [
        {
          id: 'coerce.string_to_integer',
          enabled_by_default: true,
          description: 'Exact integer strings',
        },
      ],
    });
    expect(store.latestRuleset(principal)?.version).toBe('second-precision-1');
    store.close();
  });

  it('serves authenticated validation, usage, audit verification, and dashboard routes', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
      rateLimitPerMinute: 20,
    });
    open.push(service);
    service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    expect(await fetch(`${base}/readyz`).then((result) => result.json())).toEqual({
      status: 'ready',
    });
    service.store.db.pragma('user_version = 12');
    const unready = await fetch(`${base}/readyz`);
    expect(unready.status).toBe(503);
    expect(await unready.json()).toEqual({ status: 'database_unavailable' });
    service.store.db.pragma('user_version = 14');
    expect((await fetch(`${base}/v1/usage`)).status).toBe(401);
    const response = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: { authorization: 'Bearer key-a', 'content-type': 'application/json' },
      body: JSON.stringify({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '4' },
      }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { decision: string }).decision).toBe('valid_with_repair');
    const headers = { authorization: 'Bearer key-a' };
    const compiled = await fetch(`${base}/v1/contracts/compile`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'mcp',
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
      }),
    });
    expect(compiled.status).toBe(200);
    expect(((await compiled.json()) as { status: string }).status).toBe('runtime_unverified');
    expect(
      (
        (await fetch(`${base}/v1/audits/verify`, { headers }).then((r) => r.json())) as {
          valid: boolean;
        }
      ).valid,
    ).toBe(true);
    expect(
      (
        (await fetch(`${base}/v1/usage`, { headers }).then((r) => r.json())) as {
          usage: { validation_count: number };
        }
      ).usage.validation_count,
    ).toBe(1);
    const dashboard = await fetch(`${base}/dashboard`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get('content-security-policy')).not.toContain("'unsafe-inline'");
    const dashboardBody = await dashboard.text();
    expect(dashboardBody).toContain('src="/dashboard/app.js"');
    expect(dashboardBody).toContain('href="/dashboard/app.css"');
    expect(dashboardBody).toContain('Tenant lifecycle');
    expect(dashboardBody).toContain('Download tenant export');
    expect(dashboardBody).toContain('Managed API workbench');
    expect(dashboardBody).toContain('Control-plane integrity');
    expect(dashboardBody).toContain('I reviewed this exact request and authorize this mutation.');
    expect(dashboardBody.match(/<option value=/gu)).toHaveLength(29);
    for (const label of [
      'Validate tool call',
      'Compile provider contract',
      'Register schema',
      'Release schema',
      'Create environment',
      'Update environment policy',
      'Update schema enforcement',
      'Update organization policy',
      'Set action descriptor',
      'Create approval challenge',
      'Approve challenge',
      'Cancel challenge',
      'Evaluate action',
      'Complete reservation',
      'Release reservation',
      'Compare checkpoint',
      'Redrive anchor delivery',
      'Reconcile uncertain action',
      'Ingest conformance run',
      'Create alert webhook',
      'Redrive webhook delivery',
      'Disable webhook',
      'Publish ruleset',
      'Create API key',
      'Revoke API key',
      'Start Stripe checkout',
      'Open Stripe billing portal',
      'Attempt plan change',
      'Purge retained audits',
    ])
      expect(dashboardBody, label).toContain(`>${label}<`);
    const dashboardScript = await fetch(`${base}/dashboard/app.js`);
    expect(dashboardScript.status).toBe(200);
    const dashboardJavaScript = await dashboardScript.text();
    expect(() => new Script(dashboardJavaScript)).not.toThrow();
    expect(dashboardJavaScript).toContain("clearPanels();q('status').className=''");
    expect(dashboardJavaScript).toContain("get('/v1/admin/tenant/lifecycle')");
    expect(dashboardJavaScript).toContain("get('/v1/admin/tenant/export')");
    expect(dashboardJavaScript).toContain("get('/v1/admin/control-plane-integrity')");
    expect(dashboardJavaScript).toContain("get('/v1/actions/reconciliation/verify')");
    expect(dashboardJavaScript).toContain("get('/v1/alert-webhooks/deliveries?limit=100')");
    expect(dashboardJavaScript).toContain("getOptional('/v1/rulesets/latest')");
    expect(dashboardJavaScript).toContain(
      "throw new Error('Confirm this mutation before executing')",
    );
    expect(dashboardJavaScript).toContain(
      "throw new Error('Replace every JSON placeholder before execution')",
    );
    for (const endpoint of [
      '/v1/validate',
      '/v1/contracts/compile',
      '/v1/schemas',
      '/v1/schema-releases',
      '/v1/admin/environments',
      '/v1/admin/actions/descriptors',
      '/v1/actions/challenges',
      '/v1/actions/evaluate',
      '/v1/actions/idempotency/complete',
      '/v1/actions/idempotency/release',
      '/v1/actions/idempotency/checkpoint/compare',
      '/v1/actions/idempotency/anchors/deliveries/{DELIVERY_ID}/redrive',
      '/v1/actions/reconciliation/{RESERVATION_ID}',
      '/v1/conformance-runs',
      '/v1/alert-webhooks',
      '/v1/alert-webhooks/deliveries/{DELIVERY_ID}/redrive',
      '/v1/alert-webhooks/{WEBHOOK_ID}',
      '/v1/admin/rulesets',
      '/v1/admin/api-keys',
      '/v1/admin/api-keys/{KEY_ID}',
      '/v1/billing/checkout-session',
      '/v1/billing/portal-session',
      '/v1/admin/plan',
      '/v1/admin/policy',
      '/v1/admin/retention/purge',
    ])
      expect(dashboardJavaScript, endpoint).toContain(endpoint);
  });

  it('does not let validate-only keys read operational or tenant configuration data', async () => {
    const service = createManagedServer({ databasePath: await database(), masterSecret: secret });
    open.push(service);
    service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-key' });
    const admin = service.store.authenticate('admin-key')!;
    const validateOnly = service.store.issueApiKey(admin, ['validate']);
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${validateOnly.api_key}` };
    for (const path of [
      '/v1/usage',
      '/v1/environments',
      '/v1/billing/statement',
      '/v1/alerts',
      '/v1/rulesets/latest',
    ])
      expect((await fetch(`${base}${path}`, { headers })).status, path).toBe(403);

    expect(
      (
        await fetch(`${base}/v1/contracts/compile`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            target: 'mcp',
            tool_name: 'counter',
            tool_schema: { type: 'object', properties: {} },
          }),
        })
      ).status,
    ).toBe(403);

    const validation = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '2' },
      }),
    });
    expect(validation.status).toBe(200);
  });

  it('prevents callers from widening organization repair policy', async () => {
    const service = createManagedServer({ databasePath: await database(), masterSecret: secret });
    open.push(service);
    service.store.bootstrapTenant({
      id: 'locked',
      name: 'Locked',
      plan: 'trial',
      apiKey: 'locked-key',
      policy: { allowed_repairs: [] },
    });
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/validate`, {
      method: 'POST',
      headers: { authorization: 'Bearer locked-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '4' },
        policy: { allowed_repairs: ['coerce.string_to_integer'] },
      }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { decision: string }).decision).toBe('rejected');
  });

  it('times out an incomplete request without validation or audit side effects', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
      requestTimeoutMs: 20,
    });
    open.push(service);
    service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    const principal = service.store.authenticate('key-a')!;
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/v1/validate',
          method: 'POST',
          headers: {
            authorization: 'Bearer key-a',
            'content-type': 'application/json',
            'content-length': '1000',
          },
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode ?? 0));
        },
      );
      request.once('error', reject);
      request.write('{"tool_name":');
    });
    expect(status).toBe(503);
    expect(service.store.usage(principal).validation_count).toBe(0);
    expect(service.store.listAudits(principal)).toHaveLength(0);
  });
});
