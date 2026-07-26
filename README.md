# Managed Tool-Call Schema Guard

A deterministic compatibility and safety checkpoint between AI agents and tool execution. It validates raw tool arguments, applies only explicit typed repairs, revalidates, enforces narrowing policy, detects schema drift, and emits a privacy-minimized audit record.

The repository contains two deliberately separated products. The
machine-readable architecture and license map is
[`product-boundary.json`](product-boundary.json); its rationale and enforcement
rules are in [`docs/PRODUCT_BOUNDARY.md`](docs/PRODUCT_BOUNDARY.md).

- **Schema Guard Core** is the offline, open-source enforcement layer. It runs in a developer process, CI job, agent sidecar, or local service and never requires a Schema Guard account or network connection.
- **Schema Guard Managed** is the separately licensed team workflow and
  intelligence layer. The repository implements both local and shared
  PostgreSQL operation; the deployed environment remains internal staging, not
  a customer-production reliability claim.

The goal is a serious daily-use control point, not a dressed-up JSON Schema validator. Ordinary validation is useful and reproducible. The durable product advantage must come from continuously maintained cross-provider conformance knowledge, privacy-safe failure signatures, drift intelligence, trustworthy audit history, and the workflows teams use to investigate and govern agent actions. See [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md).

The current build is strong local product evidence for that direction—not evidence of product-market fit.

## Product boundary

| Offline OSS core                                                  | Managed team product direction                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Deterministic validation, allowlisted repair, and repair receipts | Shared schema registry and organization policy                                |
| CLI, TypeScript SDK, Python access, local API                     | Tenant authentication, environments, quotas, and retention                    |
| MCP, OpenAI Agents, PydanticAI, and Google ADK normalization      | Searchable audit history, verification, export, and alerts                    |
| Contract compilation plus local schema-drift comparison           | Fleet-level drift workflow and version-change alerts                          |
| Integrity-checked incident fixtures and replay suites             | Privacy-safe compatibility clustering and conformance operations              |
| Risk, approval-binding, and idempotency execution gate            | Tenant-scoped approval workflow and durable single-node idempotency lifecycle |
| Local value-free audit output                                     | Signed audit chains and operational review workflow                           |
| Public conformance/adversarial fixtures                           | Privacy-thresholded failure and compatibility intelligence                    |
| Runs without our servers                                          | Hosted operation, billing, reliability, and continuously updated intelligence |

The core remains useful if the managed service is unavailable or never adopted. The managed layer does not weaken or remotely override core validation: organization policy can only narrow permitted behavior.

## What works

- JSON Schema Draft-07, 2019-09, and 2020-12 validation through strict,
  dialect-selected AJV compilation.
- `valid`, `valid_with_repair`, and `rejected` decisions with stable reason codes.
- Strict raw-JSON preflight rejects duplicate object members (including escaped-equivalent names), excessive input size/depth, non-plain runtime objects, accessors, sparse arrays, symbol keys, and ill-formed Unicode before schema evaluation.
- Exact, round-trip-safe string-to-number and safe string-to-integer repairs plus lowercase string-to-boolean repair. Singleton-to-array is available only by explicit policy.
- Proof-carrying repair receipts with rule/ruleset identity, matched preconditions, passed ambiguity checks, input/output/schema hashes, post-validation results, and a verifiable receipt hash.
- Revalidation after repair; no semantic-value invention.
- Repair limits, denied argument paths, and closed-schema policy.
- Value-free audit envelopes with hashes, shape, versions, rules, and audit IDs.
- Conservative drift classification for properties, required fields, types, enums, constants, bounds, and `additionalProperties`; unknown changed constructs require review.
- A canonical JSON Schema 2020-12 tool-contract compiler for OpenAI strict functions, Anthropic client tools, Google Gemini function declarations, and MCP. It reports `native`, `lossless_transform`, `policy_required`, `unsupported`, or `runtime_unverified` and never silently deletes unsupported constraints.
- Local incident capture and replay suites with fixture integrity hashes and exact decision, repair, validation-issue, policy, and repaired-output regression checks. Fixtures explicitly declare that they contain raw values and are unsafe to upload.
- A deterministic action gate with risk levels, environment policy, HMAC-authenticated approvals bound to exact validated arguments, and idempotency reservation. The TypeScript SDK releases reservations only when execution fails; an uncertain completion stays reserved to fail closed against duplicate side effects.
- Runtime interception for MCP, OpenAI Agents, PydanticAI, and Google ADK,
  including automatic schema discovery where the framework exposes it.
