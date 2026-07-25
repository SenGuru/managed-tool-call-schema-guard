# Commercial-readiness completion evidence — 2026-07-25

## Verdict

The provider-independent product is a **conditional private-beta candidate for
operator-onboarded design partners**. It is not public-production ready and is
not ready for self-service signup or automated charging.

This verdict applies to the exact source checkpoint created after this report.
It does not promote historical staging evidence to exact-source evidence.

Final checkpoint inventory:

- managed runtime source/image: commit `32e42b3`, immutable `linux/amd64`
  image
  `sha256:772754291759169e5d9867b7ac0abe6fdf5ec3b2df255c9297f5149297804dd4`;
- independent anchor source/image: commit `dd60b4e`, immutable image
  `sha256:0dab2046729a75d75c68b0e4e9c4290b192ed50b6e23db3477b884d033ead9a2`;
- bounded host monitoring first committed at `09f7724`; final handoff is the
  branch HEAD containing this report;
- branch `codex/production-readiness-2026-07-24` is pushed. The tracked tree is
  clean; the unrelated untracked `apps/` directory was preserved and excluded.

### Action-control and restart-recovery completion

The final runtime checkpoint adds tenant emergency action hold, reviewed
enforced and non-mutating shadow policies, workload-bound approval/execution
fingerprints, the complete API/SDK/CLI/Python/dashboard surface, and
integrity-protected SQLite/shared-PostgreSQL state. The exact-source container
program exercised hold before approval/reservation, shadow comparison,
workload binding, anchor outage/recovery, PostgreSQL restart and container
restart.

That restart drill first caught an unhandled checked-out PostgreSQL client
error. Shared pools now attach client error handling before checkout while
queries continue to fail closed. The 18-test PostgreSQL suite and the full
137.416-second container program then passed.

The exact `linux/amd64` managed image was built from a clean Git archive,
scanned with zero High/Critical vulnerabilities or embedded secrets, transferred
with matching archive SHA-256, and deployed on DreamHost after a successful
off-machine backup. It runs as UID/GID 65532, read-only, with all capabilities
dropped and zero restarts. Loopback and public health/readiness are `200`.
Shared control migrations are `1,2,3`, including the populated action-control
table. The post-activation backup and both host monitors succeeded.

The DigitalOcean anchor code had no delta and remained on its previously
scanned `dd60b4e` image. Its pinned ED25519 host fingerprint exactly matched
the owner-provided value before SSH. The DreamHost checkpoint at revision 9,
two rows, and its complete checkpoint hash matched the independently read
DigitalOcean record exactly.

## Provider-independent completion delta

The commercial-completeness audit added and exercised:

- protected Prometheus metrics with a monitoring-only credential, bounded
  route/status labels, latency histograms, in-flight work, timeouts, dependency
  readiness, dispatch failures, memory, and uptime;
- authoritative privacy-safe operational gauges for tenant quota bands, alert
  and checkpoint delivery depth/age/dead-letter state, pending action
  reservations, and per-source availability; readiness now fails when a
  required operational-state table is unavailable, while the monitoring
  endpoint remains scrapeable and marks that source unavailable;
- strict W3C trace-context correlation with a new server span and one-way
  trace-ID hashes in logs;
- registered-and-observed inventory across API, TypeScript SDK, CLI, and
  dashboard, with schema and action fingerprints kept in intentionally separate
  privacy domains;
- a content-addressed, allowlisted, value-free evaluation export across API,
  TypeScript SDK, CLI, and dashboard;
- least-privilege dashboard key issuance with zero preselected scopes and a
  fresh scope/confirmation review for every key;
- retry-safe dashboard mutations: a committed change is reported as committed
  even if its supplemental inventory refresh is temporarily unavailable;
- accessible full-fingerprint copy controls and accurate tenant-scoped,
  value-free inventory labels;
- an explicit OWASP GenAI/Agentic, ASVS 5.0, and NIST AI RMF control mapping
  with certification and product-boundary non-claims;
- current primary-source market mapping that separates direct competitors,
  adjacent guardrails/security, observability/evaluation complements, and
  general policy infrastructure.

## Exact final regression

The commands below ran on 2026-07-25 after the operational-metrics delta:

