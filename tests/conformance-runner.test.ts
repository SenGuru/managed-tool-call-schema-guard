import { readFileSync } from 'node:fs';
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

  it('keeps real-repo extracted fixtures populated and value-free', () => {
    const snapshot = JSON.parse(
      readFileSync('real-repo-corpus/extracted-fixtures.json', 'utf8'),
    ) as {
      repos: { id: string; head: string; signal_count_sampled: number }[];
      fixtures: {
        repo_id: string;
        adapter: string;
        source_fingerprint: string;
        schema_hash: string;
        probe_decision: string;
      }[];
    };
    expect(snapshot.repos).toHaveLength(20);
    expect(new Set(snapshot.repos.map((repo) => repo.id)).size).toBe(20);
    expect(snapshot.repos.every((repo) => repo.head.length >= 40)).toBe(true);
    expect(snapshot.repos.every((repo) => repo.signal_count_sampled >= 1)).toBe(true);
    expect(snapshot.fixtures.length).toBeGreaterThanOrEqual(100);
    expect(
      new Set(snapshot.fixtures.map((fixture) => fixture.repo_id)).size,
    ).toBeGreaterThanOrEqual(8);
    expect(
      snapshot.fixtures.every((fixture) => fixture.source_fingerprint.startsWith('sha256:')),
    ).toBe(true);
    expect(snapshot.fixtures.every((fixture) => fixture.schema_hash.startsWith('sha256:'))).toBe(
      true,
    );
    const terminalDecisions = new Set(['valid', 'valid_with_repair', 'rejected']);
    expect(
      snapshot.fixtures.every((fixture) => terminalDecisions.has(fixture.probe_decision)),
    ).toBe(true);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('raw_arguments');
    expect(serialized).not.toContain('DEMO_SECRET_MUST_NOT_APPEAR');
  });
});
