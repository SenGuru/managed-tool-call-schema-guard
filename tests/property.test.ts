import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateToolCall, verifyRepairReceipt } from '../packages/core/src/index.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'integer' } },
} as const;
describe('repair properties', () => {
  const stableDecision = (decision: ReturnType<typeof validateToolCall>) => {
    const copy = structuredClone(decision) as ReturnType<typeof validateToolCall>;
    copy.audit_id = 'dynamic';
    copy.audit.audit_id = 'dynamic';
    copy.audit.occurred_at = 'dynamic';
    copy.audit.timestamp = 'dynamic';
    return copy;
  };

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
  it('integers outside the JavaScript safe range are never repaired', () => {
    fc.assert(
      fc.property(
        fc.bigInt({
          min: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          max: BigInt(Number.MAX_SAFE_INTEGER) + 1_000_000n,
        }),
        (value) => {
          expect(
            validateToolCall({
              tool_name: 'integer',
              tool_schema: schema,
              raw_arguments: { value: value.toString() },
            }).decision,
          ).toBe('rejected');
        },
      ),
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

  it('produces the same substantive decision for the same JSON-safe request', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ maxLength: 24 }), fc.jsonValue({ maxDepth: 3 }), {
          maxKeys: 12,
        }),
        (rawArguments) => {
          const request = {
            tool_name: 'deterministic',
            tool_schema: {
              type: 'object',
              additionalProperties: false,
              properties: { value: { type: 'integer' } },
            },
            raw_arguments: rawArguments,
          } as const;
          expect(stableDecision(validateToolCall(request))).toEqual(
            stableDecision(validateToolCall(request)),
          );
        },
      ),
      { numRuns: 500 },
    );
  }, 15_000);

  it('never emits accepted arguments on rejection and always verifies repair receipts', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)), (value) => {
        const decision = validateToolCall({
          tool_name: 'integer',
          tool_schema: schema,
          raw_arguments: { value },
        });
        expect(decision.repaired_fields.every(verifyRepairReceipt)).toBe(true);
        if (decision.decision === 'rejected')
          expect(decision).not.toHaveProperty('valid_arguments');
        else expect(decision).toHaveProperty('valid_arguments');
      }),
      { numRuns: 500 },
    );
  });

  it('rejects non-canonical integer spellings instead of guessing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (value) => {
        const spellings = [`+${value}`, ` ${value}`, `${value} `, `0${value}`];
        for (const spelling of spellings)
          expect(
            validateToolCall({
              tool_name: 'integer',
              tool_schema: schema,
              raw_arguments: { value: spelling },
            }).decision,
          ).toBe('rejected');
      }),
      { numRuns: 300 },
    );
  });

  it('repairs only exact lowercase boolean literals', () => {
    const booleanSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'boolean' } },
    } as const;
    fc.assert(
      fc.property(fc.boolean(), (value) => {
        const exact = validateToolCall({
          tool_name: 'boolean',
          tool_schema: booleanSchema,
          raw_arguments: { value: String(value) },
        });
        expect(exact.decision).toBe('valid_with_repair');
        if (exact.decision !== 'rejected') expect(exact.valid_arguments.value).toBe(value);
        for (const ambiguous of [String(value).toUpperCase(), ` ${String(value)}`])
          expect(
            validateToolCall({
              tool_name: 'boolean',
              tool_schema: booleanSchema,
              raw_arguments: { value: ambiguous },
            }).decision,
          ).toBe('rejected');
      }),
      { numRuns: 100 },
    );
  });
});
