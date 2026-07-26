# Private-beta manual billing

## Boundary

The invite-only design-partner offer uses a manual, offline billing procedure.
Akriven does not collect card or bank details, create an online Checkout
session, renew automatically, calculate tax, or initiate an automated charge.
The deployed Stripe boundary remains unconfigured and fail closed.

This procedure is suitable only for the private beta. Public production still
requires the full Stripe sandbox program in
[`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md) before any automated
charging is enabled.

## Commercial policy

- Offer: **Private-beta design partner**, USD 2,250 for a prepaid 90-day term.
- Included use: 250,000 validations per month, 30-day retention, founder-led
  onboarding, and weekly evidence review.
- Overage and automatic renewal are disabled.
- A tenant remains on the internal `trial` entitlement until the operator has
  independently confirmed settlement of the manual invoice.
- Akriven retains only a keyed hash of the external invoice/settlement
  reference in the entitlement receipt. It does not persist invoice contents,
  payer details, payment credentials, or bank/card data.
- A cancellation request immediately stops renewal because none exists. The
  operator preserves the customer export, transitions the tenant to `canceled`
  when action traffic must stop, and revokes the paid entitlement to `trial`.
  Any refund or credit is handled manually under the signed order form; the
  product does not silently calculate or issue one.
- Expiry at the end of the paid term uses the same export, lifecycle, and
  entitlement-revocation procedure.

## Offline entitlement procedure

Stop the managed service before changing a public/shared tenant. Create a
mode-`0600` confirmation file outside source control:

```json
{
  "tenant_id": "customer-tenant",
  "billing_variant": "manual",
  "target_plan": "team",
  "reason_code": "manual_invoice_settled",
  "evidence_reference": "external invoice settlement reference",
  "operator_id": "named operator",
  "automated_charging_disabled": true,
  "confirm": "set tenant customer-tenant plan team"
}
```

Then run:

```bash
npm run managed:tenant -- entitlement \
  --database /root-managed/managed.db \
  --tenant-id customer-tenant \
  --service-state stopped \
  --plan team \
  --confirmation-file /root-managed/manual-entitlement-confirmation.json \
  --receipt-output /root-managed/manual-entitlement-receipt.json
```

When shared PostgreSQL is configured, the command verifies that local and
shared plan, monthly quota, and retention agree; updates the complete
entitlement in both while the service is stopped; and rolls back a partially
observed failure before returning. A plan transition applies the code-owned
quota and retention defaults together: `team` is 250,000 validations and 30
days, while `trial` is 1,000 validations and seven days. It refuses to run when
Stripe configuration is present. The confirmation file must be an owner-only
regular file rather than a symlink. The receipt directory and receipt are also
owner-only, and the receipt contains:

- a tenant HMAC reference rather than the plaintext tenant ID;
- previous and target plans;
- previous and target validation and retention entitlements;
- a bounded reason code;
- keyed hashes of the external evidence reference and named operator;
- an `applied`, `pending`, or `rolled_back` status; and
- a receipt HMAC.

The command never prints the external evidence reference.

After the change:

1. inspect local/shared synchronization with
   `npm run managed:tenant -- inspect ...`;
2. restart the exact admitted managed image;
3. read `GET /v1/billing/statement` and `GET /v1/usage` through the tenant
   boundary;
4. verify `payment_processing` still reports the manual/integration boundary;
5. retain the redacted receipt hash and observed entitlement in the
   owner-only commercial evidence packet.

## Cancellation or expiry

First create and verify a current tenant export. If traffic must stop, use the
existing stopped-service lifecycle command to transition the tenant to
`canceled`. Revoke the paid entitlement with a second owner-only confirmation:

```json
{
  "tenant_id": "customer-tenant",
  "billing_variant": "manual",
  "target_plan": "trial",
  "reason_code": "manual_cancelled",
  "evidence_reference": "external cancellation request reference",
  "operator_id": "named operator",
  "automated_charging_disabled": true,
  "confirm": "set tenant customer-tenant plan trial"
}
```

Use `manual_expired` for normal term expiry and `manual_correction` only to
correct an operator error. Each operation requires a new receipt path; existing
receipts are never overwritten.

## Repeatable production-like drill

Run the provider-independent drill against a disposable or staging PostgreSQL
database whose contents were created under the same audit master key:

```bash
SCHEMA_GUARD_TEST_POSTGRES_URL=postgresql://... \
  npm run audit:manual-billing -- \
  --source-revision <exact-40-character-candidate-sha> \
  --output /owner-only-evidence/manual-billing.json
```

The drill creates a random tenant and credentials in an owner-only temporary
directory, grants the complete paid entitlement through the real offline
operator command, verifies local/shared synchronization, reads usage and
billing statements through an HTTP server, confirms Checkout and Portal remain
fail closed, exports the tenant, cancels its lifecycle, revokes the entitlement,
verifies both HMAC receipts, and deletes the disposable audit tenant from local
and shared state after a final confirmed export. It removes the temporary
credentials, writes a redacted owner-only report, and never emits the generated
API key or master secret.

The database must be isolated for the drill. Pointing a different master key at
an existing control plane is expected to fail integrity verification and must
not be worked around by weakening or deleting retained state.

## Interrupted-operation recovery

The command creates an authenticated `pending` receipt before changing either
state store. If the process is interrupted, keep the managed service stopped
and retain that file. Do not edit either database or create an unauthenticated
replacement receipt.

After confirming that the original confirmation file and pending receipt are
owner-only, rerun the same authorization with:

```bash
npm run managed:tenant -- entitlement-reconcile \
  --database /root-managed/managed.db \
  --tenant-id customer-tenant \
  --service-state stopped \
  --plan team \
  --confirmation-file /root-managed/manual-entitlement-confirmation.json \
  --receipt-output /root-managed/manual-entitlement-receipt.json
```

Recovery verifies the receipt HMAC, tenant reference, target entitlement,
reason, evidence reference hash, operator hash, and original timestamp before
forcing both state stores to the authorized target. It then verifies plan,
quota, and retention in both stores and finalizes the same receipt as
`applied` with `recovered: true`. Any verification or database failure leaves
the service stopped and the pending receipt intact.

## Non-claims

This workflow proves controlled entitlement administration and absence of
automated charging. It does not prove payment settlement, tax treatment,
refund legality, invoice delivery, accounting reconciliation, or customer
willingness to pay. Those remain external business evidence.
