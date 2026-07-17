import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  validateToolCall,
  type DecisionStatus,
  type JsonObject,
} from '../packages/core/src/index.js';
const cases = JSON.parse(
  readFileSync(new URL('../conformance/cases.json', import.meta.url), 'utf8'),
) as { id: string; schema: object; arguments: JsonObject; decision: DecisionStatus }[];
describe('published conformance corpus', () => {
  for (const fixture of cases)
    it(fixture.id, () =>
      expect(
        validateToolCall({
          tool_name: fixture.id,
          tool_schema: fixture.schema,
          raw_arguments: fixture.arguments,
        }).decision,
      ).toBe(fixture.decision),
    );
});
