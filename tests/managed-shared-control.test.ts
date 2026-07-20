import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  validateToolCall,
  type GuardDecision,
  type GuardPolicy,
} from '../packages/core/src/index.js';
import type {
  ControlState,
  SharedAuditRecord,
  SharedPlanId,
  SharedPrincipal,
  SharedScope,
  SharedTenantBootstrap,
  SharedUsage,
} from '../packages/shared-state/src/index.js';
import { SharedQuotaExceededError } from '../packages/shared-state/src/index.js';
import { PostgresControlState } from '../packages/shared-state/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';

const secret = 'managed-shared-control-test-secret-at-least-32-characters';

type Tenant = Omit<SharedPrincipal, 'keyId' | 'scopes'> & { usage: SharedUsage };
type Key = { tenantId: string; keyId: string; scopes: SharedScope[]; revoked: boolean };

class MemoryControlState implements ControlState {
  readonly tenants = new Map<string, Tenant>();
  readonly keys = new Map<string, Key>();
  readonly keyIds = new Map<string, string>();
  readonly audits = new Map<string, SharedAuditRecord[]>();
  readonly rateWindows = new Map<string, { started: number; count: number }>();
  sequence = 0;
  available = true;

  migrate(): Promise<void> {
    return Promise.resolve();
  }
  ready(): Promise<boolean> {
    return Promise.resolve(this.available);
  }
  bootstrapTenant(input: SharedTenantBootstrap): Promise<void> {
    this.tenants.set(input.id, {
      tenantId: input.id,
      tenantName: input.name,
      plan: input.plan,
      monthlyLimit: 2,
      retentionDays: input.retentionDays ?? 30,
      policy: structuredClone(input.policy ?? {}),
      usage: {
        tenant_id: input.id,
        month: new Date().toISOString().slice(0, 7),
        validation_count: 0,
        repair_count: 0,
        rejection_count: 0,
        drift_count: 0,
      },
    });
    this.audits.set(input.id, []);
    const keyId = `bootstrap-${input.id}`;
    this.keys.set(input.apiKey, {
      tenantId: input.id,
      keyId,
      scopes: [...(input.scopes ?? ['admin'])],
      revoked: false,
    });
    this.keyIds.set(keyId, input.apiKey);
    return Promise.resolve();
  }
  authenticate(apiKey: string): Promise<SharedPrincipal | undefined> {
    const key = this.keys.get(apiKey);
    const tenant = key && !key.revoked ? this.tenants.get(key.tenantId) : undefined;
    return Promise.resolve(
      key && tenant
        ? {
            tenantId: tenant.tenantId,
            tenantName: tenant.tenantName,
            keyId: key.keyId,
            scopes: [...key.scopes],
            plan: tenant.plan,
            monthlyLimit: tenant.monthlyLimit,
            retentionDays: tenant.retentionDays,
            policy: structuredClone(tenant.policy),
          }
        : undefined,
    );
  }
  issueApiKey(
    tenantId: string,
    scopes: SharedScope[],
  ): Promise<{ key_id: string; api_key: string; scopes: SharedScope[] }> {
    this.sequence += 1;
    const keyId = `shared-key-${this.sequence}`;
    const apiKey = `shared-secret-${this.sequence}`;
    this.keys.set(apiKey, { tenantId, keyId, scopes: [...scopes], revoked: false });
    this.keyIds.set(keyId, apiKey);
    return Promise.resolve({ key_id: keyId, api_key: apiKey, scopes: [...scopes] });
  }
  revokeApiKey(tenantId: string, currentKeyId: string, keyId: string): Promise<boolean> {
    if (currentKeyId === keyId) throw new TypeError('cannot revoke current API key');
    const apiKey = this.keyIds.get(keyId);
    const key = apiKey ? this.keys.get(apiKey) : undefined;
    if (!key || key.tenantId !== tenantId || key.revoked) return Promise.resolve(false);
    key.revoked = true;
    return Promise.resolve(true);
  }
  updateTenantPolicy(tenantId: string, policy: GuardPolicy): Promise<void> {
    this.tenants.get(tenantId)!.policy = structuredClone(policy);
    return Promise.resolve();
  }
  updatePlan(tenantId: string, plan: SharedPlanId): Promise<void> {
    const tenant = this.tenants.get(tenantId)!;
    tenant.plan = plan;
    tenant.monthlyLimit = plan === 'trial' ? 1_000 : 100_000;
    return Promise.resolve();
  }
  consumeRateLimit(
    tenantId: string,
    keyId: string,
    limit: number,
    currentTime = new Date(),
  ): Promise<void> {
    const key = [...this.keys.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.keyId === keyId,
    );
    if (!key || key.revoked) return Promise.reject(new Error('shared API key unavailable'));
    const existing = this.rateWindows.get(keyId);
    if (!existing || currentTime.getTime() - existing.started >= 60_000) {
      this.rateWindows.set(keyId, { started: currentTime.getTime(), count: 1 });
      return Promise.resolve();
    }
    if (existing.count >= limit) {
      const error = new Error('shared per-key rate limit exceeded');
      error.name = 'SharedRateLimitExceededError';
      return Promise.reject(error);
    }
    existing.count += 1;
    return Promise.resolve();
  }
  private consumeValidation(
    tenantId: string,
    outcome: 'valid' | 'valid_with_repair' | 'rejected',
  ): Promise<SharedUsage> {
    const usage = this.tenants.get(tenantId)!.usage;
    if (usage.validation_count >= this.tenants.get(tenantId)!.monthlyLimit)
      return Promise.reject(new SharedQuotaExceededError());
    usage.validation_count += 1;
    if (outcome === 'valid_with_repair') usage.repair_count += 1;
    if (outcome === 'rejected') usage.rejection_count += 1;
    return Promise.resolve(structuredClone(usage));
  }
  async recordValidation(tenantId: string, decision: GuardDecision): Promise<SharedUsage> {
    const usage = await this.consumeValidation(tenantId, decision.decision);
    const audits = this.audits.get(tenantId)!;
    const previous = audits.at(-1)?.event_hash ?? 'GENESIS';
    audits.push({
      sequence: audits.length + 1,
      audit_id: decision.audit_id,
      occurred_at: decision.audit.timestamp,
      decision: decision.decision,
      reason_code: decision.audit.reason_code ?? null,
      repair_rules: [...decision.audit.repair_rule_ids],
      envelope: structuredClone(decision.audit),
      event_hash: `event-${audits.length + 1}`,
      previous_hash: previous,
      signature: `signature-${audits.length + 1}`,
    });
    return usage;
  }
  listAudits(tenantId: string, limit: number): Promise<SharedAuditRecord[]> {
    return Promise.resolve(structuredClone(this.audits.get(tenantId)!.slice(-limit).reverse()));
  }
  verifyAuditChain(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return Promise.resolve({ valid: true, checked: this.audits.get(tenantId)!.length });
  }
  purgeExpiredAudits(): Promise<number> {
    return Promise.resolve(0);
  }
  recordDrift(tenantId: string): Promise<SharedUsage> {
    const usage = this.tenants.get(tenantId)!.usage;
    usage.drift_count += 1;
    return Promise.resolve(structuredClone(usage));
  }
  usage(tenantId: string): Promise<SharedUsage> {
    return Promise.resolve(structuredClone(this.tenants.get(tenantId)!.usage));
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-shared-control-')), 'managed.db');
}

describe('managed shared control state', () => {
  it('rejects value-bearing or unknown audit-envelope fields before database access', async () => {
    const state = new PostgresControlState('postgresql://unreachable.invalid/schema_guard', secret);
    try {
      const decision = validateToolCall({
        tool_name: 'privacy_probe',
        tool_schema: { type: 'object', properties: { secret: { type: 'string' } } },
        raw_arguments: { secret: 'must-not-persist' },
      });
      (decision.audit as unknown as Record<string, unknown>).valid_arguments = {
        secret: 'must-not-persist',
      };
      await expect(state.recordValidation('tenant-a', decision)).rejects.toThrow(
        /audit envelope is invalid/u,
      );
    } finally {
      await state.close();
    }
  });

  it('propagates policy, keys, revocation, and one atomic quota across independent instances', async () => {
    const state = new MemoryControlState();
    await state.bootstrapTenant({
      id: 'tenant-a',
      name: 'Tenant A',
      plan: 'trial',
      apiKey: 'admin-a',
      scopes: ['admin'],
    });
    const services = await Promise.all(
      [0, 1].map(async () => {
        const service = createManagedServer(
          { databasePath: await database(), masterSecret: secret },
          { controlState: state },
        );
        service.store.bootstrapTenant({
          id: 'tenant-a',
          name: 'Tenant A',
          plan: 'trial',
          apiKey: 'local-only-admin',
        });
        await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
        const address = service.server.address();
        if (!address || typeof address === 'string') throw new Error('missing server address');
        return { service, base: `http://127.0.0.1:${address.port}` };
      }),
    );
    try {
      const adminHeaders = {
        authorization: 'Bearer admin-a',
        'content-type': 'application/json',
      };
      const issuedResponse = await fetch(`${services[0]!.base}/v1/admin/api-keys`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ scopes: ['validate'] }),
      });
      expect(issuedResponse.status).toBe(201);
      const issued = (await issuedResponse.json()) as { key_id: string; api_key: string };
      expect(services[1]!.service.store.authenticate(issued.api_key)).toBeUndefined();

      expect(
        (
          await fetch(`${services[0]!.base}/v1/admin/policy`, {
            method: 'PUT',
            headers: adminHeaders,
            body: JSON.stringify({ allowed_repairs: [] }),
          })
        ).status,
      ).toBe(200);
      const validationBody = JSON.stringify({
        tool_name: 'counter',
        tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
        raw_arguments: { count: '2' },
      });
      const rejected = await fetch(`${services[1]!.base}/v1/validate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.api_key}`, 'content-type': 'application/json' },
        body: validationBody,
      });
      expect(rejected.status).toBe(422);

