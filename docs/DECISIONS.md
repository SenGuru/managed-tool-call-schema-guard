# Decision log

## ADR-001: One canonical TypeScript engine

Python is a thin local-process/HTTP client with shared conformance fixtures. Two enforcement engines would create safety-significant drift before usage justifies the cost.

## ADR-002: JSON Schema Draft 2020-12

AJV compiles schemas strictly. This avoids presenting a partial hand-written validator as complete.

## ADR-003: Repair by explicit registry

Default rules are exact string-to-number, string-to-integer, and lowercase string-to-boolean conversions. Numeric repair requires an exact decimal round trip; integer repair also requires JavaScript's safe-integer range. Singleton-to-array exists but is disabled by default. Trimming, renaming, defaults, splitting, enum guessing, and object parsing are excluded because they may change meaning.

## ADR-004: Audit values excluded by default

Audit envelopes contain SHA-256 fingerprints, paths, reasons, rules, and versions—no tool name or argument values.

## ADR-005: Structural drift is evidence, not inference

Compare canonical schemas and classify required/property/type/enum/const/bound/additional-properties changes. Boolean schemas are explicit. A changed construct without a proven compatibility rule is `review`, never silently `backward_compatible`.

## ADR-006: Local API is not a hosted product claim

The open API remains a hosted-style stateless endpoint with an optional JSONL sink. Managed behaviors live only in the separate local control-plane package and do not imply deployment or an SLA.

## ADR-007: Keep the managed layer physically separate

The managed control plane lives in `packages/managed`; the core, CLI, and local API do not depend on it. This preserves a genuinely useful open layer.

## ADR-008: Tenant policy can only be narrowed

Organization policy is loaded after authentication. Caller repair allowlists are intersected, repair limits take the minimum, denied paths are unioned, and closed-schema requirements use logical OR.

## ADR-009: Retention uses audit-chain anchors

Purging an expired prefix stores its last signed hash as the tenant anchor. Verification begins from that anchor, preserving tamper evidence for retained events without retaining expired envelopes.

## ADR-010: Rulesets use asymmetric signatures

Local rulesets are signed with Ed25519. The private key is AES-256-GCM encrypted under the configured master secret. The public key travels with the ruleset, but the service verifies it against a master-secret-authenticated local trust record rather than trusting an embedded replacement key.

## ADR-011: Repair local references, reject ambiguous unions

The repair walker resolves local JSON Pointers such as `#/$defs/count` with cycle protection. It does not guess a repair branch across `oneOf`, `anyOf`, or conditional schemas; full AJV validation remains authoritative.

## ADR-012: Bound hostile JSON before recursive work

Schemas, declarations, and arguments are limited to 10,000 nodes and 64 levels before compilation, normalization, drift hashing, or audit hashing. Schema regular expressions are length-bounded and conservatively screened before AJV executes them. HTTP bodies are capped at 1 MB. These are local safety bounds, not a substitute for process isolation at public ingress.

## ADR-013: Tenant-scoped managed mutations

Rulesets and retention purge are tenant-scoped. Validation usage and audit insertion commit atomically. Audit verification cross-checks indexed display columns against the signed value-free envelope so modifying either representation is detectable.

## ADR-014: Machine logs outrank agent summaries

The live Codex/Claude mutation test records decisions and fake-tool execution inside the MCP guard server. Its verifier uses those privacy-minimized logs; agent-written summaries are informative only and cannot determine a pass.

## ADR-015: Managed local storage is private by default

SQLite database, WAL, SHM, alert, and backup files contain sensitive tenant metadata even though raw arguments are excluded. The managed store forces owner-only file permissions instead of relying on the host umask. Hosted deployments still require protected directories, encrypted volumes, reviewed backup access, and external secret management.

## ADR-016: Release commands must work without generated artifacts

Ignored `dist` output cannot be part of the assumed checkout state. Typed lint builds workspace declarations first, and executable root scripts compile before invoking TypeScript entry points. Release verification includes a fresh local clone so an existing developer tree cannot mask missing build prerequisites.

## ADR-017: Open enforcement, compounding managed intelligence

The deterministic protocol, validator, repair registry, adapters, SDKs, CLI, local audit, and public conformance fixtures remain independently runnable without Schema Guard infrastructure. Basic validation and isolated coercion rules are deliberately not treated as defensibility.

The managed product earns differentiation through maintained repair signatures, cross-provider/framework/version conformance evidence, drift history and recommendations, verifiable audit trust, signed policy distribution, and operational team workflows. Aggregate evidence remains value-free and privacy-thresholded. The repository's local control plane proves the product spine; it does not imply a production corpus, deployed reliability, or product-market fit.

## ADR-018: Persist value-free observations, not payloads

Managed validation accepts bounded provider/framework/version labels as optional operational context. Repair and rejection clusters persist only those labels, deterministic reason and repair identifiers, and generalized validation issue shapes; tool names, argument values, validation messages, and tenant identity never enter a cross-tenant signature. Conformance summaries are idempotent and contain counts and signature identifiers rather than captured calls. Schema scoring reads the tenant's existing registry and returns hashes and findings without reproducing semantic schema values.

Recommendations remain advisory. They may identify weak declarations, recurring caller shapes, or breaking drift, but they cannot change enforcement until a reviewed deterministic rule and conformance regression justify it.

## ADR-019: Environment policy only narrows

Every tenant starts with development, staging, and production environment records and may add bounded named environments. A validation request can select one environment; its stored policy is merged between organization policy and caller policy using the same intersection/minimum/union rules. An unknown environment fails closed. Environment controls cannot widen repairs or bypass schema validation.

## ADR-020: Provider compilation reports uncertainty

Canonical contracts compile through versioned capability profiles. Only
representation-preserving transforms are automatic. Semantic adaptation is
labeled `policy_required`, unsupported constraints produce no declaration, and
unprobed profiles remain `runtime_unverified`. Documentation compatibility is
not promoted to runtime proof.

## ADR-021: Exact replay remains local and sensitive

Reliable replay needs original values. Incident fixtures therefore carry an
explicit `local_sensitive`/not-upload-safe declaration, owner-only file mode,
and an integrity hash over request and expectation. Managed compatibility
signals remain value-free; they are not reconstructed from uploaded replay
payloads.

## ADR-022: Repairs carry independently checkable proof

Protocol `2026-07-20` makes repair receipts required. Each receipt binds the
ruleset/rule, schema fragment, input/output hashes, matched preconditions,
passed ambiguity checks, and schema/policy post-validation. Managed mode keys
value-derived hashes per tenant and recomputes the receipt hash over the scoped
proof.

## ADR-023: Action permission is separate from schema validity

The action gate evaluates accepted decision integrity, risk, side effects,
environment, argument-bound HMAC approval, and idempotency after validation. It
cannot replace target-system authorization. The included in-memory ledger is a
local SDK primitive; hosted mutation support must use durable transactional
storage and a separately controlled approval authority.
