# Production blueprint audit — 2026-07-22 (updated 2026-07-24)

This is the living requirements-to-evidence matrix for the Akriven / Managed
Tool-Call Schema Guard release candidate at commit `c473da8` plus the working
tree changes produced by this audit. A passing local test is not treated as
proof of a deployed integration, operated service, customer outcome, or market
demand.

Status vocabulary:

- **proven** — deterministically exercised at the stated boundary in this audit;
- **partially proven** — important behavior was exercised, but the full launch
  boundary or failure domain was not;
- **configured only** — configuration/code exists but no real target was used;
- **documented only** — a procedure or claim exists without executed evidence;
- **missing** — required behavior is not implemented;
- **blocked** — completion needs an external target, credentialed sandbox,
  provider decision, or owner-controlled console action.

## Baseline evidence

| Evidence                                   | Exact command                                                                                                                                                               | Result observed on 2026-07-22                                                                                                                                                                                                                                            | Boundary                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Dependency install without lifecycle hooks | `npm ci --ignore-scripts`                                                                                                                                                   | 307 packages in 4.68 s; managed tests cannot load the intentionally absent `better-sqlite3` native binding                                                                                                                                                               | Supply-chain diagnostic only                                               |
| Reproducible normal install                | `npm ci`                                                                                                                                                                    | 307 packages in 7.02 s                                                                                                                                                                                                                                                   | Local lockfile/install lifecycle                                           |
| Declared repository gate                   | repository sub-gates plus `npm test` and `npm run test:python`                                                                                                              | Passed: formatting, build, lint, syntax, package contents, typecheck, conformance, 191 TS tests and 4 Python tests; 16 PostgreSQL tests skipped without a credentialed database                                                                                          | Local, SQLite and in-memory/shared contracts                               |
| PostgreSQL suite and coverage              | credentialed `npm run test:coverage` against fresh PostgreSQL 16                                                                                                            | Current r7: 207/207 in 9.48 s; lines 81.24%, statements 79.40%, branches 73.46%, functions 80.29%; disposable tmpfs-backed database removed                                                                                                                              | Ephemeral loopback PostgreSQL, not deployed failover                       |
| Severe local gate                          | `npm run audit:extreme`                                                                                                                                                     | Current r7 passed in 27.176 s; 2,000 requests, concurrency 32, 949.03 req/s, p50 31.15 ms, p95 36.48 ms, p99 178.40 ms, zero errors; recovery/security/evidence gates passed                                                                                             | Local process/SQLite boundary; not a production SLO                        |
| Framework runtimes                         | `SCHEMA_GUARD_INTEGRATION_PYTHON=/opt/homebrew/bin/python3.13 npm run audit:framework-integrations`                                                                         | Passed; MCP 1.29.0, OpenAI Agents 0.13.5, PydanticAI 2.13.0, Google ADK 2.5.0; repaired `2` executed and rejected calls executed zero tools; no model API                                                                                                                | Real framework packages, no providers                                      |
| Production-image lifecycle                 | `npm run audit:container-e2e`                                                                                                                                               | Current r7 passed in 12.970 s; actual managed, persistent PostgreSQL, TLS proxy and anchor containers; file-key bootstrap, lifecycle, disabled billing, dashboard guards, export/deletion, outage/recovery and privacy exercised                                         | One Docker host and one bridge network, not separate machines              |
| Exact-r7 guarded staging rollout           | alert-bearing export regression; exact amd64 transfer; dual-overlay Compose rollout; prior clean r6→r5 compatibility drill                                                  | Exact scanned digest healthy with zero restarts; control migrations `1,2`, billing migration `1`; corrected public program 64/64; browser 29/29 presets and 14/14 panels; r6/r5 rollback tags retained                                                                   | Real DreamHost/PostgreSQL/public TLS boundary; Stripe remains unconfigured |
| Independent anchor staging                 | authenticated host audit, exact-image transfer, signed HTTP lifecycle, container/host restart, encrypted backup and clean-volume restore drill                              | DigitalOcean NYC1 Ubuntu 24.04 host hardened; exact amd64 image ID matched; signed store/duplicate/read passed; host RTO 41 s; backup downtime 15 s; restore RTO 22 s                                                                                                    | Separate real host and administrative boundary                             |
| Separate-host managed-to-anchor path       | real DreamHost managed/PostgreSQL deployment to DigitalOcean receiver over restricted public TLS                                                                            | Repair/reject, approval, exact-revision acknowledgement, duplicate block, anchor outage fail-closed, dead-letter/redrive and 9 s recovery exercised                                                                                                                      | Real network/failure domains; temporary staging hostname, not public edge  |
| Managed/PostgreSQL backup and restore      | scheduled encrypted cross-host backups plus clean-project restore of PostgreSQL, managed state and checkpoint                                                               | Recovery recipient rotated and retained owner-only; fresh decrypt/manifests pass; 34 PG tables/4 receipts, SQLite v15/26 tables/4 receipts, exact checkpoint and integrity                                                                                               | Daily scheduled RPO; no WAL/PITR; older-recipient archives are unproven    |
| Image scan                                 | `npm run audit:images`                                                                                                                                                      | Current Trivy database: zero HIGH/CRITICAL findings and zero embedded secrets in managed, anchor and hardened PostgreSQL images                                                                                                                                          | Built local images                                                         |
| Hardened edge image                        | pinned `deploy/Dockerfile.caddy-edge` build, restricted `docker run ... validate`, and Trivy image scan                                                                     | Caddy v2.11.4 built with Go 1.26.5 into scratch; UID/GID 65532, read-only, all caps dropped, no-new-privileges; both configs valid; zero HIGH/CRITICAL and secrets                                                                                                       | Built local image; no public ports or certificates                         |
| Managed hostname preflight                 | read-only authoritative DNS, address, CAA and HTTPS checks for `akriven.com`, `www` and `api`                                                                               | GoDaddy nameservers; apex/`www` occupied on GoDaddy infrastructure; apex HTTPS invalid; `api.akriven.com` unused; no DNS mutation                                                                                                                                        | Public DNS observation only                                                |
| Public managed API edge                    | GoDaddy A record, hardened Caddy edge, managed/PostgreSQL stack                                                                                                             | `api.akriven.com` authoritative/public resolution; trusted TLS; redirect/headers/CORS/limits/auth; public validation and integrity checks                                                                                                                                | Real public network boundary; no customer traffic or external paging       |
| Public managed workflow                    | `npm run audit:public-managed` with an owner-only key file and exact disposable audit tenant                                                                                | First exact-r7 run caught exported `source_key_hash`; corrected exact-r7 rerun passed 64 requests in 21.593 s, including alert-bearing privacy-safe export, registry/release/admission, all decisions, key lifecycle, policy, ruleset, action/anchor, integrity and lock | Real TLS/proxy/PostgreSQL/anchor boundary; no downstream tool execution    |
| Exact-r5 separate-host outage              | `npm run audit:public-anchor-outage` with explicit `r5-3f514af8`, owner-only key and exact anchor edge container                                                            | Passed in 15.991 s: public admission returned `checkpoint_anchor_unacknowledged`; independent edge recovered in 4.185 s; reservation remained duplicate-blocked and integrity verified                                                                                   | Real DreamHost-to-DigitalOcean failure boundary                            |
| Exact-r7 in-app-browser workflow           | Browser dashboard at `https://api.akriven.com/dashboard` with a disposable audit tenant                                                                                     | All 29/29 presets executed and 14/14 panels loaded; real dead-letter/redrive, guarded anchor/reconciliation conflicts, billing fail-closed, locked export, and dual-store exact-hash deletion passed                                                                     | Real browser/TLS/dashboard/API boundary; no downstream tool execution      |
| Image SBOMs                                | `trivy image --format cyclonedx --output audit-results/<image>.cdx.json <exact-local-image>` and `trivy sbom --scanners vuln --severity HIGH,CRITICAL --exit-code 1 <sbom>` | CycloneDX SBOMs retained for the managed, anchor and edge images; all report zero HIGH/CRITICAL vulnerabilities                                                                                                                                                          | Local image contents; no registry provenance attestation                   |
| Filesystem scan                            | `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 0 --format json .`                                                                          | Zero HIGH/CRITICAL dependency findings, secrets, or misconfigurations in reported targets                                                                                                                                                                                | Local checkout scan                                                        |
| Dependency audit                           | `npm audit --audit-level=moderate`                                                                                                                                          | Zero known npm vulnerabilities                                                                                                                                                                                                                                           | Current lockfile; future advisories still require routine review           |
| Core benchmark                             | included by `audit:extreme`                                                                                                                                                 | 10,000 iterations under concurrent desktop load: p50 27.750 µs, p95 33.334 µs, p99 93.709 µs                                                                                                                                                                             | Local CPU microbenchmark; not a production SLO                             |
| Managed load                               | included by `audit:extreme`                                                                                                                                                 | Current r7: 2,000/2,000 HTTP 200, 949.03 req/s, p50 31.15 ms, p95 36.48 ms, p99 178.40 ms; exact metering and audit chain                                                                                                                                                | Single local managed process and SQLite; not a production SLO              |
| SQLite recovery                            | included by `audit:extreme`                                                                                                                                                 | Online backup reopened, critical counts matched, integrity/chains verified                                                                                                                                                                                               | Self-contained SQLite only; no destructive PostgreSQL restore              |
| BFCL static-data replay                    | `npm run audit:real-data`                                                                                                                                                   | 3,302 calls, 3,266 conforming, 36 visible source conflicts; 15,702/15,702 mutations; six families pass                                                                                                                                                                   | Public benchmark data; no downloaded code executed                         |
| Five-benchmark static replay               | `npm run audit:benchmarks`                                                                                                                                                  | 7,699 calls, 7,575 conforming, 124 visible source conflicts; 30,203/30,203 mutations                                                                                                                                                                                     | Public benchmark data; no downloaded code executed                         |
| Native framework fixtures                  | `npm run audit:five-repos`                                                                                                                                                  | 5 repos, 9 fixtures, 20 source calls, 35 derived calls, zero failures                                                                                                                                                                                                    | Commit-pinned static source reads only                                     |
| Broad repository signals                   | `npm run audit:real-repos` and `npm run audit:real-repos:update`                                                                                                            | 20/20 repositories cloned/read, 106 value-free fixtures refreshed                                                                                                                                                                                                        | Heuristic static corpus, not runtime proof                                 |

