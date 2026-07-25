# Provider-independent private-beta traceability — 2026-07-24

> Exact-source verification update: the complete 2026-07-25 browser, route,
> credentialed PostgreSQL, container, security, load, recovery, framework and
> corpus evidence is recorded in
> [`EXHAUSTIVE_FEATURE_VERIFICATION_2026-07-25.md`](EXHAUSTIVE_FEATURE_VERIFICATION_2026-07-25.md).
> That report supersedes test counts and exact-source observations below while
> preserving this document's requirements matrix and external-blocker
> classifications.
>
> The subsequent commercial-completeness delta and final 231-test,
> container/image, dependency, load, recovery, inventory, metrics, tracing and
> evaluation-export evidence is recorded in
> [`COMMERCIAL_READINESS_EVIDENCE_2026-07-25.md`](COMMERCIAL_READINESS_EVIDENCE_2026-07-25.md).

## Verdict scope

This document is the release gate for the source on
`codex/production-readiness-2026-07-24`. It supersedes repository-wide
readiness conclusions in earlier reports while retaining their measurements as
historical evidence for the exact revisions they exercised.

The provider-independent product is suitable for **internal staging** and is a
**conditional private-beta candidate for operator-onboarded design partners**.
It is a **no-go for public beta, self-service enrollment, automated charging,
or a production SLO claim** until the external gates in
[`EXTERNAL_PROVIDER_PLAN.md`](EXTERNAL_PROVIDER_PLAN.md) are exercised.

The private-beta candidate means:

- the customer receives an independently usable MIT checkpoint plus an
  operator-managed shared service;
- tenant access is by scoped operator-issued API key, not human identity;
- the design-partner offer is manually contracted and invoiced;
- live payment, identity, email, paging, secret-manager, immutable-backup, and
  model-provider integrations are not represented as proven;
- irreversible tool execution remains the customer's responsibility and must
  use the reservation, acknowledgement, completion, and reconciliation
  protocol;
- the private website may be reviewed locally but must not be published or
  moved to customer-facing DNS by this gate.

## Evidence vocabulary

- **proven** — deterministically exercised at the stated boundary on this
  source revision;
- **partially proven** — the important internal behavior was exercised, but an
  external or multi-host boundary remains;
- **configured only** — reviewed code or configuration exists without a
  credentialed provider exercise;
- **documented only** — a procedure exists without observed execution;
- **missing** — the claimed or required behavior is not implemented;
- **blocked** — an external account, credential, verified host, legal decision,
  customer endpoint, or owner-console action is required.

Historical evidence is never silently promoted to exact-source evidence.

## Requirements-to-evidence matrix

