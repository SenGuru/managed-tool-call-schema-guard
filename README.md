# Managed Tool-Call Schema Guard

A deterministic compatibility and safety checkpoint between AI agents and tool execution. It validates raw tool arguments, applies only explicit typed repairs, revalidates, enforces narrowing policy, detects schema drift, and emits a privacy-minimized audit record.

This is a locally working MVP for a falsification test—not a production hosted service and not evidence of product-market fit.

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
- Published conformance/adversarial corpus, CI action, property tests, and benchmark.
- A separate local managed control plane with tenant API keys, organization policy, SQLite history, signed audit chains, schema registry, privacy-thresholded compatibility intelligence, Ed25519-signed rulesets, usage plans, rate limits, local alerts, exports, retention, backup/restore, and a functional dashboard.
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

Managed routes include validation, schema registration/drift, audit history and CSV export, chain verification, aggregate intelligence, usage/billing statements, alerts, signed rulesets, API-key lifecycle, organization policy, plan control, and retention purge. See [`docs/MANAGED_LOCAL.md`](docs/MANAGED_LOCAL.md).

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

## Repository map

- `packages/core`: canonical decision, repair, policy, audit, adapter, and drift engine.
- `packages/cli`, `packages/api`, `packages/sdk-typescript`: developer surfaces.
- `python`: thin Python access.
- `conformance`: portable compatibility and adversarial fixtures.
- `protocol/v1`: versioned wire schemas.
- `tests`, `benchmarks`, `examples`: verification and demos.
- `docs`: architecture, decisions, security, threat model, contribution, and handoff evidence.

## Current limitations

Adapter fixtures cover representative current declaration shapes, not every framework release. Drift classification is structural, not observed runtime compatibility. The managed control plane is fully local: payment-provider settlement, TLS/public ingress, external email/Slack delivery, cloud secret/KMS integration, multi-process distributed rate limiting, and multi-region availability still require explicitly chosen external infrastructure. They are labeled `integration_required`, not mocked as complete.

License: MIT.
