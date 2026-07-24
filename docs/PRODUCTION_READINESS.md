# Production readiness

This repository now contains a production-shaped managed service profile and an
internal-staging deployment, not a claim that a customer-production SaaS is
ready. Public mode is deliberately
fail-closed: the service refuses to start unless the deployment supplies a
64-character-or-longer master secret, an HTTPS external URL, an explicit trusted
TLS proxy setting, bounded request timeout, bounded per-key rate limit, and an
independent checkpoint-anchor URL/signing-secret pair.

## What is ready to run

- Deterministic offline enforcement engine.
- Canonical provider contract compilation with explicit unsupported/unverified
  states, integrity-checked local replay, and proof-carrying repair receipts.
- SDK action gating with argument-bound approvals, fail-closed completion
  semantics, and both development-only in-memory and durable managed SQLite
  idempotency implementations.
- Compiled managed server entrypoint.
- Container image for the managed service.
- Hardened Docker Compose profile with loopback bind, read-only filesystem,
  dropped Linux capabilities, no-new-privileges, memory/PID limits, healthcheck,
  and persistent data volume.
- CI container build/smoke job with the fixed non-root UID, read-only root
  filesystem, writable data tmpfs, database-aware readiness, HSTS, and health
  checks.
- Local tenant bootstrap flow with one-time API-key display.
- Public/shared tenant bootstrap is explicitly offline-only:
  `--service-state stopped` is required, followed by a managed-service restart
  and readiness check. Public/shared bootstrap forbids API keys in process
  arguments and requires an existing protected key file or a new mode-0600
  output file; stdout never contains the key. The staging drill measured 3
  seconds. Online self-serve provisioning remains blocked on a hosted
  identity/organization control plane.
- HMAC-bound tenant lifecycle state with fail-closed suspension, cancellation
  and deletion-pending gates; complete tenant export; exact-confirmation
  deletion requests; and an offline operator-only deletion workflow that
  verifies current export hashes and retains a pseudonymous signed receipt.
- Optional PostgreSQL tenant/API-key authority with HMAC-bound policy, plan, and
  current-month counters; authentication, revocation, and quota checks fail
  closed and are consistent across independent service instances.
- Atomic shared per-key fixed windows bound into API-key integrity state, with
  cross-instance allowance and reset tests.
- Transactionally coupled shared quota and value-free audit append, with strict
  envelope allowlisting, HMAC chain/manifest verification, deletion detection,
  anchored retention, cross-instance list/CSV/verify routes, and no quota-only
  bypass API.
- Optional PostgreSQL environment/schema authority with HMAC-bound policies and
  schema rows, serialized idempotent registration, reviewed breaking promotion,
  authenticated release/source chains, repeatable-read admission, automatic
  existing-tenant bootstrap, and cross-instance HTTP coverage.
- Public-mode config validation.
- Master-secret-bound tenant/API-key/environment/action/approval/idempotency and
  webhook controls, plus immutable queued-payload bindings, with fail-closed use,
  deep startup and tenant verification, bounded configuration readiness, and
  migration-only trust backfill.
- Self-contained restore-integrity and managed HTTP load/correctness gates.
- Aged, least-privilege uncertain-action reconciliation with authenticated
  evidence history.
- Deletion-evident tenant idempotency manifests with live out-of-band-change
  detection and value-free monotonic checkpoints suitable for external
  retention.
- A dedicated transactional checkpoint-anchor outbox that automatically queues
  every manifest revision, signs value-free HTTPS delivery, bounds retry, exposes
  dead letters/redrive, and fails readiness on missing or dead current coverage.
- Acknowledgement-gated managed HTTP action admission: a reservation is not
  returned as `allowed` until the independently configured receiver accepts its
  exact checkpoint; failure remains reserved and returns `503`.
- A separately runnable anchor receiver with exact-body HMAC verification,
  timestamp freshness, strict value-free envelopes, monotonic advance,
  rollback/fork/event-conflict rejection, authenticated retrieval, chained
  history, integrity-aware readiness, a non-root container target, and a
  separate deployment profile.
- Tenant-scoped generic HTTPS alert webhooks with encrypted endpoint material,
  signed value-free payloads, transactional outbox, bounded retry, and dead
  letters.
- Optional PostgreSQL alert/webhook authority with authenticated alert-chain and
  webhook-count manifests, expected-delivery deletion detection, encrypted
  credentials, HMAC-bound lease state, `SKIP LOCKED` claims, cross-instance
  routes/workers, and source-transaction coupling for validation and schema
  alerts.
