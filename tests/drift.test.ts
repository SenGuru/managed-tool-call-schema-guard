import { describe, expect, it } from 'vitest';
import { detectSchemaDrift } from '../packages/core/src/index.js';

describe('schema drift', () => {
  it('classifies added required fields and type changes as breaking', () => {
    const before = {
      type: 'object',
      properties: { city: { type: 'string' }, units: { type: 'string', enum: ['c', 'f'] } },
      required: ['city'],
    };
    const after = {
      type: 'object',
      properties: {
        city: { type: 'string' },
        units: { type: 'integer' },
        country: { type: 'string' },
      },
      required: ['city', 'country'],
    };
    const report = detectSchemaDrift(before, after);
    expect(report.compatibility).toBe('breaking');
    expect(report.changes.map((c) => c.kind)).toContain('required_added');
    expect(report.changes.map((c) => c.kind)).toContain('type_changed');
  });
  it('ignores object key ordering', () => {
    expect(
      detectSchemaDrift(
        { type: 'object', properties: { a: { type: 'string' } } },
        { properties: { a: { type: 'string' } }, type: 'object' },
      ).compatibility,
    ).toBe('identical');
  });
  it('classifies optional additions as backward compatible', () => {
    expect(
      detectSchemaDrift(
        { type: 'object', properties: {} },
        { type: 'object', properties: { note: { type: 'string' } } },
      ).compatibility,
    ).toBe('backward_compatible');
  });
  it('never labels unrecognized or boolean schema changes as compatible', () => {
    expect(detectSchemaDrift(true, false).compatibility).toBe('breaking');
    const report = detectSchemaDrift(
      { type: 'integer', customKeyword: 'a' },
      { type: 'integer', customKeyword: 'b' },
    );
    expect(report.compatibility).toBe('review');
    expect(report.changes.map((change) => change.kind)).toContain('unclassified_change');
  });
  it('classifies bounds and newly introduced enums conservatively', () => {
    expect(
      detectSchemaDrift({ type: 'integer', minimum: 0 }, { type: 'integer', minimum: 10 })
        .compatibility,
    ).toBe('breaking');
    expect(
      detectSchemaDrift({ type: 'string' }, { type: 'string', enum: ['safe'] }).compatibility,
    ).toBe('breaking');
  });
  it('emits unambiguous JSON Pointer paths', () => {
    const report = detectSchemaDrift(
      { type: 'object', properties: {} },
      { type: 'object', properties: { 'a/b~c': { type: 'string' } } },
    );
    expect(report.changes[0]?.path).toBe('/a~1b~0c');
  });
  it('does not call non-divisible multipleOf changes compatible', () => {
    expect(
      detectSchemaDrift({ type: 'number', multipleOf: 6 }, { type: 'number', multipleOf: 4 })
        .compatibility,
    ).toBe('review');
    expect(
      detectSchemaDrift({ type: 'number', multipleOf: 4 }, { type: 'number', multipleOf: 2 })
        .compatibility,
    ).toBe('backward_compatible');
  });
});
