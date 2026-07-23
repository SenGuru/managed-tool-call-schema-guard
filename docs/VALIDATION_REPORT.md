# Local validation report

Date: 2026-07-20

## Deterministic release suite

- Clean dependency install succeeds on Node.js 22.23.1 and npm 10.9.8.
- A fresh local clone with no generated `dist` directories completes install,
  build, lint, all tests, CLI validation/drift, demo, and Python quickstarts.
- Dry-run package manifests are checked automatically. Core, SDK, and CLI
  tarballs were also installed together in an isolated consumer project; the
  packed SDK local client and packed CLI both returned `valid_with_repair`.
- Formatting, lint, TypeScript compilation, 158 Vitest tests across 31 executing files,
  and the Python client test pass.
- The suite covers protocol envelopes, conformance fixtures, adapters, policy,
  safe repairs, unsafe precision, local `$ref`, drift, execution gating, HTTP,
  managed tenant isolation, quotas, audit tamper detection, retention anchors,
  ruleset signing, backup/restore, version-5-to-14 database migration,
  environment policy, privacy-thresholded failure clustering, schema scoring,
  recommended fixes, compatibility matrices, and property-generated inputs.
- Raw-argument adversarial cases now reject duplicate JSON members (including
  escaped-equivalent names), over-large/deep JSON strings, accessors without
  invoking them, non-plain objects, sparse arrays, symbol keys, and ill-formed
  Unicode before schema evaluation.
- The dependency audit reports zero known vulnerabilities.
- The latest 10,000-iteration local core benchmark measured 45.375 µs p50,
  73.000 µs p95, and 242.584 µs p99 on the validation machine; this is not a hosted
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
- The production-profile severe audit command (`npm run audit:extreme`) passed
  on the current deploy candidate. It re-ran the full release gate, dependency
  audit, conformance, and benchmark; then it exercised 1,000 concurrent
  repairable calls through the open API and 250 authenticated repairable calls
  through managed public mode. It also verified public-mode HSTS on dashboard and
  JSON responses, unauthenticated rejection, billing-statement integration
  boundary, audit-chain validity, unique audit IDs, owner-only audit/database
  files, and absence of an injected secret sentinel from the managed database.
  Latest report path:
  `/var/folders/sw/zp34fc5d19vgw8fb2zjtbjg40000gn/T/schema-guard-extreme.5zjHBl/extreme-production-audit.json`.
- The self-contained managed recovery drill now seeds validation, schema,
  approval, idempotency, and reconciliation state; takes an online owner-only
  backup; reopens it; matches critical table counts; and verifies SQLite,
  per-tenant control-plane and queued-payload bindings, audit-chain,
  reconciliation-chain, and schema-release-chain integrity. The latest run
  checked 15 bound control/operational/anchor records, preserved one current
  checkpoint-anchor delivery, emitted the revision-3
  idempotency checkpoint, and verified all three one-record chains.
- The repeatable single-node managed HTTP load gate accepted 2,000/2,000
  repairable requests at concurrency 32 behind an enforced promoted schema,
  produced 2,000 unique audit IDs,
  matched metering exactly, verified the 2,000-event audit chain, and found no
  private sentinel in SQLite. The latest severe-gate run measured approximately
  495.68 requests per second with 57.15 ms p50, 94.43 ms p95, and 331.21 ms p99.
  It is local regression evidence, not hosted capacity or an SLA.
- Docker is not installed in the current local environment, so the Dockerfile and
  Compose profile were reviewed by static checks but not image-built here. The CI
  workflow now builds the managed target and smoke-tests its fixed non-root UID,
  read-only root, database-aware readiness, health, and HSTS; a successful remote
  CI run is still required before treating that workflow as evidence.
- The non-skippable release-candidate gate correctly refused local certification
  because PostgreSQL, Docker, and explicit OpenAI/Anthropic/Gemini credentials
  and model versions are absent. Its machine-readable failed preflight is
  `audit-results/release-candidate-local.json`; this is blocker evidence, not a
  successful certification. The protected manual workflow provisions PostgreSQL
  and requires the remaining credentials before it can produce a green report.
