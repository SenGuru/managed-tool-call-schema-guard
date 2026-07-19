# Architecture

Schema Guard is a deterministic checkpoint. It never executes the target tool and has no model call on its enforcement path.

## Product contract

The canonical engine is TypeScript. A request contains a tool name, a JSON Schema Draft 2020-12 schema, raw JSON-object arguments, an optional narrowing policy, and optional adapter/version context. The terminal decision is exactly one of `valid`, `valid_with_repair`, or `rejected`.

Every result includes an audit ID, policy result, repaired-field provenance, engine/ruleset versions, and a privacy-minimized audit envelope.

## Trust boundaries

1. Adapters normalize external declarations into the versioned core contract.
2. Schemas and arguments are untrusted input.
3. Repairs operate only where the schema declares a target type. No missing value, enum choice, field alias, or semantic content is invented.
4. The repaired value is fully revalidated.
5. Policy can narrow behavior; it cannot bypass schema validation.
6. Audits hash values and store structural paths, never argument values.

## Public versus managed boundary

The public offline layer contains the protocol, engine, repair registry, policy hooks, adapters, drift comparison, conformance corpus, CLI, local API, SDKs, action, and local audit output. These packages do not require a managed account, control-plane connection, or remotely supplied decision. They remain independently useful during a managed outage.

`packages/managed` implements the private product boundary locally: tenant authentication, organization policy, durable audit/history, schema registry, drift and failure signatures, privacy-thresholded aggregate intelligence, signed rulesets, plans, local alerts, exports, and dashboard. The managed layer may distribute signed policy and recommendations, but tenant policy can only narrow the core contract.

Basic validation is not treated as the moat. The intended compounding layer is a maintained repair-signature corpus, provider/framework/version conformance evidence, drift history and recommendations, verifiable audit trust, and the team workflow around those assets. The repository contains the operational spine and seed fixtures, not a production-scale proprietary corpus. See [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md).

Provider-specific payment, public ingress, cloud KMS, distributed coordination, external notifications, scheduled fleet conformance, and multi-region operations remain external integrations or future implementation. Local managed behavior does not imply deployment or an SLA.

## Failure behavior

Invalid or unsupported input is rejected. Unexpected internal errors fail closed. Schema validity does not prove factual correctness or tool safety; downstream authorization and business controls remain required.
