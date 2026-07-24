# Managed control plane

The managed package is the operational product boundary used by local proof
workflows and the publicly reachable internal-staging deployment. That staging
deployment is not approved for customer data, mutating customer action traffic,
an SLA, or automated charging.

## Why this layer exists

The open engine answers one call correctly. The managed product helps a team understand and govern thousands of calls across people, environments, providers, frameworks, and schema versions. Its durable value is not another validation endpoint; it is the accumulated compatibility evidence and operational record around that endpoint.

The local package demonstrates the product spine: shared policy, schema history, reviewed environment releases, persistent value-free failure clusters, explainable schema-quality scores, evidence-linked recommendations, provider/framework/version conformance matrices, privacy-thresholded aggregate intelligence, verifiable audit history, alerts, signed rulesets, tenant-scoped action approvals and idempotency, usage controls, and an operator dashboard. The repository also runs a deterministic offline conformance gate on every release check and includes a daily CI workflow. A production service still needs real provider-version fleet probes, configured and deployment-tested alert receivers, and reliable hosted operation. Those items must not be inferred from this local build.

## Implemented behavior

- Tenant API keys are verified through master-secret HMACs; plaintext keys are shown only once and are not persisted.
- Scoped keys can be issued and revoked. The active key cannot revoke itself.
- Operational read routes use explicit scopes (`read:audit`, `read:alerts`,
  `read:billing`, `read:environment`, `read:intelligence`, `read:ruleset`, and
  `read:usage`); a validate-only key cannot enumerate tenant operations.
- Organization policy is stored server-side and merged so caller policy can only narrow it.
- Tenant policy/plan, API-key scopes and revocation state, environment policy and
  enforcement mode, action risk/side-effect descriptors, approval state,
  idempotency reservations, and webhook configuration are bound to the master
  secret. Queued alert payloads have a separate immutable binding.
  Idempotency rows additionally form a deletion-evident set through a
  monotonically revised tenant manifest that is recomputed at startup and after
  out-of-band database commits before action transitions.
  When the independent anchor URL/signing-secret pair is configured, every
  manifest revision is also inserted transactionally into a dedicated,
  value-free signed HTTPS outbox with bounded retry, dead letters, redrive, and
  current-revision readiness coverage. The managed HTTP action route waits for
  the exact reservation checkpoint acknowledgement before returning `allowed`;
  failure returns `503` and retains the pending reservation.
  Authentication and affected enforcement paths reject altered rows; startup
  performs the deep scan, readiness continuously scans bounded live
  configuration, and the admin verification API exposes deep details only for
  the caller's tenant.
- SQLite uses foreign keys, WAL, busy timeout, migrations, integrity checks, and online backup. Database, WAL, SHM, alert, and backup files default to owner-only permissions.
- Validation quota use and audit insertion commit atomically. Audit events contain
  the value-free core envelope and form a per-tenant HMAC-signed hash chain;
  tool/schema/argument/policy and repair input/output/schema hashes are keyed per
  tenant before persistence/return, and repair receipt hashes are recomputed over
  that scoped proof. Verification also checks indexed columns against the
  envelope. Retention is tenant-scoped and preserves a checkpoint anchor so the
  surviving chain remains verifiable.
- Tool schemas are registered per tenant. Structural drift produces privacy-safe signatures and local alerts.
- Registered versions can be promoted into an environment under a separate
  `promote:schema` scope. Breaking changes require explicit authorization and a
  keyed evidence reference. Each immutable release is registry-row-bound and
  forms a tenant HMAC chain. Enforced environments convert missing, mismatched,
  or integrity-invalid releases into protocol-level rejections before execution.
- Repair and rejection observations become tenant-isolated, value-free clusters keyed by adapter, provider, framework, generalized issue shape, reason, and repair rule. Provider versions are retained as metadata, never argument values.
- Latest registered schemas receive deterministic, explainable quality scores. Breaking drift, weak schemas, and recurring failure clusters produce advisory recommended actions.
- Versioned conformance summaries can be ingested idempotently and are aggregated into provider/framework compatibility matrices.
- Admins register trusted action risk/side-effect descriptors. Evaluators can
  create exact decision-bound challenges and reserve execution, while separately
  scoped approvers authorize challenges. Approvals and idempotency records are
  tenant-bound, survive restart, and never persist raw arguments, tool names,
  approver identifiers, or idempotency keys.
- Separately scoped reconcilers can inspect aged pending reservations using
  opaque IDs and resolve them only as confirmed executed or confirmed not
  executed with a keyed external-evidence reference. Records form an
  authenticated per-tenant chain and emit critical alerts.
