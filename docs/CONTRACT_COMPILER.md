# Canonical tool-contract compiler

Schema Guard 0.2 accepts a canonical JSON Schema 2020-12 object contract and
emits a provider declaration plus an explicit compatibility verdict. Compilation
is offline and deterministic; it does not call a model or provider API.

## Status contract

- `native`: the profile required no transformation and the caller asserts that
  this exact target/profile was verified by an external live probe.
- `lossless_transform`: only representation-preserving transforms were applied,
  such as `const` to a singleton `enum`, dialect-annotation removal, or Google's
  documented reference/nullable representation.
- `policy_required`: compilation would change runtime semantics and therefore
  requires an explicit operator policy. OpenAI strict normalization is the first
  example: optional properties become required nullable properties and open
  objects become closed.
- `unsupported`: a constraint cannot be represented without silently weakening
  the canonical contract. No declaration is returned.
- `runtime_unverified`: the declaration is structurally native to the checked-in
  profile, but no live verification signal was supplied for the exact target.

Precedence is `unsupported`, `policy_required`, `lossless_transform`,
`runtime_unverified`, then `native`. A transformation record contains its JSON
Pointer, transform ID, semantic class, and before/after hashes.

## Current profiles

| Target        | Profile                                  | Conservative behavior                                                                                        |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| OpenAI        | `openai-function-strict-2026-07-20`      | Enforces documented strict-object and supported-keyword rules; optional/open normalization requires policy.  |
| Anthropic     | `anthropic-client-tools-2026-07-20`      | Preserves canonical JSON Schema in `input_schema`; defaults to `runtime_unverified`.                         |
| Google Gemini | `google-function-declaration-2026-07-17` | Permits only documented function-declaration attributes and transforms documented nullable/reference syntax. |
| MCP           | `mcp-tools-2025-11-25`                   | Emits an object-root `inputSchema`; defaults to `runtime_unverified`.                                        |

The profiles are based on current primary documentation: [OpenAI function
calling](https://developers.openai.com/api/docs/guides/function-calling),
[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Anthropic client tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools),
[Google function calling](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling),
and the [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
Profiles were reviewed on 2026-07-20. Documentation is not runtime evidence;
scheduled live probes are still required before a profile can be advertised as
verified for a specific provider/model/version.

`npm run probe:live` is the credential-gated probe harness. It compiles one
side-effect-free canonical contract, forces the exact configured model to emit a
tool call without executing it, validates the emitted arguments through Schema
Guard, and writes only model/profile/declaration identifiers, counts, and
argument hashes. Three successful trials are required by the scheduled workflow.
The workflow intentionally fails when API keys or explicit model names are not
configured; a missing probe is never reported as a pass.

Required configuration is `OPENAI_API_KEY` plus
`SCHEMA_GUARD_OPENAI_MODEL`, `ANTHROPIC_API_KEY` plus
`SCHEMA_GUARD_ANTHROPIC_MODEL`, and `GEMINI_API_KEY` plus
`SCHEMA_GUARD_GEMINI_MODEL`. Request formats follow the providers' official
function-calling APIs. Use `npm run probe:live -- --provider all --dry-run` to
validate local compilation and request construction without sending traffic.

## CLI

```bash
schemaguard compile \
  --target openai \
  --tool create_ticket \
  --schema canonical-schema.json
```

The command exits nonzero for `unsupported` or when a required semantic policy
was not supplied. `--openai-strict-policy normalize` authorizes the documented
strict normalization but deliberately leaves the verdict as `policy_required`;
it never relabels a semantic change as lossless.

## Non-claims

The compiler does not prove that a model will choose the right tool, that every
model snapshot accepts the declaration, or that the provider will produce valid
arguments. Runtime calls still pass through Schema Guard validation, repair,
policy, and optional action controls.
