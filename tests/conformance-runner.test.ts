import { describe, expect, it } from 'vitest';
import { buildConformanceReport, compareReports } from '../scripts/run-conformance.js';

describe('offline conformance runner', () => {
  it('produces a complete deterministic compatibility report', () => {
    const first = buildConformanceReport();
    const second = buildConformanceReport();

    expect(first).toEqual(second);
    expect(first.passed).toBe(true);
    expect(first.summary).toEqual({
      corpus_cases: 8,
      corpus_passed: 8,
      adapters: 4,
      adapters_normalized: 4,
      adapter_probes: 8,
      adapter_probes_passed: 8,
    });
    expect(first.compatibility.map((entry) => entry.adapter)).toEqual([
      'mcp',
      'openai_agents',
      'pydantic_ai',
      'google_adk',
    ]);
    expect(first.compatibility.every((entry) => entry.schema_hash?.startsWith('sha256:'))).toBe(
      true,
    );
  });

  it('reports precise regression paths', () => {
    const current = buildConformanceReport();
    const changed = structuredClone(current);
    changed.corpus[1]!.actual_decision = 'rejected';

    expect(compareReports(current, changed)).toEqual([
      {
        path: '/corpus/1/actual_decision',
        expected: 'valid_with_repair',
        actual: 'rejected',
      },
    ]);
  });
});