- Separately scoped webhook managers can register public HTTPS receivers.
  Endpoint URLs and one-time signing secrets are AES-256-GCM sealed at rest;
  value-free payloads enter a transactional outbox with leases, signed delivery,
  bounded backoff, dead-letter status, explicit redrive, and SSRF controls.
- Aggregate compatibility intelligence is released only when a signature appears in at least three distinct tenants by default. Results contain no tenant identifiers.
- Rulesets are tenant-scoped and use an Ed25519 signing key. The private key is encrypted at rest with AES-256-GCM under the master secret; embedded public keys must match the authenticated local trust record, and expired rulesets are not served.
- Trial/team plans, monthly quotas, fixed-window per-key limits, usage
  statements, JSON/CSV audit export, complete tenant export, lifecycle locking,
  exact-confirmation deletion requests, offline verified deletion, local-file
  and generic HTTPS webhook alerts, liveness/readiness, request size/deadline
  controls, and graceful shutdown are operational.
- The operator dashboard exposes 14 read panels and 29 editable request presets
  spanning validation, compilation, registry/releases, policy/enforcement,
  actions/approvals/idempotency/reconciliation/anchors, conformance, webhooks,
  rulesets, API keys, billing-boundary checks, retention, lifecycle, and export.
  API keys remain password inputs held in tab memory. Every non-GET workbench
  request requires explicit confirmation, and unresolved path or JSON
  placeholders are rejected before transmission.

## Bootstrap and run

```bash
export SCHEMA_GUARD_DATABASE="$PWD/work/managed.db"
export SCHEMA_GUARD_MASTER_SECRET="replace-with-a-random-secret-at-least-32-characters"
npm run managed:bootstrap -- --tenant-id demo --tenant-name "Demo tenant" --plan trial
npm run managed
```

Keep the master secret and one bootstrap admin key in a secret manager in any non-local environment. Losing the master secret makes stored API-key verifiers unusable and the encrypted ruleset signing key unrecoverable.

The local single-process quickstart may bootstrap before starting the service.
Public mode or any shared-control configuration additionally requires
`--service-state stopped`; stop every managed instance, run bootstrap with that
assertion, then restart and wait for `/readyz`. An out-of-process SQLite
bootstrap while the server is running is unsupported and can make readiness
fail until restart. The public staging drill measured a 3-second
stop/bootstrap/restart window. This operator-led workflow is acceptable only
for a controlled cohort; self-serve onboarding requires a transactional hosted
provisioning control plane.

Public/shared bootstrap also forbids `--api-key`, because command arguments can
be visible to other host processes. Supply an existing non-group-writable
secret file with `--api-key-file`, or generate directly into a new mode-0600
file with `--api-key-output-file`. In both cases stdout contains metadata only,
never the key:

```bash
npm run managed:bootstrap -- \
  --tenant-id TENANT \
  --tenant-name "Tenant name" \
  --plan team \
  --api-key-output-file /owner-only/path/TENANT-admin.key \
  --service-state stopped
```

Validation requests may add bounded operational labels under `context` so failures can be compared without capturing payloads:

```json
{
  "context": {
    "adapter": "openai_agents",
    "provider": "openai",
    "provider_version": "responses-2026-07",
    "framework": "agents-sdk",
    "framework_version": "1.4",
    "environment": "staging"
  }
}
```

`GET /v1/intelligence` returns tenant failure clusters, latest-schema quality reports, drift-linked recommendations, the tenant compatibility matrix, detailed network clusters that meet the configured tenant threshold, and legacy category signatures. Tool names and argument values are absent. `POST /v1/conformance-runs` accepts a value-free provider/framework/version summary with pass/fail/repair/rejection counts and optional known failure-signature IDs; identical submissions are idempotent.

## Endpoint summary

