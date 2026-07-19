# Local validation report

Date: 2026-07-19

## Deterministic release suite

- Clean dependency install succeeds on Node.js 22.23.1 and npm 10.9.8.
- A fresh local clone with no generated `dist` directories completes install,
  build, lint, all tests, CLI validation/drift, demo, and Python quickstarts.
- Dry-run package manifests are checked automatically. Core, SDK, and CLI
  tarballs were also installed together in an isolated consumer project; the
  packed SDK local client and packed CLI both returned `valid_with_repair`.
- Formatting, lint, TypeScript compilation, 56 Vitest tests, and Python parity pass.
- The suite covers protocol envelopes, conformance fixtures, adapters, policy,
  safe repairs, unsafe precision, local `$ref`, drift, execution gating, HTTP,
  managed tenant isolation, quotas, audit tamper detection, retention anchors,
  ruleset signing, backup/restore, and property-generated inputs.
- The dependency audit reports zero known vulnerabilities.
- Three 10,000-iteration local core benchmark runs measured 11.7–12.8 µs p50,
  25.1–26.6 µs p95, and 54.4–67.2 µs p99 on the validation machine; this is
  not a hosted SLA.
- A live open-API concurrency pass accepted 500/500 repairable requests,
  persisted 500 parseable value-free audit rows, and produced 500 unique audit
  IDs. A managed concurrency pass accepted 100/100 repairable requests,
  atomically counted and listed all 100, and verified the full 100-event audit
  chain.
- Manual HTTP release checks covered invalid JSON, the 1 MB body cap, security
  headers, normalization, drift, authentication, tenant isolation, scoped-key
  revocation, organization policy, schema alerts, three-tenant privacy
  thresholds, signed rulesets, CSV export, usage, billing boundaries, retention,
  and secret-sentinel scans.

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

## Defects found and closed during the release audit

- Rulesets using valid second-precision ISO timestamps could be invisible during
  the remainder of their issue second because SQLite compared mixed ISO string
  precision lexicographically. Availability queries now compare parsed Julian
  dates, with a regression test for immediate retrieval.
- Managed SQLite database, WAL, SHM, and backup files inherited a normal umask
  and could be group/world readable. The store now forces owner-only `0600`
  permissions and verifies them in the backup/restore regression test.
- The release command depended on ignored build artifacts because typed lint ran
  before workspace declarations existed. Lint and every advertised executable
  surface now compile their workspace dependencies before running, and the
  sequence is verified from a fresh clone.
- The dashboard retained the previous tenant's panels after a later
  authentication failure. It now clears all tenant data before each load and
  again on failure; a real-browser valid-key/invalid-key transition confirms the
  stale data is removed.
- The SDK tarball omitted its compiled entry point even though `main` referenced
  it, and publishable packages lacked included license text. Publish manifests
  now explicitly include compiled output and MIT license files; an automated
  package gate rejects incomplete core, SDK, or CLI artifacts.

## Honest boundary

This proves the local deterministic enforcement path and test adapters work
under the covered cases. It is not production certification, proof against all
schemas/framework versions, a hosted reliability claim, or evidence of product-market fit.
