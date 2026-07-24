# Action checkpoint anchor delivery

The managed service can automatically send each tenant's value-free action
idempotency checkpoint to an independently hosted HTTPS receiver. This closes
the operational gap between manually exporting a checkpoint and retaining one
outside the primary SQLite/backup failure domain.

## Configuration

The URL and signing secret are a pair. Public mode refuses to start unless both
are present.

```bash
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL=https://anchor.akriven.com/v1/checkpoints
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET_FILE=/owner-only/path/to/anchor-signing-secret
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_POLL_INTERVAL_MS=5000
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS=5000
SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_MAX_ATTEMPTS=8
```

The receiver must be in an independent storage and administrative failure
domain. Pointing the URL back at the same service, database, volume, backup
account, or credentials does not provide rollback evidence.

The repository includes a standalone reference receiver under
`packages/anchor-receiver` and a separate container target/Compose file. Run it
with `npm run anchor-receiver` for local verification. Its required environment
is:

```bash
SCHEMA_GUARD_ANCHOR_DATABASE=/independent-data/anchor.db
SCHEMA_GUARD_ANCHOR_SIGNING_SECRET_FILE=/owner-only/path/to/anchor-signing-secret
SCHEMA_GUARD_ANCHOR_READ_TOKEN_FILE=/owner-only/path/to/anchor-read-token
SCHEMA_GUARD_ANCHOR_CHAIN_SECRET_FILE=/owner-only/path/to/anchor-chain-secret
```

`GET /v1/checkpoints/:tenant_ref` requires the read token and returns the latest
retained checkpoint for restore comparison. The receiver keeps a chained event
history and cross-checks its materialized latest records at startup/readiness.
It rejects stale or invalid signatures before parsing or mutation, lower
revisions as `rollback_detected`, equal-revision/different-hash records as
`integrity_conflict`, and reused event IDs with changed bodies as
`event_conflict`.

The reference receiver is deliberately a different process/database, but the
included files do not magically create an independent failure domain. Deploy
its container in a different account/project with separate storage, backups,
operators, and credentials. Its local SQLite profile is single-node; a public
multi-instance receiver still needs shared transactional storage or a managed
append-only service.

## Delivery contract

Every manifest revision is inserted into `checkpoint_anchor_deliveries` in the
same SQLite transaction as the reservation-set change. The worker uses leases,
bounded exponential retry, dead letters, explicit redrive, fresh DNS
resolution, public-IPv4 filtering, address pinning, HTTPS/443, and no redirects.
The database payload has its own master-secret HMAC. A successful receiver
acknowledgement is separately HMAC-bound to the delivery, tenant, revision,
checkpoint hash, delivery time, and HTTP status; changing only the database
status to `delivered` cannot authorize execution. The outbound request uses:

- `x-schema-guard-timestamp: <ISO timestamp>`
- `x-schema-guard-signature: v1=<hex HMAC-SHA-256>`

The signature input is `timestamp + "." + exact_request_body`. Verify it before
JSON parsing with the separately stored anchor signing secret. Reject stale
timestamps and deduplicate by `event_id`, then enforce the following per
`checkpoint.tenant_ref`:

- a higher revision advances the retained checkpoint;
- the same revision and same `checkpoint_hash` is an idempotent replay;
- a lower revision is a rollback signal and must be rejected and paged;
- the same revision with a different hash is a fork signal and must be rejected
  and paged.

Payloads contain the checkpoint version, tenant HMAC reference, revision, row
count, XOR set accumulator, update time, and service-verifiable checkpoint HMAC.
They contain no raw arguments, tool names, idempotency keys, API keys, or tenant
ID.

Reconcilers can inspect
`GET /v1/actions/idempotency/anchors/deliveries?limit=100` and redrive a dead
row through
`POST /v1/actions/idempotency/anchors/deliveries/:delivery_id/redrive`.
`/readyz` becomes unavailable when the current revision is dead-lettered or its
coverage/integrity is missing.

## Safety boundary

The background outbox is asynchronous, but an anchored managed HTTP action
evaluation has a stricter rule: it drains the checkpoint outbox and does not
return `allowed` until the receiver has acknowledged the exact current revision.
If acknowledgement fails or times out, the API returns `503`, does not authorize
tool execution, and deliberately leaves the reservation pending. Reusing the
idempotency key remains duplicate-blocked; an operator must use the existing
evidence-backed reconciliation workflow before retrying.

Completion, release, and reconciliation revisions continue through the durable
background outbox. The externally acknowledged pre-execution reservation still
preserves duplicate-execution memory across a primary-database rollback. A
public deployment must monitor pending age and dead letters, and restore must
compare against the receiver's latest retained checkpoint before action traffic
resumes. Direct `ManagedStore` evaluation refuses to return an anchored allowed
decision; use the managed HTTP boundary for acknowledgement-gated execution.

The checkpoint HMAC is service-verifiable, not a public signature. The transport
HMAC authenticates the service-to-receiver request; it does not make an
untrusted receiver honest. Protect receiver storage, credentials, clocks, and
monotonic update logic independently.
