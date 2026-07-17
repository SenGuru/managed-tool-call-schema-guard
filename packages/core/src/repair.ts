import type { AnySchema } from 'ajv';
import { sha256 } from './hash.js';
import type { JsonValue, RepairRecord, RepairRuleId } from './types.js';

export const DEFAULT_REPAIRS: RepairRuleId[] = [
  'coerce.string_to_number',
  'coerce.string_to_integer',
  'coerce.string_to_boolean',
];
interface Context {
  allowed: Set<RepairRuleId>;
  repairs: RepairRecord[];
}
const kind = (value: JsonValue): string =>
  Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
function save(
  ctx: Context,
  path: string,
  rule_id: RepairRuleId,
  before: JsonValue,
  after: JsonValue,
  targetType?: string,
): JsonValue {
  ctx.repairs.push({
    path,
    rule_id,
    from_type: kind(before),
    to_type: targetType ?? kind(after),
    original_value_hash: sha256(before),
    explanation: `${rule_id} applied because the target schema explicitly requires ${targetType ?? kind(after)}`,
  });
  return after;
}
function scalar(
  schema: Record<string, unknown>,
  value: JsonValue,
  path: string,
  ctx: Context,
): JsonValue {
  const expected = schema.type;
  if (typeof value === 'string' && (expected === 'number' || expected === 'integer')) {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)) return value;
    const converted = Number(value);
    if (!Number.isFinite(converted) || (expected === 'integer' && !Number.isInteger(converted)))
      return value;
    const rule = expected === 'integer' ? 'coerce.string_to_integer' : 'coerce.string_to_number';
    return ctx.allowed.has(rule) ? save(ctx, path, rule, value, converted, expected) : value;
  }
  if (typeof value === 'string' && expected === 'boolean' && /^(true|false)$/u.test(value))
    return ctx.allowed.has('coerce.string_to_boolean')
      ? save(ctx, path, 'coerce.string_to_boolean', value, value === 'true')
      : value;
  if (!Array.isArray(value) && expected === 'array')
    return ctx.allowed.has('coerce.singleton_to_array')
      ? save(ctx, path, 'coerce.singleton_to_array', value, [value])
      : value;
  return value;
}
const escapePointer = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
function walk(schema: AnySchema, value: JsonValue, path: string, ctx: Context): JsonValue {
  if (typeof schema === 'boolean') return value;
  let output = scalar(schema, value, path, ctx);
  if (Array.isArray(output) && typeof schema.items === 'object' && schema.items !== null)
    output = output.map((item, index) =>
      walk(schema.items as AnySchema, item, `${path}/${index}`, ctx),
    );
  else if (
    output !== null &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    schema.properties &&
    typeof schema.properties === 'object'
  )
    output = Object.fromEntries(
      Object.entries(output).map(([key, child]) => {
        const childSchema = (schema.properties as Record<string, AnySchema>)[key];
        return [
          key,
          childSchema ? walk(childSchema, child, `${path}/${escapePointer(key)}`, ctx) : child,
        ];
      }),
    );
  return output;
}
export function applyRepairs(
  schema: AnySchema,
  value: JsonValue,
  allowedRepairs?: RepairRuleId[],
): { value: JsonValue; repairs: RepairRecord[] } {
  const ctx: Context = { allowed: new Set(allowedRepairs ?? DEFAULT_REPAIRS), repairs: [] };
  return { value: walk(schema, value, '', ctx), repairs: ctx.repairs };
}