The first `audit:real-data` attempt failed because the privacy allowlist had not
been updated for new value-free receipt and validated-argument hashes. The gate
now compares those fields deterministically and passes. The first container E2E
attempt failed because Caddy was not ready when the harness made a one-shot
request; the harness now waits with a bounded retry and the full lifecycle
passes. The first severe-gate attempt failed on the patched `fast-uri` advisory
and also revealed that its failure report retained a temporary one-time API key.
Both defects are fixed and retained evidence now redacts API keys and bearer
credentials. A first direct-edge overlay used the then-pinned official Caddy
2.10.2 image. Revalidation with the current vulnerability database found
HIGH/CRITICAL findings, and `no-new-privileges` also prevented the upstream
file-capability binary from starting. The accepted edge image instead builds
version-identifiable Caddy 2.11.4 with patched Go 1.26.5 into a non-root scratch
runtime; the restricted runtime, configuration, image, SBOM and checkout scans
now pass. The superseded image was not deployed.

The first exact-r2 separate-host lifecycle deletion exposed a cross-store defect:
the public shared-mode endpoint moved PostgreSQL to `deletion_pending` but left
the local SQLite projection active, so the offline deletion operator correctly
refused execution. The endpoint now updates the local projection before the
shared transaction and rolls it back if the shared update fails. Focused tests,
the credentialed PostgreSQL suite, production-container inspection, the
exact-r7 64-request public run, and the in-app browser flow all prove both
projections are `deletion_pending` before exact-export-hash deletion. The
deployed r7 image is
`sha256:516b0869f9bb507641ddd5ae602a02b43fc620375f5134409776fe374970239d`.
It retains the lifecycle correction, the 14-panel/29-preset operator
workbench, explicit mutation confirmation, unresolved path/body placeholder
rejection, file-only bootstrap credentials, sandbox billing boundary, and the
alert-bearing export privacy correction.

