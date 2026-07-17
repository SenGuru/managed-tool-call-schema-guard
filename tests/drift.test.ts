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
});
