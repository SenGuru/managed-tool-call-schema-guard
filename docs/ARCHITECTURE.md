# Architecture

Schema Guard's canonical engine is a deterministic checkpoint. It never
executes the target tool and has no model call on its enforcement path. The
TypeScript SDK's optional `executeGuardedAction` orchestrator invokes a caller
callback only after the engine and action gate allow it.

## Product contract

The canonical engine is TypeScript. A request contains a tool name, a JSON Schema Draft 2020-12 schema, raw JSON-object arguments, an optional narrowing policy, and optional adapter/version context. The terminal decision is exactly one of `valid`, `valid_with_repair`, or `rejected`.

Every result includes an audit ID, policy result, repaired-field provenance and
verifiable receipts, engine/ruleset versions, and a privacy-minimized audit
envelope. Protocol `2026-07-20` is a breaking envelope revision because repair
receipts added required fields.

## Trust boundaries

1. Adapters normalize external declarations into the versioned core contract.
2. Schemas and arguments are untrusted input.
3. Repairs operate only where the schema declares a target type. No missing value, enum choice, field alias, or semantic content is invented.
4. The repaired value is fully revalidated.
5. Policy can narrow behavior; it cannot bypass schema validation.
6. Repair receipts bind the exact rule, preconditions, ambiguity checks,
   input/output/schema hashes, and post-validation result.
7. Audits hash values and store structural paths, never argument values.
8. Contract compilation rejects unsupported semantics rather than deleting
   constraints; semantic provider transforms require explicit policy.
9. Action evaluation is separate from structural validation and fails closed on
   invalid proof, approval, environment, or idempotency state.

## Public versus managed boundary

The authoritative, machine-checked path and license map is
[`product-boundary.json`](../product-boundary.json); see
[`PRODUCT_BOUNDARY.md`](PRODUCT_BOUNDARY.md). The root workspace is deliberately
private and unlicensed because it assembles both domains.

The public offline layer contains the protocol, engine, repair registry and
receipts, canonical contract compiler, local incident replay, action policy,
adapters, drift comparison, conformance corpus, CLI, local API, SDKs, and local
audit output. These packages do not require a managed account, control-plane
connection, or remotely supplied decision. They remain independently useful
during a managed outage.

`packages/managed` implements the private product boundary locally: tenant
authentication, master-secret-bound core control rows, organization policy,
durable audit/history, schema registry, authenticated environment releases and
runtime admission, drift and failure signatures, privacy-thresholded aggregate
intelligence, signed rulesets, plans, local and durable webhook alerts, exports,
and dashboard. The managed layer may distribute signed policy and
recommendations, but tenant policy can only narrow the core contract.

`packages/shared-state` can make the execution-critical action lifecycle, the
tenant/API-key/policy/quota authority, the privacy-safe validation audit chain,
and environment/schema-release admission transactional in PostgreSQL. Quota
consumption and audit append share one transaction, shared authentication never
falls back to SQLite, and enforced schema admission verifies release/source
integrity in one database snapshot. Per-key fixed-window admission is serialized
in the HMAC-bound API-key row. Alert history and its encrypted, leased webhook
outbox are shared and deletion-evident, with validation/schema alerts coupled to
their source transaction. Derived intelligence, conformance, and signed-ruleset
state also uses PostgreSQL: value-free failure observations are coupled to the
validation transaction; append-only conformance and ruleset records have
authenticated manifests; and network versions are independently
privacy-thresholded. The managed server still rejects configured instance
counts above one until the remaining cross-store action/notification boundaries
and deployed failover evidence are resolved.

Basic validation is not treated as the moat. The intended compounding layer is a maintained repair-signature corpus, provider/framework/version conformance evidence, drift history and recommendations, verifiable audit trust, and the team workflow around those assets. The repository contains the operational spine and seed fixtures, not a production-scale proprietary corpus. See [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md).

Provider-specific payment, public ingress, cloud KMS, distributed coordination, receiver-specific notifications, scheduled fleet conformance, and multi-region operations remain external integrations or future implementation. Local managed behavior does not imply deployment or an SLA.

## Failure behavior

Invalid or unsupported input is rejected. Unexpected internal errors fail closed. Schema validity does not prove factual correctness or tool safety; downstream authorization and business controls remain required.
