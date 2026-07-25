# Private-beta pricing, entitlements, and unit economics

## Decision

Launch one invite-only paid offer:

| Offer                       |  Price | Term            |            Included usage | Retention | Delivery                                          |
| --------------------------- | -----: | --------------- | ------------------------: | --------: | ------------------------------------------------- |
| Private-beta design partner | $2,250 | 90 days prepaid | 250,000 validations/month |   30 days | Founder-led onboarding and weekly evidence review |

There is no online checkout, automatic renewal, overage billing, or public
self-service enrollment. The internal plan identifier remains `team` to avoid a
cosmetic data migration; every customer-facing surface calls it
**Private-beta design partner**.

The `trial` plan is an internal evaluation entitlement: 1,000 validations per
month, seven-day retention, no service commitment, and not for sale.

## Why one paid offer

The current evidence proves a robust product and production-like network path.
It does not prove willingness to pay, retention, CAC, or which lower-touch tier
buyers prefer. Publishing Team, Business, and Enterprise tiers now would turn
spreadsheet assumptions into product claims.

The design-partner offer is deliberately high-touch. Its job is to produce
three forms of evidence before broader packaging:

1. a real incident that the OSS checkpoint alone does not resolve;
2. repeatable onboarding and less than two founder support hours per
   account/month by the end of the cohort;
3. at least one renewal or expansion decision based on observed value.

## Entitlement behavior

The catalog is code-owned in `packages/managed/src/plans.ts` and returned by
`GET /v1/plans`. Authenticated usage and billing statements return the same
plan name, included validation limit, retention, overage policy, and offer
shape.

- Monthly validation quota is enforced transactionally in SQLite or PostgreSQL.
- Retention is an enforced tenant setting and defaults from the plan at
  bootstrap.
- Overage is disabled; the service fails closed at quota instead of creating an
  unpriced liability.
- The private-beta offer includes the complete implemented managed workflow.
  There are no unimplemented feature gates disguised as entitlements.
- Payment collection remains disabled until a real provider sandbox and its
  failure cases are exercised.

## Unit-economics model

These are planning assumptions, not observed customer economics. They come from
the existing 12-month model and must be replaced with invoices, actual provider
bills, time tracking, and cohort data.

| Assumption                |         Planning value | Evidence status                                     |
| ------------------------- | ---------------------: | --------------------------------------------------- |
| Recognized MRR equivalent |                   $750 | Arithmetic from $2,250 / 3 months                   |
| Collection yield          |                    98% | Assumption                                          |
| Payment fees              | 3.7% of cash collected | Assumption; provider/geography unverified           |
| Variable delivery cost    |   3% of recognized MRR | Assumption                                          |
| Base fixed infrastructure |             $300/month | Budget assumption, not reconciled provider invoices |
| Base admin/tooling        |             $750/month | Budget assumption                                   |
| Founder compensation      |                     $0 | Planning decision; excludes economic labor cost     |

Per active design partner, the planning contribution before fixed cost and
founder labor is:

```text
$750.00 recognized MRR
-$15.00 collection loss (2%)
-$27.75 payment fees (3.7%)
-$22.50 variable delivery (3%)
= $684.75 monthly contribution
```

That is a 91.3% planning contribution margin before fixed infrastructure,
admin/tooling, support labor, taxes, refunds, credits, and incident cost. Base
fixed infrastructure plus admin/tooling is $1,050/month, so the arithmetic
break-even is two active design partners. This is not a true company
break-even: founder labor is valued at zero in the model and external provider
costs are not yet reconciled.

## Capacity guard

The 250,000 monthly validation entitlement is a commercial safety ceiling, not
an SLO. It averages under 0.1 requests/second across a month. The last retained
clean severe-local pass observed 554.08 requests/second with p95 68.22 ms over
2,000 requests and zero errors. Two later correctness-clean runs on a heavily
contended desktop still completed 2,000/2,000 requests at 221.23 and 178.35
requests/second, but missed the 250 ms p95 gate at 309.79 and 292.34 ms while
host load averages were roughly 14/21/23 and then 10/19/22. Those later
measurements are inconclusive performance evidence and the threshold has not
been waived. None of these short local tests establishes sustained VPS
capacity, tenant mix, database growth, support capacity, or a public latency
commitment; the unchanged gate must pass again on an idle or isolated host.

## Expansion gates

Do not activate the modeled $499 Team, $1,500 Business, or $5,000 Enterprise
offers until:

- at least three paid design partners have completed onboarding;
- at least one eligible design partner renews or expands;
- time to first value is under one day for the standard path;
- support is under two hours/account/month without weakening safety;
- actual gross margin includes provider bills and human support;
- the selected package can be enforced with code-owned entitlements.

Until then those price points are sensitivity inputs only, not website offers,
API plans, contracts, or forecast evidence.
