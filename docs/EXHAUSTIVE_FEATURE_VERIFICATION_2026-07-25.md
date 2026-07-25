# Exhaustive provider-independent feature verification — 2026-07-25

> Commercial-completeness supplement: protected metrics, authoritative
> privacy-safe quota/delivery/reservation gauges, W3C trace correlation,
> registered/observed inventory, value-free evaluation export, least-privilege
> key UX, the later 249-test credentialed regression, exact-source container
> result, final 21-route website and 14-route dashboard browser pass,
> dependency remediation, and the current external blocker sequence are recorded in
> [`COMMERCIAL_READINESS_EVIDENCE_2026-07-25.md`](COMMERCIAL_READINESS_EVIDENCE_2026-07-25.md).
> That report supersedes the exact counts below without invalidating the
> historical evidence recorded here.

## Verdict and scope

This report records the exhaustive provider-independent verification performed
against the source based on
`cd0f2bae7109ba6912500610c6dc86666addf684` plus the focused fixes described
below. The final commit identifier is recorded in the release handoff after
this report and the fixes are committed.

**Verdict: conditional private-beta candidate for operator-onboarded design
partners.** This is not a public-production verdict. Live identity, email,
Stripe, model-provider and external paging evidence remain blocked. The later
supplement records the now-proven encrypted cross-host backup/restore, public
API TLS edge and exact DreamHost/DigitalOcean staging boundary; the private
website remains unpublished.

The phrase “exhaustive” in this report means every repository-owned managed
route, every purpose-built dashboard workflow, every advanced-workbench
operation, every credentialed test suite, and every provider-independent audit
listed below was exercised. It does not mean that an unavailable external
provider was simulated and called proven.

## Test environment

| Component                | Observed version or boundary                                   |
| ------------------------ | -------------------------------------------------------------- |
| Node.js                  | `v22.23.1`                                                     |
| npm                      | `10.9.8`                                                       |
| Local Python client gate | system `Python 3.9.6`                                          |
| Framework audit          | isolated Node 22 / Python 3.13 runtimes                        |
| Docker Engine            | `29.5.2`                                                       |
| PostgreSQL               | disposable `postgres:16-alpine` plus hardened production image |
| SQLite                   | `3.51.0`                                                       |
| Trivy                    | `0.72.0`, current local vulnerability database                 |
| Browser boundary         | Codex in-app browser against `127.0.0.1:8791`                  |
| Test data                | disposable tenant and database; no customer data               |

Secrets were read only from owner-only local files and were not committed to
source. The disposable tenant was placed into `deletion_pending` and its
operational API access was verified to fail closed.

During the first dead-letter exercise, controlled alert receivers used
`example.com` before the worker attempt was observed. Privacy-safe signed test
alert payloads were sent and received HTTP `405`; they contained no raw tool
arguments, API keys, or customer data. All subsequent controlled-failure
targets used the reserved `.invalid` domain. This was an unintended external
test request and is retained here rather than silently omitted.

## Findings fixed during the pass

1. A checkpoint-anchor outage made `/readyz` return `503`, and the dashboard
   treated that expected operational state as a total workspace-load failure.
   The dashboard now accepts the structured readiness response while retaining
   fail-closed action admission. A deterministic regression test proves that
   recovery and redrive controls remain available during the outage.
2. The Google Gemini compiler correctly returned structured `422 unsupported`,
   but the dedicated compiler UI retained the previous successful artifact and
   showed only a generic HTTP error. The UI now clears stale output and renders
   the provider capability profile, blocker issue, and required action.
3. The Evidence page expected a nonexistent `valid` field from the latest
   ruleset endpoint and therefore labeled a signed ruleset “Attention.” It now
   recognizes the actual signed envelope (`signature` plus `public_key`) and
   reports `Verified`.
4. A long provider-setup boundary string overflowed the Usage page at a
   1280-pixel viewport. The evidence value now wraps and the page has zero
   horizontal overflow at that width.

