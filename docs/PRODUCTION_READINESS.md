# Production readiness

This repository now contains a production-shaped managed service profile, not a
claim that a public SaaS is already deployed. Public mode is deliberately
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
SCHEMA_GUARD_MASTER_SECRET=<64+ random characters>
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL=https://independent-anchor.example.com/v1/checkpoints
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET=<32+ random characters>
```

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
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS=5000
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_MAX_ATTEMPTS=8
```

The container listens on loopback only. Put Cloudflare and a reviewed reverse
proxy in front of it for TLS, request logging controls, compression policy, and
public routing.

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
