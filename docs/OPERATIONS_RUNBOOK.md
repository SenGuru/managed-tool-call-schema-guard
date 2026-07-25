# Managed operations runbook

This runbook covers the implemented single-node managed profile. It does not
claim multi-region recovery or shared-database failover.

## Service metrics and trace correlation

Public mode requires `SCHEMA_GUARD_METRICS_BEARER_TOKEN_FILE`. Keep the file
owner-readable only and configure the monitoring collector to scrape
`GET /metrics` with `Authorization: Bearer <token>`. Do not reuse a tenant API
key. The endpoint exposes aggregate Prometheus text with privacy-safe route
templates and no tenant IDs, API-key identifiers, prompts, schemas, or raw
arguments.

Alert on sustained 5xx request growth, request timeouts, any zero-valued
required dependency, background dispatch failures, memory pressure, and
readiness failure. The endpoint is instrumentation, not proof that an external
collector, dashboard, or paging route is operating; exercise those targets
before enabling customer traffic.

Incoming requests may include a lowercase W3C version-00 `traceparent`.
Responses return a new server span under the same trace and expose
`x-akriven-trace-id`. Access logs retain only the SHA-256 trace-ID hash.
Malformed or all-zero trace/parent identifiers receive HTTP 400.

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

## Tenant onboarding in the single-instance profile

Local development may bootstrap before starting the service. Public mode and
shared PostgreSQL control state are offline-operator workflows: stop the managed
service, run `managed:bootstrap` with `--service-state stopped`, restart the
service, and require `/readyz` plus tenant lifecycle/control-integrity checks
before returning traffic. The command rejects a public/shared invocation
without the stopped-service assertion.

Never pass a production API key with `--api-key`; public/shared bootstrap
rejects it because process arguments may be observable. Use
`--api-key-file /owner-only/existing.key` or
`--api-key-output-file /owner-only/new.key`. The input file must not be writable
by group or other users. The output path must not exist and is created mode 0600. Stdout contains only tenant metadata.

Do not run bootstrap inside an active production container. It writes the
single-node SQLite projection out of process; the running store correctly
becomes unready until restart. The staging drill observed this fail-closed state
and then measured a 3-second controlled stop/bootstrap/restart. A self-serve
service must replace this maintenance workflow with one transactional hosted
organization-provisioning control plane.

## Host configuration templates

Render host configuration from the reviewed examples rather than reconstructing
environment names during an incident:

- main service: `deploy/env.production.example`;
- anchor service: `deploy/env.anchor-receiver.example`;
- main encrypted backup: `deploy/host/dreamhost/backup.env.example`;
- anchor encrypted backup: `deploy/host/digitalocean/backup.env.example`;
- main monitor: `deploy/host/common/monitor.main.env.example`;
- anchor monitor: `deploy/host/common/monitor.anchor.env.example`.

Install rendered environment files below `/etc/akriven` with owner `root:root`
and mode `0600`. The examples contain only paths and non-secret identifiers.
Private SSH keys, database passwords, API keys, Age recovery identities,
webhook URLs, and signing secrets belong in separate owner-only files or the
production secret manager. Do not copy secret values into the environment
templates, shell history, process arguments, logs, reports, or chat.

The two backup accounts are deliberately asymmetric:
`akriven-backup-main` exists on the anchor host to receive main-host archives,
and `akriven-backup-anchor` exists on the main host to receive anchor archives.
Pin each backup source to a separately generated Ed25519 key and a verified
`known_hosts` file. Never reuse the interactive deployment identity for backup
transfer.

## Release rollback and schema compatibility

Set `SCHEMA_GUARD_MANAGED_IMAGE` and `SCHEMA_GUARD_ANCHOR_IMAGE` to immutable,
reviewed candidate tags or digests before rendering either production Compose
profile. Do not reuse the mutable `0.2.0` fallback for a rollout. Preserve the
previous image under its own immutable rollback tag, render both the rollout
and rollback configurations with every required overlay, and use `--no-build`
on the hosts so a deployment cannot silently rebuild different source.

