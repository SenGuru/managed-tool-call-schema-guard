# Production-readiness handoff — 2026-07-23 (updated 2026-07-24)

> The final provider-independent private-beta gate, including evidence for
> source changes after r7, is recorded in
> [`PRIVATE_BETA_TRACEABILITY_2026-07-24.md`](PRIVATE_BETA_TRACEABILITY_2026-07-24.md).
> Deployed r7 measurements below apply only to that exact revision.

## Verdict

**NO-GO for public production or automated paid self-service.**

The exact deployed managed revision is suitable for **internal staging**. An
operator-onboarded private cohort is still conditional on owned external
paging, a clean-machine recovery-key retrieval drill, approved legal/support
operations, and a restriction against customer mutation traffic. The owner
accepted the scheduled daily RPO, reported off-workstation recovery-key escrow
complete, and approved publication of the reviewed website. Hosted identity,
an exercised Stripe sandbox account, email/recovery, KMS, live provider probes,
independent security review, and customer evidence remain absent. The deployed
r7 image implements a disabled-by-default sandbox billing authority, but no
Stripe credential is configured and this is not external Stripe evidence.

This verdict deliberately separates working software from a purchasable,
operated SaaS.

## What changed during the final exact-revision audit

The first r2 separate-host deletion drill exposed a production defect that the
then-current tests and HTTP-only evidence had missed. In shared mode, the public
deletion request changed PostgreSQL to `deletion_pending` while leaving the
local SQLite projection active. The response looked correct, but the offline
operator correctly refused irreversible deletion.

r3 fixed that lifecycle defect:

- updates the signed local lifecycle before the shared transaction;
- restores the prior signed local lifecycle if the shared update fails;
- treats an already-pending shared lifecycle as a convergence case;
- has deterministic success and rollback tests;
- has a production-container assertion that inspects both stores after the
  public request; and
- was independently proven through both the public API and in-app browser before
  exact-export-hash deletion.

r4 adds the missing browser-operable managed control plane:

- 14 read-only panels cover lifecycle, usage, audit, alerts, releases,
  intelligence, webhooks, deliveries, actions, reconciliation, billing,
  control-plane integrity, rulesets, and recent decisions;
- 27 editable workbench presets cover the managed mutation and operational
  route families;
- non-GET requests require an explicit per-request confirmation;
- unresolved path and JSON placeholders fail closed; and
- the tenant API key remains a password input held only in tab memory.

r5 closes the production-bootstrap credential exposure:

- public/shared bootstrap rejects API keys passed in process arguments;
- an existing key can be read from a protected file;
- a generated key is written directly to a new mode-0600 file; and
- stdout contains metadata only and never contains the generated credential.

The current working tree, after r5, adds a sandbox-only Stripe billing
authority: a separately namespaced billing migration, Checkout/Portal, raw signed webhooks,
provider-current invoice/subscription reconciliation, fail-closed entitlement
state, SDK/CLI methods, and two additional workbench presets (29 total). The
exact amd64 image was built, scanned, and deployed to internal staging as r6
with billing unconfigured. It has not been exercised against a real Stripe test
account.

The exact-r7 public audit then exposed a second defect that earlier empty-alert
export fixtures had missed: a PostgreSQL alert row exported its internal
`source_key_hash`. The public program failed at the initial export before
continuing. r7 now excludes every internal `*_key_hash` field in both SQLite
and PostgreSQL serializers, adds an alert-bearing PostgreSQL regression, and
passes the same external export assertion against a tenant containing a real
durable alert. No assertion was weakened.

The deployed managed image is:

`sha256:516b0869f9bb507641ddd5ae602a02b43fc620375f5134409776fe374970239d`

It is `linux/amd64`, UID/GID 65532, read-only, capability-free, healthy, and had
zero restarts at final inspection. Trivy found zero HIGH/CRITICAL
vulnerabilities and zero embedded secrets. The exact image was streamed over
the trusted SSH connection and its image ID verified before rollout. r6 and r5
remain retained under rollback tags.

## Requirements-to-evidence traceability

The complete row-by-row matrix is
[BLUEPRINT_AUDIT_2026-07-22.md](BLUEPRINT_AUDIT_2026-07-22.md). It distinguishes
implementation, deterministic tests, production-like evidence, status, and
launch disposition for:

