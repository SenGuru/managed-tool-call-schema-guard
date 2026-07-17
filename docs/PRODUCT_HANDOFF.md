# Product implementation handoff

## Product thesis

Build a deterministic compatibility and safety layer between AI agents and tool execution. The initial interface accepts a tool name, a declared tool schema, and raw arguments. It returns one of `valid`, `valid_with_repair`, or `rejected`, together with any repaired fields, a reason or actionable hint, and an audit identifier.

This is not merely another JSON Schema validator. The potentially defensible wedge is cross-provider and cross-framework repair behavior, schema-drift detection, conformance intelligence, and accumulated compatibility/failure data.

## Evidence status

- Candidate: `C-0000 Managed Tool-Call Schema Guard`
- Final portfolio disposition: `BUILD_NOW`, ranked first by both blind Claude and fresh Codex review.
- Stage 13 executable proof: 4/4 assertions passed.
- Observed local proof latency: approximately 11–406 microseconds.
- Completed hunt integrity: 117/117 tests, 396 artifacts, 13 candidates, 9 packets, 14 review threads, `chain_ok`, and zero open blocking deviations.
- Important interpretation: `BUILD_NOW` means strongest validated experiment from the hunt. It does not mean proven product–market fit.

## Authoritative source material

Research root:

`/Users/senthilguru/Desktop/projects/tidewatch-primitive-hunt-v1`

Read these before changing product scope:

- `reports/final/EXECUTIVE-SUMMARY.md`
- `reports/final/COMPLETE-PORTFOLIO.md`
- `reports/final/RANKING.json`
- `reports/final/METHOD-AND-AUDIT.md`
- `reports/final/FINAL-STATUS-ADDENDUM.md`
- `artifacts/stage12/round2/dossier-C-0000.json`
- `artifacts/stage13/round1/dossier-C-0000.json`
- `artifacts/stage15/round1/packet-P-C-0000.json`
- `artifacts/stage13/proofs/C-0000/`

Partner proposal task output directory, when complete:

`/Users/senthilguru/Documents/Codex/2026-07-18/tool-call-schema-guard-partner-proposal/outputs`

## Initial product boundary

### Open adoption layer

- TypeScript and Python SDKs
- CLI
- versioned request/decision specification
- local deterministic validator
- narrowly allowlisted safe coercions
- adapters for MCP, OpenAI Agents, PydanticAI, and Google ADK
- conformance fixtures and adversarial tests
- GitHub Action
- local audit output

### Managed/private layer

- evolving repair intelligence and signed rulesets
- cross-provider/framework schema-drift intelligence
- aggregate compatibility and failure signatures
- hosted audit history, alerts, and exports
- organization policy management
- dashboard, authentication, billing, rate limits, and production reliability

The customer should not need to bring or operate infrastructure to use the hosted service.

## Non-negotiable safety rules

- Core decisions are deterministic; no LLM is on the enforcement path.
- Repairs are allowlisted and typed. Never invent semantic values.
- Reject on ambiguity or uncertainty.
- Preserve the raw input and decision provenance in the audit record.
- Generated code is not trusted without deterministic tests and human-reviewable behavior.
- Require property tests, adversarial fixtures, regression tests, and explicit compatibility contracts.
- Avoid logging secrets or sensitive payload values by default.

## One-week falsification target

Ship a credible local validator plus a minimal hosted repair endpoint to 5–10 real users.

Success: at least three users encounter a genuine repair or schema-drift case that a basic validator cannot resolve during the first seven days.

Kill or materially reposition: zero repair/drift use during the first seven days.

Longer kill threshold: fewer than 10% of trials invoke repair or drift functionality within 90 days.

## Six-week MVP sequence

1. SDK/CLI and basic hosted validation.
2. Deterministic repair engine v1.
3. Audit persistence and export.
4. Cross-framework schema-drift detection.
5. Minimal operational dashboard.
6. Authentication, billing, and rate limits.

## Economic constraints

The core path uses deterministic code and should have low variable compute cost. The research modeled approximately $6.70/month for an extremely small initial technical footprint; this is not a guaranteed operating bill. A realistic software gross-margin target after payment processing, monitoring, backups, and production overhead is approximately 92–97%. This excludes salaries, sales and marketing, taxes, legal expenses, support labor, and growth spending; gross margin is not net profit.

Do not put MRR or revenue forecasts into implementation documentation unless the founders explicitly request them.

## Team shape

- Developer 1: core engine, SDKs, adapters, conformance suite.
- Developer 2: hosted API, drift engine, dashboard, auth, and billing.
- Marketing 1: documentation, open-source launch, community, developer distribution.
- Marketing 2: design partners, interviews, outbound, and conversion.

## First implementation decision

Begin with the smallest trustworthy contract and executable conformance suite. Do not begin with a dashboard or a broad platform. Prove that the deterministic layer catches or safely repairs real cross-framework tool-call failures that ordinary schema validation does not.