## Production-like staging evidence

The owner-confirmed DigitalOcean checkpoint host was authenticated against the
expected SSH identity and its provider metadata matched the dashboard name,
region and Ubuntu 24.04 image. A non-root `akriven` administrator was proven
before SSH hardening. Password login, X11, agent forwarding and TCP forwarding
are disabled; root remains key-only fallback. UFW defaults to deny inbound with
only SSH allowed. All pending packages were applied, the host rebooted onto
kernel `6.8.0-136-generic`, and a persistent 1 GiB low-swappiness file was added
for the 1 GiB host.

Docker Engine/CLI 29.6.2, Compose 5.3.1, Buildx 0.35.0 and containerd 2.2.6 were
installed from Docker's signed repository after verifying signing-key
fingerprint `9DC858229FC7DD38854AE2D88D81803C0EBFCD88`. The administrator is not in the
root-equivalent Docker group. Bounded local logs, live restore and default
`no-new-privileges` are enabled.

The locally built and current-Trivy-scanned `linux/amd64` anchor image was
transferred without a registry. Its local and remote image ID was
`sha256:385d4b96f43f2d5ec767da1d779e95c219fafa4741c9d8b6c7567a0756e827c3`.
The deployed receiver is UID/GID 65532, read-only, capability-free, PID- and
memory-limited, healthy at 15–77 MiB observed RAM, and bound only to loopback.
It stored a value-free signed staging checkpoint, recognized its exact duplicate,
rejected an unauthenticated read, returned revision 1 to an authenticated read,
and retained it across container and host restarts. Host-reboot service RTO was
41 seconds.