All four fixes have focused tests in `tests/dashboard-ui.test.ts`.

## Browser workflow inventory

All 14 routes were opened through the real dashboard router and loaded from a
persisted disposable tenant:

| Route                     | Purpose-built workflows exercised                                                                      | Result |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| `/dashboard/overview`     | readiness remediation, evidence shortcut, alerts shortcut, summary cards                               | Passed |
| `/dashboard/integrate`    | access, validation, and action-protocol navigation; activation state                                   | Passed |
| `/dashboard/decisions`    | valid, repaired, rejected, filters, search, clear, signed audit inspection, CSV, four compiler targets | Passed |
| `/dashboard/schemas`      | schema registration and exact-hash release promotion                                                   | Passed |
| `/dashboard/environments` | create, policy edit, observe/enforce change, row configuration                                         | Passed |
| `/dashboard/actions`      | descriptor, action evaluation, complete/release, checkpoint compare, anchor redrive, reconciliation    | Passed |
| `/dashboard/approvals`    | create, approve, cancel, bound approval evidence                                                       | Passed |
| `/dashboard/alerts`       | acknowledge, receiver creation, one-time secret handoff, dead-letter redrive, disable                  | Passed |
| `/dashboard/intelligence` | conformance ingestion, compatibility state, recommendation state, ruleset publication                  | Passed |
| `/dashboard/evidence`     | audit inspection, audit/release/reconciliation/control/ruleset integrity, CSV and tenant export        | Passed |
| `/dashboard/access`       | scoped key creation, one-time display, revoke, revoked state                                           | Passed |
| `/dashboard/usage`        | entitlements, exact paid offer, local plan evaluation, disabled external billing state                 | Passed |
| `/dashboard/settings`     | policy, export, purge guard, deletion guard and lifecycle lock                                         | Passed |
| `/dashboard/workbench`    | all 29 presets plus mutation, JSON, placeholder, and path guards                                       | Passed |

Cross-route shell controls were also exercised: collapse/expand state, global
settings navigation, key removal/replacement, and reconnect. The deterministic
browser-DOM suite additionally exercises mobile drawer focus entry, focus trap,
Escape close, and opener focus restoration because the current in-app browser
runtime does not expose viewport emulation.

### Advanced workbench operations

Every preset was executed from the browser against the persisted disposable
tenant:

|   # | Operation                  | Observed result                                                     |
| --: | -------------------------- | ------------------------------------------------------------------- |
|   1 | Validate tool call         | `200`                                                               |
|   2 | Compile provider contract  | `200`; provider-unsupported path also `422` with structured blocker |
|   3 | Register schema            | `201`                                                               |
|   4 | Release schema             | `201`                                                               |
|   5 | Create environment         | `201`                                                               |
|   6 | Update environment policy  | `200`                                                               |
|   7 | Update schema enforcement  | `200`                                                               |
|   8 | Update organization policy | `200`                                                               |
|   9 | Set action descriptor      | `200`                                                               |
|  10 | Create approval challenge  | `201`                                                               |
|  11 | Approve challenge          | `200`                                                               |
|  12 | Cancel challenge           | `200`                                                               |
|  13 | Evaluate action            | `200`; anchor outage path `503` fail closed                         |
|  14 | Complete reservation       | `200`                                                               |
|  15 | Release reservation        | `200`                                                               |
|  16 | Compare checkpoint         | `200`, exact-current status `same`                                  |
|  17 | Redrive anchor delivery    | `200` during controlled `.invalid` outage                           |
|  18 | Reconcile uncertain action | `200`, `confirmed_not_executed`, evidence hash retained             |
|  19 | Ingest conformance run     | `201`                                                               |
|  20 | Create alert webhook       | `201`                                                               |
|  21 | Redrive webhook delivery   | `200`                                                               |
|  22 | Disable webhook            | `200`                                                               |
|  23 | Publish ruleset            | `201`                                                               |
|  24 | Create API key             | `201`                                                               |
|  25 | Revoke API key             | `200`                                                               |
|  26 | Start Stripe checkout      | `501 billing_integration_required`, expected blocked boundary       |
|  27 | Open Stripe billing portal | `501 billing_integration_required`, expected blocked boundary       |
|  28 | Attempt plan change        | `200` in explicitly local evaluation mode                           |
|  29 | Purge retained audits      | `200`                                                               |

