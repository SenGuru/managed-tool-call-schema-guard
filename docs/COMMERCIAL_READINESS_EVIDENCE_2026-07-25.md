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
| Serial uncredentialed test suite                                                                  | 232 passed and 17 credentialed PostgreSQL cases skipped; the one parallel resource-contention timeout was rerun focused (5/5) and the complete suite then passed serially                                                                                                                                                                                          |
| Credentialed PostgreSQL coverage                                                                  | 42 files and 249/249 tests passed; 79.86% statements, 73.31% branches, 81.33% functions, and 81.62% lines                                                                                                                                                                                                                                                          |
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

## Purchased-host preflight

Read-only checks after commit `6055990` established the following without
switching running services:

- DreamHost `208.113.209.209` is online and its observed ED25519 host key
  matches the separately pinned local known-hosts entry.
- The DreamHost managed service, PostgreSQL, and edge proxy are healthy; the
  public readiness endpoint presents trusted TLS.
- DreamHost uses default-drop IPv4 and IPv6 host-firewall policies. Only SSH,
  HTTP, HTTPS, and HTTPS/QUIC are admitted; the managed API listener is bound to
  loopback behind the edge proxy. Fail2Ban is active for SSH.
- The running managed container is still the previous reviewed
  `schema-guard-managed:0.2.0` release. Exact commit `dd60b4e` managed and
  anchor images were built locally for `linux/amd64`, run as UID/GID 65532,
  and scanned with zero High/Critical vulnerabilities or embedded secrets.
  Their local image IDs are
  `sha256:1c244d892e85e98e2a2fa1bbf7b7d8866a7f717ac4c42ff8f457a3e2d81700fb`
  and
  `sha256:0dab2046729a75d75c68b0e4e9c4290b192ed50b6e23db3477b884d033ead9a2`.
- The exact `dd60b4e` managed archive was transferred to DreamHost with
  matching SHA-256
  `3bf6b47f38ed1064221ab49dcfbc8b4b4de916ca3a19352652a191a445fc3ae1`
  and loaded under the immutable `schema-guard-managed:dd60b4e-amd64`
  tag. Its remote image ID, platform, and user match the local image. Zero
  running containers use it.
- The current production Compose file predates the monitoring-only bearer
  required by the new public-mode image. A versioned `dd60b4e` Compose
  candidate and a rollback copy of the deployment environment were staged.
  A fresh monitoring credential was generated directly into a root-owned,
  mode-0600 host file; only its file path was added to the deployment
  environment. The complete managed, PostgreSQL, and edge overlay renders
  successfully under the root operator context with the exact candidate tag.
  No container was recreated.
- The previous DreamHost image has an immutable rollback tag.
- DreamHost can reach the independently hosted anchor readiness endpoint using
  the pinned private CA.
- DreamHost's daily encrypted main-backup job most recently exited successfully
  and recorded an off-machine transfer. Its inbound anchor-backup ingest and
  retention jobs also exited successfully, and the root-owned archive contains
  recent owner-read-only encrypted anchor bundles. This proves recent encrypted
  bidirectional transfer, not a clean-host restore.
- The DreamHost cross-domain readiness, container-health, TLS-expiry, and
  backup-freshness monitor most recently exited successfully and recorded a
  healthy state. External paging delivery and escalation have not been
  deliberately triggered or acknowledged.
- The authenticated DigitalOcean provider console confirms Droplet
  `akriven-anchor-prod-01` is Active at `147.182.213.242`, in NYC1, on Ubuntu
  24.04 x64, with the expected `akriven`, `production`, and `audit-anchor`
  tags. No DigitalOcean Cloud Firewall is assigned and provider automated
  backups are not enabled.
- The DigitalOcean ED25519 fingerprint observed over the network agrees with
  the existing local known-hosts entry. Its authoritative value has not yet
  been confirmed from the Droplet itself through the provider Web Console. The
  control panel exposes the correct console launch flow, but its terminal opens
  in a popup that the controlled in-app browser cannot claim. No further
  DigitalOcean SSH operation is permitted until the non-secret
  `/etc/ssh/ssh_host_ed25519_key.pub` fingerprint is read through that
  control-plane terminal and matched. The exact `dd60b4e` anchor candidate has
  not been transferred or deployed.

The Compose profiles now accept explicit reviewed managed and anchor image
identities. The operator runbook requires immutable selections, a preserved
rollback tag, complete overlay rendering, and host deployment with
`--no-build`. These are deployment controls, not evidence that the new release
is running.

## Remaining launch blockers

### Before first design-partner action traffic

1. Verify the DigitalOcean host fingerprint in the provider console before any
   further SSH operation.
2. Deploy the exact committed source privately to the verified DreamHost main
   host and DigitalOcean anchor host, then repeat TLS, migration, rollback,
   anchor-outage, redrive, reconciliation, restart, and checkpoint-comparison
   drills.
3. Configure immutable encrypted off-machine backups and restore them on a
   clean host; compare audit and anchor checkpoints before resuming action
   traffic.
4. Configure independent uptime, backup-heartbeat, and paging delivery and
   observe acknowledgement/escalation.
5. Exercise a customer-owned HTTPS webhook receiver and downstream side-effect
   ledger through acknowledgement, completion, timeout, duplicate, ambiguous,
   and reconciliation paths.
6. Pin and live-test the exact OpenAI, Anthropic, and Gemini versions intended
   for the cohort, including timeout, malformed output, and drift behavior.
7. Complete an independent security review, ASVS requirement record, incident
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
plane, operator dashboard, API/SDK/CLI surface, hardened container topology, and
provider-independent operational program. What is not proven is a public SaaS
business, a customer-production SLO, live identity/email/billing/model-provider
integration, exact-source operation on the two purchased hosts, or customer
demand.