A consistent encrypted backup was streamed off-host with 15 seconds of service
downtime. Decryption into a clean Docker volume and a separate restricted
receiver returned the same revision with 22-second restore RTO; the temporary
restore container and volume were then removed. Subsequent work installed and
manually proved scheduled encrypted cross-host backup, ingest and retention
timers. A later anchor backup drill measured 7 seconds of downtime. Retained
anchor backups contain only value-free staging data and are encrypted outside
the repository.

The DreamHost target and provider-confirmed `debian` user were recovered using
the provider-generated key retained on the owner's machine. A new dedicated,
passphrase-protected Ed25519 identity was installed and proven, the exposed
legacy identity was revoked, and its temporary extracted copy was deleted.
Debian 13 was fully patched and rebooted onto kernel
`6.12.96+deb13-cloud-amd64`; SSH is public-key-only with root login disabled,
and UFW exposes only 22, 80 and 443. LLMNR/mDNS were disabled. Docker uses
bounded local logs, live restore, default `no-new-privileges`, and no userland
proxy. Reboot-to-SSH RTO was 20 seconds.

The exact scanned managed and hardened PostgreSQL images were transferred to
DreamHost without a registry. Managed and PostgreSQL run non-root with read-only
roots, file-mounted secrets, loopback-only managed HTTP, and PostgreSQL TLS with
`verify-full`. The hardened PostgreSQL derivative removes unused vulnerable
`gosu` and the default snake-oil key; its current image and SBOM scans report
zero HIGH/CRITICAL vulnerabilities and zero embedded secrets.

DigitalOcean and DreamHost also have an authenticated WireGuard tunnel for
administration. The application path deliberately does not use a private URL:
the managed SSRF guard rejects private destinations. Instead, the receiver is
available through public HTTPS at a staging-only DNS name, with DigitalOcean
UFW restricting TCP 443 to the DreamHost public address. An unapproved source
cannot reach it. The receiver remains loopback-only behind a non-root,
read-only Caddy edge.

Real API requests through the managed service proved `valid_with_repair` for an
unambiguous repair, rejection of ambiguous input, metering, audit verification,
high-risk approval, independent exact-revision acknowledgement before action
admission, completion and duplicate blocking. Stopping only the anchor edge
made action evaluation fail closed with HTTP 503. Recovery delivered the queued
checkpoint in 9 seconds; dead-letter redrive and reconciliation verification
also succeeded.

A consistent main-host backup was encrypted off-host after 3 seconds of managed
application downtime. Only the PostgreSQL custom dump, managed-data archive,
checkpoint and metadata were decrypted for the drill. They were restored into
a separately named Compose project with fresh volumes and loopback port 18788.
The service became ready in 12.676 seconds, returned an exact JSON match for
checkpoint revision 5, and reported valid audit and control-plane integrity
chains. The isolated project, volumes and remote plaintext staging files were
removed; the active service remained ready with zero restarts. Subsequent
scheduled cross-host backup/ingest/retention runs and a clean restore were
proved; the latest PostgreSQL restore took 1 second. The schedule defines a
daily RPO, but WAL/PITR remains absent.