| Requirement                                                                              | Reachable implementation                                                                                                                                                                                                                                                   | Deterministic evidence                                                                                                                                                        | Production-like evidence                                                                                                   | Status and launch consequence                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Deterministic `valid`, `valid_with_repair`, and `rejected` checkpoint semantics          | `packages/core`, protocol, compiler, engine                                                                                                                                                                                                                                | Core, property, adversarial, conformance, SDK and Python tests                                                                                                                | Exact-source managed/PostgreSQL/anchor container lifecycle                                                                 | **Proven** for internal and container boundaries                                                          |
| Raw argument and raw schema preservation                                                 | strict JSON parser, protocol receipts, managed audit envelopes                                                                                                                                                                                                             | Duplicate-key, malformed JSON, Unicode, numeric, depth, size, hashing and export tests                                                                                        | Container validation/audit/export path                                                                                     | **Proven**; raw sensitive values are not written to access logs or cross-tenant intelligence              |
| Safe allowlisted unambiguous repair and reject-on-uncertainty                            | repair planner and engine                                                                                                                                                                                                                                                  | Property/adversarial suites plus 30,203 and 15,702 mutation replays                                                                                                           | Container proves scalar repair and ambiguous numeric rejection                                                             | **Proven**                                                                                                |
| Reasons, hints, repaired fields, audit IDs and verifiable receipts                       | protocol, audit builders and signed stores                                                                                                                                                                                                                                 | Unit, SDK, CLI, tamper and chain tests                                                                                                                                        | Container audit lifecycle and integrity verification                                                                       | **Proven**                                                                                                |
| Provider normalization parity                                                            | provider adapters and conformance fixtures                                                                                                                                                                                                                                 | Differential/conformance tests and static benchmark replays                                                                                                                   | No live model-provider call in this revision                                                                               | **Partially proven**; live pinned-provider probes are **blocked**                                         |
| Framework runtime parity                                                                 | MCP, OpenAI Agents, PydanticAI and Google ADK adapters                                                                                                                                                                                                                     | Real installed framework audit on Node 22 and Python 3.13; rejected calls execute zero tools                                                                                  | No model API used                                                                                                          | **Proven** at framework boundary; external provider behavior remains blocked                              |
| Policy enforcement and environment narrowing                                             | managed policy/environment stores and evaluator                                                                                                                                                                                                                            | SQLite, PostgreSQL, API, SDK and CLI tests                                                                                                                                    | Container policy and environment override lifecycle                                                                        | **Proven**                                                                                                |
| Action classification and approval                                                       | action descriptors, challenges and evidence chain                                                                                                                                                                                                                          | Local/shared/tenant-isolation/tamper tests                                                                                                                                    | Container challenge, approval and irreversible action admission                                                            | **Proven** internally                                                                                     |
| Idempotency reservation, exact checkpoint acknowledgement, completion and reconciliation | action shared-state tables, anchor outbox and APIs                                                                                                                                                                                                                         | Concurrency, replay, checkpoint compare, tamper and reconciliation tests                                                                                                      | Container duplicate block, anchor outage fail-closed, recovery and redrive                                                 | **Proven** through a separate TLS container; customer downstream side-effect ledger is **blocked**        |
| Schema registry, releases, promotion and runtime admission                               | managed schemas, environments and schema releases                                                                                                                                                                                                                          | Local/shared/PG/API/SDK/CLI tests                                                                                                                                             | Container register/promote/enforce/reject workflow                                                                         | **Proven**                                                                                                |
| Drift, compatibility, conformance and privacy-thresholded intelligence                   | core drift and managed conformance/intelligence stores                                                                                                                                                                                                                     | Unit/property/conformance and privacy threshold tests                                                                                                                         | Container idempotent conformance ingestion and intelligence read                                                           | **Proven** for synthetic/value-free data; customer corpus value is **blocked**                            |
| Signed audit chains and tamper detection                                                 | SQLite and PostgreSQL audit/control stores                                                                                                                                                                                                                                 | Forgery, mutation, cross-tenant and chain verification tests                                                                                                                  | Container control-plane and audit verification                                                                             | **Proven**                                                                                                |
| Retention, purge receipts and independent anchors                                        | retention policy, purge transaction, checkpoint outbox/receiver                                                                                                                                                                                                            | Local/shared/PG tests and recovery audit                                                                                                                                      | Container purge plus independent anchor persistence/outage recovery                                                        | **Partially proven**; legal retention schedule and exact-source off-machine restore are blocked           |
| Managed API daily workflow                                                               | managed HTTP server and dashboard                                                                                                                                                                                                                                          | Extensive HTTP suite and embedded dashboard guard tests                                                                                                                       | Exact-source production image/container E2E                                                                                | **Proven** for operator API-key model                                                                     |
| TypeScript SDK, CLI and Python client                                                    | public workspaces and Python package                                                                                                                                                                                                                                       | SDK, CLI and Python client tests cover plans, policy, schemas, descriptors, challenges, keys and alert acknowledgement                                                        | Clients call the same HTTP contract exercised in containers                                                                | **Proven** provider-independently                                                                         |
| Open-source/paid-managed boundary                                                        | `product-boundary.json`, scoped licenses and package graph gate                                                                                                                                                                                                            | `npm run check:packages` verifies membership, licenses, dependency direction and packed contents                                                                              | Not applicable                                                                                                             | **Proven**                                                                                                |
| Tenant lifecycle and isolation                                                           | tenant bootstrap, local/shared lifecycle, export and deletion                                                                                                                                                                                                              | SQLite/PG BOLA/IDOR, key scope, deletion and export tests                                                                                                                     | Two-tenant container isolation plus dual-store deletion lock                                                               | **Proven** for operator-created tenants                                                                   |
| API-key create, list metadata, scope, rotate/revoke                                      | local and PostgreSQL control stores and admin APIs                                                                                                                                                                                                                         | HMAC, tamper, no-plaintext, scope, tenant and SDK/CLI tests                                                                                                                   | Container create/use/revoke lifecycle                                                                                      | **Proven**                                                                                                |
| Human authentication, organization membership, invitations, recovery, MFA and RBAC       | no production human identity boundary                                                                                                                                                                                                                                      | No deterministic provider test                                                                                                                                                | None                                                                                                                       | **Missing/blocked**; WorkOS is required before self-service or multi-user customer access                 |
| Quotas, plan enforcement and metering                                                    | code-owned plan catalog and transactional counters                                                                                                                                                                                                                         | SQLite/PG quota, plan, usage and billing tests                                                                                                                                | Container shared metering and billing statement                                                                            | **Proven**                                                                                                |
| Customer-facing offer and entitlements                                                   | `packages/managed/src/plans.ts` and pricing document                                                                                                                                                                                                                       | Plan/API/SDK/CLI/Python tests                                                                                                                                                 | Private website source/build/browser verification                                                                          | **Proven as an invite-only offer**, not as market demand                                                  |
| Billing statements and entitlement state                                                 | managed billing store and statement API                                                                                                                                                                                                                                    | Signature, replay, reordering, conflict and provider-current contract tests                                                                                                   | Container billing boundary returns state and fails disabled routes closed                                                  | **Proven internally**                                                                                     |
| Checkout, portal, webhooks, failed payments and cancellation                             | Stripe sandbox adapter and Compose overlay                                                                                                                                                                                                                                 | Deterministic contract tests only                                                                                                                                             | Disabled container returns `501` fail closed                                                                               | **Configured only/blocked** until real Stripe test-mode lifecycle                                         |
| Alerts and acknowledgement                                                               | signed local/shared alert stores and dashboard/API/clients                                                                                                                                                                                                                 | Tenant isolation, HMAC, idempotency and client tests                                                                                                                          | Container alert read; acknowledgement is exact-source unit/PG tested                                                       | **Proven internally**                                                                                     |
| Durable alert webhooks, retry, dead-letter and redrive                                   | webhook outbox/operator endpoints                                                                                                                                                                                                                                          | Signature, retry, replay and redrive tests                                                                                                                                    | Container rejects unsafe callback target; no customer receiver used                                                        | **Partially proven**; external receiver and paging delivery are blocked                                   |
| Independent checkpoint anchor                                                            | anchor receiver, TLS edge configuration and signed acknowledgement protocol                                                                                                                                                                                                | Anchor protocol, tamper and shared-state tests                                                                                                                                | Separate managed/anchor containers, outage, restart and persistence                                                        | **Proven on one Docker host**; exact-source separate-host rollout is blocked                              |
| Data export and deletion                                                                 | privacy-safe export, lifecycle lock and offline deletion operator                                                                                                                                                                                                          | Local/shared/PG export, hash, confirmation and rollback tests                                                                                                                 | Container export excludes verifiers; deletion pending fails closed                                                         | **Proven internally**; legal verification and customer delivery process remain external                   |
| Paying-customer dashboard                                                                | 14-route workflow dashboard with dedicated integration, validation, contracts, schemas, environments, actions, approvals, alerts, intelligence, evidence, access, usage/billing and tenant controls; raw evidence and the 29-operation workbench remain advanced fallbacks | DOM interaction tests cover routing, credential races and dedicated validation; all operator mutations are required outside the workbench-only fallback                       | In-app-browser exercised the persisted validate-to-action lifecycle; production image serves the same dashboard and assets | **Proven for the operator/API-key product boundary**; human session/role UX is blocked                    |
| Website, pricing, activation and product-boundary claims                                 | private Next.js website including developer quickstart, evidence, mechanism, decision, runtime, use-case, managed-governance, pricing, docs, FAQ and `/start` activation screens                                                                                           | Lint, build, 18-route render tests, complete 1280px/390px in-app-browser traversal, quickstart/decision/use-case interactions, both activation branches and dashboard handoff | Not deployed by this revision                                                                                              | **Proven as private source only** at website commit `2e7a0df`; self-service identity remains blocked      |
| Deployment and migrations                                                                | pinned images, Compose overlays and backward-safe migrations                                                                                                                                                                                                               | Build, migration, PG and configuration tests                                                                                                                                  | Fresh PostgreSQL/container startup plus service/database restarts                                                          | **Proven on local Docker**; new-source host rollout is blocked                                            |
| Rollback                                                                                 | retained versioned migrations/images and documented runbook                                                                                                                                                                                                                | Compatibility tests and historical exact-revision drill                                                                                                                       | No exact-source provider rollback in this gate                                                                             | **Partially proven**                                                                                      |
| Backup and restore                                                                       | SQLite online backup plus host scripts for encrypted PostgreSQL/anchor backups                                                                                                                                                                                             | Local recovery audit and non-root backup-reader audit                                                                                                                         | Container persistence restart; historical separate-host restore belongs to earlier revision                                | **Partially proven**; exact-source clean-host encrypted restore and Object Lock are blocked               |
| TLS, ports, CORS, proxy trust, limits and headers                                        | Caddy/Compose/server configuration                                                                                                                                                                                                                                         | Configuration, HTTP and adversarial tests                                                                                                                                     | Container TLS anchor path, CSP, request limits and auth behavior                                                           | **Proven locally**; public-edge exact-source scan is blocked                                              |
| Non-root/read-only/capability-limited containers and secret files                        | pinned Dockerfiles and Compose hardening                                                                                                                                                                                                                                   | Dockerfile/config scan and image inspection                                                                                                                                   | Managed/anchor container E2E plus non-root backup-reader archive exercise                                                  | **Proven**                                                                                                |
| Monitoring, uptime, backup heartbeats and independent paging                             | runbooks and provider plan                                                                                                                                                                                                                                                 | Local alert generation only                                                                                                                                                   | No real external delivery target                                                                                           | **Documented only/blocked**                                                                               |
| Dependency, source, image and supply-chain controls                                      | lockfile, package gate, pinned images and scan scripts                                                                                                                                                                                                                     | npm audit and Trivy source/image scans                                                                                                                                        | Exact local images scanned                                                                                                 | **Proven for current databases**; registry attestation and continuous monitoring remain future operations |
| Performance and denial-of-service controls                                               | request/body/schema limits and managed runtime                                                                                                                                                                                                                             | adversarial tests, 10k core benchmark and 2k-request managed load                                                                                                             | Short local process load only                                                                                              | **Partially proven**; no sustained VPS soak or public SLO                                                 |
| Real customer value, willingness to pay, renewal and support load                        | none                                                                                                                                                                                                                                                                       | Planning assumptions only                                                                                                                                                     | No paid cohort evidence                                                                                                    | **Missing**; must not be described as product-market proof                                                |

