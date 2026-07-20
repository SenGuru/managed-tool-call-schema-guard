import type { AnySchema } from 'ajv';
import { sha256 } from './hash.js';
import type { DriftChange, DriftReport } from './types.js';

type SchemaObject = Record<string, unknown>;
const object = (value: unknown): value is SchemaObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const printable = (value: unknown): string => JSON.stringify(value) ?? 'undefined';
const pointer = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
const same = (left: unknown, right: unknown): boolean =>
  left === undefined || right === undefined ? left === right : sha256(left) === sha256(right);

export function detectSchemaDrift(previous: AnySchema, current: AnySchema): DriftReport {
  const previousHash = sha256(previous);
  const currentHash = sha256(current);
  const changes: DriftChange[] = [];
  if (previousHash !== currentHash) compare(previous, current, '', changes);
  if (previousHash !== currentHash && changes.length === 0)
    add(
      changes,
      '',
      'unclassified_change',
      'review',
      'schema changed in a way that requires compatibility review',
    );
  const hasBreaking = changes.some((change) => change.compatibility === 'breaking');
  const hasReview = changes.some((change) => change.compatibility === 'review');
  return {
    changed: previousHash !== currentHash,
    previous_schema_hash: previousHash,
    current_schema_hash: currentHash,
    compatibility:
      previousHash === currentHash
        ? 'identical'
        : hasBreaking
          ? 'breaking'
          : hasReview
            ? 'review'
            : 'backward_compatible',
    changes,
  };
}

function add(
  changes: DriftChange[],
  path: string,
  kind: DriftChange['kind'],
  compatibility: DriftChange['compatibility'],
  detail: string,
): void {
  changes.push({ path: path || '/', kind, compatibility, detail });
}

function typeSet(value: unknown): Set<string> {
  return new Set(typeof value === 'string' ? [value] : strings(value));
}
function compareTypes(before: unknown, after: unknown, path: string, changes: DriftChange[]): void {
  const left = typeSet(before);
  const right = typeSet(after);
  if (left.size === right.size && [...left].every((item) => right.has(item))) return;
  const compatibility =
    left.size === 0
      ? 'breaking'
      : right.size === 0
        ? 'non_breaking'
        : [...right].every((item) => left.has(item))
          ? 'breaking'
          : [...left].every((item) => right.has(item))
            ? 'non_breaking'
            : 'breaking';
  add(
    changes,
    path,
    'type_changed',
    compatibility,
    `type changed from ${printable(before)} to ${printable(after)}`,
  );
}

function compareSetConstraint(
  before: unknown,
  after: unknown,
  path: string,
  changes: DriftChange[],
): void {
  const leftPresent = Array.isArray(before);
  const rightPresent = Array.isArray(after);
  if (!leftPresent && rightPresent) {
    add(changes, path, 'enum_narrowed', 'breaking', 'an enum constraint was added');
    return;
  }
  if (leftPresent && !rightPresent) {
    add(changes, path, 'enum_widened', 'non_breaking', 'the enum constraint was removed');
    return;
  }
  if (!leftPresent || !rightPresent) return;
  const left = new Set(before.map(printable));
  const right = new Set(after.map(printable));
  if ([...left].some((item) => !right.has(item)))
    add(changes, path, 'enum_narrowed', 'breaking', 'previously accepted enum values were removed');
  if ([...right].some((item) => !left.has(item)))
    add(changes, path, 'enum_widened', 'non_breaking', 'enum values were added');
}

function compareConst(
  before: SchemaObject,
  after: SchemaObject,
  path: string,
  changes: DriftChange[],
): void {
  const had = Object.hasOwn(before, 'const');
  const has = Object.hasOwn(after, 'const');
  if (!had && has) add(changes, path, 'const_added', 'breaking', 'a const constraint was added');
  else if (had && !has)
    add(changes, path, 'const_removed', 'non_breaking', 'the const constraint was removed');
  else if (had && has && !same(before.const, after.const))
    add(changes, path, 'const_changed', 'breaking', 'the required constant value changed');
}

function numericConstraint(
  before: SchemaObject,
  after: SchemaObject,
  key: string,
  higherIsTighter: boolean,
  path: string,
  changes: DriftChange[],
): void {
  const left = before[key];
  const right = after[key];
  if (left === undefined && right === undefined) return;
  if (left === undefined && typeof right === 'number')
    add(changes, path, 'constraint_tightened', 'breaking', `${key} constraint was added`);
  else if (typeof left === 'number' && right === undefined)
    add(changes, path, 'constraint_relaxed', 'non_breaking', `${key} constraint was removed`);
  else if (typeof left === 'number' && typeof right === 'number' && left !== right) {
    const tighter = higherIsTighter ? right > left : right < left;
    add(
      changes,
      path,
      tighter ? 'constraint_tightened' : 'constraint_relaxed',
      tighter ? 'breaking' : 'non_breaking',
      `${key} changed from ${left} to ${right}`,
    );
  } else if (!same(left, right))
    add(changes, path, 'constraint_changed', 'review', `${key} changed`);
}

