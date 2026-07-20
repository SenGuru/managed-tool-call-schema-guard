# Shared transactional managed state

`packages/shared-state` contains PostgreSQL action-lifecycle, managed-control,
and environment/schema-release state engines for horizontally scaled managed deployments. It is intentionally separate from
the SQLite local profile and does not describe SQLite or a network filesystem as
cross-host shared state.

## Implemented contract

`PostgresActionState` provides asynchronous tenant-scoped `reserve`, `complete`,
`release`, `checkpoint`, checkpoint comparison, pending-reservation,
reconciliation, reconciliation-history verification, and readiness operations.
The managed HTTP service uses this engine for those action lifecycle paths when
`SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL` is configured.
Accepted validation proofs are stored without argument values, and action-risk
descriptors are also shared and HMAC-bound. A decision recorded on one managed
instance can therefore be evaluated on another without copying that instance's
SQLite audit or descriptor rows.
Approval challenges, approvals, revocations, and value-free evidence recognition
are shared as well. Approval signatures retain the same tenant-bound execution
binding, while row state is serialized and HMAC-protected in PostgreSQL.

`PostgresControlState` separately provides authoritative tenant/API-key
authentication, policy and plan updates, key issuance/revocation, and monthly
validation/repair/rejection/drift counters when
`SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL` is configured. Quota consumption
locks the HMAC-protected tenant row and checks/increments the counter in one
transaction. The current-month counters live in the tenant row rather than a
deletable usage row, so a missing usage record cannot reset quota. A shared
control outage or integrity failure returns `503`; the HTTP service never falls
back to a stale SQLite key or policy. Key deletion/revocation fails closed by
removing authority. The shared bootstrap is idempotent only for an exact tenant
and initial-key match and rejects conflicting retries.
Per-key fixed-window rate admission is stored in the same HMAC-bound API-key
row. Every request locks that row before incrementing; a deleted row revokes
authority, counter/window substitution fails integrity, and independent
instances cannot each grant a separate local allowance.

`PostgresAlertState` provides shared alert history and generic HTTPS webhook
delivery. Each tenant has an authenticated count/tip manifest; alert records are
HMAC chained and bind the expected number of delivery rows. Webhook endpoints
and one-time signing secrets are AES-256-GCM sealed, webhook controls and mutable
delivery leases are HMAC-bound, and workers claim due rows with `FOR UPDATE SKIP
LOCKED`. Retries are bounded, dead letters require explicit redrive, disabling a
webhook terminates pending leases, and readiness detects alert, webhook, or
delivery deletion/substitution. Rejected-validation alerts are appended in the
same PostgreSQL transaction as quota, audit, and counters. Breaking-drift,
promotion, and enforcement-change alerts likewise share the schema-state
transaction. An alert failure therefore rolls back the authoritative source
transition instead of creating a silent post-commit notification gap.
When action and control state use the exact same PostgreSQL URL, reconciliation
alerts also append inside the reconciliation transaction. With separate action
and control databases, the HTTP layer performs an idempotent alert append after
reconciliation; this remains a deliberate cross-store boundary covered by the
single-instance guard rather than being described as atomic.

Shared quota admission and privacy-safe validation audit append are one
transaction: either both commit or neither does. Audit envelopes are strict
allowlisted structures; unknown or value-bearing fields are rejected before any
database access. Events are HMAC chained, live row count and chain tip are bound
by an authenticated manifest, and retention advances an HMAC-bound anchor with
the deleted event count and boundary hash in the same transaction. Audit list,
CSV, chain verification, and retention routes select this shared history when
the control backend is configured. Deep verification detects middle/tail
deletion, field substitution, forged retention anchors, and manifest rollback.

`PostgresSchemaState` is the runtime authority for environment policy,
schema-enforcement mode, registered schema versions, and reviewed environment
releases whenever the shared control database is configured. Registration is
serialized per tenant/tool, exact retries are idempotent, schema bodies and
stored drift reports are HMAC-bound, and breaking promotion requires both an
explicit override and bounded review evidence. Release records form an
HMAC-authenticated tenant chain with a count/tip manifest. Enforced admission
reads the environment, verifies the complete release chain and its authenticated
source schemas, and selects the current release in one repeatable-read snapshot.
Observe mode remains the bootstrap default. Migration automatically backfills
the three default environments and an empty release manifest for existing shared
tenants; unknown environments and database/integrity failures fail closed.
Registered schema rows also have a tenant-scoped authenticated count/set
manifest independent of the release chain. Registration verifies and advances
that manifest in the same transaction. Readiness, runtime admission, promotion,
release verification, and schema-quality reads reject deletion or substitution
of promoted or unpromoted schema versions.

`PostgresIntelligenceState` stores only bounded, value-free validation
observations: provider/framework identifiers, adapter, reason/repair IDs, and
normalized issue path/keyword shapes. It excludes argument values, expected
enum/constraint values, tool names, schema bodies, and tenant IDs from network
results. Observation append shares the validation quota/audit transaction.
Separate authenticated count/tip chains cover observations, conformance runs,
and tenant rulesets. Conformance ingestion is content-idempotent, rule
publication is version-idempotent and Ed25519 signed, and signing-key trust is
master-secret bound. Network clusters require the configured tenant threshold;
affected provider versions are shown only when that same version independently
meets the threshold.

