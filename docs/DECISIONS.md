# Decision log

## ADR-001: One canonical TypeScript engine

Python is a thin local-process/HTTP client with shared conformance fixtures. Two enforcement engines would create safety-significant drift before usage justifies the cost.

## ADR-002: JSON Schema Draft 2020-12

AJV compiles schemas strictly. This avoids presenting a partial hand-written validator as complete.

## ADR-003: Repair by explicit registry

Default rules are exact string-to-number, string-to-integer, and lowercase string-to-boolean conversions. Singleton-to-array exists but is disabled by default. Trimming, renaming, defaults, splitting, enum guessing, and object parsing are excluded because they may change meaning.

## ADR-004: Audit values excluded by default

Audit envelopes contain SHA-256 fingerprints, paths, reasons, rules, and versions—no tool name or argument values.

## ADR-005: Structural drift is evidence, not inference

Compare canonical schemas and classify required/property/type/enum/additional-properties changes. Do not claim runtime compatibility beyond explicit rules.

## ADR-006: Local API is not a hosted product claim

The open API remains a hosted-style stateless endpoint with an optional JSONL sink. Managed behaviors live only in the separate local control-plane package and do not imply deployment or an SLA.

## ADR-007: Keep the managed layer physically separate

The managed control plane lives in `packages/managed`; the core, CLI, and local API do not depend on it. This preserves a genuinely useful open layer.

## ADR-008: Tenant policy can only be narrowed

Organization policy is loaded after authentication. Caller repair allowlists are intersected, repair limits take the minimum, denied paths are unioned, and closed-schema requirements use logical OR.

## ADR-009: Retention uses audit-chain anchors

Purging an expired prefix stores its last signed hash as the tenant anchor. Verification begins from that anchor, preserving tamper evidence for retained events without retaining expired envelopes.

## ADR-010: Rulesets use asymmetric signatures

Local rulesets are signed with Ed25519. The private key is AES-256-GCM encrypted under the configured master secret; the public key travels with the ruleset so clients can verify without sharing the service secret.
