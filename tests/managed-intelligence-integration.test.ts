import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { migrations } from '../packages/managed/src/migrations.js';
import { ManagedStore } from '../packages/managed/src/store.js';

const secret = 'intelligence-test-secret-that-is-at-least-32-chars';
const services: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
});

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-intelligence-')), 'managed.db');
}

describe('managed intelligence workflow', () => {
  it('upgrades an existing version-5 database through intelligence and environment migrations', async () => {
    const path = await database();
    const legacy = new Database(path);
    for (const migration of migrations.filter(({ version }) => version <= 5)) {
      legacy.exec(migration.sql);
      legacy.pragma(`user_version = ${migration.version}`);
    }
    legacy.close();
    const store = new ManagedStore({ databasePath: path, masterSecret: secret });
    expect(store.db.pragma('user_version', { simple: true })).toBe(15);
    store.bootstrapTenant({ id: 'upgraded', name: 'Upgraded', plan: 'team', apiKey: 'key' });
    const principal = store.authenticate('key')!;
    expect(store.listEnvironments(principal).map(({ name }) => name)).toEqual([
      'development',
      'production',
      'staging',
    ]);
    expect(
      store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='failure_clusters'")
        .get(),
    ).toBeTruthy();
    expect(store.verifyControlPlaneIntegrity(principal).valid).toBe(true);
    expect(store.integrityCheck()).toBe(true);
    store.close();
  });

  it('releases detailed failure clusters only after the cross-tenant privacy threshold', async () => {
    const store = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
      aggregateTenantThreshold: 2,
    });
    for (const id of ['a', 'b']) {
      store.bootstrapTenant({ id, name: id, plan: 'team', apiKey: `key-${id}` });
      const principal = store.authenticate(`key-${id}`)!;
      store.recordValidation(
        principal,
        validateToolCall({
          tool_name: 'counter',
          tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
          raw_arguments: { count: '2' },
        }),
        { adapter: 'mcp', provider: 'anthropic', framework: 'mcp' },
      );
      if (id === 'a') expect(store.aggregateFailureIntelligence()).toEqual([]);
    }
    expect(store.aggregateFailureIntelligence()).toEqual([
      expect.objectContaining({
        category: 'repair',
        provider: 'anthropic',
        tenant_count: 2,
        event_count: 2,
      }),
    ]);
    expect(JSON.stringify(store.aggregateFailureIntelligence())).not.toContain('tenant_id');
    store.close();
  });

  it('persists value-free clusters and produces schema, drift, and compatibility actions', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'team', name: 'Team', plan: 'team', apiKey: 'team-key' });
    store.bootstrapTenant({ id: 'other', name: 'Other', plan: 'team', apiKey: 'other-key' });
    const team = store.authenticate('team-key')!;
    const other = store.authenticate('other-key')!;

    store.registerSchema(team, {
      tool_name: 'search-private-tool',
      adapter: 'openai_agents',
      version: '1',
      schema: { type: 'object', properties: { limit: { type: 'integer' } } },
    });
    store.registerSchema(team, {
      tool_name: 'search-private-tool',
      adapter: 'openai_agents',
      version: '2',
      schema: {
        type: 'object',
        required: ['limit'],
        properties: { limit: { type: 'integer' } },
      },
    });
    for (const raw of ['2', '3'])
      store.recordValidation(
        team,
        validateToolCall({
          tool_name: 'search-private-tool',
          tool_schema: {
            type: 'object',
            required: ['limit'],
            properties: { limit: { type: 'integer' } },
          },
          raw_arguments: { limit: raw },
        }),
        {
          adapter: 'openai_agents',
          provider: 'OpenAI',
          provider_version: 'responses-2026-07',
          framework: 'Agents SDK',
          framework_version: '1.4',
        },
      );

    const first = store.tenantIntelligence(team);
    const signature = (first.failure_clusters as { id: string }[])[0]!.id;
    expect(
      store.recordConformanceRun(team, {
        provider: 'OpenAI',
        provider_version: 'responses-2026-07',
        framework: 'Agents SDK',
        framework_version: '1.4',
        adapter: 'openai_agents',
        suite_version: 'corpus-1',
        executed_at: '2026-07-19T00:00:00Z',
        passed: 9,
        failed: 1,
        repaired: 2,
        rejected: 0,
        failure_signature_ids: [signature],
      }),
    ).toMatchObject({ recorded: true });

    const report = store.tenantIntelligence(team) as {
      failure_clusters: unknown[];
      schema_quality: {
        adapter: string;
        version: string;
        quality: { grade: string };
        drift: { compatibility: string } | null;
      }[];
      compatibility_matrix: unknown[];
      recommendations: unknown[];
    };
    expect(report.failure_clusters).toEqual([
      expect.objectContaining({
        category: 'repair',
        provider: 'openai',
        framework: 'agents sdk',
        event_count: 2,
        affected_versions: ['responses-2026-07'],
      }),
    ]);
    expect(report.schema_quality).toHaveLength(1);
    expect(report.schema_quality[0]).toMatchObject({
      adapter: 'openai_agents',
      version: '2',
      quality: { grade: 'good' },
      drift: { compatibility: 'breaking' },
    });
    expect(report.compatibility_matrix).toEqual([
      expect.objectContaining({ status: 'degraded', pass_rate: 0.9, total_cases: 10 }),
    ]);
    expect(report.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ALLOW_SAFE_TYPED_REPAIR' }),
        expect.objectContaining({ code: 'ADDRESS_BREAKING_DRIFT', severity: 'critical' }),
      ]),
    );
    expect(store.tenantIntelligence(other)).toMatchObject({
      failure_clusters: [],
      schema_quality: [],
      compatibility_matrix: [],
      recommendations: [],
    });
    expect(JSON.stringify(store.db.prepare('SELECT * FROM failure_clusters').all())).not.toContain(
      'search-private-tool',
    );
    store.close();
  });

  it('exposes idempotent conformance ingestion and actionable intelligence over HTTP', async () => {
    const service = createManagedServer({ databasePath: await database(), masterSecret: secret });
    services.push(service);
    service.store.bootstrapTenant({ id: 'team', name: 'Team', plan: 'team', apiKey: 'team-key' });
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: 'Bearer team-key',
      'content-type': 'application/json',
    };
    const createdEnvironment = await fetch(`${base}/v1/admin/environments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'locked', policy: { allowed_repairs: [] } }),
    });
    expect(createdEnvironment.status).toBe(201);
    const environments = (await fetch(`${base}/v1/environments`, { headers }).then((response) =>
      response.json(),
    )) as { environments: { name: string }[] };
    expect(environments.environments.map(({ name }) => name)).toEqual([
      'development',
      'locked',
      'production',
      'staging',
    ]);
    const environmentDecision = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '2' },
        context: { environment: 'locked', adapter: 'mcp' },
      }),
    });
    expect(environmentDecision.status).toBe(422);
    expect(await environmentDecision.json()).toMatchObject({
      decision: 'rejected',
      reason_code: 'SCHEMA_VALIDATION_FAILED',
    });
    const unrestrictedDecision = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '2' },
        context: { environment: 'development', adapter: 'mcp' },
      }),
    });
    expect(unrestrictedDecision.status).toBe(200);
    expect(await unrestrictedDecision.json()).toMatchObject({ decision: 'valid_with_repair' });
    const run = {
      provider: 'anthropic',
      provider_version: '2026-07',
      framework: 'mcp',
      framework_version: '1',
      adapter: 'mcp',
      suite_version: 'corpus-1',
      executed_at: '2026-07-19T00:00:00Z',
      passed: 10,
      failed: 0,
      repaired: 0,
      rejected: 0,
      failure_signature_ids: [],
    };
    const first = await fetch(`${base}/v1/conformance-runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(run),
    });
    const duplicate = await fetch(`${base}/v1/conformance-runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(run),
    });
    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ recorded: false });
    const malformed = await fetch(`${base}/v1/conformance-runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...run, failure_signature_ids: 'not-an-array' }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: 'invalid_conformance_run' });
    const intelligence = (await fetch(`${base}/v1/intelligence`, { headers }).then((response) =>
      response.json(),
    )) as {
      compatibility_matrix: { status: string }[];
      network_failure_clusters: unknown[];
      network_signatures: unknown[];
    };
    expect(intelligence.compatibility_matrix).toEqual([
      expect.objectContaining({ status: 'compatible' }),
    ]);
    expect(intelligence.network_failure_clusters).toEqual([]);
    expect(intelligence.network_signatures).toEqual([]);
  });
});