Capture an encrypted off-machine backup immediately before migration. Verify
both the candidate image ID and every migration history table after startup.
An image-only rollback is valid only when the previous binary has been proven
against the post-migration schema and lifecycle state.

The 2026-07-23 staging deployment deliberately tested the pre-lifecycle image
after SQLite v15/shared-control v2 were applied. That binary failed readiness:
its exact-version/checksum guards correctly reject the newer migration. It is
therefore **not** a valid image-only rollback target. Once lifecycle data or
deletion receipts exist, do not drop or rewrite those records to make an old
binary start. Use a forward-fix image that understands the current schema, or
restore the complete pre-migration SQLite/PostgreSQL backup into new volumes and
compare the independent checkpoint before action traffic. A destructive live
restore requires an exact target check and owner approval.

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

For a dedicated disposable `audit-*` tenant, the separate-host drill is:

```bash
SCHEMA_GUARD_PUBLIC_E2E_BASE_URL=https://api.example.com \
SCHEMA_GUARD_PUBLIC_E2E_API_KEY_FILE=/owner-only/audit.key \
SCHEMA_GUARD_PUBLIC_E2E_TENANT_ID=audit-release-candidate \
SCHEMA_GUARD_ANCHOR_SSH_TARGET=anchor-host-alias \
SCHEMA_GUARD_ANCHOR_EDGE_CONTAINER=exact-anchor-edge-container \
SCHEMA_GUARD_DEPLOYED_REVISION=managed-release-digest \
npm run audit:public-anchor-outage
```

The script validates every identifier, stops only the named anchor edge,
requires public action admission to return an anchor-acknowledgement 503,
restarts the edge in a `finally` path, waits for outbox recovery, proves the
reservation remains duplicate-blocked, releases it explicitly, and verifies
reconciliation and control integrity. Do not run it against customer action
traffic or without an independently verified recovery path.

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

## Stripe sandbox billing reconciliation

The integration is sandbox-only until the external certification in
[`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md) passes. Never respond
to a billing incident by enabling a live key, manually changing a public
tenant's plan route, editing billing rows, or replaying an unverified body.

If `/readyz` reports `billing_state_unavailable` or tenant traffic reports
`billing_reconciliation_pending`:

1. stop rollout and preserve application/PostgreSQL logs with secrets and raw
   bodies redacted;
2. check Stripe test-mode availability and endpoint delivery status in the
   provider console;
3. verify `/v1/admin/control-plane-integrity` with a protected admin key;
4. restore provider/database connectivity without modifying retained `ready`
   rows;
5. ask Stripe test mode to retry the original signed event, or use its reviewed
   retry control; and
6. confirm the event becomes applied, readiness recovers, the billing statement
   matches provider-current state, and the tenant entitlement is correct.

A pending binding intentionally returns `503` so Stripe retries. Investigate
whether Checkout state was durably recorded before retrying. A conflicting
event ID or cross-tenant subscription/customer binding is an integrity
incident: isolate the service, preserve evidence, and do not force a mapping.

For failed payments, cancellations, recovery, and reordered notifications,
trust the newly retrieved provider subscription rather than the event timestamp.
The service reduces entitlement to `trial` for every status except `active` or
`trialing` on the exact Team price. Tax, refunds/credits, invoice amounts,
dunning, and customer communication remain external policy blockers.

## Backup and restore drill

Run the self-contained drill on every release candidate:

```bash
npm run audit:recovery
```

For an operator database, use the same master secret as the source and an
explicit new destination. The command refuses to overwrite the destination:

```bash
SCHEMA_GUARD_MASTER_SECRET_FILE=/owner-only/path/to/master-secret \
  npm run audit:recovery -- \
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

The recovery identity must exist in at least one owner-controlled failure domain
separate from both servers and must be escrowed before a backup is called
recoverable. Verify a fresh ciphertext by comparing its recorded hash,
decrypting it, checking `SHA256SUMS`, and restoring into clean volumes. Merely
retaining an Age ciphertext and public recipient is not recovery evidence.
Never print or place the private recovery identity in the repository, command
arguments, logs, or chat.

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