The later lifecycle deployment audit found that the original Age X25519
recovery identity was not present on either host or in owner-accessible local
files. Those older ciphertexts are retained but are not counted as recoverable
evidence. Both jobs were rotated to a newly generated owner-only recovery
identity stored outside the repository. Fresh main and anchor backups were
created and ingested cross-host; ciphertext hashes, decryption, and both
SHA-256 manifests passed. The clean restore contained SQLite v15 with 26 tables
and four signed deletion receipts, an anchor store with three tables, and
PostgreSQL with 34 public tables, shared-control migration v2, and four signed
receipts. The exact saved action checkpoint matched, the restored managed
service became ready, control integrity was valid, and the staging owner
lifecycle remained active. All plaintext drill material, containers, networks,
and volumes were then removed.

Before the r3 deployment, another encrypted main backup completed and its exact
ciphertext was verified on the DigitalOcean failure domain. The current r7 was
built for `linux/amd64` as UID/GID 65532 and scanned with zero HIGH/CRITICAL
vulnerabilities and zero embedded secrets. The exact deployed image is
`sha256:516b0869f9bb507641ddd5ae602a02b43fc620375f5134409776fe374970239d`.
Its 64-request workflow, 29/29-preset and 14/14-panel in-app-browser workflow,
secure file-only bootstrap, alert-bearing privacy-safe export, and offline
local/shared deletion drill passed. The measured exact-revision separate-host
outage remains exact-r5 evidence. No disposable `audit-*` tenant or temporary
API-key, export, or confirmation file remains; the exact r7 image is healthy
with zero restarts.

The first r4 rollout omitted the PostgreSQL TLS/CA Compose overlay. Readiness
failed closed; the rollback invocation inherited the same omission until r3 was
restored with both Compose files. PostgreSQL, edge, DNS, and anchor were not
restarted. r4 then deployed successfully with the complete overlay and rollback
guard. This is retained as operational evidence that both `compose.yml` and
`compose.postgres.yml` are mandatory for rollout and rollback.

The GoDaddy-registered `akriven.com` zone was initially inspected without
mutation. The existing apex and `www` names remain on GoDaddy infrastructure.
After explicit owner approval, `api.akriven.com` was created as an A record to
the DreamHost address with TTL 600 seconds; both authoritative nameservers and
Google/Cloudflare public resolvers returned the exact address. The revised direct-host edge image
initializes `/data` and `/config` as UID/GID 65532 without the superseded helper
image. Exact image ID
`sha256:42dba3f08185eba89ca1797eead696a21ce92841c0af4d9de7f18d4e18a1c0cf`
validated for `linux/amd64`; restricted runtime/configuration checks passed and
the current Trivy image/SBOM scans found zero HIGH/CRITICAL vulnerabilities and
zero embedded secrets.

The edge is active at `https://api.akriven.com` with a publicly trusted
Let’s Encrypt certificate valid through 2026-10-20. External tests proved the
HTTP redirect, HTTP/2 readiness, HSTS and reviewed headers, HTTP 401 without an
API key, HTTP 413 for an authenticated 1.1 MB body, and a real authenticated
`valid_with_repair` response with an audit ID. Hostile-origin simple and
preflight requests received no CORS allow-origin permission. Only 22/80/443 were
open externally; ports 5432, 8788, 8790, 9000 and 9443 were closed. The exact
edge ran as UID/GID 65532 with a read-only root, all capabilities dropped and
zero restarts. Recent managed logs contained no authorization header,
`raw_arguments` field or bearer-token pattern. Public audit and control-plane
integrity were valid and checkpoint revision 5 was unchanged.

The provider-installed Caddy configuration was also found to reverse-proxy the
Portainer management UI from the public server IP on ports 80/443. External
HTTP/HTTPS probes confirmed the listener. Because no product DNS record used
the server and Portainer itself has no published host port, the vendor Caddy
restart policy was changed from `always` to `no` and only that proxy container
was stopped. External ports 80/443 then tested closed while SSH remained open;
the managed service stayed ready with zero data or container deletion. The
reviewed product edge will own those ports only after the DNS cutover is
explicitly approved.

