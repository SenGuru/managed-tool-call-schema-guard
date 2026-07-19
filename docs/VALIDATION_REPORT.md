# Local validation report

Date: 2026-07-19

## Deterministic release suite

- Clean dependency install succeeds on Node.js 22.23.1 and npm 10.9.8.
- Formatting, lint, TypeScript compilation, 54 Vitest tests, and Python parity pass.
- The suite covers protocol envelopes, conformance fixtures, adapters, policy,
  safe repairs, unsafe precision, local `$ref`, drift, execution gating, HTTP,
  managed tenant isolation, quotas, audit tamper detection, retention anchors,
  ruleset signing, backup/restore, and property-generated inputs.
- The dependency audit reports zero known vulnerabilities.
- A 10,000-iteration local core benchmark measured about 6.5 µs p50, 8.3 µs
  p95, and 12.1 µs p99 on the validation machine; this is not a hosted SLA.

## Real agent-in-the-loop run

The local MCP mutation harness was exercised by Codex CLI 0.144.1 with
`gpt-5.6-sol` at medium reasoning effort and Claude Code 2.1.214 at medium
effort. Each agent made 12 actual MCP calls; the machine verifier used the
server logs rather than trusting either agent's prose summary.

Per agent:

- 5 calls reached a strict fake downstream tool: one already valid call, two
  allowlisted repair cases, one nested Google ADK normalization case, and one
  MCP normalization-plus-repair case.
- 5 calls were rejected before execution: a missing required field, ambiguous
  numeric text, an unsafe integer outside JavaScript's safe range, an extra
  secret-shaped field, and an organization-policy denial.
- 2 schema revisions were detected without execution: a tightened minimum was
  `breaking`; a changed combinator was conservatively marked `review`.
- No rejected call executed, no case was retried, all expected outcomes matched,
  and the dummy secret value was absent from both privacy-minimized logs.

Aggregate: 24 agent-originated MCP calls, 10 guarded executions, 10 blocked
calls, and 4 drift classifications, with zero machine-verifier mismatches.

## Honest boundary

This proves the local deterministic enforcement path and test adapters work
under the covered cases. It is not production certification, proof against all
schemas/framework versions, a hosted reliability claim, or evidence of product-market fit.
