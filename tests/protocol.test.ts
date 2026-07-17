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
    const decision = validateToolCall({
      tool_name: 'counter',
      tool_schema: {
        type: 'object',
        required: ['count'],
        properties: { count: { type: 'integer' } },
      },
      raw_arguments: { count: '4' },
    });
    expect(validate(decision), JSON.stringify(validate.errors)).toBe(true);
  });
});