- CLI, local HTTP API, TypeScript SDK, and thin Python client to the canonical TypeScript engine.
- Published conformance/adversarial corpus, deterministic baseline regression gate, daily CI workflow, property tests, and benchmark.
- A separate local managed control plane with tenant API keys, organization
  policy, master-secret-bound security configuration/action state, immutable
  queued-payload bindings, SQLite history, signed audit chains, schema registry,
  reviewed environment releases with fail-closed schema admission, persistent
  value-free failure clusters, schema quality scoring, evidence-linked
  recommendations, provider/framework/version compatibility matrices,
  privacy-thresholded aggregate intelligence, Ed25519-signed rulesets, durable
  single-node approvals/idempotency with deletion-evident manifests and
  externally retainable rollback checkpoints plus automatic signed anchor
  delivery, tenant-wide emergency action hold, enforced and non-mutating shadow
  action policies, workload-bound approvals/fingerprints, usage plans, rate
  limits, local alerts, signed HTTPS webhook outbox delivery, exports,
  retention, backup/restore, and a functional dashboard.
- A privacy-safe registered-and-observed estate endpoint across API, SDK, CLI
  and dashboard, plus content-addressed value-free evaluation evidence export.
  Schema-registry and action-policy fingerprints remain in separate privacy
  domains; the product does not claim automatic shadow-agent/MCP discovery or a
  native third-party observability integration.
- An operator-safe uncertain-action reconciliation workflow with opaque
  reservation IDs, separate permissions, minimum-age protection, keyed evidence
  references, authenticated history, and explicit executed/not-executed outcomes.
- A repeatable real-agent MCP mutation harness for Codex and Claude that proves rejected calls never reach a strict fake downstream tool.

## Quickstart

Requires Node.js 20 or newer.

```bash
npm ci
npm run check
npm run schemaguard -- validate \
  --tool book_flight \
  --schema examples/schema.json \
  --args examples/args.json
```

The example returns `valid_with_repair`, changes `passengers` from the exact string `"2"` to integer `2`, and reports the applied rule without placing the value in its audit envelope.

Detect a breaking schema change:

```bash
npm run schemaguard -- drift \
  --before examples/schema.json \
  --after examples/schema-v2.json
```

Compile one canonical contract for a provider without pretending unsupported
semantics are portable:

```bash
npm run schemaguard -- compile \
  --target openai \
  --tool book_flight \
  --schema examples/schema.json
```

OpenAI strict mode may require semantic normalization of optional/open objects.
The compiler refuses that by default; `--openai-strict-policy normalize` is an
explicit operator decision, and the result remains labeled `policy_required`.

Turn a local incident into a permanent regression fixture, then replay it:

```bash
npm run schemaguard -- fixture \
  --tool book_flight \
  --schema examples/schema.json \
  --args examples/args.json \
  --out work/book-flight.fixture.json
npm run schemaguard -- replay --fixture work/book-flight.fixture.json
```

The fixture file contains raw arguments, is created with owner-only permissions,
and must remain in the customer's controlled repository or incident store. It is
not managed-service telemetry.

Run the local hosted-style API:

```bash
SCHEMA_GUARD_AUDIT_FILE=.schema-guard-audit.jsonl npm run api
curl -s http://127.0.0.1:8787/v1/validate \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{"tool_name":"book_flight","tool_schema":{"type":"object","required":["passengers"],"properties":{"passengers":{"type":"integer"}}},"raw_arguments":{"passengers":"2"}}
JSON
```

The local audit file is created with owner-only mode and contains no argument values by design.

## API

- `POST /v1/validate`: canonical guard decision. Rejections use HTTP 422 while still returning the full decision.
- `POST /v1/normalize`: `{ "adapter": "mcp", "tool": { ... } }`.
- `POST /v1/drift`: `{ "previous": { ... }, "current": { ... } }`.
- `GET /healthz`: local liveness only.

## Managed local quickstart

The managed control plane is separate from the open local API. It requires a database path and a 32-character-or-longer master secret.

```bash
umask 077
mkdir -p "$PWD/work"
openssl rand -base64 48 > "$PWD/work/master-secret"
export SCHEMA_GUARD_DATABASE="$PWD/work/managed.db"
export SCHEMA_GUARD_MASTER_SECRET_FILE="$PWD/work/master-secret"
npm run managed:bootstrap -- --tenant-id demo --tenant-name "Demo tenant" --plan trial
npm run managed
```

The separately deployable checkpoint receiver can be started with
`npm run anchor-receiver`; its independent-database and credential contract is
documented in [`docs/CHECKPOINT_ANCHORS.md`](docs/CHECKPOINT_ANCHORS.md).