## Claim reconciliation

The audit corrected these contradictions rather than preserving optimistic
documentation:

1. The repository is not wholly MIT. The public checkpoint packages are MIT;
   managed control-plane, shared-state and anchor packages are proprietary and
   private. Earlier published revisions retain their shipped license.
2. Multi-instance managed coordination is no longer described as missing:
   PostgreSQL-backed audit, control, action, schema, billing and alert state are
   implemented and exercised. SQLite remains a bounded local projection.
3. The dashboard is no longer called a complete customer account product. It
   is a complete operator/API-key workflow surface with 14 direct workflow
   routes, structured state, raw evidence disclosures and a 29-operation
   advanced workbench. Human sessions, memberships and recovery are external
   gates.
4. The only customer-facing paid offer is the 90-day design-partner package.
   Former Team/Business/Enterprise prices are planning hypotheses, not public
   offers or revenue evidence.
5. Billing code is not payment proof. Disabled runtime routes fail closed;
   Stripe remains blocked until its real sandbox lifecycle is exercised.
6. Historical DreamHost/DigitalOcean evidence proves only the exact historical
   revisions named in earlier reports. The current source has local,
   PostgreSQL and container evidence and requires a new verified rollout before
   it can inherit multi-host status.
7. The private website describes blocked provider boundaries explicitly and
   provides a real open-core versus operator-issued activation journey without
   faking signup, checkout, renewal or account recovery.

