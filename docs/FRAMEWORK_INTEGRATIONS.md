# Runtime framework integrations

Schema Guard integrates at the last framework-controlled boundary before a
local tool executes. Applications do not manually extract schemas. Each adapter
discovers the framework's registered schema, submits the raw call to Schema
Guard, forwards repaired arguments only after acceptance, and prevents the
original executor from running after rejection.

## TypeScript

### OpenAI Agents

```ts
import { tool } from '@openai/agents';
import { guardOpenAIAgentsTool } from '@schema-guard/sdk';

const original = tool({
  name: 'increment',
  description: 'Increment an integer',
  strict: false,
  parameters: {
    type: 'object',
    properties: { count: { type: 'integer' } },
    required: ['count'],
    additionalProperties: false,
  },
  execute: async ({ count }) => count + 1,
});

const guarded = guardOpenAIAgentsTool(original);
```

The wrapper preserves the native function-tool object and replaces its
`invoke` boundary. The original executor receives only `valid_arguments`.

### MCP client

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { GuardedMcpClient } from '@schema-guard/sdk';

const nativeClient = new Client({ name: 'app', version: '1.0.0' });
const client = new GuardedMcpClient(nativeClient, {
  onDrift: ({ toolName, report }) => console.log(toolName, report.compatibility),
});

await client.listTools();
await client.callTool({ name: 'increment', arguments: { count: '2' } });
```

`listTools()` automatically caches schemas and reports structural drift on
later refreshes. `callTool()` refreshes once on a cache miss. A tool absent from
`tools/list` is denied without contacting the downstream tool handler.

## Python

### PydanticAI

```py
from pydantic_ai import Agent
from schema_guard import pydantic_ai_capability

agent = Agent('openai:gpt-5', capabilities=[pydantic_ai_capability()])
```

The capability runs before PydanticAI's native argument validation, allowing a
bounded Schema Guard repair to flow into native validation and execution. A
rejection raises `SchemaGuardRejectedError` before the tool function executes.

### Google ADK

```py
from google.adk.runners import InMemoryRunner
from schema_guard import google_adk_plugin

runner = InMemoryRunner(agent=agent, plugins=[google_adk_plugin()])
```

The plugin reads the tool's current `FunctionDeclaration`, normalizes Google
schema types, and mutates the framework-provided argument dictionary only after
acceptance. A rejection returns a structured error response and short-circuits
tool execution.

## Verification

Run the pinned real-framework audit with Python 3.10 or newer:

```sh
SCHEMA_GUARD_INTEGRATION_PYTHON=python3.12 npm run audit:framework-integrations
```

The audit uses official MCP and OpenAI Agents packages in Node, plus isolated
PydanticAI and Google ADK installations using binary wheels only. It calls no
model API and executes no cloned external repository. The harness asserts
repair, rejection, zero rejected-tool executions, automatic MCP discovery, and
breaking MCP schema-drift detection.

These integrations cover local function tools. Provider-hosted tools that
execute outside the application process cannot be intercepted at this boundary.