- The real-repo corpus audit (`npm run audit:real-repos`) passed against sparse,
  shallow checkouts of 20 diverse public repositories spanning MCP servers,
  provider SDKs, agent frameworks, browser/database/cloud tools, and AI tooling.
  All 20 cloned successfully at recorded commit hashes. Static extraction yielded
  106 value-free tool-schema fixtures from eight repositories across all four
  adapters; guard probes returned 76 `valid` and 30 safe `rejected` decisions.
  The other 12 repositories contained tool/schema signals but no declaration that
  the deliberately non-executing literal extractor could safely materialize;
  those remain explicit extractor-coverage gaps, not compatibility passes or
  product failures. Repository code and dependencies were never executed. The
  persisted snapshot is `real-repo-corpus/extracted-fixtures.json`. Latest report
  path:
  `/var/folders/sw/zp34fc5d19vgw8fb2zjtbjg40000gn/T/schema-guard-real-repos.GxTPzp/real-repo-corpus-audit.json`.
- The runtime integration audit (`npm run audit:framework-integrations`) passed
  through the actual execution boundaries of MCP TypeScript SDK 1.29.0, OpenAI
  Agents JavaScript 0.13.5, PydanticAI Slim 2.13.0, and Google ADK 2.5.0. In each
  framework, a repairable string `"2"` reached the controlled tool as integer
  `2`, while ambiguous `"02"` was rejected with zero downstream executions.
  MCP additionally discovered its schema through the real `tools/list` protocol,
  denied an unknown tool, and classified a tightened live schema as `breaking`.
  The audit used pinned official packages, binary-only Python installation,
  in-memory framework runtimes, and no model API. It also exposed and closed two
  compatibility defects: MCP's Draft-07 schema dialect and Google ADK's current
  `parametersJsonSchema` serialization. Latest report path:
  `/var/folders/sw/zp34fc5d19vgw8fb2zjtbjg40000gn/T/schema-guard-framework-integrations.y7pWhX/framework-integration-audit.json`.
- The public real-data replay (`npm run audit:real-data`) passed against BFCL V4
  commit `6ea57973c7a6097fd7c5915698c54c17c5b1b6c8` under Apache-2.0. It parsed
  2,501 rows spanning live, Python, Java, JavaScript, single, multiple, and
  parallel categories. Of 3,302 accepted benchmark calls, 3,266 (98.91%)
  conformed to their own normalized declarations. The remaining 36 are retained
  as explicit source-contract conflicts—not silently counted as product passes—
  because their ground truths violate required, type, or enum constraints in the
  accompanying schemas. Six independent test families ran 48,049 checks with
  zero mismatches: 3,302 authentic contract replays; 15,702 adversarial repair
  and rejection checks; 9,798 Draft-07/2019-09/2020-12 differential checks;
  6,532 JSON-string/object-key-order metamorphic checks; 9,449 real-schema drift
  classifications; and 3,266 deterministic privacy-envelope checks. The audit
  found and closed two real defects: schemas using `required` without a sibling
  `properties` map were previously rejected by an overly strict AJV diagnostic,
  and disjoint type changes such as `string` to `integer` could be marked for
  review instead of definitively breaking. No benchmark code was executed, and
  the report persists no questions, raw arguments, or tool names. Durable report:
  `audit-results/real-data-replay.json`.
- The multi-benchmark replay (`npm run audit:benchmarks`) passed from fresh,
  shallow official clones of five additional purpose-built tool/function-calling
  benchmark repositories: ToolBench commit
  `d56fdd89faf8c91fa135090b212bb9057ee5cfc2`, StableToolBench
  `aa4ed9f4737ad98bd706663f01d63623c3427812`, ToolAlpaca
  `189069998d64a7baf1b4a1c3c4b2e75eb9d05532`, Seal-Tools
  `ce753ecd60ed08dd376984035de531ab8421f1c6`, and API-Bank within DAMO-ConvAI
  `483554eae102996f5ec1f4feab4e78ef29c2a394`. It consumed each repository's
  native schema/call pairing: ToolBench result trees and `available_tools`,
  StableToolBench instruction schemas and answer traces, ToolAlpaca OpenAPI
  documents and golden actions, Seal-Tools tool/call JSONL, and API-Bank class
  contracts and dialogue calls. Across 7,699 recorded calls, 7,575 conformed to
  their source contracts and 124 were retained as explicit source-contract
  conflicts. The conforming calls produced 30,203 JSON-encoding, malformed-JSON,
  closed-schema injection, missing-required, and typed safe-coercion checks with
  30,203 matches and zero mismatches. ToolBench's non-standard `optional` and
  `example_value` annotations were normalized away; its types, required fields,
  enums, descriptions, and argument values were not weakened. Only benchmark
  data and license files were read; downloaded code and dependencies were never
  executed. Combined with BFCL, validation now spans six benchmark repositories.
  Durable report: `audit-results/multi-benchmark-replay.json`.
