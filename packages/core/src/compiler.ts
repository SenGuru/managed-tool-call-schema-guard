import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { sha256 } from './hash.js';
import { assertJsonSafety, assertSafeSchemaPatterns } from './limits.js';
import {
  ENGINE_VERSION,
  type CompileContractRequest,
  type CompiledContract,
  type ContractCompatibilityStatus,
  type ContractIssue,
  type ContractTarget,
  type ContractTransformation,
  type JsonObject,
  type JsonValue,
} from './types.js';

const PROFILE_VERSION: Record<ContractTarget, string> = {
  openai: 'openai-function-strict-2026-07-20',
  anthropic: 'anthropic-client-tools-2026-07-20',
  google_gemini: 'google-function-declaration-2026-07-17',
  mcp: 'mcp-tools-2025-11-25',
};

const DEFAULT_TARGET_VERSION: Record<ContractTarget, string> = {
  openai: 'responses/function',
  anthropic: 'messages/tools',
  google_gemini: 'function-declarations',
  mcp: '2025-11-25',
};

const OPENAI_SUPPORTED = new Set([
  '$defs',
  '$ref',
  'additionalProperties',
  'anyOf',
  'description',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'items',
  'maxItems',
  'maximum',
  'minItems',
  'minimum',
  'multipleOf',
  'pattern',
  'properties',
  'required',
  'type',
]);
const OPENAI_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
]);
const GOOGLE_SUPPORTED = new Set([
  'anyOf',
  'defs',
  'description',
  'enum',
  'format',
  'items',
  'nullable',
  'properties',
  'ref',
  'required',
  'type',
]);
const CONTRACT_TARGETS = new Set<ContractTarget>(['openai', 'anthropic', 'google_gemini', 'mcp']);

type MutableSchema = boolean | { [key: string]: unknown };

