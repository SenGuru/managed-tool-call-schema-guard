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

This repository contains the public layer: protocol, engine, repair registry, policy hooks, adapters, drift comparison, conformance corpus, CLI, local API, SDKs, action, and local audit output.

The open packages remain independent. `packages/managed` implements the private boundary locally: tenant authentication, organization policy, durable audit/history, drift signatures, signed rulesets, plans, local alerts, exports, and dashboard. Provider-specific payment, public ingress, cloud KMS, distributed coordination, and multi-region operations remain external integrations.

## Failure behavior

Invalid or unsupported input is rejected. Unexpected internal errors fail closed. Schema validity does not prove factual correctness or tool safety; downstream authorization and business controls remain required.
