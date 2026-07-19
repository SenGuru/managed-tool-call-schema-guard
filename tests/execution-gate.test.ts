import { describe, expect, it } from 'vitest';
import { validateToolCall, type GuardPolicy, type JsonObject } from '../packages/core/src/index.js';

const toolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recipient', 'amount', 'confirmed'],
  properties: {
    recipient: { type: 'string' },
    amount: { type: 'integer', minimum: 1, maximum: 10_000 },
    confirmed: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
  },
} as const;

describe('guarded execution boundary', () => {
  it('executes only valid or safely repaired calls', () => {
    const cases: {
      args: JsonObject;
      expected: 'valid' | 'valid_with_repair' | 'rejected';
      policy?: GuardPolicy;
    }[] = [
      { args: { recipient: 'b', amount: 25, confirmed: true }, expected: 'valid' },
      {
        args: { recipient: 'c', amount: '42', confirmed: 'false' },
        expected: 'valid_with_repair',
      },
      { args: { amount: 7, confirmed: true }, expected: 'rejected' },
      { args: { recipient: 'd', amount: '42 dollars', confirmed: true }, expected: 'rejected' },
      {
        args: { recipient: 'e', amount: '9007199254740993', confirmed: true },
        expected: 'rejected',
      },
      {
        args: { recipient: 'f', amount: 8, confirmed: true, api_key: 'sensitive' },
        expected: 'rejected',
      },
      {
        args: { recipient: 'g', amount: 9, confirmed: true, tags: 'priority' },
        policy: { allowed_repairs: ['coerce.singleton_to_array'] },
        expected: 'valid_with_repair',
      },
      {
        args: { recipient: 'h', amount: 10, confirmed: true },
        policy: { deny_argument_paths: ['/recipient'] },
        expected: 'rejected',
      },
    ];
    const executions: JsonObject[] = [];
    for (const testCase of cases) {
      const decision = validateToolCall({
        tool_name: 'fake_transfer',
        tool_schema: toolSchema,
        raw_arguments: testCase.args,
        ...(testCase.policy ? { policy: testCase.policy } : {}),
      });
      expect(decision.decision).toBe(testCase.expected);
      if (decision.decision !== 'rejected') executions.push(decision.valid_arguments);
    }
    expect(executions).toHaveLength(3);
    expect(executions.every((args) => Number.isSafeInteger(args.amount))).toBe(true);
    expect(executions.every((args) => typeof args.confirmed === 'boolean')).toBe(true);
  });
});