| Command                                                                              | Observed result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                      | Latest clean full rerun passed in 21.43 seconds with the retained browser temporarily paused: format, build, ESLint, script syntax, dry provider boundary, package boundary, typecheck, conformance, 271 JavaScript/TypeScript tests passed, 19 credentialed PostgreSQL tests skipped, and 5 Python tests passed. The dry provider boundary reported zero live trials, as required. An earlier bounded full run passed in 236.81 seconds under heavier host contention. The unrelated untracked `apps/` tree was preserved.                                                                                 |
| Credentialed PostgreSQL regression                                                   | 18/18 shared-state tests passed against a fresh PostgreSQL 16 instance, including checked-out client error handling. The earlier complete coverage run passed 257 tests at 79.66% statements, 70.93% branches, 81.05% functions, and 81.43% lines.                                                                                                                                                                                                                                                                                                                                                          |
| Python client tests                                                                  | 5/5 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm audit --audit-level=low`                                                        | 0 known vulnerabilities across 379 dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run audit:container-e2e`                                                        | Latest current-branch pass completed in 63.423 seconds. It rebuilt the production images and proved fresh PostgreSQL 16, two-tenant isolation, dashboard assets, schema release/admission, deterministic repair/rejection, approval and idempotency controls, exact anchor acknowledgement, anchor outage/recovery, PostgreSQL and container restarts, persistence, notification and billing fail-closed boundaries, non-root/read-only/capability-dropped containers, secret-file mounts and log privacy.                                                                                                  |
| `trivy fs --scanners secret --quiet --format json .`                                 | The scan that overlapped the container audit detected only its intentionally generated disposable TLS key. After audit teardown removed that owner-only temporary directory, a clean whole-worktree rerun examined three targets and reported 0 secret findings.                                                                                                                                                                                                                                                                                                                                            |
| `npm run audit:images`                                                               | Managed, anchor, and PostgreSQL images: 0 High/Critical vulnerabilities and 0 embedded secrets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 .` | 0 High/Critical npm vulnerabilities, embedded secrets, or Dockerfile misconfigurations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run audit:framework-integrations`                                               | MCP SDK 1.29.0, OpenAI Agents 0.13.5, PydanticAI 2.13.0, and Google ADK 2.5.0 boundaries passed; rejected calls executed zero tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run audit:five-repos` / `audit:benchmarks` / `audit:real-data`                  | 5 repositories / 9 native fixtures / 35 derived calls passed; 7,699 recorded calls and 30,203 mutations matched; 2,501 real-data rows, 3,302 expected calls, and 15,702 mutations matched. Downloaded repository code was not executed.                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run audit:real-repos`                                                           | 20 repositories inspected, 106 fixtures extracted, and no downloaded repository code executed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run probe:live:dry`                                                             | OpenAI, Anthropic, and Gemini request/profile construction passed in dry-run mode; zero live trials were claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `cd website && npm run lint && npm test`                                             | Current private-site lint, five-stage production build and rendered-route suite passed. All 18 built routes were covered by the route inventory and all 3 comprehensive render/trust tests passed.                                                                                                                                                                                                                                                                                                                                                                                                          |
| In-app browser website and activation traversal                                      | Seventeen static routes plus the dynamic resource route were covered by build/render evidence; the browser traversed every static route without an error page or raw authentication JSON, exercised the Product menu, TypeScript/CLI/Managed API quickstarts, ambiguous-decision case and both activation branches. A stale `127.0.0.1:8788` managed link was found and fixed. The rebuilt managed handoff opened `https://api.akriven.com/dashboard/overview`, rendered the dashboard and sign-in UI, and did not expose raw `authentication_required` JSON. Authenticated onboarding remains pending MFA. |
| Owner-only private Sites deployment                                                  | The exact pushed website revision `16cf25d` was packaged, saved as private site version 15, and deployed successfully without changing public access or customer DNS. Owner-authenticated browser verification loaded the hosted landing page and `/start` managed path at `https://akriven.neckhurts55.chatgpt.site`; the managed workspace link resolved to `https://api.akriven.com/dashboard/overview`. This proves the private hosted marketing boundary, not public-domain routing, authenticated managed onboarding, live email, or billing.                                                         |
| Pinned isolated managed-load image on DreamHost                                      | Exact source revision `65c7bd5` built from the same digest-pinned Node base as production. The non-root image ran with a read-only filesystem, isolated network, temporary `/tmp`, no capabilities, no-new-privileges, 256-PID limit, two CPUs and 2 GiB RAM on the idle DreamHost host. It passed 2,000/2,000 requests in 6.391 seconds: 361.87 requests/s, p50 81.73 ms, p95 99.55 ms, p99 437.98 ms, 2,000 unique audit IDs, exact usage, valid audit/release chains and no persisted private sentinel. The live managed and PostgreSQL containers remained healthy.                                     |
| Clean local managed-load rerun                                                       | After terminating a verified orphaned busy-loop and temporarily pausing the retained browser process, the two pre-run CPU samples measured 77.77% and 82.54% idle. The unchanged audit passed 2,000/2,000 requests at concurrency 32 in 1.352 seconds: 1,479.55 requests/s, p50 19.74 ms, p95 25.04 ms, p99 109.32 ms, maximum 183.43 ms, exact metering, valid audit/release chains, and no persisted private sentinel. The owner-only report SHA-256 is `0f1dd47e44296a34eace3025f033841be85e2d86cc6389ca1a48e713cdbd1a1c`. This is a local single-process regression, not a network SLO.                 |
| Fail-closed commercial release gate                                                  | Seven focused tests prove missing/stale/configured-only/incomplete/secret-bearing evidence, unsafe permissions, symlinks and hash alteration fail closed; complete synthetic contract fixtures prove both target schemas. A real empty-evidence private-beta run exited `1` with verdict `no_go` and all ten required reports missing. Synthetic passing fixtures validate gate logic only; they are not commercial evidence.                                                                                                                                                                               |