- deterministic decisions and bounded repairs;
- provider/framework normalization;
- policies, approvals, idempotency, reconciliation, and fail-closed admission;
- registry, releases, drift, conformance, and compatibility intelligence;
- tenant isolation, API keys, lifecycle, export, retention, and deletion;
- audit/control chains, signatures, manifests, and independent checkpoints;
- API, CLI, TypeScript SDK, Python client, and dashboard workflows;
- quotas, statements, plan enforcement, alerts, webhooks, and redrive;
- migrations, containers, edge controls, monitoring, backup/restore, and
  rollback;
- website, identity, billing, legal/support, and market boundaries.

No documentation assertion is counted as runtime proof by itself.

Provider choices and exact sandbox/owner-console gates are recorded in
[EXTERNAL_PROVIDER_PLAN.md](EXTERNAL_PROVIDER_PLAN.md).

## Executed test inventory

| Boundary                             | Exact command or operation                                                                                   | Observed result                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Declared repository gate             | repository sub-gates plus `npm test` and `npm run test:python`                                               | 36 TS files passed, one PostgreSQL-only file skipped; 191 passed and 16 skipped; four Python tests passed                                                                                                                                                                                                 |
| Credentialed PostgreSQL and coverage | `SCHEMA_GUARD_TEST_POSTGRES_URL=... npm run test:coverage` against fresh PostgreSQL 16                       | Current r7: 37 files and 207/207 tests in 9.48 s; statements 79.40%, branches 73.46%, functions 80.29%, lines 81.24%; PostgreSQL used bounded tmpfs and the disposable container was removed                                                                                                              |
| Stripe billing source boundary       | focused tests, signed raw-body fixtures, disposable PostgreSQL 16, container/extreme negative gates          | Checkout/Portal/provider-current reconciliation, invoice/subscription events, replay/reordering, crash window, replacement and cross-tenant rejection pass; no Stripe account/network proof                                                                                                               |
| r7 staging correction and rollback   | alert-bearing export regression; exact amd64 transfer; guarded dual-overlay rollout; prior clean r6→r5 drill | r7 healthy at exact digest with zero restarts; control migrations `1,2` and billing `1`; r6/r5 rollback tags retained; public ready/dashboard 200; billing remains unconfigured                                                                                                                           |
| Secure production bootstrap          | Public-mode bootstrap with `--api-key-output-file`; file-input container bootstraps                          | Generated credential was written mode 0600 and absent from stdout; direct command-line credential and writable input file were rejected; the generated credential authenticated successfully                                                                                                              |
| Production-container lifecycle       | `npm run audit:container-e2e`                                                                                | Current r7 passed in 12.970 s; managed, persistent PostgreSQL, TLS proxy, anchor, file-key bootstrap, synchronized deletion projections, restart/outage recovery, disabled billing guards, dashboard guards, and log privacy                                                                              |
| Public managed workflow              | `npm run audit:public-managed`                                                                               | First exact-r7 run rejected an alert-bearing export containing `source_key_hash`; corrected exact-r7 rerun passed 64 HTTPS requests in 21.593 s, including registry, releases, every decision outcome, policy, key lifecycle, approval, idempotency, checkpoint, integrity, privacy-safe export, and lock |
| Separate-host outage                 | `npm run audit:public-anchor-outage` with explicit `r5-3f514af8` label                                       | Passed in 15.991 s; public action returned `checkpoint_anchor_unacknowledged`; anchor recovered in 4.185 s; reservation stayed duplicate-blocked; reconciliation/control integrity passed                                                                                                                 |
| In-app browser                       | Real dashboard at `https://api.akriven.com/dashboard`                                                        | Exact-r7 public browser executed all 29/29 presets and parsed all 14/14 panels; configured operations succeeded, durable webhook dead-letter/redrive succeeded, guarded conflicts were observed, and all three unconfigured billing mutations failed closed with 501                                      |
| Browser-triggered deletion           | Locked-state browser export followed by offline inspect/export/delete                                        | All 13 operational panels cleared while lifecycle/export remained available; local/shared lifecycle both `deletion_pending`; exact local/shared export hashes accepted; dual signed receipts retained; tenant and every temporary key/export/confirmation file removed                                    |
| Image security                       | Trivy runtime image and CycloneDX SBOM scans                                                                 | Zero HIGH, zero CRITICAL, zero embedded secrets                                                                                                                                                                                                                                                           |
| Package security                     | `npm audit --audit-level=moderate`                                                                           | Zero known npm vulnerabilities                                                                                                                                                                                                                                                                            |
| Filesystem security                  | Trivy filesystem vulnerability/secret/misconfiguration scan                                                  | Zero reported HIGH/CRITICAL findings or secrets                                                                                                                                                                                                                                                           |
| Severe local program                 | `npm run audit:extreme`                                                                                      | Current r7 passed in 27.176 s; 2,000 requests at concurrency 32, 949.03 req/s, p50 31.15 ms, p95 36.48 ms, p99 178.40 ms, zero errors; adversarial, recovery, packaging, audit, and evidence-redaction gates passed                                                                                       |
| Framework runtimes                   | `npm run audit:framework-integrations` with reviewed Python runtime                                          | MCP, OpenAI Agents, PydanticAI, and Google ADK packages exercised; rejected calls executed zero tools                                                                                                                                                                                                     |
| Static external corpora              | `audit:real-data`, `audit:benchmarks`, `audit:five-repos`, `audit:real-repos`                                | Static data/source only; downloaded third-party code was not executed; limitations remain explicit                                                                                                                                                                                                        |
| Website local boundary               | `npm ci`, `npm run lint`, `npm test`, then in-app-browser traversal in `website/`                            | Zero npm vulnerabilities; lint/build and three render/trust tests passed; all 16 routes loaded in the browser; primary/trust navigation worked; privacy/support/terms/security non-claims were present                                                                                                    |
| Website public boundary              | Sites version 14 deployment plus in-app-browser traversal of the production URL                              | Commit `fdaef4aef49c01ff5b0b28f7124e3aacd9b76429` deployed successfully; all 16 routes loaded with expected headings; no 404 or bearer-auth error; real Security and Terms link clicks succeeded                                                                                                          |

