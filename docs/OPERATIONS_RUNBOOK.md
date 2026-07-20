# Managed operations runbook

This runbook covers the implemented single-node managed profile. It does not
claim multi-region recovery or shared-database failover.

## Control-plane integrity incident

Run `GET /v1/admin/control-plane-integrity` with each tenant's admin identity as
part of a release and restore check. This deep response is tenant-scoped and
includes action rows and queued delivery payloads. `/readyz` performs a bounded
global scan of live configuration and returns unavailable when that set is
invalid; affected action and delivery paths separately verify their rows before
use. Authentication itself rejects a modified API key or tenant record, so an
affected tenant may be unable to call the diagnostic route.

Treat `control_plane_integrity_invalid`,
`action_idempotency_manifest_invalid`, failed startup integrity, or
`database_unavailable` readiness as a security incident. Stop writers, preserve
the database/WAL/SHM files and service logs, do not null or recompute trust
fields, and compare against the latest verified backup. Restore into a new path
with the same master secret and run the recovery drill before returning traffic.
Trust fields are backfilled only by their exact schema migration; ordinary
restart deliberately cannot bless an altered record.

## Idempotency checkpoint anchoring

Configure the dedicated anchor outbox as described in
[`CHECKPOINT_ANCHORS.md`](CHECKPOINT_ANCHORS.md). Confirm revision zero is
delivered for every tenant, monitor pending age/dead letters outside this
service, and exercise a receiver-side rollback and same-revision fork rejection.
The receiver must not share the primary database, volume, backup account, or
administrative credentials.

As a manual fallback after controlled action batches and every verified backup, request
`GET /v1/actions/idempotency/checkpoint` with a least-privilege
`reconcile:action` key and store the complete JSON response outside the database
and its backup domain. It contains no raw key, tool name, arguments, or tenant
ID. Submit the retained object as `checkpoint` to
`POST /v1/actions/idempotency/checkpoint/compare` against a restore candidate.
Only `same` or `advanced` permits action traffic. `rollback_detected` means the
candidate revision is older; `integrity_conflict` means equal revisions describe
divergent reservation sets.

The checkpoint HMAC is not a public signature; obtain it through authenticated
TLS and protect the external record. A rejected checkpoint, rollback, or
same-revision conflict is an integrity incident and the candidate must not serve
action traffic. Automatic delivery is implemented, while deploying the
independent receiver and pre-traffic comparison remain deployment integrations.
The managed HTTP action route waits for receiver acknowledgement before
returning `allowed`. An acknowledgement failure returns `503` and intentionally
leaves the reservation pending; verify downstream non-execution and reconcile it
instead of retrying automatically.

## Uncertain action reconciliation

An action is uncertain when the downstream callback returned success but the
SDK could not record idempotency completion. The SDK retains the reservation,
throws `SchemaGuardActionCompletionError`, and includes the opaque
`reservationId` and execution fingerprint when the managed gate returned them.
Do not retry the mutation automatically.

Use a key with only `reconcile:action` where practical:

1. Query `GET /v1/actions/reconciliation/pending?older_than_seconds=300`.
2. Match the reservation's audit ID, tool hash, environment, and execution
   fingerprint against an authoritative downstream record.
3. If the downstream system proves the mutation happened, submit
   `confirmed_executed`. The idempotency record becomes permanently completed.
4. Submit `confirmed_not_executed` only when an authoritative downstream query
   proves absence. This releases the key for retry.
5. Supply an external ticket, transaction, or query reference as
   `evidence_reference`. Schema Guard persists only its tenant-keyed HMAC.
6. Verify `GET /v1/actions/reconciliation/verify` and retain the external
   evidence under the organization's normal incident controls.

```http
POST /v1/actions/reconciliation/res_...
Authorization: Bearer <reconciler-key>
Content-Type: application/json

{
  "outcome": "confirmed_executed",
  "evidence_reference": "payments-ledger/transaction-123"
}
```

