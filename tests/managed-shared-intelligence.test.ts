import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256, type GuardDecision } from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import type {
  IntelligenceState,
  SharedCompatibilityMatrixCell,
  SharedConformanceRun,
  SharedFailureCluster,
  SharedObservationContext,
  SharedSignedRuleSet,
} from '../packages/shared-state/src/index.js';

const secret = 'managed-shared-intelligence-test-secret-at-least-32-chars';

class MemoryIntelligenceState implements IntelligenceState {
  readonly observations = new Map<string, SharedFailureCluster[]>();
  readonly runs = new Map<string, SharedConformanceRun[]>();
  readonly rulesets = new Map<string, SharedSignedRuleSet[]>();
  available = true;
  migrate(): Promise<void> {
    return Promise.resolve();
  }
  ready(): Promise<boolean> {
    return Promise.resolve(this.available);
  }
  bootstrapTenant(tenantId: string): Promise<void> {
    this.observations.set(tenantId, []);
    this.runs.set(tenantId, []);
    this.rulesets.set(tenantId, []);
    return Promise.resolve();
  }
  recordObservation(
    tenantId: string,
    decision: GuardDecision,
    context: SharedObservationContext = {},
  ): Promise<void> {
    if (decision.decision === 'valid') return Promise.resolve();
    const provider = context.provider?.toLowerCase() ?? 'unspecified';
    const framework = context.framework?.toLowerCase() ?? context.adapter ?? 'json_schema';
    const repair_rule_ids = decision.repaired_fields.map((repair) => repair.rule_id).sort();
    const issue_shapes =
      decision.decision === 'rejected'
        ? (decision.validation_errors ?? []).map((issue) => `${issue.path}|${issue.keyword}`).sort()
        : [];
    const signature = sha256({
      category: decision.decision === 'rejected' ? 'rejection' : 'repair',
      adapter: context.adapter ?? 'json_schema',
      provider,
      framework,
      repair_rule_ids,
      issue_shapes,
    });
    const rows = this.observations.get(tenantId)!;
    const existing = rows.find((row) => row.id === signature);
    if (existing) existing.event_count += 1;
    else
      rows.push({
        id: signature,
        category: decision.decision === 'rejected' ? 'rejection' : 'repair',
        adapter: context.adapter ?? 'json_schema',
        provider,
        framework,
        ...(decision.decision === 'rejected' ? { reason_code: decision.reason_code } : {}),
        repair_rule_ids,
        issue_shapes,
        event_count: 1,
        first_seen_at: decision.audit.timestamp,
        last_seen_at: decision.audit.timestamp,
        affected_versions: context.provider_version ? [context.provider_version] : [],
      });
    return Promise.resolve();
  }
  tenantFailureClusters(tenantId: string): Promise<SharedFailureCluster[]> {
    return Promise.resolve(structuredClone(this.observations.get(tenantId)!));
  }
  networkFailureClusters(): Promise<Array<SharedFailureCluster & { tenant_count: number }>> {
    return Promise.resolve([]);
  }
  recordConformanceRun(
    tenantId: string,
    run: SharedConformanceRun,
  ): Promise<{ recorded: boolean; report_hash: string }> {
    const normalized = { ...run, failure_signature_ids: [...(run.failure_signature_ids ?? [])] };
    const report_hash = sha256(normalized);
    const rows = this.runs.get(tenantId)!;
    const recorded = !rows.some((row) => sha256(row) === report_hash);
    if (recorded) rows.push(structuredClone(normalized));
    return Promise.resolve({ recorded, report_hash });
  }
  compatibilityMatrix(tenantId: string): Promise<SharedCompatibilityMatrixCell[]> {
    return Promise.resolve(
      this.runs.get(tenantId)!.map((run) => ({
        provider: run.provider,
        framework: run.framework,
        adapter: run.adapter,
        status: run.passed + run.failed < 10 ? 'insufficient_data' : 'compatible',
        pass_rate: run.passed / (run.passed + run.failed),
        total_cases: run.passed + run.failed,
        passed: run.passed,
        failed: run.failed,
        repaired: run.repaired,
        rejected: run.rejected,
        latest_provider_version: run.provider_version,
        latest_framework_version: run.framework_version,
        latest_suite_version: run.suite_version,
        last_tested_at: new Date(run.executed_at).toISOString(),
        failure_signature_ids: [...(run.failure_signature_ids ?? [])],
      })),
    );
  }
  publishRuleset(
    tenantId: string,
    input: Omit<SharedSignedRuleSet, 'key_id' | 'public_key' | 'signature'>,
  ): Promise<SharedSignedRuleSet> {
    const ruleset = {
      ...structuredClone(input),
      key_id: 'memory-key',
      public_key: 'memory-public-key',
      signature: `memory:${sha256(input)}`,
    };
    this.rulesets.get(tenantId)!.push(ruleset);
    return Promise.resolve(structuredClone(ruleset));
  }
  latestRuleset(tenantId: string): Promise<SharedSignedRuleSet | undefined> {
    return Promise.resolve(structuredClone(this.rulesets.get(tenantId)!.at(-1)));
  }
  verifyRuleset(ruleset: SharedSignedRuleSet): Promise<boolean> {
    const input = {
      version: ruleset.version,
      issued_at: ruleset.issued_at,
      expires_at: ruleset.expires_at,
      rules: ruleset.rules,
    };
    return Promise.resolve(ruleset.signature === `memory:${sha256(input)}`);
  }
  verifyTenantHistory(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return Promise.resolve({
      valid: this.available,
      checked:
        this.observations.get(tenantId)!.length +
        this.runs.get(tenantId)!.length +
        this.rulesets.get(tenantId)!.length,
    });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-shared-intelligence-')), 'managed.db');
}

describe('managed shared intelligence state', () => {
  it('shares value-free observations, conformance, rulesets, and readiness across instances', async () => {
    const state = new MemoryIntelligenceState();
    await state.bootstrapTenant('tenant-a');
    const services = await Promise.all(
      [0, 1].map(async () => {
        const service = createManagedServer(
          { databasePath: await database(), masterSecret: secret },
          { intelligenceState: state },
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
    const headers = { authorization: 'Bearer admin-a', 'content-type': 'application/json' };
    try {
      const rejected = await fetch(`${services[0]!.base}/v1/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool_name: 'private-tool-name',
          tool_schema: {
            type: 'object',
            properties: { query: { type: 'string', enum: ['secret-contract-value'] } },
            required: ['query'],
          },
          raw_arguments: { query: 'private-customer-value' },
          context: {
            adapter: 'mcp',
            provider: 'Anthropic',
            provider_version: 'v1',
            framework: 'LangGraph',
          },
        }),
      });
      expect(rejected.status).toBe(422);
      expect(JSON.stringify(state.observations)).not.toContain('private-customer-value');
      expect(JSON.stringify(state.observations)).not.toContain('secret-contract-value');
      expect(JSON.stringify(state.observations)).not.toContain('private-tool-name');

      const conformance = {
        provider: 'anthropic',
        provider_version: 'v1',
        framework: 'langgraph',
        framework_version: '1.0.0',
        adapter: 'mcp',
        suite_version: '2026.07',
        executed_at: '2026-07-20T00:00:00Z',
        passed: 20,
        failed: 0,
        repaired: 2,
        rejected: 0,
      };
      expect(
        (
          await fetch(`${services[1]!.base}/v1/conformance-runs`, {
            method: 'POST',
            headers,
            body: JSON.stringify(conformance),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await fetch(`${services[0]!.base}/v1/conformance-runs`, {
            method: 'POST',
            headers,
            body: JSON.stringify(conformance),
          })
        ).status,
      ).toBe(200);

      const issued = new Date(Date.now() - 1_000).toISOString();
      const expires = new Date(Date.now() + 86_400_000).toISOString();
      expect(
        (
          await fetch(`${services[0]!.base}/v1/admin/rulesets`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              version: '2026.07.1',
              issued_at: issued,
              expires_at: expires,
              rules: [
                {
                  id: 'coerce.string_to_integer',
                  enabled_by_default: false,
                  description: 'Typed integer repair.',
                },
              ],
            }),
          })
        ).status,
      ).toBe(201);
      const latest = await fetch(`${services[1]!.base}/v1/rulesets/latest`, { headers });
      expect(latest.status).toBe(200);
      await expect(latest.json()).resolves.toMatchObject({ version: '2026.07.1' });

      const reports = await Promise.all(
        services.map(({ base }) =>
          fetch(`${base}/v1/intelligence`, { headers }).then((response) => response.json()),
        ),
      );
      expect(reports[0]).toEqual(reports[1]);
      expect(reports[0]).toMatchObject({
        failure_clusters: [{ provider: 'anthropic', framework: 'langgraph', event_count: 1 }],
        compatibility_matrix: [{ status: 'compatible', total_cases: 20 }],
      });
      state.available = false;
      expect((await fetch(`${services[1]!.base}/readyz`)).status).toBe(503);
    } finally {
      await Promise.all(services.map(({ service }) => service.close()));
    }
  });
});