function compareMultipleOf(
  before: SchemaObject,
  after: SchemaObject,
  path: string,
  changes: DriftChange[],
): void {
  const left = before.multipleOf;
  const right = after.multipleOf;
  if (left === undefined && right === undefined) return;
  if (left === undefined && typeof right === 'number')
    add(changes, path, 'constraint_tightened', 'breaking', 'multipleOf constraint was added');
  else if (typeof left === 'number' && right === undefined)
    add(changes, path, 'constraint_relaxed', 'non_breaking', 'multipleOf constraint was removed');
  else if (typeof left === 'number' && typeof right === 'number' && left !== right) {
    if (Number.isInteger(right / left))
      add(
        changes,
        path,
        'constraint_tightened',
        'breaking',
        `multipleOf changed from ${left} to ${right}`,
      );
    else if (Number.isInteger(left / right))
      add(
        changes,
        path,
        'constraint_relaxed',
        'non_breaking',
        `multipleOf changed from ${left} to ${right}`,
      );
    else
      add(
        changes,
        path,
        'constraint_changed',
        'review',
        `multipleOf changed from ${left} to ${right}`,
      );
  } else if (!same(left, right))
    add(changes, path, 'constraint_changed', 'review', 'multipleOf changed');
}

function compare(before: AnySchema, after: AnySchema, path: string, changes: DriftChange[]): void {
  if (typeof before === 'boolean' || typeof after === 'boolean') {
    if (before === after) return;
    if (before === true)
      add(
        changes,
        path,
        'schema_restricted',
        'breaking',
        'schema changed from accepting all values',
      );
    else if (after === true)
      add(changes, path, 'schema_relaxed', 'non_breaking', 'schema now accepts all values');
    else if (before === false)
      add(changes, path, 'schema_relaxed', 'non_breaking', 'schema no longer rejects every value');
    else add(changes, path, 'schema_restricted', 'breaking', 'schema now rejects every value');
    return;
  }

  compareTypes(before.type, after.type, path, changes);
  const beforeRequired = new Set(strings(before.required));
  const afterRequired = new Set(strings(after.required));
  for (const key of afterRequired)
    if (!beforeRequired.has(key))
      add(
        changes,
        `${path}/${pointer(key)}`,
        'required_added',
        'breaking',
        'property became required',
      );
  for (const key of beforeRequired)
    if (!afterRequired.has(key))
      add(
        changes,
        `${path}/${pointer(key)}`,
        'required_removed',
        'non_breaking',
        'property is no longer required',
      );

  const beforeProperties = object(before.properties) ? before.properties : {};
  const afterProperties = object(after.properties) ? after.properties : {};
  for (const key of Object.keys(beforeProperties)) {
    const childPath = `${path}/${pointer(key)}`;
    if (!(key in afterProperties))
      add(
        changes,
        childPath,
        'property_removed',
        before.additionalProperties === false ? 'breaking' : 'review',
        'declared property was removed',
      );
    else {
      const left = beforeProperties[key];
      const right = afterProperties[key];
      if (
        (object(left) || typeof left === 'boolean') &&
        (object(right) || typeof right === 'boolean')
      )
        compare(left as AnySchema, right as AnySchema, childPath, changes);
      else if (!same(left, right))
        add(changes, childPath, 'unclassified_change', 'review', 'property schema changed');
    }
  }
  for (const key of Object.keys(afterProperties))
    if (!(key in beforeProperties))
      add(
        changes,
        `${path}/${pointer(key)}`,
        'property_added',
        afterRequired.has(key) ? 'breaking' : 'non_breaking',
        afterRequired.has(key)
          ? 'required declared property was added'
          : 'optional declared property was added',
      );

  compareSetConstraint(before.enum, after.enum, path, changes);
  compareConst(before, after, path, changes);
  if (before.additionalProperties !== false && after.additionalProperties === false)
    add(
      changes,
      path,
      'additional_properties_restricted',
      'breaking',
      'additional properties are no longer accepted',
    );
  else if (before.additionalProperties === false && after.additionalProperties !== false)
    add(
      changes,
      path,
      'additional_properties_relaxed',
      'non_breaking',
      'additional properties are now accepted',
    );
  else if (!same(before.additionalProperties, after.additionalProperties))
    add(changes, path, 'constraint_changed', 'review', 'additionalProperties schema changed');

  for (const key of ['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties'])
    numericConstraint(before, after, key, true, path, changes);
  for (const key of ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties'])
    numericConstraint(before, after, key, false, path, changes);
  compareMultipleOf(before, after, path, changes);

  if (!same(before.pattern, after.pattern)) {
    const compatibility =
      before.pattern === undefined
        ? 'breaking'
        : after.pattern === undefined
          ? 'non_breaking'
          : 'review';
    add(
      changes,
      path,
      compatibility === 'breaking'
        ? 'constraint_tightened'
        : compatibility === 'non_breaking'
          ? 'constraint_relaxed'
          : 'constraint_changed',
      compatibility,
      'pattern constraint changed',
    );
  }

  const handled = new Set([
    'type',
    'required',
    'properties',
    'enum',
    'const',
    'additionalProperties',
    'minimum',
    'exclusiveMinimum',
    'minLength',
    'minItems',
    'minProperties',
    'maximum',
    'exclusiveMaximum',
    'maxLength',
    'maxItems',
    'maxProperties',
    'multipleOf',
    'pattern',
  ]);
  const annotations = new Set([
    'title',
    'description',
    'default',
    'examples',
    '$comment',
    'deprecated',
    'readOnly',
    'writeOnly',
  ]);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (!handled.has(key) && !same(before[key], after[key]))
      add(
        changes,
        path,
        'unclassified_change',
        annotations.has(key) ? 'non_breaking' : 'review',
        `${key} changed`,
      );
}
