import { readFileSync } from 'node:fs';

const paths = process.argv.slice(2);
if (!paths.length) throw new Error('pass one or more agent-loop JSONL result paths');
const baseExpected = new Map([
  ['valid_call', ['valid', true]],
  ['repairable_strings', ['valid_with_repair', true]],
  ['missing_required', ['rejected', false]],
  ['ambiguous_numeric', ['rejected', false]],
  ['unsafe_precision', ['rejected', false]],
  ['secret_extra_field', ['rejected', false]],
  ['allowlisted_singleton', ['valid_with_repair', true]],
  ['organization_policy_denial', ['rejected', false]],
]);
const expected = new Map();
for (let round = 1; round <= 13; round += 1) {
  const suffix = String(round).padStart(3, '0');
  for (const [caseId, expectation] of baseExpected)
    expected.set(`${caseId}_${suffix}`, expectation);
}
for (const [caseId, expectation] of [
  ['minimum_tightened', ['breaking', false]],
  ['combinator_changed', ['review', false]],
  ['google_nested_union', ['valid', true]],
  ['mcp_repairable', ['valid_with_repair', true]],
])
  expected.set(caseId, expectation);
let failed = false;
for (const path of paths) {
  const raw = readFileSync(path, 'utf8');
  if (raw.includes('DEMO_SECRET_MUST_NOT_APPEAR')) {
    console.error(`${path}: sensitive sentinel leaked into the privacy-safe log`);
    failed = true;
  }
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const agent = rows[0]?.agent ?? path;
  const cases = rows.filter((row) => row.case_id && !row.duplicate);
  const duplicates = rows.filter((row) => row.duplicate);
  if (duplicates.length) {
    console.error(
      `${agent}: duplicate tool calls: ${duplicates.map((row) => row.case_id).join(', ')}`,
    );
    failed = true;
  }
  for (const [caseId, [decision, executed]] of expected) {
    const matches = cases.filter((row) => row.case_id === caseId);
    if (
      matches.length !== 1 ||
      matches[0].guard_decision !== decision ||
      matches[0].executed !== executed ||
      matches[0].expectation_met !== true
    ) {
      console.error(
        `${agent}: ${caseId} did not produce ${decision}/${executed ? 'execute' : 'block'}`,
      );
      failed = true;
    }
  }
  const executedCount = cases.filter((row) => row.executed).length;
  const rejectedCount = cases.filter((row) => row.guard_decision === 'rejected').length;
  const driftCount = cases.filter((row) => row.category === 'drift').length;
  console.log(
    `${agent}: ${cases.length}/${expected.size} cases, ${executedCount} safely executed, ${rejectedCount} blocked, ${driftCount} drift revisions classified`,
  );
}
if (failed) process.exitCode = 1;