- The same replay includes three explicit product-value tests. Schema Guard
  intercepted 124/7,699 recorded source-contract failures (1.61%): 92 argument
  schema failures and 32 malformed argument-JSON failures. A permissive
  parse-plus-JSON-Schema baseline agreed on all 124. In 1,117
  controlled unambiguous scalar-stringification cases derived from valid calls,
  the plain validator rejected all 1,117 while Schema Guard safely repaired all
  1,117. Across 21,635 rejected source or derived incidents, all Schema Guard
  responses contained a stable reason code, repair hint, and audit ID; the plain
  baseline supplied a machine-readable field-level schema issue in 14,028 cases
  (64.84%) and supplied neither remediation hints nor audit correlation. The last
  measurement is a diagnostic-completeness proxy, not elapsed human debugging
  time. Method and limitations: `docs/PRODUCT_VALUE_TEST.md`.
- The repository-native fixture audit (`npm run audit:five-repos`) passed against
  five separate official repositories at recorded commits: MCP Python SDK
  `3a6f2996cdd8358957479791e8b26198c07d6a75`, OpenAI Agents Python
  `5921667f570aa73a9f1d18b9a4ba0cb6c9549669`, PydanticAI
  `24d105d21f779c783c2cd9c60c58b71ceaf125c7`, Google ADK Python
  `c4270203c657d4abb14188b90ed692465f1f36c9`, and OpenAI Agents JS
  `b04baf06313564e40c1879c13d4ee960f02b6167`. The harness verified source-file
  hashes and exact committed anchors for schemas and actual tool-call arguments,
  then ran 20 source cases and 35 derived malformed, missing-required,
  JSON-encoding, and secret-field cases. All 55/55 matched, with at least one
  source and derived case per repository. Repository code and dependencies were
  never executed; the mapped fixtures exist only in the audit script and do not
  add repository-specific behavior to the universal runtime. Durable report:
  `audit-results/five-repo-native-fixtures.json`.

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

The live agent harness was expanded and rerun after the production-profile
hardening. Codex and Claude each passed 108/108 cases, with 41 safe executions,
65 blocked calls, and 2 drift classifications per agent. Explicit machine
verification passed on:
`work/codex-agent-live-2026-07-19T10-25-53-281Z.jsonl` and
`work/claude-agent-live-2026-07-19T10-25-53-281Z.jsonl`. A sentinel scan found
no `DEMO_SECRET_MUST_NOT_APPEAR` or `EXTREME_SECRET_SENTINEL` values in those
logs.

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

## Schema Guard 0.2 implementation verification (2026-07-20)

The product-differentiation implementation added five independently exercised
capabilities:

- canonical tool-contract compilation for OpenAI, Anthropic, Google Gemini, and
  MCP with explicit native/lossless/policy/unsupported/unverified states;
- integrity-checked local incident capture and exact replay-suite comparison;
- proof-carrying repair receipts with schema/policy post-validation;
- risk/environment/argument-bound approval and idempotency action controls; and
- authenticated managed compilation plus local/remote SDK parity.

`npm run check` passed on the resulting 0.2.0 tree. That gate included formatting,
compiled ESLint, script syntax, publish-package contents, TypeScript typecheck,
the pinned conformance comparison, 158/158 TypeScript tests across 31 executing files, and
the Python client test. The conformance report passed 8/8 corpus cases and 8/8
adapter probes under protocol `2026-07-20` and engine `0.2.0`.

`npm run audit:extreme` also passed with zero reported failures. Its nested gate
repeated the complete check, found zero high-severity dependency vulnerabilities,
passed conformance, started both local API surfaces, exercised managed bootstrap,
and measured 10,000 local validations at approximately 42.042 microseconds p50,
82.833 microseconds p95, and 179.875 microseconds p99 on this machine. These timings are a
local microbenchmark, not hosted latency or capacity evidence.

A CLI fixture/replay smoke run reproduced an exact integer repair. That run also
exposed that the first replay report shape included the accepted argument object;
the report was changed before release verification to contain only expectation
metadata and hashes, while fixture creation now prints only path/ID/privacy
metadata. Regression tests and the full gate passed after that correction.

The managed alert path now includes a tenant-scoped transactional webhook
outbox. Deterministic tests cover encrypted endpoint/secret storage, one-time
secret disclosure, kind-specific value-free payload projection, exact HMAC
signing, tenant-scoped API authorization, leased delivery, bounded retry,
dead-letter/redrive behavior, disabling, and rejection of local/IP-shaped
destinations. The recovery drill retains both webhook configuration and a queued
delivery. No successful delivery to a deployed third-party receiver has been
claimed; that remains a launch-environment check.

