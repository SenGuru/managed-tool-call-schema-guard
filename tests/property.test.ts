import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'integer' } },
} as const;
describe('repair properties', () => {
  it('exact base-10 integer strings repair to the same integer', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (value) => {
        const result = validateToolCall({
          tool_name: 'integer',
          tool_schema: schema,
          raw_arguments: { value: String(value) },
        });
        expect(result.decision).toBe('valid_with_repair');
        if (result.decision !== 'rejected') expect(result.valid_arguments.value).toBe(value);
      }),
      { numRuns: 500 },
    );
  });
  it('alphabetic strings are never coerced to numbers', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z]+$/u), (value) => {
        expect(
          validateToolCall({ tool_name: 'integer', tool_schema: schema, raw_arguments: { value } })
            .decision,
        ).toBe('rejected');
      }),
      { numRuns: 300 },
    );
  });
  it('input objects are never mutated', () => {
    fc.assert(
      fc.property(fc.integer(), (value) => {
        const input = { value: String(value) };
        const before = structuredClone(input);
        validateToolCall({ tool_name: 'integer', tool_schema: schema, raw_arguments: input });
        expect(input).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});