- Optional sandbox-only Stripe billing authority with Checkout and Customer
  Portal sessions, exact raw-body signature verification, provider-current
  subscription/invoice reconciliation, HMAC-bound PostgreSQL replay state,
  fail-closed entitlement crash-window handling, tenant export/deletion, and
  TypeScript SDK/CLI/dashboard entry points. Live keys are rejected. This code
  has deterministic and real-PostgreSQL evidence but no Stripe account,
  network, Checkout, Portal, test-clock, tax, refund, or settlement evidence;
  see [`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md).
- Reviewable, integrity-checked schema promotion and optional fail-closed
  environment admission. Existing environments migrate safely in `observe`
  mode and require an explicit privileged switch to `enforce`.
- End-to-end audit command: `npm run audit:extreme`.
- Non-skippable release-candidate certification command:
  `npm run audit:release-candidate`. Unlike the local severe gate, it refuses to
  start without PostgreSQL, Docker, and explicit OpenAI, Anthropic, and Gemini
  credentials/model versions; it then requires the shared-state suite, five
  live trials per provider, and both production container builds.

## Required production environment

Set these outside the repo, ideally through the host secret manager:

```bash
SCHEMA_GUARD_EXTERNAL_URL=https://app.invokeguard.example
SCHEMA_GUARD_MASTER_SECRET_FILE=/run/secrets/schema_guard_master
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL=https://independent-anchor.example.com/v1/checkpoints
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET_FILE=/run/secrets/schema_guard_anchor_signing
SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL_FILE=/run/secrets/schema_guard_action_database_url
SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL_FILE=/run/secrets/schema_guard_control_database_url
```

For an explicitly approved Stripe test deployment, add the reviewed
`deploy/docker-compose.stripe-sandbox.yml` overlay and the complete
configuration documented in
[`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md). Do not configure live
keys; startup rejects them.

Docker Compose file-backed secrets preserve the source file's ownership and
mode. For these non-root images, create production secret files as root, set
their owner to UID/GID 65532, set mode `0400`, and keep their parent directory
root-owned at mode `0700`. A root-owned mode-`0600` source is intentionally
unreadable to the container and makes startup fail closed.

The Compose file also sets:

```bash
SCHEMA_GUARD_PUBLIC_MODE=true
SCHEMA_GUARD_INSTANCE_COUNT=1
SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL=postgresql://.../schema_guard?sslmode=verify-full
SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL=postgresql://.../schema_guard?sslmode=verify-full
SCHEMA_GUARD_TRUST_PROXY=true
SCHEMA_GUARD_RATE_LIMIT_PER_MINUTE=600
SCHEMA_GUARD_REQUEST_TIMEOUT_MS=5000
SCHEMA_GUARD_ACTION_RECONCILIATION_MIN_AGE_SECONDS=300
SCHEMA_GUARD_ALERT_WEBHOOK_POLL_INTERVAL_MS=5000
SCHEMA_GUARD_ALERT_WEBHOOK_REQUEST_TIMEOUT_MS=5000
SCHEMA_GUARD_ALERT_WEBHOOK_MAX_ATTEMPTS=8
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_POLL_INTERVAL_MS=5000
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS=3000
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_MAX_ATTEMPTS=8
```

The container listens on loopback only. Put Cloudflare and a reviewed reverse
proxy in front of it for TLS, request logging controls, compression policy, and
public routing.

The repository also includes optional pinned Caddy overlays for a direct-host
edge: `deploy/docker-compose.edge.yml` for the managed service and
`deploy/docker-compose.anchor-edge.yml` for the independent receiver. Each runs
as UID/GID 65532 with a read-only root filesystem, drops all capabilities,
persists only ACME state, caps request bodies at the application limit, and
forwards over the private Compose network. The pinned, scratch-based edge image
builds Caddy 2.11.4 with the patched Go 1.26.5 toolchain; it contains neither a
shell nor Caddy's unnecessary low-port file capability, so
`no-new-privileges` remains enforceable while Caddy listens on internal ports
8080/8443. The image contains pre-owned empty `/data` and `/config` directories,
so new Docker volumes initialize for UID/GID 65532 without a privileged helper
or second runtime image. Validate the merged configuration before deployment. Do not start
either overlay until the corresponding DNS name resolves to the exact reviewed
host and opening ports 80/443 is approved.

### Observed separate-host staging drill (2026-07-22)

The DreamHost managed/PostgreSQL host and DigitalOcean checkpoint host were
hardened and exercised as separate failure domains. The managed service remains
loopback-only. Its independent anchor path uses TLS at a staging-only public DNS
name whose TCP 443 firewall rule admits only the DreamHost public address; the
receiver itself remains loopback-only behind the edge. A private WireGuard path
also exists for administration, but is intentionally not used as the application
URL because the product's SSRF guard correctly rejects private destinations.