Environment schema releases now turn registry drift into an enforceable runtime
control. Tests cover exact version/hash promotion, idempotency, tenant and scope
isolation, mandatory evidence for breaking promotion, authenticated history,
registry-source tampering, safe observation defaults, enforced missing/mismatch
rejection, protocol-envelope correctness, HTTP routes, and SDK operations. The
recovery drill now verifies the schema-release chain and preserves its rows.

Managed control records now carry migration-safe master-secret HMACs for tenant
policy/plan, API-key scope and revocation state, environment policy/enforcement,
action descriptors, approval state, idempotency reservations, and webhook
configuration; queued webhook and checkpoint-anchor payloads have immutable
payload HMACs. A
populated version-11 migration fixture verifies row bindings are established by
version 12, deletion-evident idempotency manifests by version 13, and a dedicated
checkpoint-anchor delivery outbox by version 14. Adversarial
tests directly substitute scopes, policy, enforcement,
action risk, revoked approval state, reservation state, webhook enablement, and
queued payloads and observe fail-closed authentication, readiness, deep
verification, or affected-path rejection. The tenant-scoped admin verification
route does not reveal another tenant's damaged record identifier. The restore
drill includes these checks. Version 13 adds a monotonic, HMAC-authenticated row
count and XOR accumulator over each tenant's idempotency set. Reserve, complete,
release, and reconciliation update it atomically; startup and out-of-band commit
checks detect deleted completed rows. The recovery report emits a value-free
checkpoint and the API/SDK compare an externally retained checkpoint with a
restore candidate. Tests detect both a genuinely older but internally valid
backup (`rollback_detected`) and two independently valid same-revision branches
(`integrity_conflict`). Detection requires retaining the checkpoint in an
external failure domain; the repository does not pretend local storage is an
external anchor.

When an independent public HTTPS URL and separate 32-character signing secret
are configured, version 14 transactionally queues every manifest revision for
automatic value-free delivery. Tests cover initial and changed revisions,
privacy-safe payload shape, transport handoff, bounded retry, dead letters,
redrive, readiness degradation, scope isolation, payload substitution, and
out-of-band deletion of current delivery coverage, forged `delivered` status
without a valid acknowledgement HMAC, direct-store bypass refusal, and HTTP
action admission only after the exact current revision is acknowledged.
Public mode now refuses to start without the anchor URL/secret pair. A receiver
failure returns `503` and leaves the reservation pending for evidence-backed
reconciliation. This is deterministic transport/admission evidence, not
evidence that an independent receiver is deployed.

The standalone receiver suite signs exact request bytes and proves initial
storage, monotonic advance, identical event deduplication, same-checkpoint replay,
lower-revision rollback rejection, equal-revision fork rejection, event-ID body
conflict rejection, stale/unsigned rejection before mutation, read-token
isolation, chained history verification, and out-of-band tamper degradation of
readiness. The separate container/Compose profile is static deployment evidence;
it has not been deployed into a genuinely independent cloud account here.

