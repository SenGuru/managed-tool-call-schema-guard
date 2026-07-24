# Product direction

Schema Guard is intended to become a daily-use compatibility and governance layer for teams whose agents call tools across providers, frameworks, environments, and schema versions. The enforcement path remains deterministic and available offline. The managed product turns many isolated decisions into an operational compatibility system without collecting argument values by default.

## What is easy to copy

A competent developer can combine JSON Schema validation, a few coercions, and an HTTP endpoint. That is useful infrastructure, but it is not a durable product advantage. Schema Guard Core intentionally makes much of this layer open and inspectable because enforcement earns trust through deterministic behavior, portable conformance fixtures, and the ability to run without a vendor service.

The open layer should win adoption on correctness and integration quality, not obscurity.

## What must compound

The managed product becomes harder to reproduce only if its evidence and workflow improve with sustained use:

1. **Repair signatures:** versioned, reviewed descriptions of recurring malformed-call shapes, the contexts in which a repair is safe, the cases in which it must reject, and regressions for both.
2. **Cross-provider conformance:** continuously rerun evidence showing how declaration shapes and arguments behave across MCP, OpenAI Agents, PydanticAI, Google ADK, and future adapters and versions.
3. **Drift intelligence:** a history of schema changes, compatibility classifications, affected environments, recurring signatures, and actionable remediations—not merely a one-off JSON diff.
4. **Audit trust:** value-free records, stable provenance, signed chains, retention anchors, export, and verification that make an enforcement decision useful during review or incident response.
5. **Operational workflow:** shared policy, environments, alerts, ownership, investigation, release gates, exceptions, and recommended fixes that teams can use every day.

None of those advantages exists merely because the code has a database table or dashboard. They compound only through maintained adapter coverage, reproducible conformance runs, carefully governed aggregate evidence, and real team use. The current repository supplies the machinery and seed corpus; it does not claim the accumulated production evidence yet.

## Product layers

### 1. Offline enforcement core

Core accepts a tool name, schema, raw arguments, and optional narrowing policy. It returns exactly `valid`, `valid_with_repair`, or `rejected`, with reason codes, repair provenance, policy results, and a privacy-minimized audit envelope.

Core includes the versioned protocol, repair registry and verifiable receipts,
schema validation, canonical cross-provider contract compiler, policy evaluation,
integrity-checked local incident replay, deterministic action controls, adapters,
local drift comparison, SDKs, CLI, local API, local audits, and public
conformance corpus. It has no model call on the enforcement path and no
dependency on managed infrastructure.

### 2. Managed team workflow

Managed supplies tenant identity, API-key lifecycle, organization policy, schema registry, reviewed environment releases with runtime admission, durable audit history, signed audit-chain verification, retention, export, alerts with a durable signed HTTPS outbox, environments and plans. It distributes signed rulesets rather than silently changing local enforcement behavior.

The repository implements this layer with a local SQLite mode and optional
shared PostgreSQL authorities for control, schema, action, alert, intelligence,
and billing state. Internal staging exercises a public TLS boundary, but
customer-approved hosting, payment settlement, configured customer notification
receivers, cloud key custody, failover, support operations, and compliance
certification remain external production gates.

### 3. Compatibility intelligence

The intelligence layer ingests value-free failure and drift signatures, enforces a cross-tenant privacy threshold, clusters recurring cases, scores schema risks, tracks provider/framework/version conformance, and recommends evidence-linked fixes. Recommendations must remain advisory until a deterministic reviewed rule and regression corpus justify enforcement.

The intended loop is:

```text
observed value-free signature
  -> privacy threshold and clustering
  -> reproduce in conformance fixture
  -> classify provider/framework/version behavior
  -> review a safe rule or recommended schema fix
  -> publish a signed versioned ruleset
  -> monitor regressions and new drift
```

## Daily-use workflow

A team should be able to:

1. Run Core beside an agent so rejected calls never reach the target tool.
2. Promote schemas through development, staging, and production environments.
3. See when a provider or framework emits an incompatible argument shape.
4. Distinguish a safe allowlisted repair from ambiguous input that must stop.
5. Review schema drift before deployment and receive an alert when an observed version changes.
6. Investigate an audit decision without exposing the underlying secret or argument value.
7. Compare a recurring failure against cross-provider conformance evidence and apply a reviewed recommendation.
8. Export and independently verify the retained audit history.
9. Capture a real incident locally, replay it in CI, and detect an exact behavior regression.
10. Require an argument-bound approval and idempotency reservation before a high-risk mutation executes.

The current build demonstrates most of this spine on one machine, including a
canonical compiler, proof-carrying repairs, exact local incident replay,
SDK-enforced action gating, persistent value-free clustering, schema scoring,
recommended fixes, conformance-summary ingestion, a compatibility matrix, and a
deterministic daily conformance workflow. Durable single-node managed
approvals/idempotency, uncertain-outcome reconciliation, a durable generic
alert-webhook transport, and shared multi-instance coordination are
implemented. Environment schema promotion binds reviewed registry versions to
fail-closed runtime admission. Live provider fleet probes, customer-owned
receivers, hosted identity/recovery, payment-provider networking, failover, and
customer-production hosting remain direction rather than completed claims.

## Local product narrative

The strongest local demonstration is not “send invalid JSON and receive an error.” It is a lifecycle:

1. Bootstrap a tenant and issue a scoped API key.
2. Register a tool schema and organization repair policy.
3. Send a valid call, a safely repairable provider-shaped call, an ambiguous call, and a policy-denied call.
4. Confirm only accepted calls are eligible for downstream execution.
5. Register a new schema version and inspect its drift classification and alert.
6. Inspect usage, decision history, repair provenance, and the signed audit chain.
7. Introduce the same privacy-safe failure signature across the configured minimum number of tenants and verify that aggregate intelligence appears without tenant identity or argument values.
8. Ingest a versioned conformance result, inspect the compatibility matrix and recommendations, and run the committed regression baseline.
9. Publish and retrieve a signed ruleset, export audit evidence, purge retained history, and verify the surviving anchored chain.

The Codex/Claude MCP mutation harness separately proves that actual agents can produce malformed calls and that rejected calls do not reach a strict fake tool under the covered fixtures. Together these demonstrations show enforcement plus operational workflow; neither is a hosted SLA or proof of market demand.

## Product principles

- No model is placed on the enforcement path.
- Never invent semantic values or repair on ambiguity.
- Organization and managed policy may narrow local behavior, never bypass validation.
- Raw values and sensitive payloads are excluded from audit and intelligence by default.
- Aggregate intelligence must meet a privacy threshold and remain reproducible from a value-free signature.
- Generated repairs, classifications, and recommendations are untrusted until encoded in deterministic tests and reviewed evidence.
- Core remains independently useful, portable, and available when managed services are unavailable.
- Managed claims follow deployed evidence; local behavior is not described as production availability.

## Validation standard

The near-term commercial test remains deliberately falsifiable: place the system in 5–10 real multi-provider or changing-schema workflows. Continue the differentiated wedge only if at least three users encounter a real repair or drift case that ordinary validation does not resolve within seven days; kill or reposition if nobody uses repair or drift.

Passing that test would justify deeper investment. It would not prove product-market fit, safety across every schema, or production readiness by itself.
