# Managed Dashboard Capability Traceability

Date: 2026-07-24

This is the living requirements-to-evidence inventory for the managed product
frontend. It distinguishes an API being technically reachable from an operator
being able to complete the workflow through a purpose-built interface.

## Final disposition

The baseline column below records what existed before this completion pass. As
of the final source revision, every operator-facing row whose baseline was
`missing`, `partial`, or `workbench-only` has a dedicated route, form, row
action, structured state view, or explicit fail-closed boundary and is
therefore **direct**. The two remaining exceptions are intentional:

- Stripe checkout and portal controls are direct, but the real provider
  lifecycle is **blocked-external** and returns a visible fail-closed error.
- The Stripe webhook is **backend-only** because it is a signed
  machine-to-machine callback, not a browser operation.

Deterministic evidence:

- `tests/dashboard-ui.test.ts` requires every operator mutation to appear
  before the workbench fallback and exercises routing, stale-credential
  suppression, lifecycle lockout, and a dedicated validation workflow.
- `tests/managed.test.ts` verifies all 14 routes, unique DOM IDs, CSP-safe
  assets, and the complete 29-operation advanced fallback.
- `npm run check` passed with 222 JavaScript/TypeScript tests, 5 Python tests,
  conformance, package-boundary, formatting, lint, type and script gates.

### 2026-07-25 customer-value completion

The exact-source completion pass added and exercised the pieces that were
technically present but not adequately productized:

- a direct Integration Guide covering SDK, CLI and the fail-closed
  validate/approve/reserve/execute/complete protocol;
- compact connected-workspace state, so the API-key entry mechanism does not
  visually dominate the product after authentication;
- outcome and text filters plus direct signed-record inspection in Decisions;
- signed audit-envelope inspection in Evidence, including chain linkage,
  hashes and explicit raw-argument withholding;
- readiness remediation buttons that route the operator to the page where the
  missing setup is resolved;
- an exact paid-offer presentation covering the 90-day term, $2,250 prepaid
  price, 250,000 validations/month, retention, included workflows, support and
  manual-enrollment boundary.

The first route-reachability test correctly failed because the Integration
Guide had not been added to the server allowlist. The allowlist was corrected,
then the dashboard tests (34/34) and complete `npm run check` gate (222
TypeScript tests plus 5 Python tests) passed without weakening authentication
or failure behavior.

Production-like evidence:

- `npm run audit:container-e2e` passed in 70.981 seconds against fresh
  PostgreSQL 16, hardened production images and a separate TLS anchor
  container. It exercised tenant isolation, schemas, releases, validation,
  action approval/idempotency, anchor outage/recovery, billing fail-closed,
  rulesets, key lifecycle, export/deletion and restart persistence.
- The in-app browser exercised the actual persisted sequence: repaired
  validation, contract compilation, schema registration, exact-hash release,
  environment policy/enforcement, action classification, bound approval,
  one-time evaluation, reservation completion and checkpoint comparison. It
  also exercised scoped key issue/revoke, conformance ingestion, signed
  ruleset publication, local plan rollback, tenant policy, audit CSV UI,
  unsafe-webhook rejection and unconfigured-billing rejection.
- `npm run audit:managed-load` passed 2,000 requests at 311.21 requests/second
  with p95 113.83 ms, zero errors and a valid 2,000-record audit chain.
- `npm run audit:recovery` restored a clean copy with matching row counts and
  valid control, audit, reconciliation and schema-release chains.
- `npm run audit:images` found zero HIGH/CRITICAL vulnerabilities and zero
  secrets in the managed, anchor and PostgreSQL images. `npm audit --omit=dev`
  reported zero vulnerabilities.

Status vocabulary:

- **direct** — a purpose-built control or structured view exists.
- **partial** — state is visible, but the workflow falls back to raw JSON or the
  generic API workbench.
- **workbench-only** — an editable preset exists, but no task-specific UI.
- **backend-only** — the route is intentionally machine-to-machine.
- **blocked-external** — internal UI and boundary may exist, but the provider
  integration is not configured or proven.

## Public service surface

| Capability                    | HTTP evidence   | Required frontend treatment                              | Baseline status |
| ----------------------------- | --------------- | -------------------------------------------------------- | --------------- |
| Liveness                      | `GET /healthz`  | Service status in workspace connection state             | partial         |
| Readiness                     | `GET /readyz`   | Fail-closed readiness detail                             | partial         |
| Plan catalog                  | `GET /v1/plans` | Human-readable plan and entitlement comparison           | missing         |
| Dashboard routes/assets/fonts | `/dashboard/**` | Direct links, history, responsive navigation, strict CSP | direct          |

