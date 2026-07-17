import { detectSchemaDrift, validateToolCall } from '../packages/core/src/index.js';
const v1 = {
  type: 'object',
  required: ['passengers'],
  properties: { passengers: { type: 'integer' } },
};
const v2 = {
  type: 'object',
  required: ['passengers', 'cabin'],
  properties: { passengers: { type: 'integer' }, cabin: { type: 'string' } },
};
console.log(
  JSON.stringify(
    validateToolCall({
      tool_name: 'book_flight',
      tool_schema: v1,
      raw_arguments: { passengers: '2' },
    }),
    null,
    2,
  ),
);
console.log(JSON.stringify(detectSchemaDrift(v1, v2), null, 2));
