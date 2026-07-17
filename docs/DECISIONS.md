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

The MVP includes a hosted-style endpoint and append-only local audit sink, not production persistence, auth, billing, dashboard, alerts, or SLA.
