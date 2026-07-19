# Managed Tool-Call Schema Guard

A deterministic compatibility and safety checkpoint between AI agents and tool execution. It validates raw tool arguments, applies only explicit typed repairs, revalidates, enforces narrowing policy, detects schema drift, and emits a privacy-minimized audit record.

The repository contains two deliberately separated products:

- **Schema Guard Core** is the offline, open-source enforcement layer. It runs in a developer process, CI job, agent sidecar, or local service and never requires a Schema Guard account or network connection.
- **Schema Guard Managed** is the team workflow and intelligence layer. This repository implements its product spine as a local control plane; it is not yet a deployed SaaS or a production reliability claim.

The goal is a serious daily-use control point, not a dressed-up JSON Schema validator. Ordinary validation is useful and reproducible. The durable product advantage must come from continuously maintained cross-provider conformance knowledge, privacy-safe failure signatures, drift intelligence, trustworthy audit history, and the workflows teams use to investigate and govern agent actions. See [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md).

The current build is strong local product evidence for that direction—not evidence of product-market fit.

## Product boundary

| Offline OSS core                                             | Managed team product direction                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Deterministic validation and allowlisted repair              | Shared schema registry and organization policy                                |
| CLI, TypeScript SDK, Python access, local API                | Tenant authentication, environments, quotas, and retention                    |
| MCP, OpenAI Agents, PydanticAI, and Google ADK normalization | Searchable audit history, verification, export, and alerts                    |
| Local schema-drift comparison                                | Fleet-level drift workflow and version-change alerts                          |
| Local value-free audit output                                | Signed audit chains and operational review workflow                           |
| Public conformance/adversarial fixtures                      | Privacy-thresholded failure and compatibility intelligence                    |
| Runs without our servers                                     | Hosted operation, billing, reliability, and continuously updated intelligence |

The core remains useful if the managed service is unavailable or never adopted. The managed layer does not weaken or remotely override core validation: organization policy can only narrow permitted behavior.

## What works

- JSON Schema Draft 2020-12 validation through strict AJV compilation.
- `valid`, `valid_with_repair`, and `rejected` decisions with stable reason codes.
- Exact, round-trip-safe string-to-number and safe string-to-integer repairs plus lowercase string-to-boolean repair. Singleton-to-array is available only by explicit policy.
- Revalidation after repair; no semantic-value invention.
- Repair limits, denied argument paths, and closed-schema policy.
- Value-free audit envelopes with hashes, shape, versions, rules, and audit IDs.
- Conservative drift classification for properties, required fields, types, enums, constants, bounds, and `additionalProperties`; unknown changed constructs require review.
- MCP, OpenAI Agents, PydanticAI, and Google ADK normalization fixtures.
- CLI, local HTTP API, TypeScript SDK, and thin Python client to the canonical TypeScript engine.
- Published conformance/adversarial corpus, deterministic baseline regression gate, daily CI workflow, property tests, and benchmark.
- A separate local managed control plane with tenant API keys, organization policy, SQLite history, signed audit chains, schema registry, persistent value-free failure clusters, schema quality scoring, evidence-linked recommendations, provider/framework/version compatibility matrices, privacy-thresholded aggregate intelligence, Ed25519-signed rulesets, usage plans, rate limits, local alerts, exports, retention, backup/restore, and a functional dashboard.
- A repeatable real-agent MCP mutation harness for Codex and Claude that proves rejected calls never reach a strict fake downstream tool.

## Quickstart

Requires Node.js 20 or newer.

```bash
npm ci
npm run check
npm run schemaguard -- validate \
  --tool book_flight \
  --schema examples/schema.json \
  --args examples/args.json
```

The example returns `valid_with_repair`, changes `passengers` from the exact string `"2"` to integer `2`, and reports the applied rule without placing the value in its audit envelope.

Detect a breaking schema change:

```bash
npm run schemaguard -- drift \
  --before examples/schema.json \
  --after examples/schema-v2.json
```

Run the local hosted-style API:

```bash
SCHEMA_GUARD_AUDIT_FILE=.schema-guard-audit.jsonl npm run api
curl -s http://127.0.0.1:8787/v1/validate \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{"tool_name":"book_flight","tool_schema":{"type":"object","required":["passengers"],"properties":{"passengers":{"type":"integer"}}},"raw_arguments":{"passengers":"2"}}
JSON
```

The local audit file is created with owner-only mode and contains no argument values by design.

## API

- `POST /v1/validate`: canonical guard decision. Rejections use HTTP 422 while still returning the full decision.
- `POST /v1/normalize`: `{ "adapter": "mcp", "tool": { ... } }`.
- `POST /v1/drift`: `{ "previous": { ... }, "current": { ... } }`.
- `GET /healthz`: local liveness only.

