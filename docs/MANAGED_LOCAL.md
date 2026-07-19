# Managed local control plane

The managed package is an operational local proof of the private product boundary and team workflow. It is not deployed infrastructure.

## Why this layer exists

The open engine answers one call correctly. The managed product helps a team understand and govern thousands of calls across people, environments, providers, frameworks, and schema versions. Its durable value is not another validation endpoint; it is the accumulated compatibility evidence and operational record around that endpoint.

The local package demonstrates the product spine: shared policy, schema history, persistent value-free failure clusters, explainable schema-quality scores, evidence-linked recommendations, provider/framework/version conformance matrices, privacy-thresholded aggregate intelligence, verifiable audit history, alerts, signed rulesets, usage controls, and an operator dashboard. The repository also runs a deterministic offline conformance gate on every release check and includes a daily CI workflow. A production service still needs real provider-version fleet probes, environment promotion, external notifications, and reliable hosted operation. Those items must not be inferred from this local build.

## Implemented behavior

- Tenant API keys are verified through master-secret HMACs; plaintext keys are shown only once and are not persisted.
- Scoped keys can be issued and revoked. The active key cannot revoke itself.
- Organization policy is stored server-side and merged so caller policy can only narrow it.
- SQLite uses foreign keys, WAL, busy timeout, migrations, integrity checks, and online backup. Database, WAL, SHM, alert, and backup files default to owner-only permissions.
- Validation quota use and audit insertion commit atomically. Audit events contain the value-free core envelope and form a per-tenant HMAC-signed hash chain; verification also checks indexed columns against the envelope. Retention is tenant-scoped and preserves a checkpoint anchor so the surviving chain remains verifiable.
- Tool schemas are registered per tenant. Structural drift produces privacy-safe signatures and local alerts.
- Repair and rejection observations become tenant-isolated, value-free clusters keyed by adapter, provider, framework, generalized issue shape, reason, and repair rule. Provider versions are retained as metadata, never argument values.
- Latest registered schemas receive deterministic, explainable quality scores. Breaking drift, weak schemas, and recurring failure clusters produce advisory recommended actions.
- Versioned conformance summaries can be ingested idempotently and are aggregated into provider/framework compatibility matrices.
- Aggregate compatibility intelligence is released only when a signature appears in at least three distinct tenants by default. Results contain no tenant identifiers.
- Rulesets are tenant-scoped and use an Ed25519 signing key. The private key is encrypted at rest with AES-256-GCM under the master secret; embedded public keys must match the authenticated local trust record, and expired rulesets are not served.
- Trial/team plans, monthly quotas, fixed-window per-key limits, usage statements, JSON/CSV audit export, local-file alerts, liveness/readiness, request size/deadline controls, graceful shutdown, and a tenant dashboard are operational.

## Bootstrap and run

```bash
export SCHEMA_GUARD_DATABASE="$PWD/work/managed.db"
export SCHEMA_GUARD_MASTER_SECRET="replace-with-a-random-secret-at-least-32-characters"
npm run managed:bootstrap -- --tenant-id demo --tenant-name "Demo tenant" --plan trial
npm run managed
```

Keep the master secret and one bootstrap admin key in a secret manager in any non-local environment. Losing the master secret makes stored API-key verifiers unusable and the encrypted ruleset signing key unrecoverable.

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
- `POST /v1/schemas`
- `POST /v1/conformance-runs`
- `GET /v1/environments`
- `GET /v1/audits`, `GET /v1/audits/verify`
- `GET /v1/intelligence`
- `GET /v1/usage`, `GET /v1/billing/statement`
- `GET /v1/alerts`
- `GET /v1/rulesets/latest`
- `POST /v1/admin/rulesets`
- `POST /v1/admin/api-keys`, `DELETE /v1/admin/api-keys/:id`
- `POST /v1/admin/environments`, `PUT /v1/admin/environments/:id/policy`
- `PUT /v1/admin/policy`, `PUT /v1/admin/plan`
- `POST /v1/admin/retention/purge`
- `GET /healthz`, `GET /readyz`, `GET /dashboard`

## Honest external boundary

No payment is collected, no public endpoint or TLS certificate is provisioned, and no email/chat webhook is contacted. The billing statement returns `payment_processing: integration_required`; alerts persist in the database and optional local JSONL file. The current intelligence corpus is composed of repository fixtures and locally submitted value-free signatures and conformance summaries; it is not represented as learned production knowledge. Distributed limits, cloud KMS, database replication, object-storage backups, external monitoring, live provider fleet probes, and multi-region failover require further implementation, a selected provider, and deployment authorization.
