# Commercial-readiness completion evidence — 2026-07-25

## Verdict

The provider-independent product is a **conditional private-beta candidate for
operator-onboarded design partners**. It is not public-production ready and is
not ready for self-service signup or automated charging.

This verdict applies to the exact source checkpoint created after this report.
It does not promote historical staging evidence to exact-source evidence.

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

| Command                                                                                           | Observed result                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product-targeted build, ESLint, typecheck, script-syntax, package-boundary, and conformance gates | Passed; conformance covered 8 cases, 4 adapters, and 8 probes. The root aggregate `npm run check` is not a valid exact-source result because an unrelated, concurrently created untracked `apps/trade-signal-lab/` directory is outside the root TypeScript/format configuration. That directory was preserved and excluded from this checkpoint.                  |
| Serial uncredentialed test suite                                                                  | Current source: 234 passed and 17 credentialed PostgreSQL cases skipped; the one parallel resource-contention timeout from the earlier pass was rerun focused and the complete suite then passed serially                                                                                                                                                          |
| Credentialed PostgreSQL coverage                                                                  | Current source against a fresh isolated PostgreSQL 16 instance: 43 files and 251/251 tests passed; the prior coverage-instrumented run measured 79.86% statements, 73.31% branches, 81.33% functions, and 81.62% lines                                                                                                                                             |
| Python client tests                                                                               | 5/5 passed                                                                                                                                                                                                                                                                                                                                                         |
| `npm audit`                                                                                       | 0 known vulnerabilities                                                                                                                                                                                                                                                                                                                                            |
| `npm run audit:container-e2e`                                                                     | Passed in 93.703 seconds against exact current source, fresh PostgreSQL 16, hardened managed and independent TLS-anchor images, two tenants, authoritative operational metrics, tracing, inventory/export, all decision paths, release admission, approvals/idempotency, outage/redrive, restart/persistence, tenant isolation, secret-file and log-privacy checks |
| `npm run audit:images`                                                                            | Managed, anchor, and PostgreSQL images: 0 High/Critical vulnerabilities and 0 embedded secrets                                                                                                                                                                                                                                                                     |
| `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 .`              | 0 High/Critical npm vulnerabilities, embedded secrets, or Dockerfile misconfigurations                                                                                                                                                                                                                                                                             |
| `npm run audit:framework-integrations`                                                            | MCP SDK 1.29.0, OpenAI Agents 0.13.5, PydanticAI 2.13.0, and Google ADK 2.5.0 boundaries passed; rejected calls executed zero tools                                                                                                                                                                                                                                |
| `npm run audit:five-repos` / `audit:benchmarks` / `audit:real-data`                               | 5 repositories / 9 native fixtures / 35 derived calls passed; 7,699 recorded calls and 30,203 mutations matched; 2,501 real-data rows, 3,302 expected calls, and 15,702 mutations matched. Downloaded repository code was not executed.                                                                                                                            |
| `npm run audit:real-repos`                                                                        | 20 repositories inspected, 106 fixtures extracted, and no downloaded repository code executed                                                                                                                                                                                                                                                                      |
| `npm run probe:live:dry`                                                                          | OpenAI, Anthropic, and Gemini request/profile construction passed in dry-run mode; zero live trials were claimed                                                                                                                                                                                                                                                   |

Current serial measurements:

- core benchmark, 10,000 iterations: p50 45.5 µs, p95 97.917 µs,
  p99 290.792 µs;
- managed HTTP load, 2,000 requests at concurrency 32 and four API keys:
  411.16 requests/s, p50 65.91 ms, p95 86.75 ms, p99 594.94 ms, zero HTTP errors, 2,000
  unique audit IDs, valid 2,000-record audit chain, and no private sentinel in
  the database;
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
- The `887274c` managed image is running on DreamHost behind trusted TLS with
  zero restarts after a deliberate clean recreation. The `dd60b4e` image and
  the previous release are retained under immutable rollback tags. SQLite
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
  covered by a focused regression. After `887274c` activation, the repeated
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
  in 334 ms on DreamHost and 584 ms on DigitalOcean. No external webhook is
  configured, so paging delivery or acknowledgement is not claimed.
- The separate-host outage runner now requires an owner-only SSH identity,
  a non-group/other-writable known-hosts file, `IdentitiesOnly`, and strict
  host-key checking. It no longer relies on ambient SSH trust.

These are production-like staging observations on the purchased hosts. They do
not prove customer-production traffic, external paging acknowledgement, or
unavailable identity/email/billing/model providers.

## Remaining launch blockers

### Before first design-partner action traffic

1. Configure an external paging destination for the already-running independent
   uptime and backup-heartbeat monitors, then observe delivery,
   acknowledgement, and escalation.
2. Exercise a customer-owned HTTPS webhook receiver and downstream side-effect
   ledger through acknowledgement, completion, timeout, duplicate, ambiguous,
   and reconciliation paths.
3. Pin and live-test the exact OpenAI, Anthropic, and Gemini versions intended
   for the cohort, including timeout, malformed output, and drift behavior.
4. Complete an independent security review, ASVS requirement record, incident
   drill, legal/privacy review, vulnerability-disclosure path, and support
   ownership.

### Before self-service or automated charging

1. Select and exercise hosted human identity: verified email, organizations,
   membership/role binding, invitations, sessions, MFA, recovery, and future
   SSO/SCIM.
2. Select and exercise transactional email, including bounce, retry, and outage
   behavior.
3. Rotate the previously exposed Stripe test credential outside chat. Supply
   the replacement only through a secret manager or owner-only file, then
   exercise test-mode Checkout, Portal, signed webhook, replay, duplicate,
   reordering, failed payment, recovery, cancellation, entitlement changes,
   refund/credit, tax, invoice, and dunning paths.
4. Complete public account, consent, support, security-contact, and
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
provider-independent operational program, exact `887274c` managed plus
`dd60b4e` anchor cross-host staging operation, and real backup/restore,
anchor-outage, deletion, restart, rollback, and checkpoint evidence. What is
not proven is a public SaaS business, a customer-production SLO, external
paging, live identity/email/billing/model-provider integration, independent
security/legal review, or customer demand.