The bootstrap command prints the API key once; only an HMAC-derived verifier is stored. Open `http://127.0.0.1:8788/dashboard`, or call the managed endpoint with `Authorization: Bearer <key>`.

In public mode or with shared PostgreSQL control state, bootstrap is
operator-offline only: stop the managed service, add `--service-state stopped`,
then restart and verify `/readyz`. The command refuses an online-style
public/shared invocation. This is not a substitute for hosted self-serve
organization provisioning.

Managed routes include validation, contract compilation, schema
registration/drift, reviewed environment promotion and runtime schema
admission, action classification/approval/idempotency, checkpoint-anchor
delivery operations, idempotent conformance-summary ingestion, audit history
and CSV export, chain verification, tenant and privacy-thresholded network
intelligence, usage/billing statements, alerts and durable HTTPS webhook
delivery, signed rulesets, API-key lifecycle, organization policy, plan control,
tenant lifecycle/complete export/deletion request, and retention purge. See
[`docs/MANAGED_LOCAL.md`](docs/MANAGED_LOCAL.md),
[`docs/PRICING_AND_UNIT_ECONOMICS.md`](docs/PRICING_AND_UNIT_ECONOMICS.md),
[`docs/BILLING_STRIPE_SANDBOX.md`](docs/BILLING_STRIPE_SANDBOX.md),

Managed HTTP requests accept an optional lowercase W3C version-00
`traceparent`. The response carries the same trace ID with a new server span
and `x-akriven-trace-id`; structured access logs contain only a SHA-256 trace
ID hash. Malformed or zero trace/parent IDs fail closed. Raw prompts and tool
arguments are never added to trace metadata.
[`docs/SCHEMA_RELEASES.md`](docs/SCHEMA_RELEASES.md),
[`docs/CHECKPOINT_ANCHORS.md`](docs/CHECKPOINT_ANCHORS.md), and
[`docs/ALERT_WEBHOOKS.md`](docs/ALERT_WEBHOOKS.md).

The CLI can inspect the daily managed read surfaces without placing a bearer key
in the process list. Materialize a scoped key as an owner-only secret file, then
select a resource:

```bash
npm run schemaguard -- managed \
  --base-url https://api.example.com \
  --api-key-file /run/secrets/schema_guard_reader_key \
  --resource usage
```

Supported resources are `plans`, `api-keys`, `policy`, `schemas`,
`action-control`, `action-descriptors`, `action-challenges`, `usage`, `audits`,
`audit-verification`, `alerts`, `environments`, `intelligence`,
`billing-statement`, `schema-releases`, `schema-release-verification`,
`control-plane-integrity`, `tenant-lifecycle`, and `tenant-export`.
`managed-request-deletion` requires an exact tenant ID.
The TypeScript SDK exposes the same daily read workflow plus schema
registration, API-key issue/revoke, action controls, releases, webhook
operations, sandbox billing Checkout/Portal, lifecycle/export, and deletion
request. Billing CLI commands write provider URLs only to a new owner-only
file. The Python client accepts `api_key=` and exposes the same
lifecycle/export/deletion workflow.

This is the local finished-product-spine walkthrough: bootstrap a tenant, protect validation with an API key, register evolving schemas, exercise repair and rejection cases, inspect the signed audit trail and drift alerts, review privacy-thresholded compatibility signals, and export operational evidence. It demonstrates the implemented product workflow end to end on one machine. A public staging ingress is now under production-readiness verification. Stripe sandbox and Postmark boundaries are deterministically tested but have not been exercised against real provider test accounts. A WorkOS staging project, application, hardened authentication policy, mapped organization, owner user and exact `owner` role are configured and deployed on the exact private-staging revision. The public-TLS authorization callback, verified Google identity, required MFA enrollment, organization-to-tenant binding, owner RBAC, session discovery, refresh, logout, restart persistence and container-recreation persistence have been exercised through the real hosted boundary. Recovery, invitation, membership removal, provider-side revocation and cross-organization isolation remain external certification work and are not represented as proven. The application notification outbox is durable, encrypted, leased, retry-bounded, dead-lettered, redrivable, and available through the API/dashboard/SDK/CLI; real Postmark delivery, payment collection, the remaining hosted identity lifecycle, cloud key management, and multi-region recovery remain integration work and are not simulated as successful.