Dry-run provider probes are not live provider evidence. Local framework
execution is not model-provider behavior. The browser workbench exposes the
managed daily-use route families, but scripted public-TLS assertions remain
necessary and no dashboard proves downstream tool execution.

## Deployment topology and hardened inventory

### Main failure domain

- DreamHost self-managed VPS.
- Managed r7, hardened PostgreSQL 16, and scratch-based Caddy edge.
- Only SSH, HTTP/ACME, HTTPS, and HTTP/3 are allowed by the host firewall.
- PostgreSQL, managed loopback, anchor, and Portainer ports are closed or
  filtered externally.
- Managed and PostgreSQL containers are non-root, read-only, secret-file based,
  bounded, healthy, and zero-restart at final inspection.
- Backup, ingest, retention, and monitor timers are enabled and active.

### Independent checkpoint failure domain

- DigitalOcean Ubuntu 24.04 host.
- Receiver and edge are on separate volumes/administration from the main host.
- Receiver is loopback-only; HTTPS admission is restricted to the DreamHost
  address and the private WireGuard path.
- Receiver and edge are non-root, read-only, capability-free, healthy, and
  zero-restart at final inspection.
- Backup, ingest, retention, and monitor timers are enabled and active.

### Public boundary

- `api.akriven.com` resolves to the reviewed main edge.
- HTTP redirects to HTTPS.
- HTTPS readiness returns 200; unauthenticated managed usage returns 401.
- Hostile-origin requests receive no CORS allow-origin permission.
- The publicly trusted certificate is valid through 2026-10-20.

## Backup, restore, rollback, RPO, and RTO

- Both failure domains have scheduled encrypted cross-host backups plus ingest
  and retention jobs.
- A fresh pre-r3 main backup completed and its exact ciphertext was found on the
  independent host.
- The current recovery recipient was used to decrypt fresh main and anchor
  archives; both bundle manifests verified.
- Clean restore evidence includes SQLite v15/26 tables, PostgreSQL 34 public
  tables/shared-control v2, anchor SQLite, audit/control integrity, exact action
  checkpoint comparison, and active owner lifecycle.
- Latest observed PostgreSQL restore: 1 second.
- Managed clean-restore readiness: previously 12.676 seconds.
- Anchor clean restore: previously 22 seconds.
- Anchor outage recovery on exact r5 path: 4.185 seconds.
- Hardened PostgreSQL migration maintenance RTO: 90 seconds.
- Current scheduled RPO: daily. WAL/PITR is not configured.
- The owner explicitly accepted that daily RPO for the first cohort on
  2026-07-23. No tighter recovery promise is proven or authorized.
- The pre-lifecycle managed binary is not compatible with the current migration
  histories. Rollback requires a current-schema-compatible forward fix or a
  complete backup restore into new volumes. Do not drop lifecycle or receipt
  records to make an old binary start.

The owner reported that the newly usable Age recovery identity was escrowed
off-workstation on 2026-07-23. A clean-machine retrieval/decryption drill has
not yet been observed, so escrow availability is owner-attested rather than
runtime-proven. Older archives whose matching private identity was not found
remain retained but are not counted as recoverable.

