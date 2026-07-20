import { describe, expect, it } from 'vitest';
import { emittedCall, requestFor } from '../scripts/live-provider-probe.mjs';

const configuration = { key: 'test-secret', model: 'exact-model-version' };
const declaration = {
  name: 'schema_guard_probe',
  description: 'probe',
  parameters: {
    type: 'object',
    properties: { count: { type: 'integer' } },
    required: ['count'],
  },
};

describe('live provider probe protocol adapters', () => {
  it('builds forced, non-executing provider requests for exact configured models', () => {
    const openai = requestFor('openai', configuration, { ...declaration, strict: true });
    expect(openai.body).toMatchObject({
      model: 'exact-model-version',
      tool_choice: { type: 'function', name: 'schema_guard_probe' },
    });
    expect(openai.headers.authorization).toBe('Bearer test-secret');

    const anthropic = requestFor('anthropic', configuration, declaration);
    expect(anthropic.body).toMatchObject({
      model: 'exact-model-version',
      tool_choice: { type: 'tool', name: 'schema_guard_probe' },
    });
    expect(anthropic.headers['x-api-key']).toBe('test-secret');

    const google = requestFor('google_gemini', configuration, declaration);
    expect(google.body).toMatchObject({
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['schema_guard_probe'],
        },
      },
    });
    expect(google.headers['x-goog-api-key']).toBe('test-secret');
  });

  it('extracts tool calls from all three provider response envelopes', () => {
    expect(
      emittedCall('openai', {
        output: [
          { type: 'message' },
          { type: 'function_call', name: 'schema_guard_probe', arguments: '{"count":7}' },
        ],
      }),
    ).toEqual({ name: 'schema_guard_probe', arguments: '{"count":7}' });
    expect(
      emittedCall('anthropic', {
        content: [{ type: 'tool_use', name: 'schema_guard_probe', input: { count: 7 } }],
      }),
    ).toEqual({ name: 'schema_guard_probe', arguments: { count: 7 } });
    expect(
      emittedCall('google_gemini', {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'schema_guard_probe', args: { count: 7 } } }],
            },
          },
        ],
      }),
    ).toEqual({ name: 'schema_guard_probe', arguments: { count: 7 } });
  });

  it('fails closed when a provider returns no matching function call', () => {
    expect(emittedCall('openai', { output: [] })).toBeUndefined();
    expect(
      emittedCall('anthropic', { content: [{ type: 'text', text: 'no call' }] }),
    ).toBeUndefined();
    expect(emittedCall('google_gemini', { candidates: [] })).toBeUndefined();
  });
});
