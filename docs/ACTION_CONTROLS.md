# Deterministic action controls

Structural validity is not permission to perform a dangerous action. Schema
Guard 0.2 adds a separate action gate after validation and before the SDK's
execution callback.

## Controls

- Risk levels: `read`, `low`, `medium`, `high`, and `critical`.
- Side effects: `none`, `reversible`, and `irreversible`.
- Environment allowlists.
- A lower auto-execution ceiling for repaired calls than already-valid calls.
- Critical actions always require approval.
- Approval challenges bind the tool, exact post-repair argument hash, repair
  receipt hashes, validation/policy identity, risk, side effect, and environment.
- Approval evidence uses HMAC-SHA-256 and stores only a keyed approver-identity
  hash. Evidence expires after at most 24 hours.
- Side-effecting actions require an idempotency key and ledger by default.
- An integrity-protected tenant emergency hold rejects every action before
  approval lookup or idempotency reservation.
- One optional shadow policy is evaluated with a non-mutating ledger. Its
  bounded status/reason/requirement diff is returned beside the enforced
  decision; it cannot authorize execution or create a reservation.
- An optional 1-256 character workload identity is tenant-keyed before it
  reaches the core gate. Its hash is bound into the approval challenge and
  execution fingerprint; the plaintext identity is not persisted or returned.
- Duplicate same-action keys are blocked; keys bound to different actions are
  conflicts.
- The SDK completes a reservation after success and releases it after a thrown
  downstream failure. If completion recording fails after the callback returns,
  it retains the reservation and reports an uncertain-completion error rather
  than permitting a possibly duplicated retry.

The action gate also verifies the accepted decision's audit linkage, allowed
policy result, and every proof-carrying repair receipt. A caller cannot make a
tampered repair executable merely by labeling the action low-risk.

## TypeScript execution boundary

Use `executeGuardedAction` for a single validate-authorize-execute lifecycle.
The callback is never invoked unless validation and action controls return
`allowed`.

The included `InMemoryIdempotencyLedger` is for a single process, tests, and
local development. Managed mode adds a tenant-scoped SQLite workflow with
separate `evaluate:action` and `approve:action` permissions, server-registered
risk descriptors, stored challenges, restart-safe approval evidence, and
transactional idempotency reserve/complete/release operations. Tool names,
approver identities, and idempotency keys are tenant-keyed before persistence.
Each tenant also has an HMAC-authenticated, monotonically revised manifest over
the complete reservation set. Reserve, complete, release, and reconciliation
update the reservation and manifest in one immediate transaction. Startup
recomputes every manifest; a running process repeats the full check after an
out-of-band SQLite commit, before another action transition. This makes row
deletion fail closed instead of erasing duplicate-execution memory.

Daily-use discovery is explicit:

- `GET /v1/admin/actions/control` returns the hold state, enforced policy,
  optional shadow policy, timestamp, and keyed operator hash.
- `PUT /v1/admin/actions/control` atomically replaces that record under
  `admin`. Activating a hold requires a bounded reason code; every change emits
  a critical, value-free alert.
- `GET /v1/admin/actions/descriptors` returns tenant-owned descriptor hashes,
  environment, risk, side effect and timestamps under `admin`; plaintext tool
  names remain excluded from persistence and the inventory.
- `GET /v1/actions/challenges?status=pending&limit=100` returns bounded,
  tenant-owned approval state under `approve:action`, so approval and
  cancellation do not depend on challenge IDs copied from an earlier response.
- both read paths verify authenticated state before returning it and fail
  closed on tampering.

The action-control record exists in both the single-node SQLite profile and the
shared PostgreSQL control plane. It is HMAC-authenticated, included in
tenant export/deletion, verified by readiness, and read authoritatively from
shared state in multi-instance mode. Shared-state loss returns `503`; it never
falls back to a stale local policy.

`GET /v1/actions/idempotency/checkpoint` returns a value-free revision, row
count, set accumulator, tenant reference, and checkpoint HMAC under the
`reconcile:action` scope. Retain it outside the database after controlled action
batches and backups. Submit that record to
`POST /v1/actions/idempotency/checkpoint/compare` after restore: `same` and
`advanced` are admissible; `rollback_detected` and `integrity_conflict` must
block action traffic. The HMAC is service-verifiable rather than a public
signature, so the external system must obtain it through the authenticated TLS
boundary and protect the retained record.

When `SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL` and its separate signing secret
are configured, every manifest update also inserts a value-free checkpoint into
a dedicated transactional HTTPS outbox. Public mode requires that pair. The
worker provides bounded retry, dead-letter visibility, and explicit redrive;
readiness fails if current coverage is missing or dead. The receiver must enforce
monotonic revision/fork rules in an independent failure domain. The background
worker is asynchronous, but the managed HTTP action route withholds `allowed`
until the receiver acknowledges the exact reservation revision; failure leaves
the reservation pending and returns `503`. See
[`CHECKPOINT_ANCHORS.md`](CHECKPOINT_ANCHORS.md).

Uncertain reservations expose an opaque operator ID and can be reconciled only
after a minimum age by the separate `reconcile:action` scope. Resolution requires
an external evidence reference, stores only its keyed hash, and appends to an
authenticated per-tenant reconciliation chain.

That managed implementation is durable and deletion-evident for the documented
single-node profile. A rollback of the entire database to an older internally
valid snapshot is detectable only by comparing an externally retained newer
checkpoint. A horizontally scaled public service still requires one shared
transactional database, an independently deployed anchor receiver, failover procedures, deployed
reconciliation drills, and an approval authority whose
credentials are operationally separate from evaluators.

## Boundary

Approval evidence says that the configured Schema Guard approval authority
approved this exact structural action. It does not grant permissions in the
target system. Downstream identity, authorization, transaction constraints,
least privilege, fraud/abuse checks, and business invariants remain mandatory.
