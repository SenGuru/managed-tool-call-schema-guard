import { Ajv2020, type AnySchema, type ErrorObject } from 'ajv/dist/2020.js';
import { createAuditEnvelope } from './audit.js';
import { sha256 } from './hash.js';
import { assertJsonSafety, assertSafeSchemaPatterns, JsonResourceLimitError } from './limits.js';
import { evaluatePolicy, policyValidationError } from './policy.js';
import { applyRepairs } from './repair.js';
import {
  PROTOCOL_VERSION,
  type GuardDecision,
  type JsonObject,
  type PolicyResult,
  type ReasonCode,
  type RepairRecord,
  type ValidateRequest,
  type ValidationIssue,
} from './types.js';

const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
function withoutPolicy(request: ValidateRequest): ValidateRequest {
  const safe = { ...request };
  delete safe.policy;
  return safe;
}

function parseArguments(raw: ValidateRequest['raw_arguments']): JsonObject {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new TypeError('tool arguments must be a JSON object');
  assertJsonSafety(parsed, 'tool arguments');
  return structuredClone(parsed) as JsonObject;
}
function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed',
    ...(error.keyword === 'type' ? { expected: String(error.params.type) } : {}),
  }));
}
function reject(input: {
  request: ValidateRequest;
  args: JsonObject;
  reasonCode: ReasonCode;
  reason: string;
  hint: string;
  repairs?: RepairRecord[];
  validationErrors?: ValidationIssue[];
  policyResult?: PolicyResult;
}): GuardDecision {
  const repairs = input.repairs ?? [];
  const policy = input.policyResult ?? evaluatePolicy(input.request.policy, input.args, repairs);
  let auditSchema: AnySchema = {};
  let auditArguments: JsonObject = {};
  try {
    assertJsonSafety(input.request.tool_schema, 'audit schema');
    auditSchema = input.request.tool_schema;
  } catch {
    // Unsafe input is represented by the decision reason, never recursively hashed.
  }
  try {
    assertJsonSafety(input.args, 'audit arguments');
    auditArguments = input.args;
  } catch {
    // Unsafe input is represented by the decision reason, never recursively hashed.
  }
  const audit = createAuditEnvelope({
    toolName: input.request.tool_name,
    schema: auditSchema,
    arguments: auditArguments,
    decision: 'rejected',
    repairs,
    policyHash: policy.applied_policy_hash,
    reasonCode: input.reasonCode,
  });
  return {
    protocol_version: PROTOCOL_VERSION,
    decision: 'rejected',
    reason_code: input.reasonCode,
    reason: input.reason,
    repair_hint: input.hint,
    repaired_fields: repairs,
    policy_result: policy,
    audit_id: audit.audit_id,
    audit,
    ...(input.validationErrors ? { validation_errors: input.validationErrors } : {}),
  };
}
function firstOpenObject(
  schema: AnySchema,
  path = '#',
  seen = new Set<object>(),
): string | undefined {
  if (typeof schema === 'boolean' || seen.has(schema)) return undefined;
  const schemaObject = schema as Record<string, unknown>;
  seen.add(schemaObject);
  const schemaType = schemaObject.type;
  const types: unknown[] = Array.isArray(schemaType) ? schemaType : [schemaType];
  if (
    (types.includes('object') || schemaObject.properties) &&
    schemaObject.additionalProperties !== false
  )
    return path;
  const maps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
  for (const key of maps) {
    const children = schemaObject[key];
    if (children && typeof children === 'object' && !Array.isArray(children))
      for (const [name, child] of Object.entries(children))
        if (typeof child === 'boolean' || (child && typeof child === 'object')) {
          const found = firstOpenObject(child as AnySchema, `${path}/${key}/${name}`, seen);
          if (found) return found;
        }
  }
  for (const key of [
    'items',
    'contains',
    'additionalProperties',
    'propertyNames',
    'not',
    'if',
    'then',
    'else',
  ]) {
    const child = schemaObject[key];
    if (
      typeof child === 'boolean' ||
      (child && typeof child === 'object' && !Array.isArray(child))
    ) {
      const found = firstOpenObject(child as AnySchema, `${path}/${key}`, seen);
      if (found) return found;
    }
  }
  for (const key of ['prefixItems', 'allOf', 'anyOf', 'oneOf']) {
    const children = schemaObject[key];
    if (Array.isArray(children))
      for (const [index, child] of children.entries())
        if (typeof child === 'boolean' || (child && typeof child === 'object')) {
          const found = firstOpenObject(child as AnySchema, `${path}/${key}/${index}`, seen);
          if (found) return found;
        }
  }
  return undefined;
}
const hint = (found: ValidationIssue[]): string =>
  found
    .slice(0, 3)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');

