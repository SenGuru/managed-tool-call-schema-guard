import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';

const load = (name: string): object =>
  JSON.parse(
    readFileSync(new URL(`../protocol/v1/${name}.schema.json`, import.meta.url), 'utf8'),
  ) as object;

describe('wire protocol schemas', () => {
  const ajv = new Ajv2020({ strict: true });
  it('accepts a canonical request', () => {
    const validate = ajv.compile(load('validate-request'));
    expect(
      validate({
        protocol_version: '2026-07-18',
        tool_name: 'counter',
        tool_schema: { type: 'object' },
        raw_arguments: {},
      }),
    ).toBe(true);
  });
  it('every engine result conforms to the published decision envelope', () => {
    const validate = ajv.compile(load('decision'));
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['count'],
      properties: { count: { type: 'integer' } },
    } as const;
    const decisions = [
      validateToolCall({ tool_name: 'counter', tool_schema: schema, raw_arguments: { count: 4 } }),
      validateToolCall({
        tool_name: 'counter',
        tool_schema: schema,
        raw_arguments: { count: '4' },
      }),
      validateToolCall({ tool_name: 'counter', tool_schema: schema, raw_arguments: {} }),
      validateToolCall({
        tool_name: 'counter',
        tool_schema: schema,
        raw_arguments: { count: 4 },
        policy: { deny_argument_paths: ['/count'] },
      }),
    ];
    for (const decision of decisions) {
      expect(validate(decision), JSON.stringify(validate.errors)).toBe(true);
      expect(decision.audit_id).toBe(decision.audit.audit_id);
      expect(decision.decision).toBe(decision.audit.decision);
      expect(decision.policy_result.applied_policy_hash).toBe(decision.audit.policy_hash);
    }
  });
});
