# Product-value benchmark test

## Purpose

This test uses artifacts from five purpose-built tool/function-calling benchmark
repositories to examine three product hypotheses:

1. Schema Guard intercepts failures present in recorded tool-call data.
2. Allowlisted repair recovers useful calls that validation alone rejects.
3. Schema Guard returns a more complete incident record for diagnosis.

These are benchmark-backed technical tests. They are not substitutes for
production telemetry or a timed study with developers.

## Dataset and baseline

The input contains 7,699 recorded calls from ToolBench, StableToolBench,
ToolAlpaca, Seal-Tools, and API-Bank. Each call is paired with its repository's
advertised schema. The comparison baseline parses JSON and applies JSON Schema
without coercion, policy, repair, audit IDs, or repair hints.

Downloaded repository code and dependencies are never executed. ToolBench's
non-standard `optional` and `example_value` metadata are removed when converting
its declarations to JSON Schema; validation constraints are retained.

## Result 1: observed failure interception

- Recorded calls examined: **7,699**
- Source-contract failures intercepted: **124**
- Observed interception rate: **1.61%**
- Rejection breakdown: 92 schema-validation failures, 32 malformed argument-JSON
  failures
- Plain-validator agreement: **124/124**

The 124 records demonstrate failures
present in benchmark artifacts. They do not establish the failure rate of a
specific production agent fleet.

## Result 2: repair beyond validation

From contract-conforming benchmark calls, the harness created 1,117 controlled
type-drift cases by changing an originally valid number, integer, or boolean into
its exact string representation. No ambiguous representations are introduced.

- Plain validator rejected: **1,117/1,117**
- Schema Guard returned `valid_with_repair`: **1,117/1,117**
- Integer repairs: **775**
- Number repairs: **341**
- Boolean repairs: **1**

This proves that the implemented repair layer can recover a bounded class of
calls that validation alone cannot resolve. It does not prove how frequently
these repairable failures occur naturally in production.

## Result 3: diagnostic-workflow proxy

The harness evaluated 21,635 rejected source or derived incidents. A Schema Guard
response is considered one-response triage-ready when it contains all three of:

- a stable `reason_code`;
- a human-readable `repair_hint`; and
- an `audit_id` that can correlate the incident with history.

Results:

- Schema Guard one-response triage-ready: **21,635/21,635 (100%)**
- Plain baseline with a machine-readable field-level schema issue:
  **14,028/21,635 (64.84%)**

The plain baseline has no stable product-level reason taxonomy, remediation hint,
or audit correlation ID. Schema Guard therefore removes integration work needed
to produce those fields and makes every tested rejection immediately routable.

This is evidence of diagnostic completeness, not proof of elapsed debugging-time
reduction. A defensible time-savings claim still requires a controlled study in
which developers diagnose the same blinded incidents with and without Schema
Guard.

## Reproduction

```bash
npm run audit:benchmarks
```

The durable machine-readable results are in
`audit-results/multi-benchmark-replay.json` under `value_tests`.