Protocol JSON Schemas live in [`protocol/v1`](protocol/v1). See
[`docs/CONTRACT_COMPILER.md`](docs/CONTRACT_COMPILER.md),
[`docs/INCIDENT_REPLAY.md`](docs/INCIDENT_REPLAY.md),
[`docs/ACTION_CONTROLS.md`](docs/ACTION_CONTROLS.md),
[`docs/SHARED_STATE.md`](docs/SHARED_STATE.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/HUMAN_IDENTITY_AND_EMAIL_BOUNDARIES.md`](docs/HUMAN_IDENTITY_AND_EMAIL_BOUNDARIES.md),
and
[`docs/DECISIONS.md`](docs/DECISIONS.md).

Drop-in runtime usage and the pinned four-framework audit are documented in
[`docs/FRAMEWORK_INTEGRATIONS.md`](docs/FRAMEWORK_INTEGRATIONS.md).

## Production profile

The repository includes a hardened container profile and a fail-closed public
configuration check for managed deployments:

```bash
cp deploy/env.production.example .env.production
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up --build
```

For direct public TLS termination on the reviewed host, layer the pinned,
non-root Caddy edge profile on top after DNS is correct and the owner has
approved the public transition:

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose.production.yml \
  -f deploy/docker-compose.edge.yml up --build
```

The independent anchor has a matching `docker-compose.anchor-edge.yml` overlay.
Do not run the main and anchor overlays on the same host or under the same
backup/administrative failure domain. The base profiles retain loopback-only
ports for local diagnostics; they are not public listeners.

Run the severe release gate before any public deployment:

```bash
npm run audit:extreme
```

The severe gate includes self-contained managed backup/restore verification and
a 2,000-request managed HTTP load/correctness threshold. Operator procedures are
in [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md).

See [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) and the
[2026-07-23 production-readiness handoff](docs/PRODUCTION_READINESS_HANDOFF_2026-07-23.md).
Public mode does not fake missing business infrastructure: the sandbox-only
Stripe code remains disabled without complete test configuration, while payment
settlement, hosted human identity, an owned external paging receiver, KMS
custody, and live provider-version probe operation still require explicit
production configuration and observed external evidence.

Run the licensed public-data replay independently:

```bash
npm run audit:real-data
```

This shallow-clones the official Apache-2.0 BFCL repository and runs six
independent real-data test families: authentic contract replay, adversarial
repair/rejection, JSON Schema dialect differential, metamorphic encoding and key
ordering, schema-drift classification, and deterministic privacy-envelope
checks. It reads only JSON data and the license; downloaded benchmark code and
dependencies are never run. The output contains hashes and counts, not
questions, argument values, or tool names.

Run the broader benchmark-repository replay:

```bash
npm run audit:benchmarks
```

This independently shallow-clones five official tool-use benchmark repositories:
ToolBench, StableToolBench, ToolAlpaca, Seal-Tools, and API-Bank. Their native
artifacts cover result trees paired with advertised tool schemas, instruction
traces, OpenAPI contracts with golden actions, explicit tool/call JSONL, and API
class contracts paired with dialogue calls. The audit currently replays 7,699
recorded calls; 7,575 conform to their benchmark-provided contracts, while 124
source-contract conflicts remain visible. It then applies 30,203 deterministic
encoding, malformed-input, injection, required-field, and safe-coercion checks,
all of which match. Downloaded benchmark code and dependencies are never
executed. Together with BFCL above, this is coverage across six purpose-built
tool/function-calling benchmark repositories—not five ordinary application
repositories.

Run the separate commit-pinned repository-native fixture audit:

```bash
npm run audit:five-repos
```

This shallow-clones five official repositories—MCP Python SDK, OpenAI Agents
Python, PydanticAI, Google ADK Python, and OpenAI Agents JS—verifies the exact
committed source fragments containing schemas and tool-call arguments, and
replays those contracts through Schema Guard. It does not execute repository
code. These are audit fixtures only; no repository-specific tools or schemas are
compiled into the product.

## Real agent black-box test

With authenticated Codex and Claude CLIs installed, run:

```bash
npm run build
npm run agent-test:live
```

Both agents make malformed, repairable, policy-denied, drifted, MCP, and Google
ADK calls through the local MCP guard. The machine verifier requires 12/12
outcomes per agent, proves only five calls execute, and scans the minimized logs
for a dummy secret sentinel. See [`examples/agent-loop`](examples/agent-loop)
and [`docs/VALIDATION_REPORT.md`](docs/VALIDATION_REPORT.md).

## Python access

The Python client deliberately calls the built TypeScript engine locally or the HTTP API; it is not a second validator implementation.

```bash
npm run build
PYTHONPATH=python python3 - <<'PY'
from schema_guard import SchemaGuardClient
print(SchemaGuardClient().validate({
    "tool_name": "counter",
    "tool_schema": {"type": "object", "required": ["count"], "properties": {"count": {"type": "integer"}}},
    "raw_arguments": {"count": "3"}
})["decision"])
PY
```

## Safety boundary

Schema Guard proves structural conformance under declared rules. Its optional
action gate enforces configured risk, environment, approval-binding, and
idempotency checks before an SDK callback executes. It does not replace the
downstream system's identity, permission, transaction, least-privilege, fraud,
or business authorization controls; structurally valid and correctly approved
arguments can still be harmful.

Repairs never add missing values, rename fields, trim strings, guess enums, parse arbitrary JSON, or infer intent. On uncertainty the engine rejects.

## One-week validation target

Place this local validator and hosted-style endpoint in 5–10 real workflows. Continue only if at least three users encounter a genuine repair or schema-drift case basic validation cannot resolve within seven days. Kill or reposition if zero repair/drift events occur. No payload telemetry is built in; any study instrumentation must be explicit, opt-in, and data-minimized.

That experiment validates whether the differentiated intelligence is valuable; it does not limit the intended product to a one-week MVP. A finished service should become the operational record for tool compatibility across environments while keeping enforcement deterministic and independently runnable.

## Repository map

- `packages/core`: canonical decision, repair receipt, contract compiler, replay, action policy, audit, adapter, and drift engine.
- `packages/cli`, `packages/api`, `packages/sdk-typescript`: developer surfaces.
- `python`: thin Python access.
- `conformance`: portable compatibility and adversarial fixtures.
- `protocol/v1`: versioned wire schemas.
- `tests`, `benchmarks`, `examples`: verification and demos.
- `docs`: architecture, decisions, security, threat model, contribution, and handoff evidence.

## Current limitations

Adapter fixtures and compiler profiles cover documented current declaration
shapes, not every model or framework release. `runtime_unverified` remains the
default compiler status until an external probe verifies the exact target
profile. Replay fixtures are intentionally local and value-bearing; the managed
service does not yet provide a reviewed incident-to-public-fixture minimizer.
The core package's included ledger is process-local; managed mode provides a
transactional SQLite workflow that survives restart on one node. An opt-in
PostgreSQL adapter now shares HTTP action reservations, completion/release,
checkpoints, uncertain-outcome reconciliation, and the acknowledgement-gated
checkpoint-anchor outbox. It also shares value-free accepted-decision proofs and
action-risk descriptors plus approval coordination for cross-instance admission,
and a second PostgreSQL adapter shares tenant/API-key authentication, revocation,
policy/plan state, atomic monthly quota counters, and a deletion-evident,
retention-aware validation audit chain. The same shared control database now
also holds HMAC-bound environment policy/enforcement, registered schema
versions, and authenticated reviewed-release chains used directly by runtime
admission. Per-key rate windows are also atomic in the HMAC-bound shared API-key
row. Alert history, encrypted webhook configuration, transactional outbox
coverage, leasing, retry/dead-letter state, and redrive are shared as well.
Privacy-safe failure observations now commit in the same transaction as shared
validation audit/quota state. Their deletion-evident history, tenant and
thresholded network clusters, conformance runs, compatibility matrices, and
Ed25519-signed rulesets are shared too. Registered-schema rows have a separate
authenticated set manifest, so deleting an unpromoted version cannot silently
change schema-quality intelligence. A
horizontally scaled deployment still requires a fully shared transactional
control plane, removal of the remaining cross-store projection/notification
boundaries, and deployed failover evidence.
The repository does not yet contain an accumulated
customer production corpus; current compatibility signals come from checked-in
fixtures and locally generated privacy-safe signatures. Drift classification is
structural, not learned from observed runtime outcomes. The managed control plane
is still partly local: hosted human identity/organization membership,
real Stripe sandbox/settlement evidence, owned external paging and certificate-renewal
monitoring, receiver-specific email/Slack delivery, cloud KMS and key rotation,
removal of the remaining single-instance
projection boundaries, and multi-region availability still require explicitly
chosen external infrastructure. They are labeled `integration_required`, not
mocked as complete. The public-server decision and required evidence are tracked
in [Enterprise launch gates](docs/ENTERPRISE_LAUNCH_GATES.md).

License: the offline core, CLI, local API, and SDK packages are MIT licensed.
Managed service, shared-state, and anchor packages are separately licensed.
See [`docs/PRODUCT_BOUNDARY.md`](docs/PRODUCT_BOUNDARY.md) and
[`product-boundary.json`](product-boundary.json). Earlier revisions retain the
rights granted by the license shipped with those revisions.