Current serial measurements:

- core benchmark, 10,000 iterations: p50 54.875 µs, p95 94.875 µs,
  p99 228.791 µs;
- managed HTTP load, 2,000 requests at concurrency 32 and four API keys:
  482.88 requests/s, p50 53.99 ms, p95 104.89 ms, p99 322.56 ms, zero HTTP errors, 2,000
  unique audit IDs, valid 2,000-record audit chain, and no private sentinel in
  the database;
- isolated two-CPU DreamHost managed HTTP load, 2,000 requests at concurrency
  32 and four API keys: 361.87 requests/s, p50 81.73 ms, p95 99.55 ms, p99
  437.98 ms, zero HTTP or decision errors, 2,000 unique audit IDs, exact
  metering, valid audit/release chains, and no private sentinel in the
  disposable database;
- clean local managed HTTP load with 82.54% pre-run CPU idle, 2,000 requests at
  concurrency 32 and four API keys: 1,479.55 requests/s, p50 19.74 ms, p95
  25.04 ms, p99 109.32 ms, maximum 183.43 ms, zero HTTP or decision errors,
  exact metering, valid chains, and no persisted private sentinel;
- self-contained backup/restore: source and restored SQLite integrity true,
  row counts equal, control/audit/reconciliation/release chains valid, and
  backup file owner-only.

## Real browser evidence

The Codex in-app browser used a fresh disposable local tenant through the real
HTTP boundary and persisted database after rebuilding the current website and
managed service. This final pass:

- opened all 14 authenticated dashboard routes through the SPA router while
  preserving the tab-memory-only tenant credential;
- executed a guarded workbench validation and observed
  `valid_with_repair`, the exact integer repair, repaired-field evidence,
  policy result, audit ID, and signed value-free receipt;
- verified the irreversible retention action presents an in-page `<dialog>`
  and that no native JavaScript/browser dialog exists, then cancelled without
  executing the purge;
- verified the internal-evaluation quota and retention, exact 90-day
  design-partner offer, manual collection boundary, and disabled Checkout and
  Portal controls;
- rebuilt the previously stale website preview after it exposed a `/start`
  404, then traversed all 17 static routes plus all four resource-article
  routes; every route exposed a titled document, `main`, and `h1`;
- checked browser warning/error logs. The only recorded error belonged to the
  intentionally replaced stale `127.0.0.1:4173` preview; the rebuilt website
  and dashboard produced no new warning/error entry.

No destructive tenant deletion was executed in this browser pass. No external
provider was called or represented as proven.

## Purchased-host staging evidence

Strictly pinned SSH checks and controlled staging operations established:

- On 2026-07-25, a fresh DigitalOcean ED25519 scan again matched the
  owner-supplied fingerprint exactly before a read-only SSH inventory. The
  Ubuntu 24.04 anchor host had no failed units, no pending security updates,
  healthy pinned receiver and edge containers, and `200` loopback liveness and
  readiness.
- A fresh DreamHost ED25519 scan matched the previously pinned fingerprint
  exactly. The panel-confirmed `debian` account was reached through the
  separately loaded authorized identity; the owner's standard Mac public key
  was then added as a second authorized key after an owner-only backup, and a
  new `IdentitiesOnly` connection using that exact key succeeded. Six pending
  Debian security updates were applied. The host then had zero pending
  upgrades, zero failed units, no unhealthy containers, no reboot requirement,
  and public liveness/readiness remained `200`.
- The owner read the DigitalOcean Droplet's ED25519 fingerprint from its
  control-plane terminal. It exactly matched the separately pinned local
  known-hosts entry before DigitalOcean SSH operations resumed.
- DreamHost `208.113.209.209` uses default-drop IPv4 and IPv6 firewall
  policies. Only SSH, HTTP, HTTPS, and HTTPS/QUIC are admitted; the managed API
  listener is loopback-only behind the edge proxy. Fail2Ban is active for SSH.
- DigitalOcean `147.182.213.242` uses default-deny UFW rules; the anchor API is
  reachable from DreamHost across the WireGuard failure-domain link. No
  DigitalOcean Cloud Firewall is assigned and provider automated backups are
  not enabled, which remain defense-in-depth findings rather than hidden
  controls.
- Exact commit `dd60b4e` managed and anchor images were built locally for
  `linux/amd64`, run as UID/GID 65532, and scanned with zero High/Critical
  vulnerabilities or embedded secrets. The archives transferred to each host
  had matching SHA-256 values and the remote image IDs exactly matched the
  local images.
- The `dd60b4e` anchor image is running on DigitalOcean with zero restarts. Its
  previous image is retained under an immutable rollback tag. An immediate
  encrypted off-machine backup completed in 8 seconds with 8 seconds of
  measured receiver downtime. Pre/post activation database integrity, row
  counts, revision range, and checkpoint/event digests matched.
- The `887274c` managed image ran on DreamHost behind trusted TLS with zero
  restarts during this named historical drill. It is now retained as the
  schema-compatible rollback image after the later exact `089c86f` activation
  recorded at the start of this report. SQLite
  integrity is `ok`, schema version 15 and persisted counts survived
  activation, the PostgreSQL migration families remained current, and the
  action checkpoint remained revision 9 with two rows. The exact image is
  `linux/amd64`, UID/GID 65532, and its Trivy scan reported zero
  High/Critical vulnerabilities or embedded secrets.
- A fresh encrypted main backup completed in 2 seconds and recorded an
  off-machine transfer before managed activation. The backup is online and
  therefore recorded no application downtime.
- A newly required monitoring credential initially exposed a real deployment
  permission defect: the hardened UID 65532 process could not read a root-owned
  mode-0600 source file. The file was corrected to the same UID 65532,
  mode-0400 pattern as the other container secrets. A clean recreation then
  passed loopback and TLS health/readiness, dashboard, authenticated metrics
  (`200`), and unauthenticated metrics (`401`).
- The DreamHost revision 9 checkpoint hash had exactly one matching latest
  acknowledgement in the independent DigitalOcean anchor. The anchor integrity
  check was `ok`.
- A real separate-host anchor outage drill used a dedicated disposable
  `audit-*` tenant. High-risk action admission failed closed with
  `checkpoint_anchor_unacknowledged`; the edge recovered in 6.011 seconds; the
  uncertain reservation remained `duplicate_blocked`; and reconciliation and
  control-plane integrity passed. The audit tenant then completed the actual
  deletion-request lock, synchronized export/hash verification, offline
  deletion receipt, retained value-free anchor boundary, and credential/file
  cleanup.
- A receiver restart recovered in 6.965 seconds. Anchor integrity remained
  `ok`, all 12 latest checkpoints and 38 events remained present, and the
  ordered checkpoint/event digests were identical before and after restart.