## Tenant and access

| Capability                 | HTTP evidence                            | Required frontend treatment                        | Baseline status |
| -------------------------- | ---------------------------------------- | -------------------------------------------------- | --------------- |
| Tenant lifecycle           | `GET /v1/admin/tenant/lifecycle`         | Lifecycle banner and recovery boundary             | partial         |
| Tenant export              | `GET /v1/admin/tenant/export`            | Download with hash/time confirmation               | direct          |
| Deletion request           | `POST /v1/admin/tenant/deletion-request` | Exact-tenant destructive confirmation              | direct          |
| API-key inventory          | `GET /v1/admin/api-keys`                 | Key table with scopes/current/revoked state        | partial         |
| Issue scoped API key       | `POST /v1/admin/api-keys`                | Scope picker and one-time secret handoff           | workbench-only  |
| Revoke API key             | `DELETE /v1/admin/api-keys/:keyId`       | Guarded per-key revoke action                      | workbench-only  |
| Organization policy        | `GET /v1/admin/policy`                   | Structured policy editor with raw advanced mode    | partial         |
| Update organization policy | `PUT /v1/admin/policy`                   | Validated save flow and applies-next-request state | workbench-only  |
| Retention purge            | `POST /v1/admin/retention/purge`         | Explicit retention boundary and confirmation       | workbench-only  |

## Tool-call decisions and contracts

| Capability                | HTTP evidence                | Required frontend treatment                                | Baseline status |
| ------------------------- | ---------------------------- | ---------------------------------------------------------- | --------------- |
| Validate tool call        | `POST /v1/validate`          | Tool/schema/arguments/environment form and decision result | workbench-only  |
| Compile provider contract | `POST /v1/contracts/compile` | Provider-aware compiler form and artifact result           | workbench-only  |
| Audit list / CSV          | `GET /v1/audits`             | Filterable decision explorer and CSV export                | partial         |
| Audit-chain verification  | `GET /v1/audits/verify`      | Clear integrity status and checked count                   | partial         |

## Schemas and environments

| Capability                 | HTTP evidence                                       | Required frontend treatment                              | Baseline status |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------- | --------------- |
| Schema registry            | `GET /v1/schemas`                                   | Registry table with versions, hashes, drift, and quality | partial         |
| Register schema            | `POST /v1/schemas`                                  | Structured registration form                             | workbench-only  |
| Release history            | `GET /v1/schema-releases`                           | Environment/tool release table                           | partial         |
| Release-chain verification | `GET /v1/schema-releases/verify`                    | Integrity status                                         | partial         |
| Promote release            | `POST /v1/schema-releases`                          | Reviewed release form with expected hash                 | workbench-only  |
| Environment inventory      | `GET /v1/environments`                              | Environment table with enforcement and policy            | partial         |
| Create environment         | `POST /v1/admin/environments`                       | Named environment creation flow                          | workbench-only  |
| Update environment policy  | `PUT /v1/admin/environments/:id/policy`             | Per-environment editor                                   | workbench-only  |
| Change schema enforcement  | `PUT /v1/admin/environments/:id/schema-enforcement` | Observe/enforce control with confirmation                | workbench-only  |

## Action governance

