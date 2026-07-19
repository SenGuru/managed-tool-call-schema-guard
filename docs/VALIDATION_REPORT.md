# Local validation report

Date: 2026-07-19

## Deterministic release suite

- Clean dependency install succeeds on Node.js 22.23.1 and npm 10.9.8.
- A fresh local clone with no generated `dist` directories completes install,
  build, lint, all tests, CLI validation/drift, demo, and Python quickstarts.
- Dry-run package manifests are checked automatically. Core, SDK, and CLI
  tarballs were also installed together in an isolated consumer project; the
  packed SDK local client and packed CLI both returned `valid_with_repair`.
- Formatting, lint, TypeScript compilation, 67 Vitest tests, and the Python client test pass.
- The suite covers protocol envelopes, conformance fixtures, adapters, policy,
  safe repairs, unsafe precision, local `$ref`, drift, execution gating, HTTP,
  managed tenant isolation, quotas, audit tamper detection, retention anchors,
  ruleset signing, backup/restore, version-5-to-7 database migration,
  environment policy, privacy-thresholded failure clustering, schema scoring,
  recommended fixes, compatibility matrices, and property-generated inputs.
- The dependency audit reports zero known vulnerabilities.
- The latest 10,000-iteration local core benchmark measured 6.9 µs p50,
  9.6 µs p95, and 16.3 µs p99 on the validation machine; this is not a hosted
  SLA or managed-service latency measurement.
- A live open-API concurrency pass accepted 500/500 repairable requests,
  persisted 500 parseable value-free audit rows, and produced 500 unique audit
  IDs. A managed concurrency pass accepted 100/100 repairable requests,
  atomically counted and listed all 100, and verified the full 100-event audit
  chain.
- The expanded managed product-spine pass processed 303 validations across
  three tenants, including 300 concurrent repairs for one tenant. It retained
  301/301 unique tenant-A audit IDs, verified the 301-event signed chain and
  SQLite integrity, released a 302-event failure cluster only after the
  three-tenant threshold, classified breaking drift, generated a recommended
  fix, built a compatible provider/framework matrix, rejected an extra-field
  secret sentinel, and found the sentinel in neither the database nor WAL/SHM.
- Manual HTTP release checks covered invalid JSON, the 1 MB body cap, security
  headers, normalization, drift, authentication, tenant isolation, scoped-key
  revocation, organization policy, schema alerts, three-tenant privacy
  thresholds, signed rulesets, CSV export, usage, billing boundaries, retention,
  and secret-sentinel scans.
- Real-browser dashboard QA loaded usage, signed-chain status, alerts, failure
  clusters, schema quality, drift, compatibility, recommendations, and recent
  decisions from the local service. Replacing the valid key with an invalid key
  cleared every tenant panel and showed the authentication error; the browser
  reported no console warnings or errors.

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
- Compatibility status originally treated correctly rejected adversarial
  cases as conformance failures. A zero-failure suite with expected rejections
  now remains `compatible`; rejection and repair counts stay visible as
  behavioral evidence, with a regression test locking the distinction.

## Honest boundary

This proves the local deterministic enforcement path and test adapters work
under the covered cases. It is not production certification, proof against all
schemas/framework versions, a hosted reliability claim, or evidence of product-market fit.