Observed action traffic proved independent exact-revision acknowledgement,
fail-closed HTTP 503 during an anchor-edge outage, dead-letter/redrive behavior,
and 9-second delivery recovery. Scheduled encrypted cross-host backup, ingest
and retention timers now run for both failure domains and were also triggered
manually. Clean restores verified SQLite/PostgreSQL integrity and exact audit,
control and anchor checkpoints. The latest measured PostgreSQL restore took
1 second; the anchor backup drill caused 7 seconds of downtime; migration to the
current hardened PostgreSQL image had a 90-second maintenance RTO. The current
schedule defines a daily RPO; WAL/PITR is not configured. The owner accepted
that daily RPO for the first cohort on 2026-07-23.

The 2026-07-23 lifecycle audit discovered that the original Age recovery
identity was no longer available, so older ciphertexts are retained but not
claimed as recoverable. Both jobs were rotated to a new owner-only recovery
identity outside the repository. Fresh cross-host backups then passed
ciphertext-hash comparison, decryption, and bundle manifests. A clean restore
verified managed SQLite v15/26 tables/four deletion receipts, anchor SQLite
three tables, PostgreSQL 34 public tables/shared-control v2/four receipts, the
exact saved action checkpoint, managed readiness, control integrity, and the
active owner lifecycle. Plaintext and all disposable restore resources were
removed. The owner reported that the recovery identity was copied into
off-workstation escrow on 2026-07-23. A clean-machine retrieval/decryption drill
has not been observed, so escrow availability remains owner-attested.

The exact r7 managed image
`sha256:516b0869f9bb507641ddd5ae602a02b43fc620375f5134409776fe374970239d`
is now deployed. It retains the r3 correction for the production-observed
shared deletion-request defect: r2 updated PostgreSQL but left the local SQLite
projection active, while r3 through r7 synchronize both signed lifecycle stores and
roll local state back if the shared transaction fails.

r4 also replaces the partial read-only dashboard with an operator workbench:
14 read panels cover lifecycle, usage, evidence, delivery, action,
reconciliation, billing, integrity, releases, intelligence, and rulesets; 27
editable presets cover managed operational route families. Non-GET requests
require explicit confirmation and unresolved path or JSON placeholders fail
closed.

The exact r5 source passed the declared repository gate, production-container
audit, severe program, a 61-request public TLS workflow, separate-host anchor
failure/recovery, and the in-app-browser lifecycle. The browser exercised all
27 workbench presets and loaded all 14 panels, including real dead-letter,
redrive, and aged-reconciliation paths. r5 also requires protected file input
or direct mode-0600 output for public/shared bootstrap credentials; stdout
contains metadata only. Offline inspection proved both lifecycle projections
`deletion_pending` before exact-hash deletion for disposable tenants.
Local/shared receipts were produced, all temporary key/export/confirmation
files were removed, and no disposable `audit-*` tenant remains.

r6 adds the disabled-by-default sandbox Stripe authority and two workbench
presets. Before rollout, a clean current-r6 process migrated PostgreSQL and a
clean r5 image then became ready against the same database; billing migration
history is isolated from the legacy control history. The production-like
rollout took a fresh encrypted backup, retained r5 as the rollback image,
verified the transferred amd64 digest, used both required Compose files, and
finished healthy with zero restarts. Public readiness and dashboard returned
200, the browser observed all 29 presets, and the unconfigured webhook remained
fail closed. No real Stripe account or settlement path was exercised.

r7 closes a privacy defect found by the exact public program after a browser
created a durable alert. The shared export excluded `key_hash` but not the
alert deduplication column `source_key_hash`. The first public run stopped at
that assertion. Both export serializers now exclude all internal
`*_key_hash` fields; an alert-bearing PostgreSQL regression passes; the exact
scanned r7 image is healthy with zero restarts; and the corrected public run
passes 64/64 HTTPS requests in 21.593 seconds. The public browser also executed
all 29/29 presets, parsed all 14/14 panels, verified locked-state export, and
finished with exact-hash deletion from both stores.

The first r4 rollout omitted the PostgreSQL TLS/CA Compose overlay and readiness
failed closed. r3 was restored using both reviewed Compose files without
restarting PostgreSQL, edge, DNS, or anchor. r4 then deployed successfully with
the complete overlay and automatic rollback guard. Production rollout and
rollback commands must always include both `compose.yml` and
`compose.postgres.yml`.

This is staging evidence only. It does not prove PITR, observed certificate
renewal, owned external monitoring/paging, customer usage, or a customer-facing
support operation. Those launch-checklist items remain open.

