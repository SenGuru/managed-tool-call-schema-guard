import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectSchemaDrift,
  sha256,
  type DriftReport,
  type GuardPolicy,
} from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import type {
  SchemaState,
  SharedEnvironment,
  SharedSchemaAdmissionResult,
  SharedSchemaEnforcementMode,
  SharedSchemaRelease,
} from '../packages/shared-state/src/index.js';

const secret = 'managed-shared-schema-test-secret-at-least-32-characters';
const v1 = {
  type: 'object',
  additionalProperties: false,
  properties: { query: { type: 'string' } },
  required: ['query'],
} as const;
const v2 = {
  type: 'object',
  additionalProperties: false,
  properties: { query: { type: 'string' }, limit: { type: 'integer' } },
  required: ['query', 'limit'],
} as const;

type Registered = {
  toolName: string;
  adapter: string;
  version: string;
  schema: object | boolean;
  schemaHash: string;
};

class MemorySchemaState implements SchemaState {
  readonly environments = new Map<string, SharedEnvironment[]>();
  readonly schemas = new Map<string, Registered[]>();
  readonly releases = new Map<string, SharedSchemaRelease[]>();
  available = true;
  integrityValid = true;

  migrate(): Promise<void> {
    return Promise.resolve();
  }
  ready(): Promise<boolean> {
    return Promise.resolve(this.available && this.integrityValid);
  }
  bootstrapTenant(tenantId: string): Promise<void> {
    const timestamp = new Date().toISOString();
    this.environments.set(
      tenantId,
      ['development', 'staging', 'production'].map((name) => ({
        id: `env-${tenantId}-${name}`,
        name,
        policy: {},
        schema_enforcement: 'observe',
        created_at: timestamp,
        updated_at: timestamp,
      })),
    );
    this.schemas.set(tenantId, []);
    this.releases.set(tenantId, []);
    return Promise.resolve();
  }
  listEnvironments(tenantId: string): Promise<SharedEnvironment[]> {
    return Promise.resolve(structuredClone(this.environments.get(tenantId) ?? []));
  }
  createEnvironment(
    tenantId: string,
    name: string,
    policy: GuardPolicy,
  ): Promise<SharedEnvironment> {
    const timestamp = new Date().toISOString();
    const environment: SharedEnvironment = {
      id: `env-${tenantId}-${name}`,
      name,
      policy: structuredClone(policy),
      schema_enforcement: 'observe',
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.environments.get(tenantId)!.push(environment);
    return Promise.resolve(structuredClone(environment));
  }
  environmentPolicy(tenantId: string, name: string): Promise<GuardPolicy> {
    const environment = this.environment(tenantId, name);
    return Promise.resolve(structuredClone(environment.policy));
  }
  updateEnvironmentPolicy(
    tenantId: string,
    environmentId: string,
    policy: GuardPolicy,
  ): Promise<void> {
    this.environment(tenantId, environmentId).policy = structuredClone(policy);
    return Promise.resolve();
  }
  updateEnvironmentSchemaEnforcement(
    tenantId: string,
    environmentId: string,
    mode: SharedSchemaEnforcementMode,
  ): Promise<void> {
    this.environment(tenantId, environmentId).schema_enforcement = mode;
    return Promise.resolve();
  }
  registerSchema(
    tenantId: string,
    input: { tool_name: string; adapter: string; version: string; schema: object | boolean },
  ): Promise<{ schema_hash: string; drift: DriftReport | null }> {
    const rows = this.schemas.get(tenantId)!;
    const prior = rows.filter((row) => row.toolName === input.tool_name).at(-1);
    const schemaHash = sha256(input.schema);
    const existing = rows.find(
      (row) => row.toolName === input.tool_name && row.version === input.version,
    );
    if (!existing)
      rows.push({
        toolName: input.tool_name,
        adapter: input.adapter,
        version: input.version,
        schema: structuredClone(input.schema),
        schemaHash,
      });
    return Promise.resolve({
      schema_hash: schemaHash,
      drift: prior ? detectSchemaDrift(prior.schema, input.schema) : null,
    });
  }
  promoteSchemaRelease(
    tenantId: string,
    promoterId: string,
    input: {
      tool_name: string;
      version: string;
      environment: string;
      expected_schema_hash: string;
      allow_breaking?: boolean;
      evidence_reference?: string;
    },
  ): Promise<SharedSchemaRelease & { drift: DriftReport | null }> {
    const candidate = this.schemas
      .get(tenantId)!
      .find((row) => row.toolName === input.tool_name && row.version === input.version)!;
    const rows = this.releases.get(tenantId)!;
    const current = rows
      .filter(
        (row) =>
          row.environment === input.environment &&
          row.tool_name_hash === sha256({ tenantId, tool: input.tool_name }),
      )
      .at(-1);
    const prior = current
      ? this.schemas
          .get(tenantId)!
          .find((row) => row.version === current.version && row.toolName === input.tool_name)
      : undefined;
    const drift = prior ? detectSchemaDrift(prior.schema, candidate.schema) : null;
    const release: SharedSchemaRelease = {
      release_id: `release-${rows.length + 1}`,
      tool_name_hash: sha256({ tenantId, tool: input.tool_name }),
      environment: input.environment,
      schema_hash: candidate.schemaHash,
      adapter: candidate.adapter,
      version: candidate.version,
      compatibility: drift?.compatibility ?? 'initial',
      evidence_hash: sha256(input.evidence_reference ?? 'none'),
      promoted_by_hash: sha256(promoterId),
      promoted_at: new Date().toISOString(),
      previous_hash: rows.at(-1)?.record_hash ?? 'GENESIS',
      record_hash: sha256({ tenantId, sequence: rows.length + 1, schema: candidate.schemaHash }),
    };
    rows.push(release);
    return Promise.resolve({ ...structuredClone(release), drift });
  }
  schemaAdmission(
    tenantId: string,
    environmentName: string,
    toolName: string,
    schema: object | boolean,
  ): Promise<SharedSchemaAdmissionResult> {
    const environment = this.environment(tenantId, environmentName);
    const toolHash = sha256({ tenantId, tool: toolName });
    const submitted = sha256(schema);
    const base = {
      mode: environment.schema_enforcement,
      environment: environment.name,
      tool_name_hash: toolHash,
      submitted_schema_hash: submitted,
    };
    if (environment.schema_enforcement === 'observe')
      return Promise.resolve({ ...base, allowed: true });
    if (!this.integrityValid)
      return Promise.resolve({
        ...base,
        allowed: false,
        reason: 'schema_release_integrity_invalid',
      });
    const release = this.releases
      .get(tenantId)!
      .filter((row) => row.environment === environment.name && row.tool_name_hash === toolHash)
      .at(-1);
    if (!release)
      return Promise.resolve({ ...base, allowed: false, reason: 'schema_not_promoted' });
    return Promise.resolve({
      ...base,
      allowed: release.schema_hash === submitted,
      ...(release.schema_hash === submitted ? {} : { reason: 'schema_release_mismatch' as const }),
      promoted_schema_hash: release.schema_hash,
      release_id: release.release_id,
    });
  }
  listSchemaReleases(
    tenantId: string,
    environment: string | undefined,
    limit: number,
  ): Promise<Array<SharedSchemaRelease & { integrity_valid: boolean }>> {
    return Promise.resolve(
      this.releases
        .get(tenantId)!
        .filter((release) => environment === undefined || release.environment === environment)
        .slice(-limit)
        .reverse()
        .map((release) => ({ ...structuredClone(release), integrity_valid: this.integrityValid })),
    );
  }
  verifySchemaReleaseHistory(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return Promise.resolve({
      valid: this.integrityValid,
      checked: this.integrityValid ? this.releases.get(tenantId)!.length : 0,
    });
  }
  listLatestSchemas(tenantId: string) {
    const latest = new Map<string, Registered>();
    for (const schema of this.schemas.get(tenantId)!) latest.set(schema.toolName, schema);
    return Promise.resolve(
      [...latest.values()].map((schema) => ({
        tool_name_hash: sha256({ tenantId, tool: schema.toolName }),
        adapter: schema.adapter,
        version: schema.version,
        schema_hash: schema.schemaHash,
        schema: structuredClone(schema.schema),
        drift: null,
        created_at: new Date().toISOString(),
      })),
    );
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  private environment(tenantId: string, idOrName: string): SharedEnvironment {
    const environment = this.environments
      .get(tenantId)!
      .find((row) => row.id === idOrName || row.name === idOrName);
    if (!environment) throw new TypeError('shared environment does not exist');
    return environment;
  }
}

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-shared-schema-')), 'managed.db');
}

describe('managed shared schema state', () => {
  it('uses one environment and release authority across independent HTTP instances', async () => {
    const state = new MemorySchemaState();
    await state.bootstrapTenant('tenant-a');
    const services = await Promise.all(
      [0, 1].map(async () => {
        const service = createManagedServer(
          { databasePath: await database(), masterSecret: secret },
          { schemaState: state },
        );
        service.store.bootstrapTenant({
          id: 'tenant-a',
          name: 'Tenant A',
          plan: 'team',
          apiKey: 'admin-a',
        });
        await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
        const address = service.server.address();
        if (!address || typeof address === 'string') throw new Error('missing server address');
        return { service, base: `http://127.0.0.1:${address.port}` };
      }),
    );
    try {
      const headers = {
        authorization: 'Bearer admin-a',
        'content-type': 'application/json',
      };
      const production = (await state.listEnvironments('tenant-a')).find(
        (environment) => environment.name === 'production',
      )!;
      expect(
        (
          await fetch(`${services[0]!.base}/v1/admin/environments/${production.id}/policy`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ allowed_repairs: [] }),
          })
        ).status,
      ).toBe(200);
      const validation = (base: string, schema: object, rawArguments: object) =>
        fetch(`${base}/v1/validate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tool_name: 'search',
            tool_schema: schema,
            raw_arguments: rawArguments,
            context: { environment: 'production' },
          }),
        });
      expect((await validation(services[1]!.base, v1, { query: 2 })).status).toBe(422);
      await state.updateEnvironmentPolicy('tenant-a', production.id, {});

      const registrationResponse = await fetch(`${services[0]!.base}/v1/schemas`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool_name: 'search',
          adapter: 'mcp',
          version: '1',
          schema: v1,
        }),
      });
      expect(registrationResponse.status).toBe(201);
      const registration = (await registrationResponse.json()) as { schema_hash: string };
      expect(
        (
          await fetch(
            `${services[1]!.base}/v1/admin/environments/${production.id}/schema-enforcement`,
            { method: 'PUT', headers, body: JSON.stringify({ mode: 'enforce' }) },
          )
        ).status,
      ).toBe(200);
      const unpromoted = await validation(services[0]!.base, v1, { query: 'safe' });
      expect(unpromoted.status).toBe(422);
      await expect(unpromoted.json()).resolves.toMatchObject({
        policy_result: { reasons: ['managed.schema_not_promoted'] },
      });
      expect(
        (
          await fetch(`${services[1]!.base}/v1/schema-releases`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              tool_name: 'search',
              version: '1',
              environment: 'production',
              expected_schema_hash: registration.schema_hash,
            }),
          })
        ).status,
      ).toBe(201);
      expect((await validation(services[0]!.base, v1, { query: 'safe' })).status).toBe(200);
      const mismatch = await validation(services[1]!.base, v2, { query: 'safe', limit: 2 });
      expect(mismatch.status).toBe(422);
      await expect(mismatch.json()).resolves.toMatchObject({
        policy_result: { reasons: ['managed.schema_release_mismatch'] },
      });

      const releaseLists = await Promise.all(
        services.map(({ base }) =>
          fetch(`${base}/v1/schema-releases`, { headers }).then((response) => response.json()),
        ),
      );
      expect(releaseLists[0]).toEqual(releaseLists[1]);
      const localPrincipal = services[1]!.service.store.authenticate('admin-a')!;
      expect(services[1]!.service.store.listSchemaReleases(localPrincipal)).toEqual([]);

      state.integrityValid = false;
      const integrityBlocked = await validation(services[0]!.base, v1, { query: 'safe' });
      expect(integrityBlocked.status).toBe(422);
      await expect(integrityBlocked.json()).resolves.toMatchObject({
        policy_result: { reasons: ['managed.schema_release_integrity_invalid'] },
      });
      expect((await fetch(`${services[1]!.base}/readyz`)).status).toBe(503);
    } finally {
      await Promise.all(services.map(({ service }) => service.close()));
    }
  });
});
