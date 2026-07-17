import type { AnySchema } from 'ajv';
import { sha256 } from './hash.js';
import type { DriftChange, DriftReport } from './types.js';

type SchemaObject = Record<string, unknown>;
const objectSchema = (value: AnySchema): SchemaObject => (typeof value === 'boolean' ? {} : value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const printable = (value: unknown): string => JSON.stringify(value);

export function detectSchemaDrift(previous: AnySchema, current: AnySchema): DriftReport {
  const previousHash = sha256(previous);
  const currentHash = sha256(current);
  const changes: DriftChange[] = [];
  if (previousHash !== currentHash)
    compare(objectSchema(previous), objectSchema(current), '', changes);
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
function compare(
  before: SchemaObject,
  after: SchemaObject,
  path: string,
  changes: DriftChange[],
): void {
  if (printable(before.type) !== printable(after.type))
    add(
      changes,
      path,
      'type_changed',
      'breaking',
      `type changed from ${printable(before.type)} to ${printable(after.type)}`,
    );
  const beforeRequired = new Set(strings(before.required));
  const afterRequired = new Set(strings(after.required));
  for (const key of afterRequired)
    if (!beforeRequired.has(key))
      add(changes, `${path}/${key}`, 'required_added', 'breaking', 'property became required');
  for (const key of beforeRequired)
    if (!afterRequired.has(key))
      add(
        changes,
        `${path}/${key}`,
        'required_removed',
        'non_breaking',
        'property is no longer required',
      );
  const beforeProperties = object(before.properties) ? before.properties : {};
  const afterProperties = object(after.properties) ? after.properties : {};
  for (const key of Object.keys(beforeProperties)) {
    if (!(key in afterProperties))
      add(
        changes,
        `${path}/${key}`,
        'property_removed',
        before.additionalProperties === false ? 'breaking' : 'review',
        'declared property was removed',
      );
    else if (
      (object(beforeProperties[key]) || typeof beforeProperties[key] === 'boolean') &&
      (object(afterProperties[key]) || typeof afterProperties[key] === 'boolean')
    )
      compare(
        objectSchema(beforeProperties[key] as AnySchema),
        objectSchema(afterProperties[key] as AnySchema),
        `${path}/${key}`,
        changes,
      );
  }
  for (const key of Object.keys(afterProperties))
    if (!(key in beforeProperties))
      add(
        changes,
        `${path}/${key}`,
        'property_added',
        afterRequired.has(key) ? 'breaking' : 'non_breaking',
        afterRequired.has(key)
          ? 'required declared property was added'
          : 'optional declared property was added',
      );
  const beforeEnum = new Set(Array.isArray(before.enum) ? before.enum.map(printable) : []);
  const afterEnum = new Set(Array.isArray(after.enum) ? after.enum.map(printable) : []);
  if (beforeEnum.size && afterEnum.size) {
    if ([...beforeEnum].some((item) => !afterEnum.has(item)))
      add(
        changes,
        path,
        'enum_narrowed',
        'breaking',
        'one or more previously accepted enum values were removed',
      );
    if ([...afterEnum].some((item) => !beforeEnum.has(item)))
      add(changes, path, 'enum_widened', 'non_breaking', 'one or more enum values were added');
  }
  if (before.additionalProperties !== false && after.additionalProperties === false)
    add(
      changes,
      path,
      'additional_properties_restricted',
      'breaking',
      'additional properties are no longer accepted',
    );
  if (before.additionalProperties === false && after.additionalProperties !== false)
    add(
      changes,
      path,
      'additional_properties_relaxed',
      'non_breaking',
      'additional properties are now accepted',
    );
}
