# Security model

## Invariants

- No LLM or network call is made by the canonical enforcement engine.
- A repair must be registered, enabled, type-directed by the schema, recorded, and followed by full revalidation.
- Policies only narrow behavior.
- Unexpected failures return `rejected`.
- Ambiguous JSON object members and runtime values that do not have one portable JSON representation are rejected before validation.
- Unsafe or lossy numeric conversions are not repairs.
- Audit envelopes contain hashes and argument paths, not values.
- The engine never executes the target tool.
- Provider compilation never silently drops an unsupported constraint.
- The action gate verifies accepted decision/repair proof before evaluating risk,
  approval, and idempotency.

## Sensitive data

Raw arguments remain in process memory because validation requires them and
accepted responses return them to the caller. They are not written by ordinary
core validation. CLI/API audit output writes only the minimized envelope. The
explicit `schemaguard fixture` command is an exception: replay requires exact
values, so it writes an owner-only, `local_sensitive` fixture that is marked
unsafe for managed upload. Debuggers, crash dumps, reverse proxies, shell
history, fixture repositories, and caller logs are outside the audit-envelope
guarantee and must be configured separately.

SHA-256 fingerprints are correlation aids, not encryption. Low-entropy values
may be guessable by brute force. Core emits portable SHA-256 values; managed mode
re-scopes sensitive persisted/returned fields with tenant-keyed HMACs.

## Operational guidance

- Bind the sample server to loopback; place real authentication and TLS at a reviewed production boundary.
- Treat schemas as untrusted code-like configuration and cap request sizes/time.
- Keep target-tool credentials out of guard configuration.
- Use closed schemas for high-impact tools and deny sensitive argument paths where appropriate.
- Retain local audits only as long as necessary and protect file permissions/backups.
- Store approval HMAC secrets separately from agent/tool credentials and expose
  approval issuance only to authenticated human or reviewed workflow identities.
- Use the durable managed ledger for single-node hosted mutations. Multi-process
  deployments require shared transactional storage, and uncertain outcomes must
  follow the reconciliation runbook rather than automatic retry.
- Pin dependencies with `package-lock.json`; run the full check and dependency audit before releases.

## Managed local controls

The managed package stores no raw arguments. API keys use direct indexed lookup of master-secret HMACs, tenant queries and rulesets are scoped, caller policy cannot widen organization policy, and compatibility aggregates require a distinct-tenant threshold. Audit history is chained and signed with column/envelope consistency checks. Ruleset private keys are encrypted at rest and public verification keys are checked against an authenticated trust record. SQLite database/WAL/SHM files, local alert files, and backups are forced to owner-only permissions, but their directories, the master secret, and host process memory remain sensitive assets.

Managed alert webhook URLs and signing secrets are sealed with AES-256-GCM under
purpose- and record-bound keys derived from the master secret. Outbound payloads
use a kind-specific metadata allowlist and HMAC-SHA-256 signatures. Registration
requires HTTPS/443 and rejects local/IP-shaped hosts; delivery re-resolves DNS,
rejects non-public IPv4 results, pins the accepted address for TLS, and refuses
redirects. This reduces SSRF and DNS-rebinding exposure but does not replace
deployment egress controls. IPv6-only webhook destinations are currently
unsupported.

Tenant policy/plan, API-key scopes and revocation state, environment policy and
schema-enforcement mode, action risk/side-effect descriptors, approval state,
idempotency reservations, and webhook configuration carry master-secret HMACs
over their security-relevant columns. Queued alert and checkpoint-anchor
payloads carry immutable payload HMACs before delivery signing. Successful
checkpoint receiver acknowledgements carry a separate HMAC over the delivery,
tenant, revision, checkpoint hash, timestamp, and HTTP status, so changing only
the database status cannot authorize execution. Ordinary reads verify the relevant record
before use. Startup performs a deep scan including mutable action rows and queued
payloads. Readiness continuously scans the smaller live-configuration set;
`GET /v1/admin/control-plane-integrity` performs a tenant-scoped deep scan. Null
trust fields are populated only inside the specific migration transaction. A
later null or invalid value is not silently adopted.

These bindings detect row substitution and untrusted insertion without the
master secret. Idempotency records additionally feed a tenant manifest with a
monotonic revision, authenticated row count, and XOR accumulator over the bound
set. State changes update both in one immediate transaction. Startup recomputes
the manifest, and the running action path does so after SQLite reports an
out-of-band commit. Tests prove deletion of another tenant's completed row blocks
the next action and that offline deletion blocks restart.

This still cannot distinguish a rollback of the entire database to an older,
internally valid snapshot without an external reference. The scoped checkpoint
API provides a value-free revision/hash, and the optional dedicated outbox
automatically sends each revision to a separately configured HTTPS receiver.
Public mode requires receiver configuration. The repository does not deploy or
operate that independent receiver. The managed HTTP action route does not return
an idempotent reservation as `allowed` until the exact current checkpoint is
acknowledged; failure remains pending and fails closed. Later completion and
reconciliation revisions use the background outbox. A multi-instance service still requires shared
transactional storage, receiver-side monotonic/fork enforcement, externally
monitored delivery, and strict database/backup access controls.

The managed readiness probe also verifies that SQLite is queryable, foreign-key
enforcement is active, and the on-disk schema version exactly matches the
running build. The bounded probe deliberately does not rescan unbounded approval,
idempotency, or delivery history on every health request. It does not replace
the deep verification endpoint, external integrity anchoring, periodic restore
drills, or end-to-end dependency monitoring.

Environment releases bind the tenant, tool-name HMAC, environment, exact
registry row, schema hash, adapter, version, compatibility classification,
promoter-key HMAC, evidence HMAC, timestamp, and previous release hash. Runtime
admission re-verifies the active record and its source schema body before
trusting it. Breaking promotion requires an explicit flag plus an external
evidence reference, of which only a tenant-keyed HMAC is retained. Switching an
environment between observation and enforcement is privileged and alerted.

Report vulnerabilities privately to the repository owner. Do not include live secrets or customer payloads in reports.
