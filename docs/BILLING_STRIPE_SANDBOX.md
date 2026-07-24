# Stripe sandbox billing authority

## Status

The managed service contains a sandbox-only Stripe Billing integration. It
implements Checkout, Customer Portal, signed raw-body webhooks, durable
PostgreSQL event state, provider-current subscription reconciliation, and
fail-closed entitlement updates.

This is implementation and deterministic test evidence, not proof of a real
Stripe account. No Stripe account credential, product, price, Checkout page,
Customer Portal, test clock, tax configuration, refund, or settlement has been
exercised as of 2026-07-24. Automated charging must remain disabled until the
external sandbox program below passes.

Live Stripe keys are deliberately rejected. The only accepted mode is
`sandbox`, and the provider constructor requires an `sk_test_` key.

## Deployment configuration

Use [`../deploy/docker-compose.stripe-sandbox.yml`](../deploy/docker-compose.stripe-sandbox.yml)
as an additional Compose overlay. Store the Stripe secret key and webhook
signing secret in root-managed files outside the repository. Do not place them
in shell history, Compose YAML, chat, logs, or source control.

Required non-secret configuration:

```bash
SCHEMA_GUARD_STRIPE_TEAM_PRICE_ID=price_...
SCHEMA_GUARD_STRIPE_CHECKOUT_SUCCESS_URL=https://.../account/billing/success
SCHEMA_GUARD_STRIPE_CHECKOUT_CANCEL_URL=https://.../account/billing
SCHEMA_GUARD_STRIPE_PORTAL_RETURN_URL=https://.../account/billing
```

Required secret-file locations:

```bash
SCHEMA_GUARD_STRIPE_SECRET_KEY_FILE=/root-managed/path/stripe-secret-key
SCHEMA_GUARD_STRIPE_WEBHOOK_SECRET_FILE=/root-managed/path/stripe-webhook-secret
```

The managed service requires all Stripe fields together, shared PostgreSQL
control state, HTTPS return URLs, and `SCHEMA_GUARD_STRIPE_MODE=sandbox`.
Partial configuration fails startup. Without the overlay, checkout, portal, and
webhook routes return `billing_integration_required`.

The public webhook destination is:

```text
POST https://<managed-host>/v1/billing/stripe/webhook
```

The endpoint is intentionally unauthenticated by Akriven API key because Stripe
is the caller. It requires a bounded `Stripe-Signature` header and verifies the
exact raw request bytes before parsing.

## Entitlement semantics

- `active` or `trialing` on the exact configured Team price grants the `team`
  plan.
- Every other known subscription status or price grants `trial`.
- Checkout session IDs bind a Stripe subscription to a tenant. Tenant IDs are
  sent to Stripe only as a pseudonymous HMAC reference.
- Subscription and invoice events trigger a fresh Stripe subscription
  retrieval. Event timestamps do not override provider-current state.
- Duplicate event IDs with the same signed payload are idempotent. A reused
  event ID with different content fails integrity verification.
- Events that arrive before a trusted checkout/subscription binding are
  retained as pending and return `503` so Stripe retries.
- A replacement subscription may supersede the same tenant's canceled
  subscription. A subscription or customer already bound to another tenant is
  rejected.
- Entitlement update and event acknowledgement use a retained `ready` state.
  If the process fails between them, tenant traffic returns
  `billing_reconciliation_pending` until a retry completes the event.
- Readiness fails while any billing event is in the `ready` crash window.
- Billing checkout, subscription, and event rows are HMAC-bound, included in
  tenant export, covered by control-plane integrity, and removed by tenant
  deletion.

The billing statement reports subscription state and entitlement. It does not
yet calculate invoices, taxes, credits, refunds, or amounts due.

## Implemented interfaces

- `POST /v1/billing/checkout-session` (`admin`)
- `POST /v1/billing/portal-session` (`admin`)
- `POST /v1/billing/stripe/webhook` (Stripe signature)
- `GET /v1/billing/statement` (`read:billing`)
- TypeScript SDK checkout and portal methods
- CLI `managed-billing-checkout` and `managed-billing-portal`
- Dashboard workbench presets for checkout and portal

The CLI requires `--out` and creates a new mode-0600 file. It prints only the
destination metadata, not the returned Stripe URL.

## Observed deterministic evidence

On 2026-07-24:

- focused managed billing/API/SDK/CLI/lifecycle tests: 46/46 passed;
- signed raw-body tests rejected altered and stale requests and normalized
  subscription and invoice payment events;
- disposable PostgreSQL 16 shared-state suite: 16/16 passed, including
  reordering, duplicate/conflicting replay, replacement subscription,
  cross-tenant binding rejection, export, and tamper detection;
- credentialed full suite: 207/207 passed;
- coverage: 79.40% statements, 73.44% branches, 80.29% functions, and 81.24%
  lines; `shared-state/src/billing.ts` reached 82.97% statement coverage;
- production-container E2E passed with Stripe absent and verified checkout,
  portal, and webhook remain fail closed; and
- `npm run audit:extreme` passed with the same disabled-boundary checks; and
- the in-app browser loaded the source dashboard's 29 presets and executed both
  billing presets with explicit mutation confirmation; each returned
  `501 billing_integration_required` while the billing panel remained at the
  integration boundary; and
- the exact scanned amd64 r7 image was deployed after the r6 pre-migration
  backup and clean r6→r5 rollback drill. Public readiness/dashboard returned
  200, the public browser executed all 29 presets, and Checkout, Portal, plan
  mutation, and the unconfigured webhook returned 501. No Stripe overlay or
  credential was enabled.

Fake providers and locally generated Stripe signatures are contract evidence.
They are not Stripe network, settlement, or browser evidence.

## Required external sandbox program

Before automated charging:

1. Create a Stripe test product and recurring Team price.
2. Configure a test Customer Portal and the signed webhook endpoint.
3. Load test credentials directly into protected host secret files.
4. Deploy the exact scanned image with the sandbox Compose overlay.
5. From an external browser, complete Checkout with Stripe test data and verify
   the tenant changes from `trial` to `team`.
6. Open Customer Portal and exercise cancellation at period end.
7. Use Stripe test clocks to exercise trial, renewal, failed payment,
   recovery, cancellation, and subscription replacement.
8. Deliver duplicate, delayed, reordered, malformed, stale, and forged events.
   Confirm provider-current reconciliation, idempotency, retry behavior, and
   tenant isolation.
9. Stop Stripe/network access during reconciliation. Confirm `503`, retained
   event state, readiness failure where applicable, and recovery after retry.
10. Verify billing rows survive application/PostgreSQL restart, are present in
    export, pass integrity checks, and are removed by a disposable tenant
    deletion.
11. Exercise the flow through the real public TLS and browser boundaries.
12. Decide and implement tax, refund/credit, invoice-statement, dunning,
    cancellation-effective-date, and customer-support policy.

Retain redacted event IDs, timestamps, response statuses, entitlement
transitions, test-clock scenarios, and exact image revision. Do not retain or
publish credentials, full webhook bodies, customer data, or payment details.