## Exact provider-independent test inventory

| Command                                                                                                    | Observed result                                                                                                                                                                                                                                     | Boundary                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `npm run check`                                                                                            | 2026-07-25 exact-source rerun passed in approximately 30.0 s: format, build, lint, script syntax, dry provider probe, package boundary, typecheck, conformance, 222 TypeScript tests passed, 16 PostgreSQL tests skipped, and 5 Python tests passed | Local/SQLite/in-memory                            |
| credentialed `npm run test:coverage` against disposable PostgreSQL 16                                      | Final rerun: 39/39 files and 227/227 tests passed in 5.73 s; statements 79.48%, branches 73.43%, functions 80.62%, lines 81.33%                                                                                                                     | Loopback PostgreSQL                               |
| `npm run audit:extreme`                                                                                    | Final rerun passed in 46.64 s                                                                                                                                                                                                                       | Severe local gate                                 |
| managed load inside `audit:extreme`                                                                        | 2,000/2,000 HTTP 200; zero errors; 554.08 req/s; p50 53.85 ms, p95 68.22 ms, p99 278.18 ms; unique audits and valid chain                                                                                                                           | Short local load, not SLO                         |
| core benchmark inside `audit:extreme`                                                                      | 10,000 operations; p50 58.250 µs, p95 164.042 µs, p99 580.416 µs                                                                                                                                                                                    | Local CPU                                         |
| `npm run audit:container-e2e`                                                                              | 2026-07-25 final exact-source rerun passed in 52.043 s; fresh PostgreSQL, TLS anchor, two tenants, all decision paths, promotion/admission, approval/idempotency, outage/redrive, restarts, persistence, hardening and log redaction                | Exact-source production images on one Docker host |
| `npm run audit:framework-integrations`                                                                     | Passed with automatic Python 3.13 selection; MCP 1.29.0, OpenAI Agents 0.13.5, PydanticAI 2.13.0, Google ADK 2.5.0; no model API or external repository code                                                                                        | Real framework packages                           |
| `npm run audit:release-candidate -- --output .codex-work/release-candidate-current.json`                   | Preflight blocked as designed on absent PostgreSQL URL and live OpenAI, Anthropic and Gemini model credentials; Docker 29.5.2 was reachable                                                                                                         | External-provider release gate                    |
| `npm run audit:five-repos`                                                                                 | 5 static repositories, 9 fixtures, 20 source calls, 35 derived calls, zero failures                                                                                                                                                                 | Commit-pinned static source reads                 |
| `npm run audit:benchmarks`                                                                                 | 7,699 recorded calls; 7,575 conforming; 124 visible source conflicts; 30,203/30,203 mutations matched                                                                                                                                               | Static benchmark data; no downloaded code         |
| `npm run audit:real-data`                                                                                  | 2,501 rows; 3,302 expected calls; 3,266 baseline pass; 36 visible conflicts; 15,702/15,702 mutations matched                                                                                                                                        | BFCL static data; no downloaded code              |
| `npm audit --audit-level=moderate`                                                                         | 0 vulnerabilities across 370 dependencies                                                                                                                                                                                                           | Current npm advisory database                     |
| `npm run audit:images`                                                                                     | Managed, anchor and PostgreSQL images: 0 High/Critical vulnerabilities and 0 secrets                                                                                                                                                                | Local image contents                              |
| exact-source CycloneDX generation plus `trivy sbom --scanners vuln --severity HIGH,CRITICAL --exit-code 1` | SBOMs retained for managed, anchor and PostgreSQL images; all three SBOM scans passed                                                                                                                                                               | Local image contents                              |
| `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 .`                       | 0 vulnerabilities, 0 secrets and 0 High/Critical misconfigurations after non-root deployment fixes                                                                                                                                                  | Local checkout                                    |
| non-root backup-reader archive exercise                                                                    | UID/GID 65532, no network, read-only root filesystem and all capabilities dropped; archive of same-UID anchor volume succeeded                                                                                                                      | Disposable local Docker volumes                   |
| private website `npm run lint`, `npm run build`, and render tests                                          | Passed; 18 routes including `/pricing` and `/start`; 3/3 render suites                                                                                                                                                                              | Nested private website repository                 |
| private website in-app-browser inspection                                                                  | All 18 routes traversed at 1280px and 390px; quickstart, decision and use-case tabs, mobile navigation, both activation branches, managed-dashboard navigation and zero document overflow verified                                                  | Local browser only                                |