export function validateToolCall(request: ValidateRequest): GuardDecision {
  let args: JsonObject = {};
  try {
    if (request === null || typeof request !== 'object' || Array.isArray(request))
      return reject({
        request: { tool_name: '<invalid>', tool_schema: {}, raw_arguments: {} },
        args,
        reasonCode: 'SCHEMA_INVALID',
        reason: 'validation request must be an object',
        hint: 'conform the request to protocol/v1/validate-request.schema.json',
      });
    if (
      typeof request.tool_name !== 'string' ||
      request.tool_name.length === 0 ||
      request.tool_name.length > 256 ||
      !Object.hasOwn(request, 'tool_schema') ||
      !Object.hasOwn(request, 'raw_arguments')
    ) {
      const safeRequest: ValidateRequest = {
        tool_name: typeof request.tool_name === 'string' ? request.tool_name : '<invalid>',
        tool_schema: Object.hasOwn(request, 'tool_schema') ? request.tool_schema : {},
        raw_arguments: {},
      };
      return reject({
        request: safeRequest,
        args,
        reasonCode: 'SCHEMA_INVALID',
        reason: 'request must contain a non-empty tool_name, tool_schema, and raw_arguments',
        hint: 'conform the request to protocol/v1/validate-request.schema.json',
      });
    }
    const policyError = policyValidationError(request.policy);
    if (policyError)
      return reject({
        request: withoutPolicy(request),
        args,
        reasonCode: 'SCHEMA_INVALID',
        reason: policyError,
        hint: 'supply a valid guard policy',
      });
    if (request.protocol_version && request.protocol_version !== PROTOCOL_VERSION)
      return reject({
        request,
        args,
        reasonCode: 'SCHEMA_INVALID',
        reason: `unsupported protocol version ${request.protocol_version}`,
        hint: `use protocol_version ${PROTOCOL_VERSION}`,
      });
    try {
      args = parseArguments(request.raw_arguments);
    } catch (error) {
      return reject({
        request,
        args,
        reasonCode:
          error instanceof JsonResourceLimitError
            ? 'RESOURCE_LIMIT_EXCEEDED'
            : typeof request.raw_arguments === 'string' && error instanceof SyntaxError
              ? 'ARGUMENTS_JSON_INVALID'
              : 'ARGUMENTS_NOT_OBJECT',
        reason: error instanceof Error ? error.message : 'invalid arguments',
        hint: 'supply raw_arguments as a JSON object or a JSON string containing an object',
      });
    }
    let validate;
    try {
      assertJsonSafety(request.tool_schema, 'tool schema');
      assertSafeSchemaPatterns(request.tool_schema);
      validate = ajv.compile(request.tool_schema as AnySchema);
    } catch (error) {
      return reject({
        request,
        args,
        reasonCode:
          error instanceof JsonResourceLimitError ? 'RESOURCE_LIMIT_EXCEEDED' : 'SCHEMA_INVALID',
        reason: error instanceof Error ? error.message : 'invalid tool schema',
        hint: 'supply a valid JSON Schema Draft 2020-12 schema',
      });
    }
    if (validate(args)) {
      const policy = evaluatePolicy(request.policy, args, []);
      const openPath = request.policy?.require_closed_schema
        ? firstOpenObject(request.tool_schema)
        : undefined;
      if (openPath) {
        policy.outcome = 'denied';
        policy.reasons.push(`policy requires additionalProperties: false at ${openPath}`);
      }
      if (policy.outcome === 'denied')
        return reject({
          request,
          args,
          reasonCode: 'POLICY_DENIED',
          reason: policy.reasons.join('; '),
          hint: 'remove denied fields or use an approved schema and policy',
          policyResult: policy,
        });
      const audit = createAuditEnvelope({
        toolName: request.tool_name,
        schema: request.tool_schema,
        arguments: args,
        decision: 'valid',
        repairs: [],
        policyHash: policy.applied_policy_hash,
      });
      return {
        protocol_version: PROTOCOL_VERSION,
        decision: 'valid',
        valid_arguments: args,
        repaired_fields: [],
        policy_result: policy,
        audit_id: audit.audit_id,
        audit,
      };
    }
    const before = toIssues(validate.errors);
    const repaired = applyRepairs(request.tool_schema, args, request.policy?.allowed_repairs);
    if (
      !repaired.repairs.length ||
      repaired.value === null ||
      Array.isArray(repaired.value) ||
      typeof repaired.value !== 'object'
    )
      return reject({
        request,
        args,
        reasonCode: 'SCHEMA_VALIDATION_FAILED',
        reason:
          'arguments do not satisfy the declared tool schema and no allowlisted repair applies',
        hint: hint(before),
        validationErrors: before,
      });
    const repairedArgs = repaired.value as JsonObject;
    if (!validate(repairedArgs)) {
      const after = toIssues(validate.errors);
      return reject({
        request,
        args,
        reasonCode: 'SCHEMA_VALIDATION_FAILED',
        reason: 'allowlisted repairs were insufficient to satisfy the declared tool schema',
        hint: hint(after),
        repairs: repaired.repairs,
        validationErrors: after,
      });
    }
    const policy = evaluatePolicy(request.policy, repairedArgs, repaired.repairs);
    const openPath = request.policy?.require_closed_schema
      ? firstOpenObject(request.tool_schema)
      : undefined;
    if (openPath) {
      policy.outcome = 'denied';
      policy.reasons.push(`policy requires additionalProperties: false at ${openPath}`);
    }
    if (policy.outcome === 'denied')
      return reject({
        request,
        args,
        reasonCode:
          repaired.repairs.length > (request.policy?.max_repairs ?? 8)
            ? 'REPAIR_LIMIT_EXCEEDED'
            : 'POLICY_DENIED',
        reason: policy.reasons.join('; '),
        hint: 'tighten the input or explicitly revise the guard policy',
        repairs: repaired.repairs,
        policyResult: policy,
      });
    const audit = createAuditEnvelope({
      toolName: request.tool_name,
      schema: request.tool_schema,
      arguments: args,
      decision: 'valid_with_repair',
      repairs: repaired.repairs,
      policyHash: policy.applied_policy_hash,
    });
    return {
      protocol_version: PROTOCOL_VERSION,
      decision: 'valid_with_repair',
      valid_arguments: repairedArgs,
      repaired_fields: repaired.repairs,
      policy_result: policy,
      audit_id: audit.audit_id,
      audit,
    };
  } catch (error) {
    const resourceLimited = error instanceof JsonResourceLimitError;
    return reject({
      request: withoutPolicy(request),
      args,
      reasonCode: resourceLimited ? 'RESOURCE_LIMIT_EXCEEDED' : 'INTERNAL_ERROR',
      reason: resourceLimited ? error.message : 'the guard failed closed after an internal error',
      hint: `retry safely and report tool fingerprint ${sha256(request.tool_name)}`,
    });
  }
}
