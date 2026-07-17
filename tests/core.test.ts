import { describe, expect, it } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['origin', 'destination', 'passengers'],
  properties: {
    origin: { type: 'string' },
    destination: { type: 'string' },
    passengers: { type: 'integer', minimum: 1 },
    confirmed: { type: 'boolean' },
  },
} as const;
describe('decision engine', () => {
  it('accepts valid arguments unchanged', () => {
    const result = validateToolCall({
      tool_name: 'book_flight',
      tool_schema: schema,
      raw_arguments: { origin: 'SFO', destination: 'JFK', passengers: 2 },
    });
    expect(result.decision).toBe('valid');
    expect(result.repaired_fields).toEqual([]);
  });
  it('repairs only declared exact scalar coercions', () => {
    const result = validateToolCall({
      tool_name: 'book_flight',
      tool_schema: schema,
      raw_arguments: { origin: 'SFO', destination: 'JFK', passengers: '2', confirmed: 'false' },
    });
    expect(result.decision).toBe('valid_with_repair');
    if (result.decision !== 'rejected')
      expect(result.valid_arguments).toMatchObject({ passengers: 2, confirmed: false });
    expect(result.repaired_fields.map((r) => r.rule_id)).toEqual([
      'coerce.string_to_integer',
      'coerce.string_to_boolean',
    ]);
  });
  it('does not invent missing semantic values', () => {
    const result = validateToolCall({
      tool_name: 'book_flight',
      tool_schema: schema,
      raw_arguments: { origin: 'SFO', passengers: 2 },
    });
    expect(result.decision).toBe('rejected');
    if (result.decision === 'rejected') expect(result.reason_code).toBe('SCHEMA_VALIDATION_FAILED');
  });
  it('rejects ambiguous numeric strings and unknown fields', () => {
    for (const passengers of ['2 seats', ' 2', '02', 'NaN', 'Infinity'])
      expect(
        validateToolCall({
          tool_name: 'book_flight',
          tool_schema: schema,
          raw_arguments: { origin: 'SFO', destination: 'JFK', passengers },
        }).decision,
      ).toBe('rejected');
    expect(
      validateToolCall({
        tool_name: 'book_flight',
        tool_schema: schema,
        raw_arguments: { origin: 'SFO', destination: 'JFK', passengers: 2, api_key: 'secret' },
      }).decision,
    ).toBe('rejected');
  });
  it('enforces repair and path policies', () => {
    expect(
      validateToolCall({
        tool_name: 'x',
        tool_schema: schema,
        raw_arguments: { origin: 'SFO', destination: 'JFK', passengers: '2' },
        policy: { max_repairs: 0 },
      }).decision,
    ).toBe('rejected');
    expect(
      validateToolCall({
        tool_name: 'x',
        tool_schema: schema,
        raw_arguments: { origin: 'SFO', destination: 'JFK', passengers: 2 },
        policy: { deny_argument_paths: ['/destination'] },
      }).decision,
    ).toBe('rejected');
  });
  it('never includes values in the audit envelope', () => {
    const result = validateToolCall({
      tool_name: 'secret_tool',
      tool_schema: schema,
      raw_arguments: { origin: 'TOP_SECRET', destination: 'JFK', passengers: 2 },
    });
    const audit = JSON.stringify(result.audit);
    expect(audit).not.toContain('TOP_SECRET');
    expect(audit).not.toContain('secret_tool');
    expect(result.audit.arguments_hash).toMatch(/^sha256:/u);
  });
  it('rejects malformed schemas and JSON', () => {
    expect(
      validateToolCall({ tool_name: 'x', tool_schema: { type: 'mystery' }, raw_arguments: {} })
        .decision,
    ).toBe('rejected');
    expect(
      validateToolCall({ tool_name: 'x', tool_schema: {}, raw_arguments: '{oops' }).decision,
    ).toBe('rejected');
  });
});