A PostgreSQL shared-action-state package now implements row-locked atomic
reserve/complete/release/checkpoint transitions with tenant-keyed reservation
HMACs and deletion-evident manifests. The managed HTTP evaluation,
completion/release, checkpoint/compare, reconciliation, history verification,
and readiness paths can opt into it through
`SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL`. An always-on HTTP contract test races
12 evaluations through the adapter and covers duplicate mapping, completion,
checkpoint backend selection/comparison, reconciliation, and failed
initialization. The credential-gated integration suite races 40 same-key
reservations through two independent pools, covers conflicts, tenant isolation,
transitions, checkpoints, transactional reconciliation, authenticated
reconciliation-chain manifests, a transactionally queued/HMAC-bound checkpoint
anchor outbox, exact-revision acknowledgement, out-of-band
reservation/reconciliation/current-anchor deletion, and two managed HTTP servers
using the same PostgreSQL state. Migration DDL now uses an advisory transaction
lock and a checksummed version history; the suite rejects substituted history
and races independent migrators. The shared control-state slice additionally
covers HMAC-bound tenant/API-key authority, policy and plan propagation,
fail-closed authentication, revocation, and atomic current-month quota counters.
An always-on test starts two independent managed instances, proves a key exists
only in shared state, propagates policy, admits exactly the remaining global
quota under a race, returns identical usage, and revokes the key across
instances. Quota consumption and strict value-free audit append now commit in
one shared transaction; list/CSV/verification and anchored retention select that
history. An always-on pre-database test rejects an injected value-bearing audit
field. The PostgreSQL test races 16 validation/audit appends across two pools
against an eight-request test plan and requires exactly eight admissions,
verifies the chain and retained anchor, then detects tenant-policy and audit-row
substitution/deletion.
The shared schema-state slice adds HMAC-bound environment and registered-schema
rows, per-tool serialized/idempotent registration, reviewed promotion, a
manifest-bound release chain, authenticated source binding, and repeatable-read
runtime admission. One always-on test starts two HTTP instances with independent
SQLite stores and proves shared policy, registration, promotion, enforcement,
mismatch rejection, listing, and integrity failure. The PostgreSQL suite adds
cross-pool policy/admission/promotion, evidence privacy, release-deletion
detection, a 16-way exact-registration race, conflicting-version rejection,
rate-counter substitution detection, and migration-checksum rejection.
The shared alert slice adds a tenant manifest, HMAC-chained value-free alert
records, expected-delivery coverage, encrypted webhook credentials, HMAC-bound
delivery/lease state, bounded retries, dead letters, redrive, and `SKIP LOCKED`
claims. An always-on test routes two independent HTTP instances through one
alert authority, proves cross-instance list/delivery/disable/readiness behavior,
and shows that one instance can read the shared alert while its SQLite alert
table is empty. The PostgreSQL suite races 16 idempotent alert sources, requires
one delivery lease across two pools, scans encrypted storage for endpoint/secret
plaintext, detects delivery deletion, and proves a damaged alert manifest rolls
back both validation audit/counters and a breaking schema registration.
The shared intelligence slice adds a manifest-protected value-free observation
chain coupled to validation audit/quota, independently thresholded network
versions, chained/idempotent conformance reports, and trusted Ed25519-signed
ruleset history. An always-on two-instance HTTP test proves backend selection,
cross-instance clusters/matrices/rulesets, value exclusion, idempotent
conformance ingestion, and readiness loss. The credential-gated PostgreSQL test
races duplicate observations, conformance reports, and ruleset publication
across two pools; scans persisted observations for private tool/schema/argument
values; detects history deletion; and proves a corrupt intelligence manifest
rolls back quota and audit. The schema registry now has a separate authenticated
set manifest, and the credentialed suite deletes an unpromoted schema to require
readiness and intelligence reads to fail closed.
The shared action test also configures reconciliation and alert state on one
PostgreSQL database, damages the alert manifest, and requires the reconciliation
record and reservation transition to roll back together.
This machine has neither PostgreSQL nor Docker, so those fourteen credential-gated tests are explicitly
skipped locally. The CI `postgres-shared-state` job provisions PostgreSQL 16 and
is the required execution evidence; no green remote run has been observed here.
An always-on managed HTTP test also proves that a shared-state reservation is not
returned as allowed until the exact queued checkpoint is delivered and marked
acknowledged. Another starts two independent managed SQLite instances against
one action state, registers a descriptor and accepted validation only through
the first, creates the high-risk challenge on the second, approves it through
the first, and proves the second admits it while its own local audit/descriptor
lookups remain empty. Shared readiness also covers substitution of accepted
proofs, descriptors, and approval state. Authentication, API keys, tenant policy,
plan, quota, validation audit history, environment policy, and schema
registration/release admission can be PostgreSQL-backed too. Per-key rate
windows are HMAC-bound and atomically shared as well; always-on and PostgreSQL
tests cover cross-instance allowance and reset behavior. Alert/webhook state is
shared and source-transaction coupled. Derived intelligence, conformance, and
signed-ruleset state is shared too. Public
`SCHEMA_GUARD_INSTANCE_COUNT>1` remains rejected and multi-instance readiness is
not claimed because remaining cross-store workflow boundaries and deployed
failover evidence are unresolved.

No live provider/model call was made for the compiler profiles in this release.
Accordingly, structurally compatible declarations default to
`runtime_unverified`; this report does not convert provider documentation into a
runtime-conformance claim. A credential-gated OpenAI/Anthropic/Gemini probe
harness, scheduled workflow, privacy-safe report, dry-run gate, and provider
envelope tests are now present; the three dry-run profiles passed, but no live
trial can pass without explicit keys and exact model names. The core in-memory
idempotency ledger remains local development evidence. Managed mode now has a
separately scoped, tenant-bound SQLite approval and idempotency workflow with
restart, isolation, tampering,
least-privilege, privacy, and HTTP lifecycle tests. This is durable single-node
evidence, not proof of shared-database failover or downstream reconciliation.
Accepted audit envelopes bind both the exact post-repair argument hash and the
exact ordered repair-receipt hashes. Adversarial tests reject modified output and
a substituted self-consistent receipt before action execution.
