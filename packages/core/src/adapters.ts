import type { AnySchema } from 'ajv';
import { sha256 } from './hash.js';
import type { AdapterName, NormalizedTool } from './types.js';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function schema(value: unknown, label: string): AnySchema {
  if (typeof value === 'boolean' || object(value)) return value as AnySchema;
  throw new TypeError(`${label} does not contain a JSON Schema object`);
}
function name(value: unknown, label: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new TypeError(`${label} does not contain a non-empty tool name`);
}
function result(
  adapter: AdapterName,
  toolName: string,
  toolSchema: AnySchema,
  source: unknown,
  warnings: string[] = [],
): NormalizedTool {
  return {
    adapter,
    tool_name: toolName,
    tool_schema: toolSchema,
    source_fingerprint: sha256(source),
    warnings,
  };
}

export function normalizeTool(adapter: AdapterName, source: unknown): NormalizedTool {
  if (!object(source)) throw new TypeError(`${adapter} tool declaration must be an object`);
  switch (adapter) {
    case 'json_schema':
      return result(
        adapter,
        name(source.name, adapter),
        schema(source.schema ?? source.parameters, adapter),
        source,
      );
    case 'mcp':
      return result(
        adapter,
        name(source.name, adapter),
        schema(source.inputSchema, adapter),
        source,
      );
    case 'openai_agents': {
      const fn = source.type === 'function' && object(source.function) ? source.function : source;
      return result(adapter, name(fn.name, adapter), schema(fn.parameters, adapter), source);
    }
    case 'pydantic_ai':
      return result(
        adapter,
        name(source.name, adapter),
        schema(source.parameters_json_schema ?? source.parameters, adapter),
        source,
      );
    case 'google_adk': {
      const declaration = object(source.function_declaration)
        ? source.function_declaration
        : source;
      const rawSchema = declaration.parameters_json_schema ?? declaration.parameters;
      return result(
        adapter,
        name(declaration.name, adapter),
        normalizeGoogleSchema(schema(rawSchema, adapter)),
        source,
        ['Google ADK uppercase primitive type labels were normalized when present'],
      );
    }
  }
}

function normalizeGoogleSchema(value: AnySchema): AnySchema {
  if (typeof value === 'boolean') return value;
  const input = value as Record<string, unknown>;
  const schemaMaps = new Set([
    'properties',
    'patternProperties',
    'dependentSchemas',
    '$defs',
    'definitions',
  ]);
  const schemaArrays = new Set(['prefixItems', 'allOf', 'anyOf', 'oneOf']);
  const schemaValues = new Set([
    'items',
    'contains',
    'additionalProperties',
    'propertyNames',
    'not',
    'if',
    'then',
    'else',
  ]);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (key === 'type' && typeof child === 'string') output[key] = child.toLowerCase();
    else if (key === 'type' && Array.isArray(child))
      output[key] = (child as unknown[]).map((item: unknown) =>
        typeof item === 'string' ? item.toLowerCase() : item,
      );
    else if (schemaMaps.has(key) && object(child))
      output[key] = Object.fromEntries(
        Object.entries(child).map(([property, propertySchema]) => [
          property,
          normalizeGoogleSchema(schema(propertySchema, `google_adk property ${property}`)),
        ]),
      );
    else if (schemaArrays.has(key) && Array.isArray(child))
      output[key] = child.map((entry) =>
        normalizeGoogleSchema(schema(entry, `google_adk ${key} entry`)),
      );
    else if (schemaValues.has(key) && (object(child) || typeof child === 'boolean'))
      output[key] = normalizeGoogleSchema(child as AnySchema);
    else output[key] = child;
  }
  return output as AnySchema;
}