## Security findings and disposition

### Fixed

- Shared deletion request left the local lifecycle projection stale.
- The managed dashboard exposed only a small read-only subset of the managed
  product. r4 adds the complete operator workbench and explicit mutation and
  placeholder guards.
- Public/shared bootstrap could be run without asserting stopped service.
- Public/shared bootstrap could expose the one-time administrator key through
  stdout or a process argument. r5 requires protected file input or direct
  mode-0600 file output and keeps the credential out of stdout.
- Container E2E did not inspect both lifecycle projections.
- Long CLI lifecycle coverage could exceed the default test timeout.
- Public outage evidence hardcoded an obsolete revision label.
- Severe-gate failure evidence could retain one-time API-key material.
- Edge base image/runtime findings were replaced by a patched scratch build.
- Backup recovery recipient lacked an available private identity for new
  evidence.

The first r4 rollout invocation accidentally omitted the PostgreSQL TLS/CA
Compose overlay. Readiness failed closed. The automatic rollback invocation
used the same incomplete overlay and therefore also remained unhealthy until
the operator restored r3 with both reviewed Compose files. No PostgreSQL, edge,
DNS, or anchor service was restarted. r4 was then redeployed with the complete
overlay and automatic rollback guard and finished healthy with zero restarts.
This incident is retained as negative deployment evidence: all production
rollout and rollback commands must include both `compose.yml` and
`compose.postgres.yml`.

### Still open

- No owned external paging receiver or independent paging escalation.
- No observed automatic certificate renewal.
- No KMS/envelope-key service or exercised key rotation.
- No WAL/PITR; the owner accepted the resulting daily RPO for the first cohort.
- No multi-instance managed failover.
- No independent penetration test, ASVS record, or operated incident exercise.
- No hosted human identity, organization membership/RBAC, recovery, or MFA
  policy.
- Sandbox-only billing code, Checkout/Portal interfaces, signed provider
  webhooks, invoice/subscription reconciliation, replacement subscriptions,
  and fail-closed entitlements now pass deterministic and PostgreSQL tests.
  The code is deployed in r7 but disabled; no real Stripe test account,
  Checkout, Portal, test clock, tax, refund, invoice, or settlement has been
  exercised.
- No protected live OpenAI/Anthropic/Gemini probes.
- No published package consumer-install certification or registry provenance.
- No customer usage, willingness-to-pay, retention, support, or market proof.

## Website and purchasable-SaaS boundary

The owner explicitly approved publication. The reviewed website candidate was
committed in its separate repository as
`fdaef4aef49c01ff5b0b28f7124e3aacd9b76429`, pushed to the existing Sites source
repository, packaged from that exact commit, saved as version 14, and deployed
successfully to `https://akriven.neckhurts55.chatgpt.site`. No custom-domain or
public-DNS mutation was made.

The production URL was then exercised in the in-app browser. All 16 reviewed
routes returned their expected page and heading, including privacy, support,
terms, and security; none returned a 404 or the prior bearer-auth error. Real
client clicks traversed from the home page to Security and from Security to
Terms. The terms page states that it covers evaluation, is not paid-service
terms, does not announce general availability, and offers no checkout.

The lingering generic starter package name and README were replaced with
Akriven-specific metadata and an honest hosting boundary. A third deterministic
test now locks footer trust links plus privacy, support, terms, and security
non-claims. Lint, build, and all three website tests passed after the change.

## Remaining launch blockers

### Must-fix before any customer data or mutating customer action

1. Escrow the backup recovery identity outside the owner workstation and run a
   retrieval drill. Escrow is owner-attested complete; the retrieval drill
   remains unobserved.
2. Configure an owned external paging destination, monitor it independently,
   and exercise delivery, silence, failure, dead letter, and escalation.
3. Obtain legal approval for the now-published privacy, terms, support,
   retention, incident, and security-contact surfaces.
4. Complete an independent security review and a real incident-response drill.
5. Keep customer mutation traffic disabled until an authoritative downstream
   ledger has proven uncertain-action reconciliation.

### Must-fix before public self-service or charging

1. Hosted identity, verified email, organization membership, invitations,
   role separation, recovery, sessions, CSRF defenses, and MFA policy.