| Capability                        | HTTP evidence                                                 | Required frontend treatment           | Baseline status |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------- | --------------- |
| Action descriptors                | `GET /v1/admin/actions/descriptors`                           | Risk/side-effect table                | partial         |
| Upsert descriptor                 | `PUT /v1/admin/actions/descriptors`                           | Tool/environment/risk form            | workbench-only  |
| Approval challenges               | `GET /v1/actions/challenges`                                  | Pending/approved/revoked inbox        | partial         |
| Create challenge                  | `POST /v1/actions/challenges`                                 | Accepted-decision challenge form      | workbench-only  |
| Approve challenge                 | `POST /v1/actions/challenges/:id/approve`                     | Guarded row action                    | workbench-only  |
| Cancel challenge                  | `DELETE /v1/actions/challenges/:id`                           | Guarded row action                    | workbench-only  |
| Evaluate action                   | `POST /v1/actions/evaluate`                                   | Approval/idempotency evaluation form  | workbench-only  |
| Complete reservation              | `POST /v1/actions/idempotency/complete`                       | Execution-ledger completion form      | workbench-only  |
| Release reservation               | `POST /v1/actions/idempotency/release`                        | Guarded non-execution release form    | workbench-only  |
| Current checkpoint                | `GET /v1/actions/idempotency/checkpoint`                      | Revision/hash/row-count status        | partial         |
| Compare checkpoint                | `POST /v1/actions/idempotency/checkpoint/compare`             | External-checkpoint verification form | workbench-only  |
| Anchor delivery inventory         | `GET /v1/actions/idempotency/anchors/deliveries`              | Delivery status table                 | partial         |
| Redrive anchor delivery           | `POST /v1/actions/idempotency/anchors/deliveries/:id/redrive` | Eligible row action                   | workbench-only  |
| Pending reconciliation            | `GET /v1/actions/reconciliation/pending`                      | Actionable pending queue              | partial         |
| Reconciliation history            | `GET /v1/actions/reconciliation/history`                      | Outcome/evidence history              | partial         |
| Reconciliation-chain verification | `GET /v1/actions/reconciliation/verify`                       | Integrity status                      | partial         |
| Resolve reservation               | `POST /v1/actions/reconciliation/:id`                         | Outcome/evidence form bound to row    | workbench-only  |

## Alerts and delivery

| Capability         | HTTP evidence                                    | Required frontend treatment                           | Baseline status |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------- | --------------- |
| Alert queue        | `GET /v1/alerts`                                 | Severity/status list                                  | direct          |
| Acknowledge alert  | `POST /v1/alerts/:id/acknowledge`                | Guarded row action                                    | direct          |
| Webhook inventory  | `GET /v1/alert-webhooks`                         | Receiver table                                        | partial         |
| Create webhook     | `POST /v1/alert-webhooks`                        | Label/HTTPS endpoint form and one-time secret handoff | workbench-only  |
| Delivery inventory | `GET /v1/alert-webhooks/deliveries`              | Retry/dead-letter table                               | partial         |
| Redrive delivery   | `POST /v1/alert-webhooks/deliveries/:id/redrive` | Eligible row action                                   | workbench-only  |
| Disable webhook    | `DELETE /v1/alert-webhooks/:id`                  | Guarded receiver action                               | workbench-only  |

## Intelligence and signed configuration

| Capability                 | HTTP evidence                           | Required frontend treatment                                                         | Baseline status |
| -------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| Compatibility intelligence | `GET /v1/intelligence`                  | Failure clusters, schema quality, compatibility, recommendations, privacy threshold | partial         |
| Ingest conformance run     | `POST /v1/conformance-runs`             | Versioned provider/framework result form                                            | workbench-only  |
| Latest ruleset             | `GET /v1/rulesets/latest`               | Version, validity window, signature identity, and rules                             | partial         |
| Publish ruleset            | `POST /v1/admin/rulesets`               | Guarded ruleset editor                                                              | workbench-only  |
| Control-plane integrity    | `GET /v1/admin/control-plane-integrity` | Component-by-component integrity view                                               | partial         |

## Usage and billing

| Capability             | HTTP evidence                       | Required frontend treatment                                       | Baseline status  |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------- | ---------------- |
| Usage and entitlements | `GET /v1/usage`                     | Period usage, quota, retention, and workflow entitlements         | partial          |
| Billing statement      | `GET /v1/billing/statement`         | Offer, subscription boundary, and amount state                    | partial          |
| Start checkout         | `POST /v1/billing/checkout-session` | Provider-aware action and blocked-state explanation               | blocked-external |
| Open billing portal    | `POST /v1/billing/portal-session`   | Provider-aware action and blocked-state explanation               | blocked-external |
| Local plan change      | `PUT /v1/admin/plan`                | Local-only guarded evaluation control; unavailable in public mode | workbench-only   |
| Stripe webhook         | `POST /v1/billing/stripe/webhook`   | No browser control; signed provider callback only                 | backend-only     |

## Completion rule

Frontend completion requires every operator-facing row above to be **direct**,
with deterministic interaction tests and real-browser evidence. A raw
`<pre>` block or a workbench preset is retained as advanced access but does not
count as purpose-built completion. Backend-only callbacks remain excluded from
interactive coverage and must instead have contract/security evidence.