## Requirements-to-evidence matrix

| Requirement                                                                                             | Implementation                                                             | Deterministic tests                                                                                        | Production-like evidence                                                                                                                              | Status                                                   | Launch disposition                                                                  |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `valid`, `valid_with_repair`, `rejected` checkpoint semantics                                           | `packages/core/src/engine.ts`, protocol schemas                            | core, protocol, conformance, property tests                                                                | Production-image exact, repair and rejection requests                                                                                                 | proven                                                   | Suitable for first cohort                                                           |
| Raw JSON/schema safety, duplicate keys, Unicode, depth/size, hostile runtime values                     | `strict-json.ts`, `limits.ts`, compiler/engine preflight                   | core/property/adversarial tests                                                                            | HTTP body limits and ambiguous numeric rejection in image E2E                                                                                         | proven locally; partially proven at hostile edge         | Add edge/WAF tests before public beta                                               |
| Allowlisted unambiguous repair, reject on uncertainty, receipts/reasons/hints/repaired fields/audit IDs | `repair.ts`, `engine.ts`, `audit.ts`, decision protocol                    | core/property/protocol/conformance                                                                         | Image E2E plus framework executor proof                                                                                                               | proven                                                   | Suitable for first cohort                                                           |
| Cross-provider/framework normalization and parity                                                       | adapters, compiler, TS/Python integrations                                 | adapter/conformance/runtime suites                                                                         | Real framework packages; no model calls                                                                                                               | partially proven                                         | Live pinned provider probes required before public claims                           |
| Policy narrowing and closed-schema controls                                                             | core policy and managed organization/environment policy                    | policy, managed and shared-control tests                                                                   | Image E2E policy denial                                                                                                                               | proven                                                   | Suitable for first cohort                                                           |
| Action classification, approvals, idempotency and fail-closed execution                                 | core action gate, managed/shared action state, SDK                         | action, SDK, reconciliation and race tests                                                                 | Separate-host irreversible approval, anchor acknowledgement, duplicate block, outage and recovery                                                     | proven at staging network boundary                       | Real downstream action ledger remains required                                      |
| Uncertain reservation reconciliation                                                                    | managed/shared state and routes                                            | SQLite/shared/PostgreSQL reconciliation tests                                                              | Routes exercised; no real downstream ledger                                                                                                           | partially proven                                         | Operator/downstream drill required before mutating customer actions                 |
| Schema registry, drift, promotion and runtime admission                                                 | managed store/shared schema                                                | drift, release and PostgreSQL concurrency tests                                                            | Image E2E promotion, enforce, mismatch rejection                                                                                                      | proven on one host                                       | Suitable for controlled cohort                                                      |
| Audit chains, signatures, tamper/deletion detection and purge anchors                                   | managed/shared stores and crypto                                           | tamper, retention, PostgreSQL deletion tests                                                               | Separate-host verification and clean restore retain valid audit/control chains                                                                        | partially proven                                         | External retention/legal-policy operation remains required                          |
| Privacy-thresholded compatibility/network intelligence                                                  | managed/shared intelligence                                                | threshold, isolation and integrity tests                                                                   | Conformance ingestion/intelligence route in image E2E                                                                                                 | partially proven                                         | No operated cross-tenant corpus or privacy review                                   |
| Managed API and browser daily workflow                                                                  | `packages/managed/src/server.ts`, `packages/managed/src/dashboard.ts`      | extensive HTTP tests plus embedded-script compilation/assertions                                           | Exact-r7 64-request public program; every 29/29 guarded preset and 14/14 read panels exercised at the real browser/TLS boundary                       | proven on protected operator API-key model               | Suitable for operator-led private cohort; not human self-service                    |
| CLI and TypeScript SDK                                                                                  | CLI/core/SDK packages                                                      | packaging, CLI and SDK suites                                                                              | Lifecycle/export/deletion plus existing workflows exercised in production-container E2E                                                               | proven from source/build artifact                        | Consumer-install and published-artifact decision required                           |
| Python SDK/client                                                                                       | `python/schema_guard`                                                      | four client tests plus framework integration                                                               | Python framework packages call canonical engine; lifecycle/export/deletion client contract tested                                                     | partially proven                                         | Clean wheel/install and deployed-network run remain                                 |
| Tenant bootstrap and API-key scopes/rotation/revocation                                                 | offline-guarded bootstrap, managed/shared control                          | auth/isolation/revocation/tamper/concurrency tests                                                         | Exact-r5 public bootstrap used direct mode-0600 output with no key on stdout; file-input container bootstrap and issue/revoke public E2E passed       | proven for operator-led API keys                         | Online self-serve provisioning, human identity and recovery remain absent           |
| Human identity, org membership, invitations, sessions, MFA, recovery                                    | none                                                                       | none                                                                                                       | none                                                                                                                                                  | missing                                                  | Must-fix for self-serve/public; not required for operator-led private cohort        |
| Tenant suspension/cancellation and complete deletion lifecycle                                          | HMAC-bound local/shared lifecycle, API gate, operator CLI and receipts     | migration, tamper, tenant, shared PG, SDK/CLI tests                                                        | Exact-r7 browser request/export/locked-state and dual-store exact-hash deletion with local/shared receipts; tenant and temporary key material removed | proven for operator-led workflow                         | Legal retention policy and real paid-tenant drill remain external                   |
| Quotas, rate limits, metering, plan enforcement and statements                                          | managed/shared control                                                     | quota/rate/tenant tests                                                                                    | Image E2E usage and statement                                                                                                                         | proven for internal entitlement                          | Payment settlement remains absent                                                   |
| Checkout, signed billing webhooks, failed payment, cancellation and entitlement reconciliation          | sandbox-only Stripe provider, PostgreSQL billing state, SDK/CLI/dashboard  | signed raw-body, replay, reordering, crash-window, replacement, tenant-binding and PostgreSQL tamper tests | Disabled-boundary container checks only; no Stripe account/network/Checkout/Portal/test-clock execution                                               | implemented and locally proven; external sandbox blocked | Must-fix external sandbox program before automated charging; manual invoicing only  |
| Durable alert webhooks, retry/dead-letter/redrive                                                       | managed/shared alerts/webhook transport                                    | SSRF/signature/retry/shared tests                                                                          | Exact-r7 public browser created a webhook, triggered a dead delivery and successfully redrove it; no owned external receiver                          | partially proven                                         | Real receiver and external dead-letter monitor required                             |
| Independent exact-revision checkpoint anchor                                                            | standalone receiver and outbox                                             | receiver/shared/outage tests                                                                               | DreamHost-to-DigitalOcean restricted TLS delivery, exact acknowledgement, outage, redrive and recovery                                                | proven in separate-host staging                          | Replace staging hostname/cert and add external paging before customer traffic       |
| Data export, retention and purge                                                                        | full tenant export, audit JSON/CSV, purge, offline deletion and receipt    | tenant scope, tamper, alert-bearing shared PG, SDK/CLI tests                                               | Exact-r7 public audit first caught `source_key_hash`; corrected alert-bearing export, locked browser export and disposable local/shared deletion pass | proven for implemented data stores                       | Approve legal retention window; independent value-free anchor remains retained      |
| Website, signup, onboarding, account recovery, support                                                  | public Sites project and complete 16-route website                         | local lint/build, render tests and full in-app-browser traversal                                           | Version 14 from commit `fdaef4a` serves all 16 reviewed routes; real trust-link clicks pass; no hosted identity, email, recovery or support backend   | partially proven                                         | Informational/trust site proven; public/self-serve account flows remain blocked     |
| Hardened managed/anchor images                                                                          | multi-stage pinned distroless images plus hardened PostgreSQL derivative   | CI smoke definitions                                                                                       | Exact managed, anchor, edge and PostgreSQL amd64 images deployed/scanned; both hosts hardened                                                         | proven in staging                                        | Add registry provenance/signing and routine scan operation                          |
| TLS, DNS, firewall, proxy limits and certificate renewal                                                | hardened pinned edge image/overlays and E2E Caddy                          | config validation, restricted runtime, E2E headers                                                         | Real `api.akriven.com` TLS, headers, CORS, 1 MB limit, port scan and certificate issuance                                                             | proven at public edge                                    | Renewal alert delivery and an observed renewal remain unproven                      |
| PostgreSQL migrations and concurrency                                                                   | checksummed app-driven migrations/shared state                             | full credentialed suite                                                                                    | fresh DB/restarts; live v2 migration; pre-lifecycle image correctly failed on newer history                                                           | partially proven                                         | Separate migration role and schema-compatible rollback image remain missing         |
| Encrypted off-machine backup, PITR, RPO/RTO                                                             | scheduled cross-host encrypted backup/ingest/retention and restore tooling | self-contained and host drills                                                                             | both schedules/manually triggered runs, clean restores and exact checkpoint/chain comparison; owner accepted daily RPO and attested escrow complete   | partially proven                                         | Clean-machine escrow retrieval remains; add WAL/PITR before promising a tighter RPO |
| Monitoring, metrics, SLOs, alert delivery and incident drill                                            | health/readiness/logs/outbox visibility and host monitor timers            | health/readiness tests                                                                                     | both host timers active; loopback failure/recovery delivery proved                                                                                    | partially proven                                         | Owned external paging, metrics/dashboard and observed ongoing delivery required     |
| SBOM, provenance, license review and release artifacts                                                  | pinned lock/images/actions; retained CycloneDX image SBOMs                 | package checks/CI definitions                                                                              | Trivy image and SBOM vulnerability scans                                                                                                              | partially proven                                         | Add license review, registry provenance/signing and release workflow                |
| Live provider-version fleet                                                                             | credential-aware fail-closed probe script/workflow                         | dry-run and probe parser tests                                                                             | no live credentials used                                                                                                                              | configured only                                          | Credentialed sandbox runs and scheduled alert review required                       |
| Real customer/market evidence                                                                           | benchmark proxies and product-value hypotheses                             | benchmark gates                                                                                            | none                                                                                                                                                  | missing                                                  | Design partners, usage, willingness-to-pay and retention evidence required          |

