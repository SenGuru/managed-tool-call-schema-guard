# Human identity and transactional email boundaries

This document separates provider-independent implementation from live-provider
evidence. Neither an installed SDK nor a deterministic fake-provider contract
is proof that a WorkOS or Postmark account, domain, message, recovery flow, or
customer session works.

## Human identity

The managed service implements a WorkOS AuthKit-compatible server boundary in
`packages/managed/src/identity.ts` and `packages/managed/src/server.ts`:

- authorization-code login with a ten-minute HMAC-authenticated state value;
- separate `Secure`, `HttpOnly`, `SameSite=Lax`, host-only state and session
  cookies;
- immediate callback-session verification and exact WorkOS
  organization-to-existing-tenant mapping;
- verified-email, non-impersonated session requirements;
- fail-closed roles `owner`, `admin`, `operator`, `auditor`, and `billing`;
- server-derived managed scopes; WorkOS permission strings never grant managed
  API authority directly;
- privacy-safe HMAC-derived human principal IDs instead of stored/logged raw
  WorkOS user or session IDs;
- same-origin enforcement for every browser-session mutation;
- refresh and provider logout flows;
- dashboard session discovery while preserving scoped bearer keys for SDK,
  CLI, automation, and recovery operations.

The provider configuration is all-or-none:

```text
SCHEMA_GUARD_WORKOS_API_KEY_FILE=/run/secrets/workos-api-key
SCHEMA_GUARD_WORKOS_CLIENT_ID=client_...
SCHEMA_GUARD_WORKOS_COOKIE_PASSWORD_FILE=/run/secrets/workos-cookie-password
SCHEMA_GUARD_WORKOS_REDIRECT_URI=https://api.example/v1/auth/callback
SCHEMA_GUARD_WORKOS_LOGOUT_RETURN_URL=https://api.example/
SCHEMA_GUARD_WORKOS_ORGANIZATION_TENANT_MAP_FILE=/run/secrets/workos-organization-tenant-map
```

The mapping file is a JSON object whose keys are non-secret WorkOS organization
IDs and whose values are existing managed tenant IDs. It is owner-controlled
configuration because it grants tenant authority. Redirect and logout URLs
must share the configured `SCHEMA_GUARD_EXTERNAL_URL` origin.

Deterministic tests cover valid sessions, least-privilege role mapping,
unverified email, unsupported roles, impersonation, unmapped organizations,
tenant substitution, callback mutation/expiry, invalid cookies, CSRF, refresh,
logout, and provider outage.

On 2026-07-26, a real WorkOS staging project and application were configured
with the Akriven callback/logout URLs, strong breached-password rejection,
passkeys, Magic Auth and required MFA. The `Akriven Internal Staging`
organization is mapped to the existing `staging-owner` tenant, and its owner
membership has the exact `owner` role consumed by the fail-closed role mapper.
The replacement provider key, cookie password, generated staging-user password
and authorization map are held in owner-only files outside the repository.
This is **configured external evidence**, not a completed session
certification: verified-email login, MFA enrollment/recovery, invitation,
membership removal, provider-side revocation, organization switching and the
public-TLS callback/session/logout path still require the exact application
revision to be deployed and exercised.

## Transactional email

`packages/managed/src/email.ts` implements a provider-neutral transactional
email contract and Postmark adapter:

- allowlisted notification kinds and reviewed template aliases;
- one exact recipient per message;
- bounded JSON-safe template models;
- a transactional message stream with privacy-safe idempotency metadata;
- normalized acknowledgements that retain a recipient hash rather than the raw
  address;
- delivery and bounce webhook normalization;
- constant-time Basic Authentication verification for callbacks;
- bounded webhook bodies, deterministic event IDs, and exclusion of raw SMTP
  details, message bodies, and untrusted provider metadata.

Postmark does not provide an HMAC webhook signature. Production callback
ingress must combine a unique Basic Authentication credential, provider IP
allowlisting, TLS, recipient binding, and durable `MessageID`/event-id
deduplication.

The adapter, parser, and durable application notification outbox have
deterministic contract, adversarial, SQLite, PostgreSQL, HTTP, dashboard, SDK,
and CLI tests. The outbox encrypts recipient/template payloads, exposes only
privacy-safe hashes and delivery metadata, leases concurrent workers, applies
bounded retry/dead-letter behavior, supports explicit redrive, and binds
authenticated provider receipts to exact message and recipient hashes.

There is not yet a live Postmark account/domain/template set. External inbox
delivery, bounce, provider-side duplicate/reordering behavior, provider outage,
and callback IP allowlisting therefore remain **blocked external/integration
evidence**, not mocked success. WorkOS may own its hosted
verification/invitation/recovery messages; Akriven-owned mandatory messages
must use this durable outbox after the provider templates are reviewed.