- `POST /v1/validate`
- `POST /v1/contracts/compile`
- `POST /v1/schemas`
- `POST /v1/schema-releases`
- `GET /v1/schema-releases`, `GET /v1/schema-releases/verify`
- `POST /v1/conformance-runs`
- `PUT /v1/admin/actions/descriptors`
- `POST /v1/actions/challenges`
- `POST /v1/actions/challenges/:id/approve`, `DELETE /v1/actions/challenges/:id`
- `POST /v1/actions/evaluate`
- `POST /v1/actions/idempotency/complete`, `POST /v1/actions/idempotency/release`
- `GET /v1/actions/idempotency/checkpoint`
- `POST /v1/actions/idempotency/checkpoint/compare`
- `GET /v1/actions/idempotency/anchors/deliveries`
- `POST /v1/actions/idempotency/anchors/deliveries/:id/redrive`
- `GET /v1/actions/reconciliation/pending`
- `POST /v1/actions/reconciliation/:reservation_id`
- `GET /v1/actions/reconciliation/history`, `GET /v1/actions/reconciliation/verify`
- `GET /v1/environments`
- `GET /v1/audits`, `GET /v1/audits/verify`
- `GET /v1/intelligence`
- `GET /v1/usage`, `GET /v1/billing/statement`
- `GET /v1/alerts`
- `POST /v1/alert-webhooks`, `GET /v1/alert-webhooks`
- `GET /v1/alert-webhooks/deliveries`
- `POST /v1/alert-webhooks/deliveries/:id/redrive`
- `DELETE /v1/alert-webhooks/:id`
- `GET /v1/rulesets/latest`
- `POST /v1/admin/rulesets`
- `POST /v1/admin/api-keys`, `DELETE /v1/admin/api-keys/:id`
- `POST /v1/admin/environments`, `PUT /v1/admin/environments/:id/policy`
- `PUT /v1/admin/environments/:id/schema-enforcement`
- `PUT /v1/admin/policy`, `PUT /v1/admin/plan`
- `GET /v1/admin/tenant/lifecycle`
- `GET /v1/admin/tenant/export`
- `POST /v1/admin/tenant/deletion-request`
- `GET /v1/admin/control-plane-integrity`
- `POST /v1/admin/retention/purge`
- `GET /healthz`, `GET /readyz`, `GET /dashboard`

## Tenant lifecycle and deletion

An authenticated tenant admin can inspect lifecycle status, download a
value-safe complete export, and request deletion. The request body must contain
`confirm_tenant_id` exactly matching the authenticated tenant. A successful
request moves the tenant to `deletion_pending`; validation and ordinary control
routes then fail with HTTP 423 while lifecycle inspection and export remain
available.

When shared control state is configured, the request synchronizes the local
SQLite projection and shared PostgreSQL lifecycle. It updates local state first
and restores the prior signed local lifecycle if the shared transaction fails.
The offline operator still requires both stores to report `deletion_pending`
before deletion.

Suspension, cancellation, resumption and irreversible deletion are offline
operator actions. Stop every managed-service instance first. Supply the master
secret and optional PostgreSQL URLs through environment variables or
owner-readable secret files, never command-line arguments:

```bash
npm run managed:tenant -- inspect --tenant-id TENANT
npm run managed:tenant -- transition --tenant-id TENANT --status suspended --service-state stopped
npm run managed:tenant -- export --tenant-id TENANT --output /owner-only/path/tenant-export.json --service-state stopped
npm run managed:tenant -- delete --tenant-id TENANT --confirmation-file /owner-only/path/deletion-confirmation.json --service-state stopped
```

The deletion confirmation file must name the exact tenant and current local and,
when configured, shared export hashes. The operator refuses deletion unless
both stores are `deletion_pending`, the hashes still match, and shared control
and action state use the same PostgreSQL pool. Successful deletion removes
tenant-owned managed/shared rows but retains a pseudonymous HMAC-bound receipt.
The independent anchor intentionally retains value-free monotonic checkpoints;
the owner must define the legal retention period for those records.

## Honest external boundary

No payment is collected. A sandbox-only Stripe billing authority is implemented
but is not configured on the deployed staging service and has not been
exercised against a real Stripe test account. A publicly trusted staging
endpoint is deployed at
`api.akriven.com` for production-readiness verification, but it is not approved
for customer data, customer action traffic, or an SLA. The generic alert
transport and dedicated checkpoint-anchor transport are implemented; the
checkpoint receiver is independently deployed and outage-tested, while no
owned customer notification receiver or native email/chat provider is
configured. The deployed billing statement returns
`payment_processing: integration_required`, and checkout, portal, and webhook
routes fail closed. Source-level fake-provider, signed raw-body, SDK/CLI, crash
window, and PostgreSQL reconciliation tests pass; those are not Stripe network
or settlement evidence. See
[`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md).
alerts persist in the database, optional local JSONL file, and transactional
webhook outbox. The current intelligence corpus is composed of
repository fixtures and locally submitted value-free signatures and conformance
summaries; it is not represented as learned production knowledge. Distributed
limits, cloud KMS, database replication, object-storage backups, external
monitoring, live provider fleet probes, multi-instance approval/idempotency
coordination, deployed reconciliation exercises, and multi-region failover require further implementation, a selected provider, and
deployment authorization. See [`SCHEMA_RELEASES.md`](SCHEMA_RELEASES.md) and
[`ALERT_WEBHOOKS.md`](ALERT_WEBHOOKS.md) and
[`CHECKPOINT_ANCHORS.md`](CHECKPOINT_ANCHORS.md).
