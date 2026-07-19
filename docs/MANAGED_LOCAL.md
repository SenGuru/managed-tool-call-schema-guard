# Managed local control plane

The managed package is an operational local proof of the private product boundary. It is not deployed infrastructure.

## Implemented behavior

- Tenant API keys are verified through master-secret HMACs; plaintext keys are shown only once and are not persisted.
- Scoped keys can be issued and revoked. The active key cannot revoke itself.
- Organization policy is stored server-side and merged so caller policy can only narrow it.
- SQLite uses foreign keys, WAL, busy timeout, migrations, integrity checks, and online backup.
- Validation quota use and audit insertion commit atomically. Audit events contain the value-free core envelope and form a per-tenant HMAC-signed hash chain; verification also checks indexed columns against the envelope. Retention is tenant-scoped and preserves a checkpoint anchor so the surviving chain remains verifiable.
- Tool schemas are registered per tenant. Structural drift produces privacy-safe signatures and local alerts.
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

## Endpoint summary

- `POST /v1/validate`
- `POST /v1/schemas`
- `GET /v1/audits`, `GET /v1/audits/verify`
- `GET /v1/intelligence`
- `GET /v1/usage`, `GET /v1/billing/statement`
- `GET /v1/alerts`
- `GET /v1/rulesets/latest`
- `POST /v1/admin/rulesets`
- `POST /v1/admin/api-keys`, `DELETE /v1/admin/api-keys/:id`
- `PUT /v1/admin/policy`, `PUT /v1/admin/plan`
- `POST /v1/admin/retention/purge`
- `GET /healthz`, `GET /readyz`, `GET /dashboard`

## Honest external boundary

No payment is collected, no public endpoint or TLS certificate is provisioned, and no email/chat webhook is contacted. The billing statement returns `payment_processing: integration_required`; alerts persist in the database and optional local JSONL file. Distributed limits, cloud KMS, database replication, object-storage backups, external monitoring, and multi-region failover require a selected provider and deployment authorization.