The workbench refused an unchecked mutation, malformed JSON, an unresolved
path placeholder, and a path outside `/v1/` before issuing a request.

## Managed HTTP route inventory

The following table accounts for the complete managed server surface. “Direct”
means a purpose-built dashboard workflow exists. “Support” means the route is
an infrastructure or machine-to-machine boundary and should not be presented
as a customer button.

| Route group                | Routes                                                                                    | UI disposition                   | Exercised evidence                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| Health and plans           | `GET /healthz`, `GET /readyz`, `GET /v1/plans`                                            | Direct status/plan views         | local browser, HTTP tests, container E2E                            |
| Protected monitoring       | `GET /metrics`                                                                            | Support; separate monitor auth   | auth/privacy/unit and production-container E2E                      |
| Dashboard delivery         | `/dashboard`, 14 dashboard routes, `app.js`, `app.css`, two fonts                         | Support plus router              | route test, browser, CSP/container E2E                              |
| Tenant lifecycle           | lifecycle, export, deletion request                                                       | Direct                           | wrong/exact confirmation, export hash, `423` lock                   |
| Validation and compilation | `POST /v1/validate`, `POST /v1/contracts/compile`                                         | Direct                           | all outcomes, malformed/adversarial tests, provider targets         |
| Action descriptors         | admin descriptor `GET`/`PUT`                                                              | Direct                           | browser, SQLite, PostgreSQL, container                              |
| Approvals                  | challenge `GET`/`POST`, approve, revoke                                                   | Direct                           | browser, RBAC negative, expiry/replay/tamper tests                  |
| Action execution           | evaluate, complete, release                                                               | Direct                           | browser, idempotency/concurrency tests, outage E2E                  |
| Checkpoint anchors         | checkpoint, compare, delivery list, redrive                                               | Direct                           | browser, independent TLS container, outage/recovery                 |
| Reconciliation             | pending, history, verify, resolve                                                         | Direct                           | naturally aged outage reservation and signed evidence               |
| Schemas and releases       | schema `GET`/`POST`, release `GET`/`POST`/verify                                          | Direct                           | browser, admission/drift/tamper, PostgreSQL/container               |
| Audit and intelligence     | audits list/CSV/verify, intelligence, conformance ingestion, value-free evaluation export | Direct                           | browser, DOM download/failure, privacy thresholds, corpus/container |
| Registered inventory       | `GET /v1/inventory`                                                                       | Direct integration view          | API/SDK/CLI/unit, browser, DOM and production-container E2E         |
| Usage and environments     | usage, environments, environment create/policy/enforcement                                | Direct                           | browser, quotas, isolation, PostgreSQL/container                    |
| Billing statement          | `GET /v1/billing/statement`                                                               | Direct                           | browser and internal billing state tests                            |
| Checkout and portal        | checkout/portal session                                                                   | Direct blocked-state controls    | browser and container return `501` without Stripe                   |
| Stripe webhook             | `POST /v1/billing/stripe/webhook`                                                         | Backend-only signed callback     | signature/replay/reordering tests; live sandbox blocked             |
| Alerts                     | list and acknowledge                                                                      | Direct                           | browser, tenant/shared-state tests                                  |
| Webhooks                   | receiver create/list/disable, delivery list/redrive                                       | Direct                           | browser, worker retry/dead-letter tests                             |
| Integrity and rulesets     | control integrity, latest/publish ruleset                                                 | Direct                           | browser and forgery/tamper tests                                    |
| API keys                   | list/create/revoke                                                                        | Direct                           | browser, scope/RBAC/no-plaintext tests                              |
| Organization and plan      | policy `GET`/`PUT`, plan `PUT`                                                            | Direct; plan mutation local-only | browser and policy/entitlement tests                                |
| Retention                  | purge                                                                                     | Direct guarded action            | browser, receipt/anchor tests                                       |

