import { describe, expect, it } from 'vitest';

import { valueFreeEvaluationExport } from '../packages/managed/src/evaluation-export.js';

describe('value-free evaluation export', () => {
  it('exports only allowlisted structural and aggregate evidence', () => {
    const exported = valueFreeEvaluationExport(
      {
        privacy_threshold: 4,
        failure_clusters: [
          {
            id: 'signature-hash',
            category: 'validation',
            adapter: 'openai_agents',
            provider: 'openai',
            framework: 'agents-sdk',
            event_count: 9,
            raw_arguments: { password: 'must-not-leak' },
            tenant_id: 'tenant-must-not-leak',
          },
        ],
        schema_quality: [
          {
            tool_name_hash: 'tool-hash',
            schema_hash: 'schema-hash',
            adapter: 'json_schema',
            version: '1',
            quality: { score: 92, issues: [{ code: 'closed_world' }] },
            schema: { secret: 'must-not-leak' },
          },
        ],
        compatibility_matrix: [
          {
            provider: 'openai',
            latest_provider_version: '2026-07',
            framework: 'agents-sdk',
            latest_framework_version: '1.2.3',
            adapter: 'openai_agents',
            status: 'verified',
          },
        ],
        recommendations: [
          {
            code: 'require_closed_schema',
            severity: 'warning',
            message: 'Set additionalProperties to false',
            source: 'schema_registry',
            prompt: 'must-not-leak',
          },
        ],
      },
      '2026-07-25T00:00:00.000Z',
    );

    expect(exported.summary).toEqual({
      failure_clusters: 1,
      schema_quality_records: 1,
      compatibility_records: 1,
      recommendations: 1,
    });
    expect(exported.privacy).toMatchObject({
      value_free: true,
      privacy_threshold: 4,
      tenant_identifiers_included: false,
      raw_arguments_included: false,
    });
    expect(exported.records.map((record) => record.record_type)).toEqual([
      'failure_cluster',
      'schema_quality',
      'compatibility',
      'recommendation',
    ]);
    expect(JSON.stringify(exported)).not.toContain('must-not-leak');
    expect(JSON.stringify(exported)).not.toContain('tenant-must-not-leak');
    expect(exported.records.every((record) => !('tenant_id' in record))).toBe(true);
    expect(exported.content_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('is content-addressed independently of generation time', () => {
    const first = valueFreeEvaluationExport({}, '2026-07-25T00:00:00.000Z');
    const second = valueFreeEvaluationExport({}, '2026-07-26T00:00:00.000Z');
    expect(first.content_sha256).toBe(second.content_sha256);
    expect(first.generated_at).not.toBe(second.generated_at);
  });
});