- A PostgreSQL outage left liveness at `200`, removed readiness, recovered in
  5.730 seconds without restarting the managed container, and preserved the
  checkpoint exactly. The first observed readiness response was `500` rather
  than the intended `503`; this was classified as a defect, fixed so transient
  dependency exceptions degrade readiness and metrics deterministically, and
  covered by a focused regression. During the historical `887274c` activation,
  the repeated
  outage returned liveness `200`, readiness `503`, unauthenticated metrics
  `401`, authenticated degraded metrics `200`, and recovered in 5.753 seconds
  with the checkpoint unchanged.
- The preserved `dd60b4e` rollback image recovered in 6.503 seconds with
  identical SQLite/checkpoint state. Returning to `887274c` took 6.412 seconds
  and again retained identical state and zero restarts.
- The newest main archive was recovered from its DigitalOcean off-machine copy
  and the anchor archive from its DreamHost off-machine copy. The owner-only
  age identity matched the configured recipient; every bundled checksum
  passed; restored SQLite and anchor integrity were `ok`; and the restored
  revision 9 checkpoint had exactly one matching anchor acknowledgement.
  PostgreSQL started in an isolated, no-network, read-only-root, non-root
  container in 3.791 seconds and restored the custom dump in 1.429 seconds
  with all migration families and row counts present. The disposable container,
  volume, and decrypted workspace were removed.
- Both host monitor timers are enabled and healthy. The monitor now bounds each
  TLS connection and has a 120-second systemd limit; reviewed copies completed
  in 334 ms on DreamHost and 584 ms on DigitalOcean. Their optional local
  state-change webhook remains unconfigured.
- A Better Stack free-plan workspace now independently checks
  `https://api.akriven.com/readyz`; its first observed result was **Up**.
  Separate daily main- and anchor-backup heartbeats are installed as
  root-owned `0600` secret files on their respective hosts. Fresh real backup
  runs completed successfully and both heartbeats changed from Pending to
  **Up**.
- A controlled main-backup heartbeat failure created an external incident and
  delivered its failure email to the owner inbox. A subsequent healthy
  heartbeat resolved the incident after 23 seconds. This proves provider
  incident creation, email delivery and recovery for that route. It does not
  prove paid phone/SMS/push delivery, multi-person escalation or a sustained
  missed-heartbeat drill.
- A subsequent read-only provider-console recertification again showed the
  public readiness monitor and both daily backup heartbeats `Up`. It also
  showed no on-call schedule and no escalation policy. Scheduled on-call
  requires an account upgrade, and no second independently owned responder is
  present. This strengthens the blocker evidence rather than promoting paging
  to proven.
- The separate-host outage runner now requires an owner-only SSH identity,
  a non-group/other-writable known-hosts file, `IdentitiesOnly`, and strict
  host-key checking. It no longer relies on ambient SSH trust.

These are production-like staging observations on the purchased hosts. They do
not prove customer-production traffic, external paging acknowledgement, or
unavailable identity/email/billing/model providers.

### Notification and WorkOS staging activation

Commit `32e42b3` was built for `linux/amd64` as UID/GID 65532, scanned with
zero High/Critical vulnerabilities and zero detected image secrets, archived,
transferred and loaded with an identical archive SHA-256. A fresh encrypted
off-machine main backup completed before activation. The full
production/PostgreSQL/edge/WorkOS Compose graph validated before the managed
container was recreated.

The activated container is healthy with zero restarts. Public and loopback
liveness/readiness are `200`; SQLite integrity is `ok` at migration 17; shared
control migrations are `1,2,3,4`; both notification outboxes were empty after
activation. All three WorkOS secret files are mounted mode `0400` for UID/GID 65532. The authenticated notification inventory returned `200`; an attempted
send and Postmark callback returned `501` with no row created because Postmark
is intentionally unconfigured. A 15-minute log scan found no WorkOS key or
private-sentinel pattern.

The real public `GET /v1/auth/login` boundary returned `302` to WorkOS AuthKit
and issued the secure state cookie. Its first console configuration used the
nonexistent `/v1/auth/sign-in` endpoint and correctly produced `401`; the
observed mismatch was corrected to `/v1/auth/login` before the browser
certification proceeded. At this report checkpoint the hosted owner flow had
reached WorkOS email verification. Callback/session/MFA/logout evidence remains
pending until that owner-controlled verification and enrollment finishes.

## Remaining launch blockers

### Before first design-partner action traffic