The default five-minute age guard prevents reconciliation of a newly active
reservation; it does not prove the original process is dead or that the target
system is consistent. Operators must establish those facts. Reconciliation
records form a tenant-scoped HMAC-authenticated chain and emit critical alerts.

## Alert webhook operations

Create a receiver with a least-privilege `manage:webhooks` key and retain the
one-time signing secret in the receiver's secret manager. Send a controlled
rejection or drift event, then confirm the receiver verified the HMAC and
deduplicated the event ID. Inspect
`GET /v1/alert-webhooks/deliveries?limit=100`; any `dead` row requires diagnosis
before explicit redrive. Disabling a webhook dead-letters its outstanding rows.

Monitor dead-letter count from outside Schema Guard so loss of the alert path
can itself page an operator. Keep deployment egress restricted even though the
transport pins public IPv4 DNS results and refuses redirects. Exact signature,
retry, and endpoint rules are in [`ALERT_WEBHOOKS.md`](ALERT_WEBHOOKS.md).

## Schema promotion and enforcement

Keep new environments in `observe` while registering every active tool schema.
Promote exact version/hash pairs with a least-privilege `promote:schema` key,
review breaking classifications, and retain the external review referenced by
the stored evidence HMAC. Verify `/v1/schema-releases/verify` before switching
the environment to `enforce`.

After enforcement, run one exact promoted call and one deliberate mismatched
schema. The first must remain accepted and the second must return a protocol
`rejected` decision without `valid_arguments`. Treat a
`schema_release_integrity_invalid` policy reason as a security incident; do not
switch to observation merely to restore traffic. Preserve the database, verify
release history and the underlying registry rows, then restore from a known-good
backup if required. See [`SCHEMA_RELEASES.md`](SCHEMA_RELEASES.md).

## Backup and restore drill

Run the self-contained drill on every release candidate:

```bash
npm run audit:recovery
```

For an operator database, use the same master secret as the source and an
explicit new destination. The command refuses to overwrite the destination:

```bash
SCHEMA_GUARD_MASTER_SECRET='<secret>' npm run audit:recovery -- \
  --source /protected/schema-guard/managed.db \
  --backup /protected/schema-guard/drills/managed-$(date +%Y%m%d).db \
  --report /protected/schema-guard/drills/latest-report.json
```

The drill uses SQLite's online backup API, requires source and restored
integrity checks, compares critical table counts, verifies every tenant's bound
control records, the idempotency set manifest/checkpoint, and audit,
action-reconciliation, and schema-release chains, checks owner-only backup
permissions, and emits a SHA-256 backup fingerprint.
Run the production drill during a documented
write-quiescence window so the source-count comparison describes one stable
recovery point. Copy the verified backup off-machine through the chosen
encrypted storage system; that transfer is external integration work.

Before replacing a production database, stop writers, preserve the failed
volume, run this drill against the candidate backup, restore into a new path,
start one instance against that path, verify `/readyz`, tenant authentication,
control-plane integrity, audit chains, reconciliation chains, schema-release
chains, and a non-mutating validation call, then
record measured recovery time and recovery point. Do not claim an RTO or RPO
until repeated environment-level drills support it.

## Managed load/correctness audit

```bash
npm run audit:managed-load
```

The default profile promotes the exact test schema into staging, enables
fail-closed schema enforcement, and sends 2,000 authenticated repair requests at
concurrency 32 through the managed HTTP boundary. It requires zero HTTP/decision errors,
unique audit IDs, exact metering, a valid 2,000-event audit chain, absence of a
private sentinel from SQLite, a valid active release chain, p95 at or below 250
ms, and at least 100 requests per second on the test host. Override workload thresholds explicitly with
`--requests`, `--concurrency`, `--max-p95-ms`, and `--min-rps`.

This is a repeatable single-process regression threshold, not hosted capacity
evidence. Before public launch, repeat it against the deployed ingress and
database, add sustained/soak and failure-injection tests, and set limits from the
actual service-level objectives.
