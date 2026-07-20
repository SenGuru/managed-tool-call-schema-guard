import { describe, expect, it } from 'vitest';
import {
  rejectAcceptedDecisionByPolicy,
  validateToolCall,
  verifyRepairReceipt,
} from '../packages/core/src/index.js';

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
    expect(result.repaired_fields.every(verifyRepairReceipt)).toBe(true);
    expect(result.repaired_fields[0]).toMatchObject({
      ruleset_version: 'oss-2026-07-18.1',
      post_validation: { schema: 'passed', policy: 'allowed' },
    });
  });
  it('converts an accepted decision into a proof-consistent external policy rejection', () => {
    const accepted = validateToolCall({
      tool_name: 'book_flight',
      tool_schema: schema,
      raw_arguments: { origin: 'SFO', destination: 'JFK', passengers: '2' },
    });
    if (accepted.decision === 'rejected') throw new Error('fixture should be accepted');
    const rejected = rejectAcceptedDecisionByPolicy(accepted, {
      policy_id: 'managed.schema_release_admission.v1',
      policy_reasons: ['managed.schema_release_mismatch'],
      reason: 'schema is not admitted',
      repair_hint: 'promote the exact schema',
    });
    expect(rejected).toMatchObject({
      decision: 'rejected',
      reason_code: 'POLICY_DENIED',
      audit_id: accepted.audit_id,
      policy_result: {
        outcome: 'denied',
        reasons: ['managed.schema_release_mismatch'],
      },
    });
    expect(rejected).not.toHaveProperty('valid_arguments');
    expect(rejected.audit).not.toHaveProperty('validated_arguments_hash');
    expect(rejected.audit.policy_hash).toBe(rejected.policy_result.applied_policy_hash);
    expect(rejected.repaired_fields[0]).toMatchObject({
      post_validation: { schema: 'passed', policy: 'denied' },
    });
    expect(rejected.repaired_fields.every(verifyRepairReceipt)).toBe(true);
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
  it('records failed schema and denied policy postconditions in repair receipts', () => {
    const constrained = {
      type: 'object',
      additionalProperties: false,
      properties: { count: { type: 'integer', minimum: 5 } },
      required: ['count'],
    } as const;
    const schemaFailure = validateToolCall({
      tool_name: 'counter',
      tool_schema: constrained,
      raw_arguments: { count: '2' },
    });
    expect(schemaFailure.decision).toBe('rejected');
    expect(schemaFailure.repaired_fields[0]?.post_validation).toEqual({
      schema: 'failed',
      policy: 'not_run',
    });
    expect(schemaFailure.repaired_fields.every(verifyRepairReceipt)).toBe(true);

    const policyFailure = validateToolCall({
      tool_name: 'counter',
      tool_schema: constrained,
      raw_arguments: { count: '5' },
      policy: { deny_argument_paths: ['/count'] },
    });
    expect(policyFailure.decision).toBe('rejected');
    expect(policyFailure.repaired_fields[0]?.post_validation).toEqual({
      schema: 'passed',
      policy: 'denied',
    });
    expect(policyFailure.repaired_fields.every(verifyRepairReceipt)).toBe(true);
  });
  it('accepts standards-valid required keys without sibling property declarations', () => {
    const result = validateToolCall({
      tool_name: 'population',
      tool_schema: {
        type: 'object',
        required: ['population'],
        properties: {
          population: { type: 'object', required: ['adults', 'children'] },
        },
      },
      raw_arguments: { population: { adults: 2, children: 1 } },
    });
    expect(result.decision).toBe('valid');
  });
  it('supports common JSON Schema formats instead of rejecting their declarations', () => {
    const valid = validateToolCall({
      tool_name: 'invite_user',
      tool_schema: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
      raw_arguments: { email: 'person@example.com' },
    });
    const invalid = validateToolCall({
      tool_name: 'invite_user',
      tool_schema: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
      raw_arguments: { email: 'not-an-email' },
    });
    expect(valid.decision).toBe('valid');
    expect(invalid.decision).toBe('rejected');
    if (invalid.decision === 'rejected')
      expect(invalid.validation_errors?.[0]?.keyword).toBe('format');
  });
  it('rejects ambiguous numeric strings and unknown fields', () => {
    for (const passengers of ['2 seats', ' 2', '02', 'NaN', 'Infinity', '-0', '9007199254740993'])
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
  it('repairs through local JSON Schema references without guessing across unions', () => {
    const result = validateToolCall({
      tool_name: 'counter',
      tool_schema: {
        type: 'object',
        additionalProperties: false,
        properties: { count: { $ref: '#/$defs/count' } },
        required: ['count'],
        $defs: { count: { type: 'integer', minimum: 0 } },
      },
      raw_arguments: { count: '2' },
    });
    expect(result.decision).toBe('valid_with_repair');
    if (result.decision !== 'rejected') expect(result.valid_arguments.count).toBe(2);
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
  it('reports denied policy outcomes consistently and closes nested object schemas', () => {
    const result = validateToolCall({
      tool_name: 'nested',
      tool_schema: {
        type: 'object',
        additionalProperties: false,
        properties: { options: { type: 'object', properties: { enabled: { type: 'boolean' } } } },
      },
      raw_arguments: { options: { enabled: true } },
      policy: { require_closed_schema: true },
    });
    expect(result.decision).toBe('rejected');
    expect(result.policy_result.outcome).toBe('denied');
    expect(result.policy_result.reasons.join(' ')).toContain('#/properties/options');
  });
  it('fails closed on malformed runtime policy values', () => {
    const result = validateToolCall({
      tool_name: 'counter',
      tool_schema: { type: 'object' },
      raw_arguments: {},
      policy: { max_repairs: -1 },
    });
    expect(result.decision).toBe('rejected');
    if (result.decision === 'rejected') expect(result.reason_code).toBe('SCHEMA_INVALID');
  });
  it('fails closed without recursively hashing cyclic or over-deep schemas', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.self = cyclic;
    expect(() =>
      validateToolCall({ tool_name: 'cyclic', tool_schema: cyclic, raw_arguments: {} }),
    ).not.toThrow();
    expect(
      validateToolCall({ tool_name: 'cyclic', tool_schema: cyclic, raw_arguments: {} }).decision,
    ).toBe('rejected');

    let deep: Record<string, unknown> = { type: 'string' };
    for (let index = 0; index < 70; index += 1) deep = { allOf: [deep] };
    const result = validateToolCall({ tool_name: 'deep', tool_schema: deep, raw_arguments: {} });
    expect(result.decision).toBe('rejected');
    if (result.decision === 'rejected') expect(result.reason_code).toBe('RESOURCE_LIMIT_EXCEEDED');
  });
  it('rejects non-JSON runtime objects without invoking accessors', () => {
    let getterCalls = 0;
    const accessorArguments: Record<string, unknown> = {};
    Object.defineProperty(accessorArguments, 'amount', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1000;
      },
    });
    const accessorResult = validateToolCall({
      tool_name: 'payment',
      tool_schema: { type: 'object' },
      raw_arguments: accessorArguments as never,
    });
    expect(accessorResult.decision).toBe('rejected');
    expect(getterCalls).toBe(0);

    const dateResult = validateToolCall({
      tool_name: 'schedule',
      tool_schema: { type: 'object' },
      raw_arguments: { when: new Date('2026-01-01T00:00:00Z') } as never,
    });
    expect(dateResult.decision).toBe('rejected');

    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = 'present';
    const sparseResult = validateToolCall({
      tool_name: 'batch',
      tool_schema: { type: 'object' },
      raw_arguments: { items: sparse } as never,
    });
    expect(sparseResult.decision).toBe('rejected');
  });
  it('rejects symbol keys and ill-formed Unicode at the local SDK boundary', () => {
    const symbolArguments: Record<string | symbol, unknown> = { amount: 1 };
    symbolArguments[Symbol('hidden')] = 1000;
    expect(
      validateToolCall({
        tool_name: 'payment',
        tool_schema: { type: 'object' },
        raw_arguments: symbolArguments as never,
      }).decision,
    ).toBe('rejected');

    expect(
      validateToolCall({
        tool_name: 'message',
        tool_schema: { type: 'object' },
        raw_arguments: { text: '\ud800' },
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
  it('rejects duplicate JSON object members instead of accepting parser-dependent arguments', () => {
    const duplicateTopLevel = validateToolCall({
      tool_name: 'payment',
      tool_schema: { type: 'object' },
      raw_arguments: '{"amount":1,"amount":1000}',
    });
    expect(duplicateTopLevel.decision).toBe('rejected');
    if (duplicateTopLevel.decision === 'rejected') {
      expect(duplicateTopLevel.reason_code).toBe('ARGUMENTS_JSON_INVALID');
      expect(duplicateTopLevel.reason).toBe('raw_arguments contains a duplicate object member');
    }

    const escapedEquivalent = validateToolCall({
      tool_name: 'payment',
      tool_schema: { type: 'object' },
      raw_arguments: '{"amount":1,"\\u0061mount":1000}',
    });
    expect(escapedEquivalent.decision).toBe('rejected');
    if (escapedEquivalent.decision === 'rejected')
      expect(escapedEquivalent.reason_code).toBe('ARGUMENTS_JSON_INVALID');

    const nestedDuplicate = validateToolCall({
      tool_name: 'payment',
      tool_schema: { type: 'object' },
      raw_arguments: '{"payment":{"amount":1,"amount":1000}}',
    });
    expect(nestedDuplicate.decision).toBe('rejected');
    if (nestedDuplicate.decision === 'rejected')
      expect(nestedDuplicate.reason_code).toBe('ARGUMENTS_JSON_INVALID');
  });
  it('allows the same JSON member name in separate objects', () => {
    const result = validateToolCall({
      tool_name: 'pair',
      tool_schema: {
        type: 'object',
        required: ['left', 'right'],
        properties: {
          left: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } } },
          right: {
            type: 'object',
            required: ['value'],
            properties: { value: { type: 'integer' } },
          },
        },
      },
      raw_arguments: '{"left":{"value":1},"right":{"value":2}}',
    });
    expect(result.decision).toBe('valid');
  });
  it('bounds raw JSON strings before parsing or recursively validating them', () => {
    const overDeep = validateToolCall({
      tool_name: 'nested',
      tool_schema: { type: 'object' },
      raw_arguments: `{"value":${'['.repeat(65)}0${']'.repeat(65)}}`,
    });
    expect(overDeep.decision).toBe('rejected');
    if (overDeep.decision === 'rejected')
      expect(overDeep.reason_code).toBe('RESOURCE_LIMIT_EXCEEDED');

    const overLarge = validateToolCall({
      tool_name: 'large',
      tool_schema: { type: 'object' },
      raw_arguments: `{"value":"${'a'.repeat(1_000_001)}"}`,
    });
    expect(overLarge.decision).toBe('rejected');
    if (overLarge.decision === 'rejected')
      expect(overLarge.reason_code).toBe('RESOURCE_LIMIT_EXCEEDED');
  });
  it('rejects potentially catastrophic schema regular expressions before validation', () => {
    const result = validateToolCall({
      tool_name: 'regex',
      tool_schema: {
        type: 'object',
        properties: { value: { type: 'string', pattern: '^(a+)+$' } },
      },
      raw_arguments: { value: `${'a'.repeat(100)}!` },
    });
    expect(result.decision).toBe('rejected');
    if (result.decision === 'rejected') expect(result.reason_code).toBe('SCHEMA_INVALID');
  });
});
