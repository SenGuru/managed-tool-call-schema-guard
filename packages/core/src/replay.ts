import { sha256 } from './hash.js';
import { validateToolCall } from './engine.js';
import { assertJsonSafety } from './limits.js';
import {
  type GuardDecision,
  type JsonValue,
  type ReplayExpectation,
  type ReplayFixture,
  type ReplayMismatch,
  type ReplayReport,
  type ReplaySuiteReport,
  type ValidateRequest,
} from './types.js';

const FIXTURE_VERSION = '2026-07-20' as const;

function expectation(decision: GuardDecision): ReplayExpectation {
  return {
    decision: decision.decision,
    ...(decision.decision === 'rejected' ? { reason_code: decision.reason_code } : {}),
    repair_rule_ids: decision.repaired_fields.map((repair) => repair.rule_id),
    repaired_paths: decision.repaired_fields.map((repair) => repair.path),
    ...(decision.decision !== 'rejected'
      ? { valid_arguments_hash: sha256(decision.valid_arguments) }
      : {}),
    policy_outcome: decision.policy_result.outcome,
    policy_reasons: [...decision.policy_result.reasons],
    validation_issue_signatures:
      decision.decision === 'rejected'
        ? (decision.validation_errors ?? [])
            .map((item) => `${item.path}|${item.keyword}|${item.expected ?? ''}`)
            .sort()
        : [],
  };
}

function cloneRequest(request: ValidateRequest): ValidateRequest {
  assertJsonSafety(request, 'replay request');
  return structuredClone(request);
}

export function createReplayFixture(
  request: ValidateRequest,
  decision: GuardDecision = validateToolCall(request),
): ReplayFixture {
  const clonedRequest = cloneRequest(request);
  const expected = expectation(decision);
  return {
    fixture_version: FIXTURE_VERSION,
    fixture_id: sha256({ fixture_version: FIXTURE_VERSION, request: clonedRequest, expected }),
    request: clonedRequest,
    expected,
    source_audit_id: decision.audit_id,
    privacy: {
      classification: 'local_sensitive',
      contains_raw_argument_values: true,
      safe_for_managed_upload: false,
    },
  };
}

function assertFixture(fixture: ReplayFixture): void {
  assertJsonSafety(fixture, 'replay fixture');
  if (fixture.fixture_version !== FIXTURE_VERSION)
    throw new TypeError(`unsupported replay fixture version: ${String(fixture.fixture_version)}`);
  if (!fixture.request || !fixture.expected || typeof fixture.fixture_id !== 'string')
    throw new TypeError('malformed replay fixture');
  if (
    fixture.privacy?.classification !== 'local_sensitive' ||
    !fixture.privacy.contains_raw_argument_values ||
    fixture.privacy.safe_for_managed_upload
  )
    throw new TypeError('replay fixture privacy declaration is missing or invalid');
  const computed = sha256({
    fixture_version: fixture.fixture_version,
    request: fixture.request,
    expected: fixture.expected,
  });
  if (computed !== fixture.fixture_id) throw new TypeError('replay fixture integrity check failed');
}

function compare(expected: ReplayExpectation, actual: ReplayExpectation): ReplayMismatch[] {
  const fields = [
    'decision',
    'reason_code',
    'repair_rule_ids',
    'repaired_paths',
    'valid_arguments_hash',
    'policy_outcome',
    'policy_reasons',
    'validation_issue_signatures',
  ] as const;
  const mismatches: ReplayMismatch[] = [];
  for (const field of fields) {
    const expectedValue = expected[field] ?? null;
    const actualValue = actual[field] ?? null;
    if (sha256(expectedValue) !== sha256(actualValue))
      mismatches.push({
        field,
        expected: expectedValue as JsonValue,
        actual: actualValue as JsonValue,
      });
  }
  return mismatches;
}

export function replayFixture(fixture: ReplayFixture): ReplayReport {
  assertFixture(fixture);
  const decision = validateToolCall(cloneRequest(fixture.request));
  const actual = expectation(decision);
  const mismatches = compare(fixture.expected, actual);
  return {
    fixture_id: fixture.fixture_id,
    passed: mismatches.length === 0,
    expected: structuredClone(fixture.expected),
    actual,
    mismatches,
  };
}

export function replaySuite(fixtures: ReplayFixture[]): ReplaySuiteReport {
  if (!Array.isArray(fixtures) || fixtures.length === 0)
    throw new TypeError('replay suite must contain at least one fixture');
  const reports = fixtures.map(replayFixture);
  const passedCount = reports.filter((report) => report.passed).length;
  return {
    passed: passedCount === reports.length,
    total: reports.length,
    passed_count: passedCount,
    failed_count: reports.length - passedCount,
    reports,
  };
}