Current provider-independent identity/email/outbox checkpoint: `npm run check`
passed with 271 JS/TS tests, 19 credentialed-PostgreSQL tests skipped by the
uncredentialed default run, and 5 Python tests. The deterministic additions
cover WorkOS-compatible session/RBAC/CSRF/BOLA/outage behavior plus Postmark
send/webhook normalization and encrypted notification
idempotency/leasing/privacy/retry/dead-letter/redrive/API/dashboard/SDK/CLI
behavior. They are not live-provider evidence. The credentialed coverage gate
then passed all 283 tests against disposable PostgreSQL 16 at 79.30%
statements, 73.36% branches, 81.51% functions, and 81.28% lines. The
PostgreSQL notification contract explicitly exercised concurrent claiming,
delivery, provider-event replay, forced dead-letter, operator redrive, recovery
delivery and tamper detection.

1. Add a second independently owned responder and exercise acknowledgement and
   escalation. Better Stack email incident delivery and recovery are proven,
   but the free plan does not provide the required paid call/SMS/push route.
2. Exercise a customer-owned HTTPS webhook receiver and downstream side-effect
   ledger through acknowledgement, completion, timeout, duplicate, ambiguous,
   and reconciliation paths.
3. Pin and live-test the exact OpenAI, Anthropic, and Gemini versions intended
   for the cohort, including timeout, malformed output, and drift behavior.
4. Complete an independent security review, ASVS requirement record, incident
   drill, legal/privacy review, vulnerability-disclosure path, and support
   ownership.

### Before self-service or automated charging

1. Deploy and externally exercise the configured WorkOS staging boundary:
   verified email, public-TLS callback/session/logout, invitations, MFA
   enrollment/recovery, membership removal, provider revocation,
   cross-organization isolation and future SSO/SCIM. The staging project,
   application, callbacks, hardened methods, mapped organization, owner user
   and exact owner role are configured; the local server/session/CSRF/BOLA
   contract is proven, but live Akriven session behavior is not yet.
2. Configure and externally exercise the implemented Postmark adapter,
   authenticated webhook normalizer, and encrypted durable notification
   outbox. The SQLite/PostgreSQL queue, leasing, idempotency, retry,
   dead-letter/redrive, privacy-safe evidence, API, dashboard, SDK and CLI
   paths are proven provider-independently; external delivery, bounce,
   duplicate/reordering, callback allowlisting and outage behavior are not.
3. Provision and certify the branded Akriven email boundary without conflating
   a mailbox with a transactional sender. The recommended split is Google
   Workspace for a human-operated address such as `support@akriven.com`, and
   Postmark for application notifications and WorkOS authentication mail.
   Before use, verify the GoDaddy DNS zone's MX, SPF, DKIM, custom return-path
   alignment and staged DMARC policy, then exercise delivery, reply, bounce,
   complaint and outage paths. Any mailbox purchase or customer-facing DNS
   mutation remains an owner-confirmation gate. The ordered implementation and
   evidence gates are in `docs/BRANDED_EMAIL_PROVIDER_CHECKLIST.md`.
4. Rotate the previously exposed Stripe test credential outside chat. Supply
   the replacement only through a secret manager or owner-only file, then
   exercise test-mode Checkout, Portal, signed webhook, replay, duplicate,
   reordering, failed payment, recovery, cancellation, entitlement changes,
   refund/credit, tax, invoice, and dunning paths.
5. Complete public account, consent, support, security-contact, and
   retention/deletion flows without publishing the currently private website
   until explicitly approved.

### Evidence that only the market can produce

- willingness to pay at the design-partner price;
- activation time and implementation burden;
- retained usage, renewal, expansion, and churn;
- real support load, provider costs, payment loss, and gross margin;
- customer incident outcomes and downstream-ledger reconciliation quality.

## Honest boundary

What is proven is a substantial deterministic checkpoint, managed control
plane, operator dashboard, API/SDK/CLI surface, hardened container topology,
provider-independent operational program, exact `32e42b3` managed plus
`dd60b4e` anchor cross-host staging operation, and real backup/restore,
anchor-outage, deletion, restart, rollback, and checkpoint evidence. What is
not proven is a public SaaS business, a customer-production SLO, external
paging, live identity/email/billing/model-provider integration, independent
security/legal review, or customer demand.
