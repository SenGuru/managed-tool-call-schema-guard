# External provider selection and certification plan

This document records the recommended first-cohort providers and the exact
evidence required before an external integration can change the production
readiness verdict. Provider configuration is not implementation or runtime
proof. Secret values must be written directly into owner-only files or a secret
manager; they must never be pasted into chat, committed, printed, or placed in
process arguments.

## Recommended stack

| Capability                                                   | Recommendation                                                                                                              | Why it fits Akriven                                                                                                                                                                                                                                  | Launch boundary                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2B identity, organizations, MFA, invitations and future SSO | [WorkOS AuthKit and RBAC](https://workos.com/docs/authkit/overview)                                                         | Organizations are first-class, membership is organization-scoped, and hosted authentication supports MFA, social login, passwords and magic authentication. RBAC can later map organization roles and IdP groups.                                    | Staging account/configuration is complete; public-TLS session, MFA/recovery, revocation and isolation certification remain required before self-service or multi-user access. |
| Subscription billing                                         | [Stripe Billing](https://docs.stripe.com/billing/testing)                                                                   | The repository already implements sandbox-only Checkout, Customer Portal, signed raw-body webhooks, provider-current reconciliation and fail-closed entitlement state. Stripe test clocks cover renewal, failure, trial and plan-change time travel. | Required before automated charging. Keep manual invoicing only until the sandbox program passes.                                                                              |
| Transactional email                                          | [Postmark](https://postmarkapp.com/developer/)                                                                              | Transactional message streams fit verification, invitation, recovery, security and billing mail. Delivery and bounce webhooks are available with documented retries.                                                                                 | Required before email verification, invitations, recovery or automated billing notices are claimed.                                                                           |
| External uptime, heartbeat and on-call escalation            | [Better Stack Uptime](https://betterstack.com/docs/uptime/working-with-incidents/)                                          | HTTPS monitors, scheduled-job heartbeats, incidents, on-call schedules and escalation policies cover the currently missing independent paging boundary.                                                                                              | Required before customer mutation traffic or an availability/SLO claim.                                                                                                       |
| Production secret custody                                    | [1Password service accounts and CLI](https://developer.1password.com/docs/cli/secrets-scripts)                              | Vault-scoped service accounts support least-privilege retrieval and can render existing file-based Docker secrets without putting values in source control.                                                                                          | Required before live payment, identity, email or monitoring credentials are installed.                                                                                        |
| Immutable off-machine backup target                          | [Backblaze B2 with Object Lock](https://www.backblaze.com/docs/cloud-storage-enable-object-lock-with-the-s3-compatible-api) | S3-compatible storage, bucket-scoped application keys and Object Lock add an independently administered WORM copy beyond the current cross-host daily backup.                                                                                        | Required before stronger ransomware/immutability claims; daily RPO remains the currently accepted recovery boundary.                                                          |
| Application exception diagnostics                            | [Sentry for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/)                                              | Captures deployed exceptions and release regressions independently from host-local logs. Configure aggressive event scrubbing and disable request bodies, local variables and raw tool arguments.                                                    | Recommended before private beta; not a substitute for uptime/on-call delivery.                                                                                                |

Do not add another general-purpose platform unless one of these providers fails
the sandbox certification. Keeping one provider per boundary reduces secret,
webhook and incident-response complexity.

## Ordered activation sequence

The provider-independent product and purchased-host staging drills are complete
for the prior API-key cohort boundary. The repository now also contains a
fail-closed WorkOS-compatible human-session boundary and a Postmark
send/webhook boundary backed by an encrypted, leased, retry-bounded durable
notification outbox. These are deterministic local and PostgreSQL evidence,
not live-provider proof. Use this order for the remaining account work:

1. Create the 1Password production vault and vault-scoped service account.
   Prove a clean operator session can render owner-only files after reboot.
2. Configure Better Stack public API/anchor monitors, backup heartbeats, an
   actual on-call contact and an escalation policy. Trigger and acknowledge one
   service incident and one missed-heartbeat incident.
3. Obtain the first design partner's owned HTTPS webhook receiver and
   downstream side-effect ledger, plus sandbox credentials for only the exact
   model/provider versions that partner will use. Run the customer-bound
   callback and five-trial provider gates.
4. Complete independent security review, legal/privacy retention approval,
   vulnerability-disclosure routing, and named incident/support ownership.
   These four steps gate action-mutating private-beta traffic.
5. Finish certification of the deployed WorkOS staging environment against the
   implemented organization/role/session boundary: verified-email
   callback/session/logout, invitation, MFA/recovery, membership removal,
   provider revocation and cross-organization isolation. The real public login
   redirect and secure state cookie are already observed.
6. Configure Postmark only after the identity flows define their verification,
   invitation, recovery and security-message requirements. Exercise the
   implemented durable outbox through real inbox delivery, bounce,
   duplicate/reordering, outage, dead-letter and redrive before Akriven-owned
   mandatory messages are a launch claim.
7. Rotate the previously exposed Stripe test credential in the Stripe console,
   store the replacement only through 1Password-rendered owner-only files, and
   run the complete test-mode lifecycle. Do not enable live mode.
8. Add Backblaze B2 Object Lock after legal approves retention. The current
   encrypted cross-host daily backup/clean-restore boundary is already proven;
   B2 adds independent WORM/ransomware resistance.
9. Add privacy-scrubbed Sentry diagnostics before expanding the cohort. It is
   recommended, not a substitute for Better Stack paging.

Only non-secret identifiers such as callback URLs, provider environment names,
price IDs and selected model versions belong in the evidence record. Do not
paste keys, tokens, heartbeat URLs, webhook secrets, session cookies or
recovery identities into chat.

## Owner-console actions

These actions must be completed in the provider consoles. Values are secret
unless explicitly described as identifiers.

1. **WorkOS**
   - Staging is configured with hosted AuthKit, strong breached-password
     rejection, passkeys, Magic Auth, required MFA, reviewed callback/logout
     URLs, the `akriven.com` domain, an exact organization-to-tenant mapping and
     an `owner` membership.
   - The replacement staging key and supporting identity secrets are stored in
     owner-only files outside source control. The default key exposed on the
     initial quick-start screen was expired and is not used.
   - Before cohort expansion, define and exercise the remaining `admin`,
     `operator`, `auditor`, and `billing` memberships, invitation and recovery
     flows, revocation, organization switching and BOLA isolation.
   - Create a separate production environment only after staging
     certification. Do not reuse staging credentials.
2. **Stripe sandbox**
   - Create a test-only recurring price for lifecycle certification and record
     only its non-secret `price_...` identifier for configuration. This is not
     the manually contracted 90-day private-beta offer and must not be exposed
     to customers.
   - Register
     `https://api.akriven.com/v1/billing/stripe/webhook` for the reviewed event
     set in `BILLING_STRIPE_SANDBOX.md`.
   - Put the sandbox restricted/secret API key and webhook signing secret
     directly into owner-only files. Stripe documents that webhook secrets are
     separate from API keys and that secret keys belong only in a server-side
     vault.
3. **Postmark**
   - Verify the sending domain, establish SPF/DKIM/DMARC, and create a
     transactional message stream.
   - Put the server token into the secret manager.
   - Protect delivery/bounce callbacks with a unique credential and provider
     IP allowlist. Postmark does not currently provide HMAC webhook signatures,
     so callbacks must be treated as advisory until their payload, recipient
     binding and `MessageID` idempotency are verified.
4. **Better Stack**
   - Create public API readiness and independent anchor monitors.
   - Create heartbeats for main backup, backup ingestion, restore-verification
     cadence and certificate renewal.
   - Configure an actual on-call contact, escalation path and test incident.
   - Store heartbeat URLs as secrets; they authorize submissions.
5. **1Password**
   - Create a dedicated production vault and vault-scoped service account.
   - Grant read access only to the deployment secret set.
   - Exercise retrieval after reboot from a clean operator session and retain
     only redacted evidence.
6. **Backblaze B2**
   - Create a dedicated backup bucket with Object Lock before uploading
     production backups.
   - Create separate write-only backup and read/restore application keys,
     restricted to that bucket and prefix.
   - Approve the retention duration with legal counsel before compliance mode
     is enabled because compliance retention cannot be shortened.

## Stripe configuration already implemented

The reviewed overlay is `deploy/docker-compose.stripe-sandbox.yml`. It expects:

```text
SCHEMA_GUARD_STRIPE_MODE=sandbox
SCHEMA_GUARD_STRIPE_SECRET_KEY_FILE=/owner-only/path/stripe-secret-key
SCHEMA_GUARD_STRIPE_WEBHOOK_SECRET_FILE=/owner-only/path/stripe-webhook-secret
SCHEMA_GUARD_STRIPE_TEAM_PRICE_ID=price_...
SCHEMA_GUARD_STRIPE_CHECKOUT_SUCCESS_URL=https://.../account/billing/success
SCHEMA_GUARD_STRIPE_CHECKOUT_CANCEL_URL=https://.../account/billing
SCHEMA_GUARD_STRIPE_PORTAL_RETURN_URL=https://.../account/billing
```

Only the price ID and HTTPS URLs are non-secret. The two secret files must be
regular owner-only files. Do not enable the overlay with partial configuration:
startup and billing traffic are intentionally fail closed.

## Certification gates

### Identity

- Hosted signup, login, logout, refresh and organization switching work through
  the public TLS boundary.
- Invitations, membership removal and every role are verified against a
  second organization, including BOLA/IDOR negative cases.
- MFA enrollment/recovery, session revocation, expired callbacks, state/nonce
  replay, key rotation and provider outage fail closed.
- WorkOS identity is bound server-side to the existing tenant ID; client claims
  alone never select a tenant.

### Billing

- Browser Checkout and Customer Portal use a real Stripe sandbox session.
- Raw-body signature verification rejects mutation, old timestamps, wrong
  endpoint secrets and replay/conflict cases.
- Test clocks exercise activation, renewal, failed payment, recovery,
  cancellation, replacement subscription, upgrade/downgrade and event
  reordering.
- Provider-current reconciliation is compared with persisted entitlement after
  every simulated transition.
- No live-mode key, charge or customer is used. Stripe recommends test clocks
  for subscription lifecycle simulations and a non-zero webhook timestamp
  tolerance.

### Email

- Verified sender/domain delivery is observed at external test inboxes.
- Verification, invitation, recovery, security-change and billing templates
  contain no API keys, raw tool arguments or internal hashes.
- Bounce, delivery, duplicate, reordering and retry behavior is durable and
  idempotent by provider `MessageID`.
- Provider outage queues rather than dropping mandatory security messages.

### Monitoring and backup

- Public API, anchor and backup-heartbeat alerts reach the owner through an
  independently operated channel.
- Acknowledgement and escalation are timed in a runbook drill.
- A missed backup heartbeat and a simulated service outage both create and
  resolve incidents.
- A clean host restores an Object-Locked backup, compares audit and anchor
  checkpoints, measures RPO/RTO, and removes all plaintext drill material.

Observed on 2026-07-25:

- Better Stack free-plan account and public readiness monitor: configured;
  `https://api.akriven.com/readyz` observed **Up**.
- Main and anchor daily backup heartbeats: configured through root-owned
  `0600` URL files; both real backup jobs delivered an **Up** heartbeat.
- Controlled heartbeat failure: external incident and owner email observed;
  healthy recovery recorded after 23 seconds.
- A fresh read-only provider-console check found the readiness monitor and both
  daily backup heartbeats `Up`. It also confirmed that the account has no
  on-call schedule and no escalation policy; Better Stack requires an account
  upgrade for scheduled on-call duties and still needs at least one additional
  independently owned responder before acknowledgement/escalation can be
  proven.
- Second responder, explicit acknowledgement drill, and multi-channel
  escalation: blocked on an additional responder and paid notification route.
- 1Password Teams registration and email verification: reached the
  owner-controlled master-password/Secret-Key step. Vault activation is blocked
  until the owner chooses the master password and retains the Emergency Kit.
- WorkOS Google signup verification completed. The Akriven staging project,
  application, hardened authentication settings, mapped organization, complete
  role set and owner membership are configured and deployed. The real public
  login redirect and secure state cookie are observed; callback/session,
  MFA/recovery and revocation certification remain pending.
- Sentry signup remains blocked at Google's device-verification boundary; no
  Sentry project, data region or irreversible retention choice was created.
- Postmark, Stripe, Backblaze and live model credentials: not configured.
  Stripe live mode, customer-facing DNS, Backblaze Object Lock and any paid
  commitment remain deliberately untouched.

## Evidence handling

Retain timestamps, provider event IDs, HTTP statuses, pseudonymous tenant
references, checkpoint hashes, test-clock IDs and screenshots that contain no
credentials. Do not retain API keys, webhook secrets, session cookies, bearer
tokens, payment data, private email content or raw tool arguments in reports.

Passing every gate above is required before changing an integration from
`configured only` or `locally proven` to `production-like external evidence`.
