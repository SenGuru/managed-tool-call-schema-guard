import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedError, ManagedStore } from '../packages/managed/src/store.js';

const secret = 'managed-schema-release-secret-that-is-at-least-32-characters';
const v1 = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: { query: { type: 'string' } },
} as const;
const v2 = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'limit'],
  properties: { query: { type: 'string' }, limit: { type: 'integer' } },
} as const;

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-release-')), 'managed.db');
}

describe('managed schema releases', () => {
  it('blocks unreviewed breaking promotion and maintains an authenticated tenant chain', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    store.bootstrapTenant({ id: 'b', name: 'B', plan: 'team', apiKey: 'admin-b' });
    const a = store.authenticate('admin-a')!;
    const b = store.authenticate('admin-b')!;
    const first = store.registerSchema(a, {
      tool_name: 'search',
      adapter: 'openai_agents',
      version: '1',
      schema: v1,
    });
    const second = store.registerSchema(a, {
      tool_name: 'search',
      adapter: 'openai_agents',
      version: '2',
      schema: v2,
    });
    const release1 = store.promoteSchemaRelease(a, {
      tool_name: 'search',
      version: '1',
      environment: 'production',
      expected_schema_hash: first.schema_hash,
    });
    expect(release1).toMatchObject({ compatibility: 'initial', version: '1' });
    expect(
      store.promoteSchemaRelease(a, {
        tool_name: 'search',
        version: '1',
        environment: 'production',
        expected_schema_hash: first.schema_hash,
      }).release_id,
    ).toBe(release1.release_id);
    expect(() =>
      store.promoteSchemaRelease(a, {
        tool_name: 'search',
        version: '2',
        environment: 'production',
        expected_schema_hash: second.schema_hash,
      }),
    ).toThrow(/breaking schema promotion/u);
    expect(() =>
      store.promoteSchemaRelease(a, {
        tool_name: 'search',
        version: '2',
        environment: 'production',
        expected_schema_hash: second.schema_hash,
        allow_breaking: true,
      }),
    ).toThrow(/evidence/u);
    const release2 = store.promoteSchemaRelease(a, {
      tool_name: 'search',
      version: '2',
      environment: 'production',
      expected_schema_hash: second.schema_hash,
      allow_breaking: true,
      evidence_reference: 'change-review/CR-9182',
    });
    expect(release2).toMatchObject({ compatibility: 'breaking', version: '2' });
    expect(release2.evidence_hash).toMatch(/^hmac-sha256:/u);
    expect(store.verifySchemaReleaseHistory(a)).toEqual({ valid: true, checked: 2 });
    expect(store.listSchemaReleases(b)).toEqual([]);
    expect(JSON.stringify(store.db.prepare('SELECT * FROM schema_releases').all())).not.toContain(
      'change-review/CR-9182',
    );
    store.db
      .prepare("UPDATE schema_releases SET compatibility='review' WHERE release_id=?")
      .run(release1.release_id);
    expect(store.verifySchemaReleaseHistory(a)).toMatchObject({
      valid: false,
      first_invalid_release_id: release1.release_id,
    });
    store.close();
  });

  it('enforces only the latest promoted schema when an environment opts in', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    const registered = store.registerSchema(principal, {
      tool_name: 'search',
      adapter: 'mcp',
      version: '1',
      schema: v1,
    });
    expect(store.schemaAdmission(principal, 'production', 'unregistered', v2)).toMatchObject({
      mode: 'observe',
      allowed: true,
    });
    const production = store
      .listEnvironments(principal)
      .find((environment) => environment.name === 'production')!;
    store.updateEnvironmentSchemaEnforcement(principal, String(production.id), 'enforce');
    expect(store.schemaAdmission(principal, 'production', 'search', v1)).toMatchObject({
      allowed: false,
      reason: 'schema_not_promoted',
    });
    store.promoteSchemaRelease(principal, {
      tool_name: 'search',
      version: '1',
      environment: 'production',
      expected_schema_hash: registered.schema_hash,
    });
    expect(store.schemaAdmission(principal, 'production', 'search', v1)).toMatchObject({
      mode: 'enforce',
      allowed: true,
    });
    expect(store.schemaAdmission(principal, 'production', 'search', v2)).toMatchObject({
      allowed: false,
      reason: 'schema_release_mismatch',
    });
    store.db
      .prepare("UPDATE tool_schemas SET schema_json='{}' WHERE tenant_id='a' AND version='1'")
      .run();
    expect(store.schemaAdmission(principal, 'production', 'search', v1)).toMatchObject({
      allowed: false,
      reason: 'schema_release_integrity_invalid',
    });
    expect(store.verifySchemaReleaseHistory(principal).valid).toBe(false);
    expect(() =>
      store.updateEnvironmentSchemaEnforcement(
        { ...principal, scopes: ['validate'] },
        String(production.id),
        'observe',
      ),
    ).toThrow(ManagedError);
    store.close();
  });

  it('returns a protocol rejection and never valid arguments for an unpromoted runtime schema', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
      alertWebhookPollIntervalMs: 60_000,
    });
    try {
      service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
      const principal = service.store.authenticate('admin-a')!;
      const registered = service.store.registerSchema(principal, {
        tool_name: 'search',
        adapter: 'openai_agents',
        version: '1',
        schema: v1,
      });
      const production = service.store
        .listEnvironments(principal)
        .find((environment) => environment.name === 'production')!;
      const validator = service.store.issueApiKey(principal, ['validate']);
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const base = `http://127.0.0.1:${address.port}`;
      const promotionBody = JSON.stringify({
        tool_name: 'search',
        version: '1',
        environment: 'production',
        expected_schema_hash: registered.schema_hash,
      });
      expect(
        (
          await fetch(`${base}/v1/schema-releases`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${validator.api_key}`,
              'content-type': 'application/json',
            },
            body: promotionBody,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${base}/v1/schema-releases`, {
            method: 'POST',
            headers: { authorization: 'Bearer admin-a', 'content-type': 'application/json' },
            body: promotionBody,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await fetch(`${base}/v1/admin/environments/${String(production.id)}/schema-enforcement`, {
            method: 'PUT',
            headers: { authorization: 'Bearer admin-a', 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'enforce' }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          (await fetch(`${base}/v1/schema-releases?environment=production`, {
            headers: { authorization: 'Bearer admin-a' },
          }).then((response) => response.json())) as { releases: unknown[] }
        ).releases,
      ).toHaveLength(1);
      expect(
        await fetch(`${base}/v1/schema-releases/verify`, {
          headers: { authorization: 'Bearer admin-a' },
        }).then((response) => response.json()),
      ).toEqual({ valid: true, checked: 1 });
      const validate = (schema: object, raw_arguments: object) =>
        fetch(`${base}/v1/validate`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${validator.api_key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            tool_name: 'search',
            tool_schema: schema,
            raw_arguments,
            context: { environment: 'production' },
          }),
        });
      expect((await validate(v1, { query: 'safe' })).status).toBe(200);
      const blocked = await validate(v2, { query: 'safe', limit: 2 });
      expect(blocked.status).toBe(422);
      const decision = (await blocked.json()) as Record<string, unknown>;
      expect(decision).toMatchObject({
        decision: 'rejected',
        reason_code: 'POLICY_DENIED',
        policy_result: {
          outcome: 'denied',
          reasons: ['managed.schema_release_mismatch'],
        },
      });
      expect(decision).not.toHaveProperty('valid_arguments');
      expect(service.store.listAudits(principal)[0]).toMatchObject({
        decision: 'rejected',
        reason_code: 'POLICY_DENIED',
      });
    } finally {
      await service.close();
    }
  });
});