The owner identified `akriven.com` as the GoDaddy-registered product domain and
explicitly approved the managed API cutover. The existing apex/`www` records
were left untouched. An A record for `api.akriven.com` was created with value
`208.113.209.209` and TTL 600 seconds, then confirmed directly against both
authoritative nameservers and the Google and Cloudflare public resolvers.

The reviewed edge is now active at `https://api.akriven.com`. Let’s Encrypt
issued a publicly trusted certificate valid through 2026-10-20. External tests
proved HTTP-to-HTTPS redirect, HTTP/2 readiness, HSTS and the reviewed security
headers, unauthenticated HTTP 401, authenticated 1.1 MB rejection with HTTP 413,
and an authenticated `valid_with_repair` request with an audit ID. Hostile-origin
simple and preflight requests received no CORS allow-origin header. External
port probes found only 22/80/443 open; PostgreSQL, managed loopback, anchor and
Portainer ports were closed. Public audit/control integrity remained valid and
checkpoint revision 5 was retained.

The machine-readable launch position and the evidence still required before a
public server are tracked in [ENTERPRISE_LAUNCH_GATES.md](ENTERPRISE_LAUNCH_GATES.md).

## Launch checklist

Public launch is allowed only when each item has evidence:

- Domain and TLS terminate before the service.
- Reverse proxy does not log request bodies or authorization headers.
- `SCHEMA_GUARD_MASTER_SECRET` is generated randomly, stored outside git, and
  recovery/rotation is documented.
- Database volume is encrypted or hosted on an encrypted disk.
- Encrypted off-machine backups run on a schedule.
- A restore drill has been performed from the latest backup.
- Every tenant's latest idempotency checkpoint is retained outside the database
  failure domain and the restore candidate returns `same` or `advanced` when it
  compares that checkpoint before action traffic is enabled.
- The checkpoint receiver runs under separate storage, backup, and administrative
  credentials; its monotonic revision/fork behavior and request HMAC are tested.
- Pending anchor age and dead-letter count page externally, and a deliberate
  receiver outage proves the managed action route fails closed without invoking
  the downstream tool.
- `/v1/admin/control-plane-integrity` is valid for every tenant and `/readyz`
  becomes unavailable in a deliberate non-production substitution test.
- External uptime and error monitoring are configured.
- A deployed webhook test reaches the owned receiver, verifies its HMAC, and
  external monitoring pages on dead-letter growth.
- Billing provider webhooks are implemented before charging money.
- High-risk hosted actions use separately issued evaluator and approver keys;
  production operations prevent the same human/system authority from holding
  both roles.
- Production environments use a separately issued `promote:schema` key, have an
  active release for every executed tool, pass release-chain verification, and
  have exercised one expected schema-mismatch rejection before launch.
- Multi-instance deployments use a shared transactional database and have a
  tested uncertain-outcome reconciliation procedure against the deployed shared
  store and downstream systems.

`SCHEMA_GUARD_INSTANCE_COUNT>1` currently fails startup in every mode. The
PostgreSQL action-state and control-state engines exist. Tenant authentication,
API-key revocation, policy/plan state, atomic current-month metering, and
privacy-safe validation audit history can now use shared PostgreSQL, as can
action reservation/completion/checkpoint and reconciliation. Environment policy,
schema registration/promotion, and enforced runtime admission can use shared
PostgreSQL too, and per-key rate admission plus generic alert/webhook delivery
are shared. Derived intelligence, conformance history, and signed rulesets now
use deletion-evident shared PostgreSQL state as well. Accepted
action-decision proofs, action-risk descriptors, and approval workflows are
shared and integrity-bound, so a high-risk decision created on one instance can
be approved and admitted on another. The action checkpoint-anchor outbox is shared and
acknowledgement gated when PostgreSQL action state is selected. Remove the instance guard only
after cross-store action/notification and local projection boundaries are
removed, credentialed PostgreSQL CI is observed green, and deployed failover
evidence passes.

- Terms, privacy policy, and security contact are published.
- `npm run audit:extreme` passes on the exact deploy candidate.
- `npm run audit:release-candidate -- --output release-candidate-report.json`
  passes in the protected manual workflow, with the resulting report retained.
- `npm run audit:real-repos` is run and reviewed, then promoted into checked-in
  fixtures for any real provider/framework shapes it discovers.

## Current hard boundary

The included Compose profile can host a private beta or design-user deployment
behind a protected domain. For a broad self-serve public launch, payment
settlement, hosted user signup, configured/tested alert receiver, independently
deployed checkpoint receiver, receiver and primary backup automation,
credentialed provider-version probe operation/alerting, shared multi-instance persistence,
deployed reconciliation/failover drills, and support operations still need product decisions and external account
configuration.