2. Run the implemented billing authority against a real Stripe test account:
   browser Checkout/Portal, test clocks, failed payment/recovery, cancellation,
   replacement, duplicates/reordering/outage, and exact-image public-TLS proof.
   Decide and implement refund/credit, tax, invoice, and dunning policy. See
   [`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md).
3. KMS-backed secrets and versioned rotation.
4. Operated metrics, SLOs, dashboards, paging, status communication, and support
   ownership.
5. Complete package/release provenance and consumer installation.

### Should-fix before public beta

1. Separate production migrations from application startup.
2. Add multi-instance/failover only after every authoritative path is shared.
3. Run protected live provider probes with pinned versions.
4. Perform sustained external load/soak tests and set resource-backed SLOs.
5. Observe certificate renewal and longer-running backup/restore schedules.

### Post-launch evidence

- Customer failure interception rate and time saved.
- Conversion, retention, expansion, churn, and willingness-to-pay.
- Provider and framework drift incidence.
- Support load, incident rate, and operational cost.

## Exact owner actions

Do not paste any key, token, payment value, or private credential into chat.

1. From the reported escrow copy, prove recovery-key retrieval and decryption
   on a clean machine without exposing the key in chat or source control.
2. Create the recommended provider accounts/projects below in sandbox or test
   mode. Provide only non-secret account/project identifiers; load credentials
   directly into the deployment secret manager.
3. Create the owned Better Stack paging route and non-secret monitor/receiver
   identifiers, then exercise delivery and escalation.
4. Obtain legal review for terms, privacy, DPA/subprocessor position, retention,
   deletion, and support commitments.
5. Commission an independent security review and name incident/support
   ownership.

## Recommended provider stack

This is a recommendation, not configured or exercised integration evidence:

1. **WorkOS AuthKit** for hosted authentication, first-class organizations, and
   organization-scoped roles/permissions. Start with one role per membership
   for predictable authorization and add enterprise SSO only when demanded.
   Sources: [AuthKit overview](https://workos.com/docs/authkit/overview),
   [users and organizations](https://workos.com/docs/authkit/users-organizations),
   and [roles and permissions](https://workos.com/docs/authkit/roles-and-permissions).
2. **Stripe Billing** for Checkout, subscriptions, Customer Portal, and signed
   asynchronous billing events. Implement only in sandbox/test mode until test
   clocks cover trial, renewal, failed-payment, cancellation, duplicate, and
   reordered-event cases. Sources:
   [Billing integration testing](https://docs.stripe.com/billing/testing) and
   [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks).
3. **Better Stack** for independent HTTPS/expiry checks, backup and worker
   heartbeats, incidents, on-call schedules, and escalation. Its heartbeat
   model directly covers the current daily backup timer. Sources:
   [heartbeat monitors](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/)
   and [incident lifecycle](https://betterstack.com/docs/uptime/working-with-incidents/).
4. **Postmark** for transactional verification, invitation, recovery, billing,
   security, and support notifications, using a separate transactional message
   stream and a verified sender domain. Source:
   [Postmark developer guide](https://postmarkapp.com/developer/).
5. **AWS KMS** for customer-managed symmetric wrapping keys and envelope
   encryption. Use a least-privilege application principal, record the key
   version/ARN with each envelope, enable audited rotation, and fail closed when
   KMS is unavailable. Sources:
   [AWS KMS envelope encryption](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html)
   and [key rotation](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html).

## What was actually proven

### Deterministic local evidence

The core, adapters, compiler, repair engine, policies, action gate, local/shared
stores, SDKs, CLI, Python client, migrations, tamper checks, and packaging pass
their declared gates. Static public benchmark/source replays add breadth but do
not establish provider or customer behavior.

### Production-like network evidence

The exact scanned r7 image is live behind public TLS with persisted PostgreSQL,
an independent checkpoint host, scheduled encrypted cross-host backups,
restorable evidence, hardened containers, and a 29-preset browser workbench.
Exact-r7 evidence includes the 64-request public program, all 29 presets and 14
panels, alert-bearing privacy-safe export, secure file-only bootstrap,
dual-store export-hash deletion, pre-migration backup, separate billing
migration history, clean r6→r5 rollback compatibility, exact-digest rollout,
public readiness/dashboard, and disabled billing boundaries. The measured
independent-host outage/recovery remains exact-r5 evidence because the
DigitalOcean host key was not silently retrusted. This is strong
internal-staging evidence, not a production SLA.

### Real customer and market evidence

None. No paid checkout, real customer traffic, production action ledger,
retention cohort, support operation, or willingness-to-pay study was exercised.
Benchmark performance and a functioning staging system must not be represented
as product-market fit.
