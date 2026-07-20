import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validateToolCall,
  type DecisionStatus,
  type GuardDecision,
} from '../packages/core/src/index.js';
import {
  GuardedMcpClient,
  SchemaGuardConfigurationError,
  SchemaGuardRejectedError,
  guardOpenAIAgentsTool,
} from '../packages/sdk-typescript/src/index.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

describe('runtime framework integrations', () => {
  it('selects the JSON Schema dialect declared by the framework', () => {
    for (const schemaUri of [
      'http://json-schema.org/draft-07/schema#',
      'https://json-schema.org/draft/2019-09/schema',
      'https://json-schema.org/draft/2020-12/schema',
    ]) {
      const decision = validateToolCall({
        tool_name: 'dialect_probe',
        tool_schema: {
          $schema: schemaUri,
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
          additionalProperties: false,
        },
        raw_arguments: { count: 1 },
      });
      expect(decision.decision, schemaUri).toBe('valid');
    }
  });

  it('guards the real OpenAI Agents function-tool invoke boundary', async () => {
    const decisions: DecisionStatus[] = [];
    let executions = 0;
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
      execute: ({ count }: { count: number }) => {
        executions += 1;
        return count + 1;
      },
    });
    const guarded = guardOpenAIAgentsTool(original, {
      onDecision: (decision) => decisions.push(decision.decision),
    });

    await expect(guarded.invoke({} as never, '{"count":"2"}')).resolves.toBe(3);
    expect(executions).toBe(1);
    await expect(guarded.invoke({} as never, '{"count":"02"}')).rejects.toBeInstanceOf(
      SchemaGuardRejectedError,
    );
    expect(executions).toBe(1);
    expect(decisions).toEqual(['valid_with_repair', 'rejected']);
    expect(original).not.toBe(guarded);
  });

  it('discovers MCP schemas and guards the real client/server call boundary', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: 'schema-guard-test-server', version: '1.0.0' });
    let executions = 0;
    const registeredTool = server.registerTool(
      'increment',
      {
        description: 'Increment an integer',
        inputSchema: { count: z.number().int() },
      },
      ({ count }) => {
        executions += 1;
        return { content: [{ type: 'text', text: String(count + 1) }] };
      },
    );
    const nativeClient = new Client({ name: 'schema-guard-test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), nativeClient.connect(clientTransport)]);
    closers.push(async () => {
      await nativeClient.close();
      await server.close();
    });

    const observed: GuardDecision[] = [];
    const drift: string[] = [];
    const guarded = new GuardedMcpClient(nativeClient, {
      onDecision: (decision) => observed.push(decision),
      onDrift: ({ report }) => drift.push(report.compatibility),
    });
    const tools = await guarded.listTools();
    expect(tools.tools.map((entry) => entry.name)).toContain('increment');

    const repaired = (await guarded.callTool({
      name: 'increment',
      arguments: { count: '2' },
    })) as { content: { type: string; text: string }[] };
    expect(repaired.content[0]?.text).toBe('3');
    expect(executions).toBe(1);

    await expect(
      guarded.callTool({ name: 'increment', arguments: { count: '02' } }),
    ).rejects.toBeInstanceOf(SchemaGuardRejectedError);
    expect(executions).toBe(1);

    await expect(
      guarded.callTool({ name: 'not_registered', arguments: {} }),
    ).rejects.toBeInstanceOf(SchemaGuardConfigurationError);
    expect(executions).toBe(1);
    expect(observed.map((decision) => decision.decision)).toEqual([
      'valid_with_repair',
      'rejected',
    ]);

    registeredTool.update({ paramsSchema: { count: z.number().int().min(3) } });
    await guarded.listTools();
    expect(drift).toEqual(['breaking']);
  });
});