Each transition:

1. begins a database transaction;
2. creates or locks the tenant manifest with `SELECT ... FOR UPDATE`;
3. recomputes and verifies all HMAC-bound reservation rows, row count, and XOR
   accumulator before trusting the state;
4. applies the reservation change;
5. updates the authenticated manifest revision in the same transaction; and
6. commits before returning.

The same idempotency key is a duplicate only for the same execution fingerprint
and a conflict for a different fingerprint. Reservation keys are tenant-keyed
HMACs; metadata remains value-free. Two independent connection pools cannot both
create the same tenant/key reservation because every writer locks the same
manifest row first.

## Evidence boundary

`tests/postgres-shared-state.test.ts` opens independent action, control, and schema pools and races 40
same-key reservations, then tests conflicts, completion, release, tenant
isolation, checkpoint revisions, transactional uncertain-outcome reconciliation,
idempotent reconciliation, reconciliation-chain integrity, and out-of-band
reservation/reconciliation deletion detection. It also
starts two managed HTTP instances with independent SQLite control-plane files
and proves that PostgreSQL admits exactly one of two same-tenant/key action
requests, permits completion through the other instance, and exposes the shared
revision through the HTTP checkpoint endpoint. It also authenticates and revokes
keys across control pools, propagates policy, races 16 audit-carrying quota
attempts against an eight-request test plan with exactly eight admitted, verifies
the resulting chain, exercises anchored retention, and detects tenant-row and
audit-row substitution/deletion. It also propagates environment policy across
pools, exercises observe/enforce admission, registers and promotes reviewed
versions from different pools, checks evidence privacy, detects release deletion,
collapses 16 concurrent exact registrations to one authenticated schema row,
rejects a same-version adapter conflict, detects rate-counter substitution, and
rejects a substituted migration checksum. It runs only when
`SCHEMA_GUARD_TEST_POSTGRES_URL` is present. The normal local suite marks it
skipped because this machine has no PostgreSQL/Docker runtime; the CI
`postgres-shared-state` job provisions PostgreSQL 16 and is required to execute
it. A separate always-on in-memory contract test covers the HTTP adapter,
readiness, duplicate mapping, transitions, backend selection, checkpoint
comparison, reconciliation routes, cross-instance accepted-decision/descriptor
handoff, and fail-closed initialization without pretending to be a PostgreSQL
concurrency test. A second always-on two-instance contract proves shared policy,
key issuance/revocation, and one quota across independent SQLite stores. A third
always-on test routes two independent managed HTTP instances through one schema
authority and proves cross-instance policy, registration, promotion, enforced
admission, release listing, and integrity-failure behavior while the second
instance's SQLite store contains no release.
A fourth always-on two-instance contract proves shared value-free failure
clusters, idempotent conformance, signed-ruleset publication/readback, and
readiness behavior without representing itself as PostgreSQL concurrency proof.

These are opt-in backends, not yet the default managed backend. Validation audit,
environment, schema registry, promotion, admission, alerts, generic webhook
delivery, derived failure intelligence, conformance runs, and signed rulesets
are shared. Shared
reconciliation records are HMAC chained and covered by a separate authenticated
count/tip manifest in the same PostgreSQL transaction as the reservation
transition. When checkpoint anchoring is configured, every new shared action
manifest revision queues a value-free anchor event in that same transaction.
Workers claim due rows with `FOR UPDATE SKIP LOCKED`; mutable delivery/lease state
is HMAC-bound, retries are bounded, current-revision deletion/dead-letter state
fails readiness and subsequent transitions, and HTTP execution admission waits
for acknowledgement of the exact shared revision. Public multi-instance
readiness still requires removing the remaining cross-store action/alert and
non-authoritative SQLite projection boundaries, followed by deployed failover
tests. Until that
integration lands and its CI job is observed green, do not claim multi-instance
managed operation.

The current opt-in profile is:

```text
SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL=postgresql://user:password@host/schema_guard?sslmode=verify-full
SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL=postgresql://user:password@host/schema_guard?sslmode=verify-full
```

Use TLS and a least-privilege database role in a real environment. Public mode
rejects shared database URLs that omit `sslmode=require`,
`verify-ca`, or `verify-full`. Prefer `verify-full` with a trusted CA. Operations
currently verify all tenant reservation and reconciliation records before each
transition, favoring deletion detection over constant-time scaling; a hosted
load test must establish the practical tenant-history limit. Schema creation is
serialized with a PostgreSQL advisory transaction lock and recorded in a
checksummed `sg_schema_migrations` history; incompatible or substituted history
fails startup. Migration execution is still application-driven and does not yet
replace a separately authorized production migration role/workflow.

Managed configuration has a matching fail-closed guard in both private and
public modes:
`SCHEMA_GUARD_INSTANCE_COUNT` defaults to `1`, and values above one are rejected
until every managed state path is shared. Execution-critical action admission,
authentication, policy, keys, quota, per-key rate admission, validation audit,
environment/schema authority, alerts, and webhook delivery can now share
PostgreSQL, as can derived intelligence, conformance, and signed-ruleset
workflows. The remaining guard covers cross-store action/notification coupling,
non-authoritative local projections, and missing deployed failover evidence. It
makes the unsupported topology a startup error rather than an optimistic
deployment convention.
