# Managed Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an engineering, platform, security, or AI-infrastructure
operator at an operator-onboarded private-beta customer. They need to protect
tool execution, release schemas safely, review decisions, govern risky actions,
and retain evidence without reading internal implementation details.

Human account membership, invitations, recovery, and self-service
administration are outside the currently proven product boundary. The private
beta uses scoped tenant API keys.

## Product Purpose

Akriven places a deterministic checkpoint between an AI model and tool
execution. The managed product turns that checkpoint into an operational
control plane for policies, schema releases, approvals, idempotency,
reconciliation, alerts, audit evidence, and tenant administration.

Success means an operator can understand protection state and complete a daily
workflow from a focused page while unsafe or ambiguous traffic still fails
closed.

## Positioning

Akriven does not ask another model to judge a model. It produces deterministic,
proof-carrying `valid`, `valid_with_repair`, and `rejected` outcomes and extends
the same authority through release and execution coordination.

## Operating Context

- Operators work across overview, tool-call, schema-release, action-control,
  alert-delivery, evidence, API-lab, and tenant-settings workflows.
- PostgreSQL holds shared managed authority in production-like operation.
- An independent checkpoint receiver occupies a separate failure domain.
- Frequent read workflows must be immediately scannable; state-changing
  operations remain explicitly confirmed and fail closed.

## Capabilities and Constraints

- Preserve all existing 19 read panels and 29 guarded operation presets.
- API keys remain in tab memory and must never be persisted by the dashboard.
- Raw secrets and sensitive tool arguments must not appear in UI logs or
  cross-tenant intelligence.
- Navigation must expose real route-like pages with browser history, direct
  links, responsive behavior, and a collapsible desktop sidebar.
- Interface refinement must not weaken confirmation, placeholder, tenant,
  policy, integrity, or deletion guards.
- External identity, automated billing, transactional email, live provider
  proof, and paging remain blocked until exercised.

## Brand Commitments

The commercial Akriven website is the binding authority. The managed product
uses the same warm paper, near-black ink, one-pixel rules, acid-lime emphasis,
Geist-led typography, and evidence-first voice, with quieter density for daily
operation.

## Evidence on Hand

The parent repository contains implementation, tests, security scans, SBOMs,
traceability, container E2E, PostgreSQL, recovery, and load evidence. There are
no testimonials, public customer logos, paid-cohort outcomes, or proven live
external-provider integrations.

## Product Principles

1. Stop uncertainty before execution.
2. Put the operator's workflow ahead of the API's internal shape.
3. Make every state inspectable without making every state visible at once.
4. Keep dangerous actions deliberate and ordinary navigation immediate.
5. Claim only what exercised evidence proves.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Preserve keyboard operation, visible focus, sufficient
contrast, semantic page structure, responsive navigation, readable data
presentation, and reduced-motion behavior.