The final regression rerun and commit identifiers are appended during release
checkpointing. Generated test outputs are evidence artifacts, not
implementation proof by themselves.

## Failures found during this gate

- Strict lint rejected two new test assertions; the tests were typed directly
  and rerun without weakening lint.
- The first credentialed PostgreSQL run exposed a missing
  `sg_alert_acknowledgements` table in test reset ordering. The foreign-key
  dependency was fixed and all 214 tests reran.
- The first container run exhausted Docker storage while PostgreSQL created
  WAL. Only dangling audit images and build cache were pruned; tagged
  candidates and user data were preserved. The exact suite then passed.
- The framework audit rejected macOS Python 3.9. It passed unchanged against
  the installed Python 3.13 runtime. The audit now discovers an installed
  Python 3.10+ runtime deterministically.
- The production environment template omitted the PostgreSQL password-file,
  TLS-directory and CA-bundle locations required by Compose; exact template
  coverage tests now prevent undeclared interpolation.
- The anchor edge omitted HSTS, and the recovery drill/documentation encouraged
  an inline master secret. The edge now matches the main security headers and
  recovery accepts an owner-only secret file.
- Two container rebuilds failed before compilation because Docker could not
  complete registry downloads. A locked npm cache mount was added, the exact
  build later succeeded, and the complete container E2E passed.
