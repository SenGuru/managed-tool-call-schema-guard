import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { FixedWindowRateLimiter } from '../packages/managed/src/rate-limit.js';
import { ManagedError, ManagedStore } from '../packages/managed/src/store.js';

const secret = 'test-master-secret-that-is-at-least-32-characters';
const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const service of open.splice(0)) await service.close();
});
async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-managed-')), 'managed.db');
}
describe('managed local control plane', () => {
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

  it('detects audit tampering and preserves chain verification across retention purge', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a', retentionDays: 1 });
    const principal = store.authenticate('key-a')!;
    for (const count of ['1', '2']) {
      const decision = validateToolCall({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count },
      });
      store.consumeValidation(principal);
      store.recordDecision(principal, decision);
    }
    expect(store.verifyAuditChain(principal)).toMatchObject({ valid: true, checked: 2 });
    const first = store.db
      .prepare('SELECT sequence FROM audit_events ORDER BY sequence LIMIT 1')
      .get() as { sequence: number };
    store.db
      .prepare("UPDATE audit_events SET occurred_at='2000-01-01T00:00:00.000Z' WHERE sequence=?")
      .run(first.sequence);
    expect(store.purgeExpired()).toBe(1);
    expect(store.verifyAuditChain(principal)).toMatchObject({ valid: true, checked: 1 });
    store.db.prepare("UPDATE audit_events SET envelope_json='{}' WHERE tenant_id='a'").run();
    expect(store.verifyAuditChain(principal).valid).toBe(false);
    store.close();
  });

  it('enforces monthly quotas', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    store.db.prepare('UPDATE tenants SET monthly_limit=1 WHERE id=?').run('a');
    const principal = store.authenticate('key-a')!;
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
    const ruleset = store.publishRuleset({
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
    store.close();
  });

  it('backs up and reopens a migrated database without losing authentication', async () => {
    const source = await database();
    const destination = `${source}.backup`;
    const store = new ManagedStore({ databasePath: source, masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'key-a' });
    expect(store.integrityCheck()).toBe(true);
    await store.backup(destination);
    store.close();
    const restored = new ManagedStore({ databasePath: destination, masterSecret: secret });
    expect(restored.authenticate('key-a')?.tenantId).toBe('a');
    expect(restored.integrityCheck()).toBe(true);
    restored.close();
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
    expect((await fetch(`${base}/dashboard`)).status).toBe(200);
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
});
