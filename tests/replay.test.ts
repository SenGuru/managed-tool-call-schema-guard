import { describe, expect, it } from 'vitest';
import {
  createReplayFixture,
  replayFixture,
  replaySuite,
  sha256,
  type ReplayFixture,
  type ValidateRequest,
} from '../packages/core/src/index.js';

const request: ValidateRequest = {
  tool_name: 'book_trip',
  tool_schema: {
    type: 'object',
    additionalProperties: false,
    properties: { passengers: { type: 'integer' } },
    required: ['passengers'],
  },
  raw_arguments: { passengers: '2' },
};

describe('incident replay fixtures', () => {
  it('captures and deterministically replays a repaired production-shaped call', () => {
    const fixture = createReplayFixture(request);
    const report = replayFixture(fixture);
    expect(fixture.privacy).toEqual({
      classification: 'local_sensitive',
      contains_raw_argument_values: true,
      safe_for_managed_upload: false,
    });
    expect(fixture.expected).toMatchObject({
      decision: 'valid_with_repair',
      repair_rule_ids: ['coerce.string_to_integer'],
      repaired_paths: ['/passengers'],
    });
    expect(report.passed).toBe(true);
    expect(report.mismatches).toEqual([]);
  });

  it('detects expectation tampering before replay', () => {
    const fixture = createReplayFixture(request);
    const tampered = structuredClone(fixture);
    tampered.expected.decision = 'valid';
    expect(() => replayFixture(tampered)).toThrow('integrity check failed');
  });

  it('shows exact regression dimensions when a valid fixture is intentionally re-baselined', () => {
    const fixture = createReplayFixture(request);
    const changed = structuredClone(fixture) as ReplayFixture;
    changed.expected.decision = 'valid';
    changed.fixture_id = sha256({
      fixture_version: changed.fixture_version,
      request: changed.request,
      expected: changed.expected,
    });
    const report = replayFixture(changed);
    expect(report.passed).toBe(false);
    expect(report.mismatches.map((item) => item.field)).toContain('decision');
  });

  it('runs suites and rejects stale fixture hashes', () => {
    const first = createReplayFixture(request);
    const second = createReplayFixture({ ...request, raw_arguments: { passengers: '3' } });
    const suite = replaySuite([first, second]);
    expect(suite).toMatchObject({ passed: true, total: 2, passed_count: 2, failed_count: 0 });

    const stale = structuredClone(first);
    stale.request.raw_arguments = { passengers: '9' };
    expect(() => replaySuite([stale])).toThrow('integrity check failed');
  });
});