- The image audit masked a missing Trivy report with an `ENOENT` exception. It
  now reports the scanner/output failure directly.
- The first new Integration Guide test found that its page was present in the
  HTML but omitted from the server route allowlist, returning 401 on direct
  navigation. The server route was added and the complete route loop passed.
- A real in-app-browser rejection returned the correct HTTP 422 but left the
  previous `valid_with_repair` card visible. The validation workflow now treats
  a structured 422 `rejected` response as a first-class checkpoint decision,
  clears stale output before submission, and has deterministic browser-DOM
  regression coverage.
- The filesystem scan identified root defaults in the PostgreSQL and backup
  utility images. PostgreSQL now declares UID/GID 999 and the one-shot backup
  reader uses UID/GID 65532 with a pre-owned output file, no network, read-only
  root filesystem and no Linux capabilities. A disposable archive exercise
  and the scan both pass.

These are evidence that the gates detected defects; the initial failures are
not counted as passes.

## 2026-07-25 customer-browser evidence

The exact local dashboard was exercised through the in-app browser with the
real loopback HTTP boundary and persisted SQLite tenant database. The browser
journey—not direct API calls—completed:

1. API-key workspace connection and compact connected state;
2. SDK/CLI integration guidance and the
   validate/approve/reserve/execute/complete protocol;