## Managed local quickstart

The managed control plane is separate from the open local API. It requires a database path and a 32-character-or-longer master secret.

```bash
export SCHEMA_GUARD_DATABASE="$PWD/work/managed.db"
export SCHEMA_GUARD_MASTER_SECRET="replace-with-a-random-secret-at-least-32-characters"
npm run managed:bootstrap -- --tenant-id demo --tenant-name "Demo tenant" --plan trial
npm run managed
```

The bootstrap command prints the API key once; only an HMAC-derived verifier is stored. Open `http://127.0.0.1:8788/dashboard`, or call the managed endpoint with `Authorization: Bearer <key>`.

Managed routes include validation, schema registration/drift, idempotent conformance-summary ingestion, audit history and CSV export, chain verification, tenant and privacy-thresholded network intelligence, usage/billing statements, alerts, signed rulesets, API-key lifecycle, organization policy, plan control, and retention purge. See [`docs/MANAGED_LOCAL.md`](docs/MANAGED_LOCAL.md).

This is the local finished-product-spine walkthrough: bootstrap a tenant, protect validation with an API key, register evolving schemas, exercise repair and rejection cases, inspect the signed audit trail and drift alerts, review privacy-thresholded compatibility signals, and export operational evidence. It demonstrates the implemented product workflow end to end on one machine. Payment collection, external notification delivery, public ingress, cloud key management, and multi-region recovery remain integration work and are not simulated as successful.

Protocol JSON Schemas live in [`protocol/v1`](protocol/v1). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/SECURITY.md`](docs/SECURITY.md), and [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Real agent black-box test

With authenticated Codex and Claude CLIs installed, run:

```bash
npm run build
npm run agent-test:live
```

Both agents make malformed, repairable, policy-denied, drifted, MCP, and Google
ADK calls through the local MCP guard. The machine verifier requires 12/12
outcomes per agent, proves only five calls execute, and scans the minimized logs
for a dummy secret sentinel. See [`examples/agent-loop`](examples/agent-loop)
and [`docs/VALIDATION_REPORT.md`](docs/VALIDATION_REPORT.md).

## Python access

The Python client deliberately calls the built TypeScript engine locally or the HTTP API; it is not a second validator implementation.

```bash
npm run build
PYTHONPATH=python python3 - <<'PY'
from schema_guard import SchemaGuardClient
print(SchemaGuardClient().validate({
    "tool_name": "counter",
    "tool_schema": {"type": "object", "required": ["count"], "properties": {"count": {"type": "integer"}}},
    "raw_arguments": {"count": "3"}
})["decision"])
PY
```

## Safety boundary

Schema Guard proves only structural conformance under declared rules. It does not execute tools, authorize actions, verify factual truth, or make a dangerous operation safe. Use downstream authorization, least privilege, confirmation, idempotency, and business controls.

Repairs never add missing values, rename fields, trim strings, guess enums, parse arbitrary JSON, or infer intent. On uncertainty the engine rejects.

## One-week validation target

Place this local validator and hosted-style endpoint in 5–10 real workflows. Continue only if at least three users encounter a genuine repair or schema-drift case basic validation cannot resolve within seven days. Kill or reposition if zero repair/drift events occur. No payload telemetry is built in; any study instrumentation must be explicit, opt-in, and data-minimized.

That experiment validates whether the differentiated intelligence is valuable; it does not limit the intended product to a one-week MVP. A finished service should become the operational record for tool compatibility across environments while keeping enforcement deterministic and independently runnable.

## Repository map

- `packages/core`: canonical decision, repair, policy, audit, adapter, and drift engine.
- `packages/cli`, `packages/api`, `packages/sdk-typescript`: developer surfaces.
- `python`: thin Python access.
- `conformance`: portable compatibility and adversarial fixtures.
- `protocol/v1`: versioned wire schemas.
- `tests`, `benchmarks`, `examples`: verification and demos.
- `docs`: architecture, decisions, security, threat model, contribution, and handoff evidence.

## Current limitations

Adapter fixtures cover representative current declaration shapes, not every framework release. The repository does not yet contain an accumulated production corpus; current compatibility signals come from checked-in fixtures and locally generated privacy-safe signatures. Drift classification is structural, not learned from observed runtime outcomes. The managed control plane is fully local: payment-provider settlement, TLS/public ingress, external email/Slack delivery, cloud secret/KMS integration, multi-process distributed rate limiting, and multi-region availability still require explicitly chosen external infrastructure. They are labeled `integration_required`, not mocked as complete.

License: MIT.