The independent anchor’s checkpoint ingestion and read-token endpoints are
machine-to-machine/operator support boundaries. They are covered by receiver
tests and the production container E2E rather than duplicated as customer
dashboard forms.

### Website-to-product activation

The private website exposes a provider-independent `/start` journey with two
explicit paths: offline open core and an operator-issued managed workspace.
Desktop and 390-pixel browser runs exercised both branches, verified zero
horizontal overflow, and followed the managed action to the real dashboard
connection screen. The website does not collect or store tenant API keys and
does not represent human login, invitations, recovery, or automated billing as
available.

The commercial experience was subsequently rebuilt around the same evidence
boundary: a developer quickstart with TypeScript, CLI, and managed API modes;
interactive decision cases; the three-stage execution protocol; use-case
switching; managed-governance workflows; pricing comparison; developer-path
guidance; commercial and product-boundary FAQs; and the activation handoff.
Every one of the 18 public routes was traversed at 1280 pixels and 390 pixels
through the in-app browser. Every route returned a titled page with an `h1`,
and no route produced document-level horizontal overflow. The final managed
handoff reached the real dashboard connection field whose key remains in the
active tab.

## Exact commands and observed results

| Command                                           | Result                                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                   | format, lint, scripts, package boundary, types, dry provider boundary, conformance; 223 JS/TS passed, 16 PostgreSQL skipped; 5 Python passed          |
| credentialed `npm run test:coverage`              | 40 files, 239/239 tests passed; 79.51% statements, 73.46% branches, 80.66% functions, 81.36% lines                                                    |
| `npm test -- --run tests/dashboard-ui.test.ts`    | 12/12 focused dashboard tests passed                                                                                                                  |
| `npm run audit:container-e2e`                     | passed, 48.917 seconds, fresh PostgreSQL, hardened managed/anchor containers, restart/outage/isolation/secret/log checks                              |
| `npm run audit:extreme`                           | passed, 43.969 seconds; includes check, dependency audit, conformance, benchmark, recovery, load, managed HTTP                                        |
| `npm run audit:framework-integrations`            | MCP, OpenAI Agents, PydanticAI and Google ADK runtime boundary passed; rejected calls executed zero tools                                             |
| `npm run audit:five-repos`                        | 5 repositories, 9 fixtures, 35 derived calls, zero failures; downloaded code not executed                                                             |
| `npm run audit:benchmarks`                        | 7,699 recorded calls, 30,203 mutations, zero mismatches                                                                                               |
| `npm run audit:real-data`                         | 2,501 rows, 3,302 expected calls, 15,702 mutations, zero mismatches                                                                                   |
| `npm run audit:real-repos`                        | 20 repositories, 106 extracted fixtures; source was inspected only, never executed                                                                    |
| `npm run audit:images`                            | 3 images, zero HIGH/CRITICAL vulnerabilities, zero embedded secrets                                                                                   |
| `trivy fs --scanners vuln,secret,misconfig ... .` | zero HIGH/CRITICAL vulnerabilities, secrets, or misconfigurations                                                                                     |
| private website `npm run lint && npm test`        | lint and production build passed at website commit `2e7a0df`; 18 routes built including `/start`; 3/3 rendered HTML and trust/non-claim suites passed |

Additional measurements produced inside the extreme audit:

- core benchmark, 10,000 iterations: p50 37.375 µs, p95 59.125 µs,
  p99 185.959 µs;
- managed HTTP load, 2,000 requests at concurrency 32: 644.03 requests/s,
  p50 45.22 ms, p95 58.19 ms, p99 266.98 ms, zero HTTP errors, 2,000 unique
  audit IDs, valid 2,000-record chain;
