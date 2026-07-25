# Commercial-readiness completion evidence — 2026-07-25

## Verdict

The provider-independent product is a **conditional private-beta candidate for
operator-onboarded design partners**. It is not public-production ready and is
not ready for self-service signup or automated charging.

This verdict applies to the exact source checkpoint created after this report.
It does not promote historical staging evidence to exact-source evidence.

## Provider-independent completion delta

The commercial-completeness audit added and exercised:

- protected Prometheus metrics with a monitoring-only credential, bounded
  route/status labels, latency histograms, in-flight work, timeouts, dependency
  readiness, dispatch failures, memory, and uptime;
- strict W3C trace-context correlation with a new server span and one-way
  trace-ID hashes in logs;
- registered-and-observed inventory across API, TypeScript SDK, CLI, and
  dashboard, with schema and action fingerprints kept in intentionally separate
  privacy domains;
- a content-addressed, allowlisted, value-free evaluation export across API,
  TypeScript SDK, CLI, and dashboard;
- least-privilege dashboard key issuance with zero preselected scopes and a
  fresh scope/confirmation review for every key;
- retry-safe dashboard mutations: a committed change is reported as committed
  even if its supplemental inventory refresh is temporarily unavailable;
- accessible full-fingerprint copy controls and accurate tenant-scoped,
  value-free inventory labels;
- an explicit OWASP GenAI/Agentic, ASVS 5.0, and NIST AI RMF control mapping
  with certification and product-boundary non-claims;
- current primary-source market mapping that separates direct competitors,
  adjacent guardrails/security, observability/evaluation complements, and
  general policy infrastructure.

## Exact final regression

All commands below ran on 2026-07-25 after the final provider-independent fixes:

| Command                                                                              | Observed result                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                                                                      | Passed format, build, lint, script syntax, dry provider boundary, package boundary, typecheck, conformance, 231 TypeScript/JavaScript tests; 16 credentialed PostgreSQL cases skipped by the uncredentialed command; 5 Python tests passed                                                                         |
| `npm test -- --run tests/dashboard-ui.test.ts`                                       | 14/14 dashboard DOM tests passed, including least-privilege reset, committed-mutation refresh isolation, and evaluation-export success/failure recovery                                                                                                                                                            |
| `npm audit`                                                                          | 0 known vulnerabilities after updating the transitive `brace-expansion` dependency that the first scan reported as High severity                                                                                                                                                                                   |
| `npm run audit:container-e2e`                                                        | Passed in 45.870 seconds against fresh PostgreSQL 16, hardened managed and independent TLS-anchor images, two tenants, metrics, tracing, inventory/export, all decision paths, release admission, approvals/idempotency, outage/redrive, restart/persistence, tenant isolation, secret-file and log-privacy checks |
| `npm run audit:images`                                                               | Managed, anchor, and PostgreSQL images: 0 High/Critical vulnerabilities and 0 embedded secrets                                                                                                                                                                                                                     |
| `npm run audit:extreme`                                                              | Passed in 37.223 seconds; includes the repository check, dependency audit, conformance, benchmark, restore drill, load test, 1,000-call open-core burst, and 250-call managed burst                                                                                                                                |
| `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 .` | 0 High/Critical npm vulnerabilities, embedded secrets, or Dockerfile misconfigurations                                                                                                                                                                                                                             |

Measurements from the final extreme audit:

- core benchmark, 10,000 iterations: p50 28.166 µs, p95 33.417 µs,
  p99 76.084 µs;
- managed HTTP load, 2,000 requests at concurrency 32: 818.79 requests/s,
  p50 35.55 ms, p95 43.82 ms, p99 215.25 ms, zero HTTP errors, 2,000
  unique audit IDs, valid 2,000-record audit chain, and no private sentinel in
  the database;
- self-contained backup/restore: source and restored SQLite integrity true,
  row counts equal, control/audit/reconciliation/release chains valid, and
  backup file owner-only.

## Real browser evidence

The Codex in-app browser used a disposable local tenant through the real HTTP
boundary and persisted database. It exercised:

- `valid`, `valid_with_repair`, and ambiguous-input `rejected`;
- schema registration, exact-hash production promotion, and enforcement;
- high/irreversible action classification, approval, one-time admission,
  duplicate blocking, completion, and checkpoint advance;
- inventory showing one registered schema tool and one separate action-policy
  fingerprint without falsely correlating the two privacy domains;
- conformance ingestion, signed ruleset publication, and value-free evaluation
  export;
- validate-only API-key creation with no default scopes, one-time secret
  display, product-native revoke confirmation, and revocation;
- product-native alert acknowledgement and unsafe loopback webhook rejection;
- audit/control/release/reconciliation/ruleset integrity and signed,
  value-free audit inspection;
- plan/entitlement display with Checkout and Portal honestly disabled;
- organization-policy save, wrong-tenant deletion rejection, and guarded
  workbench mutation refusal.

No destructive tenant deletion was executed in this browser pass. No external
provider was called or represented as proven.

## Remaining launch blockers

### Before first design-partner action traffic

1. Verify the DigitalOcean host fingerprint in the provider console before any
   further SSH operation.
2. Deploy the exact committed source privately to the verified DreamHost main
   host and DigitalOcean anchor host, then repeat TLS, migration, rollback,
   anchor-outage, redrive, reconciliation, restart, and checkpoint-comparison
   drills.
3. Configure immutable encrypted off-machine backups and restore them on a
   clean host; compare audit and anchor checkpoints before resuming action
   traffic.
4. Configure independent uptime, backup-heartbeat, and paging delivery and
   observe acknowledgement/escalation.
5. Exercise a customer-owned HTTPS webhook receiver and downstream side-effect
   ledger through acknowledgement, completion, timeout, duplicate, ambiguous,
   and reconciliation paths.
6. Pin and live-test the exact OpenAI, Anthropic, and Gemini versions intended
   for the cohort, including timeout, malformed output, and drift behavior.
7. Complete an independent security review, ASVS requirement record, incident
   drill, legal/privacy review, vulnerability-disclosure path, and support
   ownership.

### Before self-service or automated charging

1. Select and exercise hosted human identity: verified email, organizations,
   membership/role binding, invitations, sessions, MFA, recovery, and future
   SSO/SCIM.
2. Select and exercise transactional email, including bounce, retry, and outage
   behavior.
3. Rotate the previously exposed Stripe test credential outside chat. Supply
   the replacement only through a secret manager or owner-only file, then
   exercise test-mode Checkout, Portal, signed webhook, replay, duplicate,
   reordering, failed payment, recovery, cancellation, entitlement changes,
   refund/credit, tax, invoice, and dunning paths.
4. Complete public account, consent, support, security-contact, and
   retention/deletion flows without publishing the currently private website
   until explicitly approved.

### Evidence that only the market can produce

- willingness to pay at the design-partner price;
- activation time and implementation burden;
- retained usage, renewal, expansion, and churn;
- real support load, provider costs, payment loss, and gross margin;
- customer incident outcomes and downstream-ledger reconciliation quality.

## Honest boundary

What is proven is a substantial deterministic checkpoint, managed control
plane, operator dashboard, API/SDK/CLI surface, hardened container topology, and
provider-independent operational program. What is not proven is a public SaaS
business, a customer-production SLO, live identity/email/billing/model-provider
integration, exact-source operation on the two purchased hosts, or customer
demand.