## Current priority classification

### Must-fix before any customer data or mutating customer action

1. Configure an owned alert receiver plus an independent monitor for readiness,
   pending-age and dead-letter growth; exercise delivery and failure.
2. Add independent expiry/uptime paging for the managed hostname and observe a
   successful automatic certificate renewal. The public edge is proven, but its
   renewal and external alert delivery are not.
3. Approve a legal retention schedule, including the value-free independent
   anchor boundary, and repeat a clean restore and disposable deletion drill on
   the exact deployed revision. The implemented operator workflow must remain
   service-offline during irreversible deletion.
4. Prove retrieval of the owner-attested escrow copy on a clean machine. The
   daily-backup RPO is accepted for the first cohort; add monitored WAL
   archiving/PITR before promising a tighter RPO.

### Must-fix before automated charging or public self-service

1. Hosted human identity, organization membership/RBAC, secure sessions,
   verified email, invitations, recovery and MFA policy.
2. Run the implemented sandbox-only Checkout, Customer Portal, signed webhook,
   failed-payment, cancellation, replacement-subscription and reconciliation
   paths against a real Stripe test account and browser. Local raw-body,
   duplicate, reordering, crash-window, tenant-binding and PostgreSQL integrity
   tests pass; Stripe network and settlement remain unproven. See
   [`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md).
3. Hosted onboarding/account recovery and operated support/legal approval. The
   informational privacy, terms, support, and security surfaces are public.
4. Metrics/SLO dashboards, paging ownership, status communication, security
   review, registry provenance/signing and vulnerability-response process.

### Should-fix before public beta

1. Remove application-driven production migrations in favor of a separately
   authorized migration job and prove forward/rollback compatibility.
2. Increase Python client/package coverage and perform clean consumer installs
   for every artifact intended for distribution.
3. Run protected live provider probes with explicitly pinned model versions and
   retain reviewed output.
4. Run sustained external load/soak tests and set SLOs from deployed resource
   measurements rather than local thresholds.

## Current verdict

**NO-GO for public production.** Local deterministic and one-host
production-image evidence support proceeding to **internal staging**. A tightly
controlled, operator-onboarded private cohort may be considered only after the
separate-host staging, backup/restore, alert, edge and operational gates above
are proven. Automated billing and self-service must remain disabled until the
external Stripe sandbox and hosted-identity programs pass.
