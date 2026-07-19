import { describe, expect, it } from 'vitest';
import { detectSchemaDrift } from '../packages/core/src/index.js';
import {
  aggregateCompatibilityMatrix,
  clusterFailures,
  extractFailureSignature,
  recommendFixes,
  scoreSchemaQuality,
} from '../packages/managed/src/intelligence.js';

describe('managed compatibility intelligence', () => {
  it('extracts deterministic value-free signatures and generalizes array indices', () => {
    const first = extractFailureSignature({
      adapter: 'mcp',
      provider: ' Anthropic ',
      framework: 'MCP',
      decision: 'rejected',
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      validation_issues: [
        { path: '/items/0/count', keyword: 'type', message: 'secret A', expected: 'integer' },
      ],
    });
    const second = extractFailureSignature({
      adapter: 'mcp',
      provider: 'anthropic',
      framework: 'mcp',
      decision: 'rejected',
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      validation_issues: [
        { path: '/items/99/count', keyword: 'type', message: 'secret B', expected: 'integer' },
      ],
    });
    expect(first?.id).toBe(second?.id);
    expect(first?.issue_shapes).toEqual(['/items/*/count|type|integer']);
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(
      extractFailureSignature({ adapter: 'mcp', provider: 'x', framework: 'y', decision: 'valid' }),
    ).toBeNull();
  });

  it('clusters out-of-order observations deterministically', () => {
    const observation = {
      adapter: 'openai_agents' as const,
      provider: 'OpenAI',
      framework: 'Agents SDK',
      decision: 'valid_with_repair' as const,
      repair_rule_ids: ['coerce.string_to_integer' as const],
    };
    expect(
      clusterFailures([
        { observed_at: '2026-07-19T10:00:00Z', provider_version: '2', observation },
        { observed_at: '2026-07-18T10:00:00Z', provider_version: '1', observation },
      ]),
    ).toMatchObject([
      {
        category: 'repair',
        event_count: 2,
        first_seen_at: '2026-07-18T10:00:00.000Z',
        last_seen_at: '2026-07-19T10:00:00.000Z',
        affected_versions: ['1', '2'],
      },
    ]);
  });

  it('scores schema quality from explainable bounded deductions', () => {
    const weak = scoreSchemaQuality({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
    const strong = scoreSchemaQuality({
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query', minLength: 1, maxLength: 200 },
        limit: { type: 'integer', description: 'Maximum results', minimum: 1, maximum: 20 },
      },
    });
    expect(weak.score).toBeLessThan(strong.score);
    expect(weak.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'CLOSE_OBJECT_SCHEMA',
        'DECLARE_REQUIRED_FIELDS',
        'ADD_PROPERTY_DESCRIPTION',
      ]),
    );
    expect(strong).toMatchObject({ score: 100, grade: 'excellent' });
    expect(strong.metrics).toEqual({
      object_count: 1,
      property_count: 2,
      described_property_count: 2,
      constrained_leaf_count: 2,
      leaf_count: 2,
    });
  });

  it('turns quality, recurring failures, and breaking drift into prioritized fixes', () => {
    const clusters = clusterFailures(
      Array.from({ length: 10 }, (_, index) => ({
        observed_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}Z`,
        observation: {
          adapter: 'mcp' as const,
          provider: 'anthropic',
          framework: 'mcp',
          decision: 'rejected' as const,
          reason_code: 'SCHEMA_VALIDATION_FAILED' as const,
          validation_issues: [
            { path: '/count', keyword: 'type', message: 'bad', expected: 'integer' },
          ],
        },
      })),
    );
    const recommendations = recommendFixes({
      quality: scoreSchemaQuality({ type: 'object', properties: { count: { type: 'integer' } } }),
      clusters,
      drift: detectSchemaDrift(
        { type: 'object', properties: { count: { type: 'integer' } } },
        { type: 'object', required: ['count'], properties: { count: { type: 'integer' } } },
      ),
    });
    expect(recommendations[0]).toMatchObject({
      code: 'ADDRESS_BREAKING_DRIFT',
      severity: 'critical',
    });
    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FIX_CALLER_ARGUMENT_SHAPE',
          path: '/count',
          severity: 'critical',
        }),
      ]),
    );
  });

  it('aggregates compatibility runs and uses the newest run for version metadata', () => {
    const matrix = aggregateCompatibilityMatrix([
      {
        provider: 'OpenAI',
        provider_version: '1',
        framework: 'Agents',
        framework_version: '1',
        adapter: 'openai_agents',
        suite_version: '1',
        executed_at: '2026-07-18T00:00:00Z',
        passed: 8,
        failed: 2,
        repaired: 2,
        rejected: 0,
        failure_signature_ids: ['b'],
      },
      {
        provider: 'openai',
        provider_version: '2',
        framework: 'agents',
        framework_version: '2',
        adapter: 'openai_agents',
        suite_version: '2',
        executed_at: '2026-07-19T00:00:00Z',
        passed: 10,
        failed: 0,
        repaired: 0,
        rejected: 0,
        failure_signature_ids: ['a'],
      },
    ]);
    expect(matrix).toEqual([
      expect.objectContaining({
        provider: 'openai',
        framework: 'agents',
        status: 'degraded',
        pass_rate: 0.9,
        total_cases: 20,
        latest_provider_version: '2',
        latest_suite_version: '2',
        last_tested_at: '2026-07-19T00:00:00.000Z',
        failure_signature_ids: ['a', 'b'],
      }),
    ]);
    expect(() =>
      aggregateCompatibilityMatrix([
        {
          ...{
            provider: 'x',
            provider_version: '1',
            framework: 'y',
            framework_version: '1',
            adapter: 'mcp' as const,
            suite_version: '1',
            executed_at: 'bad',
            passed: 1,
            failed: 0,
            repaired: 0,
            rejected: 0,
          },
        },
      ]),
    ).toThrow('valid timestamp');
    expect(() =>
      aggregateCompatibilityMatrix([
        {
          provider: 'x',
          provider_version: '1',
          framework: 'y',
          framework_version: '1',
          adapter: 'mcp',
          suite_version: '1',
          executed_at: '2026-07-19T00:00:00Z',
          passed: 1,
          failed: 0,
          repaired: 1,
          rejected: 1,
        },
      ]),
    ).toThrow('cannot exceed total cases');
  });
});