function pointer(path: string, key: string): string {
  const escaped = key.replace(/~/gu, '~0').replace(/\//gu, '~1');
  return path === '/' ? `/${escaped}` : `${path}/${escaped}`;
}

function appendRelative(path: string, relative: string): string {
  return path === '/' ? `/${relative}` : `${path}/${relative}`;
}

function issue(
  issues: ContractIssue[],
  path: string,
  code: string,
  message: string,
  action: string,
  severity: ContractIssue['severity'] = 'blocker',
): void {
  issues.push({ path, code, severity, message, action });
}

function transform(
  transformations: ContractTransformation[],
  path: string,
  transformId: ContractTransformation['transform_id'],
  semantics: ContractTransformation['semantics'],
  before: unknown,
  after: unknown,
): void {
  transformations.push({
    path,
    transform_id: transformId,
    semantics,
    before_hash: sha256({ present: before !== undefined, value: before ?? null }),
    after_hash: sha256({ present: after !== undefined, value: after ?? null }),
  });
}

function schemaChildren(object: Record<string, unknown>): [string, unknown][] {
  const children: [string, unknown][] = [];
  for (const key of ['items', 'not', 'if', 'then', 'else']) {
    if (key in object) children.push([key, object[key]]);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    const value = object[key];
    if (Array.isArray(value))
      value.forEach((child, index) => children.push([`${key}/${index}`, child]));
  }
  for (const key of ['$defs', 'defs', 'properties', 'patternProperties', 'dependentSchemas']) {
    const value = object[key];
    if (value && typeof value === 'object' && !Array.isArray(value))
      for (const [name, child] of Object.entries(value as Record<string, unknown>).sort(
        ([a], [b]) => a.localeCompare(b),
      ))
        children.push([`${key}/${name.replace(/~/gu, '~0').replace(/\//gu, '~1')}`, child]);
  }
  return children;
}

function rootIsObject(schema: MutableSchema): boolean {
  if (typeof schema === 'boolean') return false;
  const type = schema.type;
  return type === 'object' || (Array.isArray(type) && type.includes('object'));
}

function validateCanonicalSchema(
  schema: unknown,
  issues: ContractIssue[],
): schema is MutableSchema {
  try {
    assertJsonSafety(schema, 'canonical tool schema');
    assertSafeSchemaPatterns(schema);
  } catch (error) {
    issue(
      issues,
      '/',
      'CANONICAL_SCHEMA_UNSAFE',
      error instanceof Error ? error.message : String(error),
      'Reduce schema size/complexity and remove unsafe patterns.',
    );
    return false;
  }
  const validator = new Ajv2020({ strict: true, strictRequired: false, validateSchema: true });
  const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
  addFormats(validator);
  if (!validator.validateSchema(schema as AnySchema)) {
    for (const error of validator.errors ?? [])
      issue(
        issues,
        error.instancePath || '/',
        'CANONICAL_SCHEMA_INVALID',
        error.message ?? 'invalid JSON Schema 2020-12 schema',
        'Correct the canonical JSON Schema before compiling it.',
      );
    return false;
  }
  try {
    validator.compile(schema as AnySchema);
  } catch (error) {
    issue(
      issues,
      '/',
      'CANONICAL_SCHEMA_COMPILE_FAILED',
      error instanceof Error ? error.message : String(error),
      'Remove unknown keywords and correct unresolved or unsupported references.',
    );
    return false;
  }
  if (!rootIsObject(schema as MutableSchema)) {
    issue(
      issues,
      '/',
      'TOOL_ROOT_NOT_OBJECT',
      'Tool arguments must use an object schema at the root.',
      'Wrap parameters in a root object schema.',
    );
    return false;
  }
  return true;
}

function applyConstTransforms(
  schema: MutableSchema,
  transformations: ContractTransformation[],
  path = '/',
): void {
  if (typeof schema === 'boolean') return;
  if ('const' in schema && !('enum' in schema)) {
    const before = { const: schema.const };
    schema.enum = [structuredClone(schema.const)] as unknown[];
    delete schema.const;
    transform(
      transformations,
      pointer(path, 'const'),
      'const_to_singleton_enum',
      'lossless',
      before,
      { enum: schema.enum },
    );
  }
  for (const [relative, child] of schemaChildren(schema)) {
    if (child !== null && typeof child === 'object')
      applyConstTransforms(child as MutableSchema, transformations, appendRelative(path, relative));
  }
}

function checkName(request: CompileContractRequest, issues: ContractIssue[]): void {
  const regex =
    request.target === 'google_gemini'
      ? /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/u
      : /^[A-Za-z0-9_-]{1,64}$/u;
  if (!regex.test(request.tool_name))
    issue(
      issues,
      '/name',
      'TOOL_NAME_UNSUPPORTED',
      `Tool name is not valid for ${request.target}.`,
      'Use at most 64 provider-supported letters, digits, underscores, or hyphens.',
    );
}

function checkOpenAi(
  schema: MutableSchema,
  issues: ContractIssue[],
  request: CompileContractRequest,
  transformations: ContractTransformation[],
  path = '/',
): void {
  if (typeof schema === 'boolean') {
    issue(
      issues,
      path,
      'BOOLEAN_SCHEMA_UNSUPPORTED',
      'Boolean schemas are unsupported.',
      'Use an explicit object schema.',
    );
    return;
  }
  for (const key of Object.keys(schema).sort()) {
    if (key === '$schema') {
      const before = schema[key];
      delete schema.$schema;
      transform(
        transformations,
        pointer(path, key),
        'drop_dialect_annotation',
        'lossless',
        before,
        undefined,
      );
    } else if (!OPENAI_SUPPORTED.has(key)) {
      issue(
        issues,
        pointer(path, key),
        'OPENAI_KEYWORD_UNSUPPORTED',
        `OpenAI strict function schemas do not support ${key}.`,
        'Remove the constraint or select non-strict provider operation outside this compiler profile.',
      );
    }
  }
  if (typeof schema.format === 'string' && !OPENAI_FORMATS.has(schema.format))
    issue(
      issues,
      pointer(path, 'format'),
      'OPENAI_FORMAT_UNSUPPORTED',
      `OpenAI strict mode does not document format ${schema.format}.`,
      'Use a documented format or enforce it at the Schema Guard execution checkpoint.',
    );
  if (schema.type === 'object') {
    const properties =
      schema.properties &&
      typeof schema.properties === 'object' &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const optional = Object.keys(properties).filter((key) => !required.has(key));
    const needsClose = schema.additionalProperties !== false;
    if (optional.length || needsClose) {
      if (request.openai_strict_policy !== 'normalize') {
        issue(
          issues,
          path,
          'OPENAI_STRICT_POLICY_REQUIRED',
          'OpenAI strict mode requires every property to be required and every object to be closed.',
          "Set openai_strict_policy='normalize' only if your tool accepts explicit nulls and closed objects.",
        );
      } else {
        for (const name of optional) {
          const child = properties[name];
          if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
          const object = child as Record<string, unknown>;
          const before = structuredClone(object);
          if (Array.isArray(object.type)) {
            const existingTypes: unknown[] = object.type;
            if (!existingTypes.includes('null')) object.type = [...existingTypes, 'null'];
          } else if (typeof object.type === 'string') object.type = [object.type, 'null'];
          else {
            const existingBranches: unknown[] = Array.isArray(object.anyOf) ? object.anyOf : [];
            object.anyOf = [...existingBranches, { type: 'null' }];
          }
          transform(
            transformations,
            pointer(pointer(path, 'properties'), name),
            'openai_strict_optional_nullable',
            'policy_authorized',
            before,
            object,
          );
        }
        const beforeRequired = schema.required;
        schema.required = Object.keys(properties);
        if (optional.length)
          transform(
            transformations,
            pointer(path, 'required'),
            'openai_strict_optional_nullable',
            'policy_authorized',
            beforeRequired,
            schema.required,
          );
        if (needsClose) {
          const before = schema.additionalProperties;
          schema.additionalProperties = false;
          transform(
            transformations,
            pointer(path, 'additionalProperties'),
            'openai_strict_close_object',
            'policy_authorized',
            before,
            false,
          );
        }
      }
    }
  }
  for (const [relative, child] of schemaChildren(schema)) {
    if (child !== null && (typeof child === 'object' || typeof child === 'boolean'))
      checkOpenAi(
        child as MutableSchema,
        issues,
        request,
        transformations,
        appendRelative(path, relative),
      );
  }
}

function checkGoogle(
  schema: MutableSchema,
  issues: ContractIssue[],
  transformations: ContractTransformation[],
  path = '/',
): void {
  if (typeof schema === 'boolean') {
    issue(
      issues,
      path,
      'BOOLEAN_SCHEMA_UNSUPPORTED',
      'Boolean schemas are unsupported.',
      'Use an explicit object schema.',
    );
    return;
  }
  if ('$schema' in schema) {
    const before = schema.$schema;
    delete schema.$schema;
    transform(
      transformations,
      pointer(path, '$schema'),
      'drop_dialect_annotation',
      'lossless',
      before,
      undefined,
    );
  }
  if ('$defs' in schema) {
    const before = schema.$defs;
    schema.defs = schema.$defs;
    delete schema.$defs;
    transform(
      transformations,
      pointer(path, '$defs'),
      'google_reference_syntax',
      'lossless',
      before,
      schema.defs,
    );
  }
  if (typeof schema.$ref === 'string') {
    const original = schema.$ref;
    if (!/^#\/\$defs\/[^/]+$/u.test(original))
      issue(
        issues,
        pointer(path, '$ref'),
        'GOOGLE_REFERENCE_UNSUPPORTED',
        'Google documents only local references to direct children of defs.',
        'Flatten or restructure the reference to a direct local definition.',
      );
    else {
      schema.ref = original.replace('#/$defs/', '#/defs/');
      delete schema.$ref;
      transform(
        transformations,
        pointer(path, '$ref'),
        'google_reference_syntax',
        'lossless',
        original,
        schema.ref,
      );
    }
  }
  if (Array.isArray(schema.type) && schema.type.length === 2 && schema.type.includes('null')) {
    const existingTypes: unknown[] = schema.type;
    const nonNull = existingTypes.find((entry) => entry !== 'null');
    if (typeof nonNull === 'string') {
      const before = schema.type;
      schema.type = nonNull;
      schema.nullable = true;
      transform(
        transformations,
        pointer(path, 'type'),
        'google_nullable_type',
        'lossless',
        before,
        {
          type: nonNull,
          nullable: true,
        },
      );
    }
  }
  for (const key of Object.keys(schema).sort()) {
    if (!GOOGLE_SUPPORTED.has(key))
      issue(
        issues,
        pointer(path, key),
        'GOOGLE_KEYWORD_UNSUPPORTED',
        `Google function declarations do not document support for ${key}.`,
        'Remove the constraint from the declaration and enforce it at the Schema Guard execution checkpoint.',
      );
  }
  for (const [relative, child] of schemaChildren(schema)) {
    if (child !== null && (typeof child === 'object' || typeof child === 'boolean'))
      checkGoogle(child as MutableSchema, issues, transformations, appendRelative(path, relative));
  }
}

function statusFor(
  issues: ContractIssue[],
  transformations: ContractTransformation[],
  runtimeVerified: boolean,
): ContractCompatibilityStatus {
  if (
    issues.some(
      (item) => item.severity === 'blocker' && item.code !== 'OPENAI_STRICT_POLICY_REQUIRED',
    )
  )
    return 'unsupported';
  if (
    issues.some((item) => item.code === 'OPENAI_STRICT_POLICY_REQUIRED') ||
    transformations.some((item) => item.semantics === 'policy_authorized')
  )
    return 'policy_required';
  if (transformations.length) return 'lossless_transform';
  return runtimeVerified ? 'native' : 'runtime_unverified';
}

export function compileToolContract(request: CompileContractRequest): CompiledContract {
  if (!CONTRACT_TARGETS.has(request.target))
    throw new TypeError(`unknown contract target: ${request.target}`);
  const issues: ContractIssue[] = [];
  const transformations: ContractTransformation[] = [];
  checkName(request, issues);
  let schema: MutableSchema | null = null;
  if (validateCanonicalSchema(request.tool_schema, issues)) {
    schema = structuredClone(request.tool_schema) as MutableSchema;
    applyConstTransforms(schema, transformations);
    if (request.target === 'openai') checkOpenAi(schema, issues, request, transformations);
    if (request.target === 'google_gemini') checkGoogle(schema, issues, transformations);
  }

  const status = statusFor(issues, transformations, request.runtime_verified === true);
  let declaration: JsonObject | null = null;
  if (
    schema !== null &&
    status !== 'unsupported' &&
    !(status === 'policy_required' && request.openai_strict_policy !== 'normalize')
  ) {
    const common = {
      name: request.tool_name,
      ...(request.description ? { description: request.description } : {}),
    };
    if (request.target === 'openai')
      declaration = { ...common, strict: true, parameters: schema as JsonValue };
    if (request.target === 'anthropic')
      declaration = { ...common, strict: true, input_schema: schema as JsonValue };
    if (request.target === 'google_gemini')
      declaration = { ...common, parameters: schema as JsonValue };
    if (request.target === 'mcp') declaration = { ...common, inputSchema: schema as JsonValue };
  }

  return {
    compiler_version: ENGINE_VERSION,
    target: request.target,
    target_version: request.target_version ?? DEFAULT_TARGET_VERSION[request.target],
    capability_profile: PROFILE_VERSION[request.target],
    status,
    source_schema_hash: sha256(request.tool_schema),
    ...(declaration ? { compiled_declaration_hash: sha256(declaration) } : {}),
    declaration,
    issues,
    transformations,
    runtime_verification: request.runtime_verified ? 'verified_by_caller' : 'not_verified',
  };
}
