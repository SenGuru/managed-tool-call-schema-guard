import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { normalizeTool, type AdapterName } from '../packages/core/src/index.js';

for (const adapter of ['mcp', 'openai_agents', 'pydantic_ai', 'google_adk'] as AdapterName[]) {
  it(`normalizes ${adapter}`, () => {
    const fixture = JSON.parse(
      readFileSync(new URL(`../conformance/adapters/${adapter}.json`, import.meta.url), 'utf8'),
    ) as unknown;
    const result = normalizeTool(adapter, fixture);
    expect(result.tool_name).toBe('get_weather');
    expect(result.tool_schema).toMatchObject({ type: 'object' });
    expect(result.source_fingerprint).toMatch(/^sha256:/u);
  });
}

it('normalizes Google ADK types in nested unions and definitions', () => {
  const result = normalizeTool('google_adk', {
    name: 'nested',
    parameters: {
      type: 'OBJECT',
      properties: {
        value: { anyOf: [{ type: 'INTEGER' }, { type: 'NULL' }] },
      },
      $defs: { child: { type: 'ARRAY', items: { type: 'STRING' } } },
    },
  });
  expect(result.tool_schema).toMatchObject({
    type: 'object',
    properties: { value: { anyOf: [{ type: 'integer' }, { type: 'null' }] } },
    $defs: { child: { type: 'array', items: { type: 'string' } } },
  });
});