3. `valid`, `valid_with_repair`, and fail-closed `rejected` decisions;
4. decision filtering and signed audit-envelope inspection with event hash,
   previous hash, signature, and no sensitive raw argument values;
5. immutable schema registration and exact-hash promotion;
6. high-risk irreversible action classification, approval challenge, guarded
   approval, idempotent reservation, execution completion, and checkpoint
   comparison reporting `same`;
7. validate-only API-key issue, one-time secret presentation without DOM
   capture, guarded revocation, and revoked inventory state;
8. in-product alert acknowledgement and rejection of a loopback/private
   webhook destination;
9. signed ruleset publication, organization-policy save, and cancellation of
   an irreversible retention purge;
10. complete design-partner offer review with provider-dependent checkout and
    portal controls disabled;
11. collapsible navigation at a 1,440 × 1,000 viewport with zero horizontal
    page overflow.

This is customer-workflow evidence on a local service boundary. It does not
prove public TLS, real identity/email/payment/paging delivery, multi-host
DreamHost/DigitalOcean operation, or customer willingness to pay.

## External blockers

### Must be closed before the first design partner sends action traffic

1. Independently verify the DigitalOcean host fingerprint in the provider
   console before any SSH operation.
2. Deploy this exact committed source to private staging on the reviewed main
   and anchor hosts; repeat TLS, migration, outage, rollback and clean restore
   drills.
3. Configure independently delivered uptime, backup-heartbeat and paging
   alerts and observe acknowledgement/escalation.
4. Install secrets through an owner-controlled secret manager, never chat,
   source control or command-line arguments.
5. Configure immutable off-machine backups and complete a clean-host restore
   with audit/anchor checkpoint comparison.
6. Obtain a customer-owned test webhook and downstream side-effect ledger;
   prove acknowledgement-before-execution, completion and ambiguous-result
   reconciliation.
7. Select and live-test the exact model/provider versions the customer will
   use, including timeout, malformed-stream and provider-drift behavior.

### Must be closed before self-service or automated charging

1. WorkOS identity, organization membership, MFA, recovery and server-side
   role/tenant binding.
2. Postmark verification, invitation, recovery, security and billing email,
   including bounce/retry/outage behavior.
3. Stripe test-mode Checkout, Portal, signed webhook, replay/reordering,
   failed-payment, cancellation and entitlement reconciliation.
4. Public website account flows, support ownership, privacy/terms acceptance
   and an externally reviewed retention/deletion policy.

### Post-launch validation

- paid cohort willingness to pay and renewal;
- actual provider bills, payment loss, support time and gross margin;
- sustained multi-tenant load/soak and database growth;
- availability, latency and incident data sufficient to set a defensible SLO.

## What was actually proven

### Deterministic local evidence

The checkpoint engine, repairs, policy, schemas, audits, action protocol,
tenant lifecycle, quotas, internal billing state, alert/webhook machinery,
clients, package boundary, pricing catalog and private website source pass
their local, PostgreSQL and static-data gates.

### Production-like network evidence

Exact-source pinned containers exercised managed HTTP, fresh PostgreSQL and a
TLS-separated checkpoint receiver with restart, outage, recovery, persistence,
tenant isolation, fail-closed billing and secret/log hardening on one Docker
host. Earlier reports retain real DreamHost-to-DigitalOcean evidence only for
their named historical revisions.

### Real customer and market evidence

None. No live provider integration, automated payment, public signup, paying
cohort, renewal, measured support burden or customer incident was produced by
this gate.
