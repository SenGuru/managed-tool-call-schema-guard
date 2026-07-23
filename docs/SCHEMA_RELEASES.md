# Environment schema releases

The managed registry can turn a reviewed schema version into an enforceable
environment release. This closes the gap between observing drift and actually
preventing an agent or integration from presenting an unapproved schema at the
tool-execution checkpoint.

## Safe rollout

Every environment starts in `observe` mode, so upgrading an existing database
does not unexpectedly stop traffic.

1. Register the candidate with `POST /v1/schemas` and retain the returned
   `schema_hash`.
2. Promote that exact version and hash with a `promote:schema` key:

```http
POST /v1/schema-releases
Authorization: Bearer <promoter-key>
Content-Type: application/json

{
  "tool_name": "search",
  "version": "2026-07-20.1",
  "environment": "production",
  "expected_schema_hash": "sha256:..."
}
```

3. Review `GET /v1/schema-releases/verify` and the environment-filtered release
   list with a `read:environment` key. A promoter that must perform this review
   needs both `promote:schema` and `read:environment`; the read routes do not
   grant promotion authority.
4. Change the environment to enforcement mode:

```http
PUT /v1/admin/environments/<environment-id>/schema-enforcement
Authorization: Bearer <promoter-key>
Content-Type: application/json

{ "mode": "enforce" }
```

5. Send a known-good call using the exact promoted schema before enabling real
   agent traffic.

## Promotion and runtime rules

- Promotion binds tenant, tool-name HMAC, environment, registry row, schema
  hash, adapter, version, compatibility result, promoter-key HMAC, evidence HMAC,
  time, and previous release hash.
- Repeating the same target/version promotion is idempotent.
- A breaking candidate is blocked unless `allow_breaking: true` and a non-empty
  `evidence_reference` are supplied. Only a tenant-keyed HMAC of that reference
  is persisted.
- Release records form an append-only tenant HMAC chain. Verification also
  recomputes the registered schema body hash and checks its tenant, tool,
  adapter, and version bindings.
- In `enforce` mode, no release or a different submitted schema hash produces a
  standard `rejected` decision with `POLICY_DENIED`; `valid_arguments` is absent,
  so SDK execution remains fail closed.
- If the active release or its registry source fails integrity verification,
  runtime admission rejects rather than trusting it.
- Returning an environment to `observe` is an explicit privileged change and
  emits a critical alert.

Schema releases govern the schema presented to Schema Guard. They do not deploy
tool code, grant downstream authorization, or prove that a provider honors its
declaration; those remain separate release and live-conformance responsibilities.
