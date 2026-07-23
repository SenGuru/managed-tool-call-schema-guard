# Production-readiness handoff — 2026-07-23

## Verdict

**NO-GO for public production or automated paid self-service.**

The exact deployed managed revision is suitable for **internal staging**. An
operator-onboarded private cohort is still conditional on owned external
paging, a clean-machine recovery-key retrieval drill, approved legal/support
operations, and a restriction against customer mutation traffic. The owner
accepted the scheduled daily RPO, reported off-workstation recovery-key escrow
complete, and approved publication of the reviewed website. Hosted identity,
billing, email/recovery, KMS, live provider probes, independent security review,
and customer evidence remain absent.

This verdict deliberately separates working software from a purchasable,
operated SaaS.

## What changed during the final exact-revision audit

The first r2 separate-host deletion drill exposed a production defect that the
then-current tests and HTTP-only evidence had missed. In shared mode, the public
deletion request changed PostgreSQL to `deletion_pending` while leaving the
local SQLite projection active. The response looked correct, but the offline
operator correctly refused irreversible deletion.

r3 now:

- updates the signed local lifecycle before the shared transaction;
- restores the prior signed local lifecycle if the shared update fails;
- treats an already-pending shared lifecycle as a convergence case;
- has deterministic success and rollback tests;
- has a production-container assertion that inspects both stores after the
  public request; and
- was independently proven through both the public API and in-app browser before
  exact-export-hash deletion.

The deployed managed image is:

`sha256:57ce369135602f5831663c43f305d4eb19e3906de123e36b8cc176cbda0c84ee`

It is `linux/amd64`, UID/GID 65532, read-only, capability-free, healthy, and had
zero restarts at final inspection. Trivy found zero HIGH/CRITICAL
vulnerabilities and zero embedded secrets.

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

## Executed test inventory

| Boundary                             | Exact command or operation                                                             | Observed result                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Declared repository gate             | `npm run check`                                                                        | 35 TS files passed, one PostgreSQL-only file skipped; 183 passed and 15 skipped; four Python tests passed                                                                                              |
| Credentialed PostgreSQL and coverage | `SCHEMA_GUARD_TEST_POSTGRES_URL=... npm run test:coverage` against fresh PostgreSQL 16 | 36 files, 198/198 tests in 16.31 s; statements 79.63%, branches 73.72%, functions 80.98%, lines 81.59%; disposable database removed                                                                    |
| Production-container lifecycle       | `npm run audit:container-e2e`                                                          | Passed in 18.647 s; managed, PostgreSQL, TLS proxy, anchor, two tenants, synchronized deletion projections, three restart classes, outage recovery, hardening, and log privacy                         |
| Public managed workflow              | `npm run audit:public-managed`                                                         | 61 HTTPS requests in 18.077 s; registry, releases, every decision outcome, policy, key lifecycle, approval, idempotency, checkpoint, integrity, export, and lock                                       |
| Separate-host outage                 | `npm run audit:public-anchor-outage` with explicit r3 label                            | Public action returned `checkpoint_anchor_unacknowledged`; anchor recovered in 7.622 s; reservation stayed duplicate-blocked; reconciliation/control integrity passed                                  |
| In-app browser                       | Real dashboard at `https://api.akriven.com/dashboard`                                  | All panels loaded; export downloaded with hash; wrong deletion rejected; correct deletion locked access; locked reload suppressed operational panels; export remained available                        |
| Browser-triggered deletion           | Offline inspect/export/delete after the browser request                                | Local and shared lifecycle both `deletion_pending`; exact export hashes accepted; signed receipts retained; audit tenant and temporary key removed                                                     |
| Image security                       | Trivy runtime image and CycloneDX SBOM scans                                           | Zero HIGH, zero CRITICAL, zero embedded secrets                                                                                                                                                        |
| Package security                     | `npm audit --audit-level=moderate`                                                     | Zero known npm vulnerabilities                                                                                                                                                                         |
| Filesystem security                  | Trivy filesystem vulnerability/secret/misconfiguration scan                            | Zero reported HIGH/CRITICAL findings or secrets                                                                                                                                                        |
| Severe local program                 | `npm run audit:extreme`                                                                | Passed; adversarial/property, load, recovery, packaging, audit, and evidence-redaction gates                                                                                                           |
| Framework runtimes                   | `npm run audit:framework-integrations` with reviewed Python runtime                    | MCP, OpenAI Agents, PydanticAI, and Google ADK packages exercised; rejected calls executed zero tools                                                                                                  |
| Static external corpora              | `audit:real-data`, `audit:benchmarks`, `audit:five-repos`, `audit:real-repos`          | Static data/source only; downloaded third-party code was not executed; limitations remain explicit                                                                                                     |
| Website local boundary               | `npm ci`, `npm run lint`, `npm test`, then in-app-browser traversal in `website/`      | Zero npm vulnerabilities; lint/build and three render/trust tests passed; all 16 routes loaded in the browser; primary/trust navigation worked; privacy/support/terms/security non-claims were present |
| Website public boundary              | Sites version 14 deployment plus in-app-browser traversal of the production URL        | Commit `fdaef4aef49c01ff5b0b28f7124e3aacd9b76429` deployed successfully; all 16 routes loaded with expected headings; no 404 or bearer-auth error; real Security and Terms link clicks succeeded       |

Dry-run provider probes are not live provider evidence. Local framework
execution is not model-provider behavior. A browser dashboard does not expose
every API route; routes without UI were exercised through the real public TLS
boundary instead.

## Deployment topology and hardened inventory

### Main failure domain

- DreamHost self-managed VPS.
- Managed r3, hardened PostgreSQL 16, and scratch-based Caddy edge.
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
- Anchor outage recovery on exact r3 path: 7.622 seconds.
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
- Public/shared bootstrap could be run without asserting stopped service.
- Container E2E did not inspect both lifecycle projections.
- Long CLI lifecycle coverage could exceed the default test timeout.
- Public outage evidence hardcoded an obsolete revision label.
- Severe-gate failure evidence could retain one-time API-key material.
- Edge base image/runtime findings were replaced by a patched scratch build.
- Backup recovery recipient lacked an available private identity for new
  evidence.

### Still open

- No owned external paging receiver or independent paging escalation.
- No observed automatic certificate renewal.
- No KMS/envelope-key service or exercised key rotation.
- No WAL/PITR; the owner accepted the resulting daily RPO for the first cohort.
- No multi-instance managed failover.
- No independent penetration test, ASVS record, or operated incident exercise.
- No hosted human identity, organization membership/RBAC, recovery, or MFA
  policy.
- No sandbox billing authority, checkout, portal, signed provider webhooks,
  failed-payment handling, cancellation, refund, or entitlement reconciliation.
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
2. Sandbox billing checkout/portal, raw-body signature verification, replay,
   duplicates, reordering, failure, cancellation, refund, tax, and entitlement
   reconciliation.
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

The exact scanned r3 image is live behind public TLS with persisted PostgreSQL,
an independent checkpoint host, scheduled encrypted cross-host backups,
restorable evidence, hardened containers, fail-closed receiver outages, public
API workflows, and a real browser dashboard. This is strong internal-staging
evidence, not a production SLA.

### Real customer and market evidence

None. No paid checkout, real customer traffic, production action ledger,
retention cohort, support operation, or willingness-to-pay study was exercised.
Benchmark performance and a functioning staging system must not be represented
as product-market fit.
