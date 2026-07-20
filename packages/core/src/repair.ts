import type { AnySchema } from 'ajv';
import { sha256 } from './hash.js';
import { RULESET_VERSION, type JsonValue, type RepairRecord, type RepairRuleId } from './types.js';

export const DEFAULT_REPAIRS: RepairRuleId[] = [
  'coerce.string_to_number',
  'coerce.string_to_integer',
  'coerce.string_to_boolean',
];
interface Context {
  allowed: Set<RepairRuleId>;
  repairs: RepairRecord[];
  root: AnySchema;
  resolving: Set<string>;
}
const kind = (value: JsonValue): string =>
  Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
function save(
  ctx: Context,
  schema: Record<string, unknown>,
  path: string,
  rule_id: RepairRuleId,
  before: JsonValue,
  after: JsonValue,
  matchedPreconditions: string[],
  ambiguityChecks: string[],
  targetType?: string,
): JsonValue {
  const repair: Omit<RepairRecord, 'receipt_hash'> = {
    path,
    rule_id,
    ruleset_version: RULESET_VERSION,
    from_type: kind(before),
    to_type: targetType ?? kind(after),
    original_value_hash: sha256(before),
    output_value_hash: sha256(after),
    schema_fragment_hash: sha256(schema),
    matched_preconditions: matchedPreconditions,
    ambiguity_checks: ambiguityChecks.map((check) => ({ check, result: 'passed' as const })),
    post_validation: { schema: 'not_run', policy: 'not_run' },
    explanation: `${rule_id} applied because the target schema explicitly requires ${targetType ?? kind(after)}`,
  };
  ctx.repairs.push({ ...repair, receipt_hash: sha256(repair) });
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
    if (/^-0(?:\.0+)?(?:[eE][+-]?\d+)?$/u.test(value)) return value;
    const converted = Number(value);
    if (
      !Number.isFinite(converted) ||
      !sameDecimalValue(value, String(converted)) ||
      (expected === 'integer' && !Number.isSafeInteger(converted))
    )
      return value;
    const rule = expected === 'integer' ? 'coerce.string_to_integer' : 'coerce.string_to_number';
    return ctx.allowed.has(rule)
      ? save(
          ctx,
          schema,
          path,
          rule,
          value,
          converted,
          ['input_is_string', `schema_type_is_${expected}`, 'repair_rule_is_allowlisted'],
          [
            'exact_decimal_grammar',
            'negative_zero_spelling_rejected',
            'finite_conversion',
            'exact_decimal_round_trip',
            ...(expected === 'integer' ? ['javascript_safe_integer'] : []),
          ],
          expected,
        )
      : value;
  }
  if (typeof value === 'string' && expected === 'boolean' && /^(true|false)$/u.test(value))
    return ctx.allowed.has('coerce.string_to_boolean')
      ? save(
          ctx,
          schema,
          path,
          'coerce.string_to_boolean',
          value,
          value === 'true',
          ['input_is_string', 'schema_type_is_boolean', 'repair_rule_is_allowlisted'],
          ['exact_lowercase_boolean_literal'],
        )
      : value;
  if (!Array.isArray(value) && expected === 'array')
    return ctx.allowed.has('coerce.singleton_to_array')
      ? save(
          ctx,
          schema,
          path,
          'coerce.singleton_to_array',
          value,
          [value],
          ['input_is_not_array', 'schema_type_is_array', 'repair_rule_is_allowlisted'],
          ['single_value_has_one_unambiguous_array_wrapping'],
        )
      : value;
  return value;
}
const escapePointer = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
function decimalCanonical(value: string): string | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(value);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  let digits = `${match[2]}${fraction}`.replace(/^0+/u, '');
  if (!digits) return '0e0';
  let exponent = Number(match[4] ?? 0) - fraction.length;
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exponent += 1;
  }
  return `${match[1]}${digits}e${exponent}`;
}
const sameDecimalValue = (before: string, after: string): boolean =>
  decimalCanonical(before) === decimalCanonical(after);

function localReference(root: AnySchema, reference: string): AnySchema | undefined {
  if (reference === '#') return root;
  if (!reference.startsWith('#/')) return undefined;
  let current: unknown = root;
  for (const encoded of reference.slice(2).split('/')) {
    const part = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'boolean' ||
    (current !== null && typeof current === 'object' && !Array.isArray(current))
    ? (current as AnySchema)
    : undefined;
}

function walk(schema: AnySchema, value: JsonValue, path: string, ctx: Context): JsonValue {
  if (typeof schema === 'boolean') return value;
  if (typeof schema.$ref === 'string' && !ctx.resolving.has(schema.$ref)) {
    const referenced = localReference(ctx.root, schema.$ref);
    if (referenced !== undefined) {
      ctx.resolving.add(schema.$ref);
      value = walk(referenced, value, path, ctx);
      ctx.resolving.delete(schema.$ref);
    }
  }
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
  const ctx: Context = {
    allowed: new Set(allowedRepairs ?? DEFAULT_REPAIRS),
    repairs: [],
    root: schema,
    resolving: new Set(),
  };
  return { value: walk(schema, value, '', ctx), repairs: ctx.repairs };
}

export function repairReceiptHash(repair: RepairRecord): string {
  const { receipt_hash: receiptHash, ...receipt } = repair;
  void receiptHash;
  return sha256(receipt);
}

export function verifyRepairReceipt(repair: RepairRecord): boolean {
  return repair.receipt_hash === repairReceiptHash(repair);
}

export function finalizeRepairReceipts(
  repairs: RepairRecord[],
  postValidation: RepairRecord['post_validation'],
): RepairRecord[] {
  return repairs.map((repair) => {
    const updated = { ...repair, post_validation: { ...postValidation } };
    return { ...updated, receipt_hash: repairReceiptHash(updated) };
  });
}