- self-contained backup/restore: source and restored SQLite integrity true,
  row counts equal, control/audit/reconciliation/release chains valid, backup
  mode owner-only.

## Adversarial and security coverage

The 239-test credentialed program covers malformed and duplicate-key JSON,
Unicode and numeric boundaries, depth/size limits, coercion smuggling,
allowlisted versus ambiguous repair, property-generated values, adapter
differentials, policy narrowing, schema drift and admission, tenant isolation,
BOLA/IDOR, API-key scope/revocation, approval forgery, idempotency replay,
concurrency, migration-history substitution, audit/control/reconciliation
tamper detection, webhook and billing signatures, replay/reordering, and
provider-outage failure behavior.

The production container program separately proves non-root execution,
read-only root filesystems, dropped Linux capabilities, secret files, CSP,
correlation IDs, value-free access logs, PostgreSQL restart recovery, managed
and anchor persistence, and independent HTTPS checkpoint acknowledgement.

## Blocked evidence — not mocked and not called proven

1. Live OpenAI, Anthropic, and Gemini probes require owner-provisioned API keys
   and pinned model choices.
2. Stripe Checkout, Portal, and webhook delivery require a Stripe test-mode
   account and products/prices.
3. Human identity, organization membership, invitations, MFA, and recovery
   require the selected identity provider.
4. Transactional email and bounce/retry evidence require the selected email
   provider and verified sender/domain.
5. Independent paging/uptime delivery requires the selected monitoring and
   on-call provider.
6. Public TLS/DNS and exact-source separate-host staging require the verified
   DreamHost target and a console-verified DigitalOcean SSH fingerprint.
7. Immutable off-machine backup and a clean-host restore require the selected
   object-storage retention configuration.
8. A real customer’s side-effect ledger, webhook endpoint, workload corpus,
   willingness to pay, renewal behavior, and support burden cannot be proven
   internally.

## External-provider sequence

The owner-controlled infrastructure gates are now complete: authoritative
DigitalOcean fingerprint verification, pinned DreamHost and DigitalOcean SSH
trust, owner-only secret files, exact image deployment, private anchor TLS,
outage/redrive/restart/rollback drills, encrypted cross-host backups, and an
isolated clean restore with checkpoint comparison.

Execute the remaining external gates in this order:

1. Configure an external paging destination for the active independent uptime
   and backup-heartbeat monitors, then
   observe a real acknowledgement/escalation.
2. Configure and test WorkOS (or the selected identity provider), then Postmark
   (or the selected email provider), including recovery and outage paths.
3. Configure Stripe test mode only; test Checkout, Portal, signatures,
   duplicates, reordering, failed payment, cancellation, and entitlement
   reconciliation.
4. Configure pinned model-provider test credentials and run the five-trial
   live provider release gate.
5. Run a customer-owned test webhook and side-effect ledger through
   acknowledge-before-execution, completion, timeout, duplicate, and
   reconciliation paths.
6. Complete independent security/legal review and support ownership, review all
   retained evidence, perform the release-candidate audit, and seek explicit
   owner approval before any public DNS, live payment, package publication, or
   customer traffic change.

## What was actually proven

### Deterministic local evidence

The repository-owned engine, policies, repairs, adapters, compiler, schemas,
actions, audit chains, lifecycle, quotas, internal billing state, alerts,
webhooks, clients, package boundary, dashboard, and private offer pass their
local and credentialed PostgreSQL evidence.

### Production-like network evidence

The exact managed image runs on DreamHost and the exact anchor image on
DigitalOcean across pinned private TLS. Restart, PostgreSQL/anchor outage,
redrive, rollback, persistence, isolation, fail-closed execution, log
redaction, encrypted off-machine clean restore, checkpoint comparison, and
container hardening passed.

### Real external/customer evidence

Purchased-host and public API TLS evidence was added, but no live model call,
real email, external page acknowledgement, automated payment, paying customer,
renewal, or customer incident is represented as proven.