      expect(
        (
          await fetch(`${services[1]!.base}/v1/admin/policy`, {
            method: 'PUT',
            headers: adminHeaders,
            body: '{}',
          })
        ).status,
      ).toBe(200);
      const raced = await Promise.all(
        Array.from({ length: 8 }, (_unused, index) =>
          fetch(`${services[index % 2]!.base}/v1/validate`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${issued.api_key}`,
              'content-type': 'application/json',
            },
            body: validationBody,
          }),
        ),
      );
      expect(raced.filter((response) => response.status === 200)).toHaveLength(1);
      expect(raced.filter((response) => response.status === 429)).toHaveLength(7);

      const usageResponses = await Promise.all(
        services.map(({ base }) =>
          fetch(`${base}/v1/usage`, { headers: { authorization: 'Bearer admin-a' } }),
        ),
      );
      const usage = (await Promise.all(
        usageResponses.map((response) => response.json()),
      )) as Array<{
        usage: SharedUsage;
      }>;
      expect(usage[0]!.usage).toEqual(usage[1]!.usage);
      expect(usage[0]!.usage).toMatchObject({ validation_count: 2, rejection_count: 1 });
      const audits = await Promise.all(
        services.map(({ base }) =>
          fetch(`${base}/v1/audits`, { headers: { authorization: 'Bearer admin-a' } }).then(
            async (response) => (await response.json()) as { audits: SharedAuditRecord[] },
          ),
        ),
      );
      expect(audits[0]).toEqual(audits[1]);
      expect(audits[0]!.audits).toHaveLength(2);
      expect(audits[0]!.audits.every((audit) => !('valid_arguments' in audit.envelope))).toBe(true);
      const verification = await fetch(`${services[1]!.base}/v1/audits/verify`, {
        headers: { authorization: 'Bearer admin-a' },
      });
      expect(verification.status).toBe(200);
      expect(await verification.json()).toEqual({ valid: true, checked: 2 });

      const revoked = await fetch(
        `${services[1]!.base}/v1/admin/api-keys/${encodeURIComponent(issued.key_id)}`,
        { method: 'DELETE', headers: adminHeaders },
      );
      expect(revoked.status).toBe(200);
      expect(await revoked.json()).toEqual({ revoked: true });
      expect(
        (
          await fetch(`${services[0]!.base}/v1/validate`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${issued.api_key}`,
              'content-type': 'application/json',
            },
            body: validationBody,
          })
        ).status,
      ).toBe(401);
      state.available = false;
      await expect(
        Promise.all(services.map(({ base }) => fetch(`${base}/readyz`))).then((responses) =>
          responses.map((response) => response.status),
        ),
      ).resolves.toEqual([503, 503]);
    } finally {
      await Promise.all(services.map(({ service }) => service.close()));
    }
  });

  it('enforces one per-key rate window across independent instances', async () => {
    const state = new MemoryControlState();
    await state.bootstrapTenant({
      id: 'rate-tenant',
      name: 'Rate Tenant',
      plan: 'trial',
      apiKey: 'rate-admin',
    });
    const services = await Promise.all(
      [0, 1].map(async () => {
        const service = createManagedServer(
          { databasePath: await database(), masterSecret: secret, rateLimitPerMinute: 2 },
          { controlState: state },
        );
        service.store.bootstrapTenant({
          id: 'rate-tenant',
          name: 'Rate Tenant',
          plan: 'trial',
          apiKey: 'local-rate-admin',
        });
        await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
        const address = service.server.address();
        if (!address || typeof address === 'string') throw new Error('missing server address');
        return { service, base: `http://127.0.0.1:${address.port}` };
      }),
    );
    try {
      const headers = { authorization: 'Bearer rate-admin' };
      const responses = await Promise.all([
        fetch(`${services[0]!.base}/v1/usage`, { headers }),
        fetch(`${services[1]!.base}/v1/usage`, { headers }),
        fetch(`${services[0]!.base}/v1/usage`, { headers }),
      ]);
      expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
      expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
      await expect(
        responses.find((response) => response.status === 429)!.json(),
      ).resolves.toMatchObject({ error: 'rate_limit_exceeded' });
    } finally {
      await Promise.all(services.map(({ service }) => service.close()));
    }
  });
});
