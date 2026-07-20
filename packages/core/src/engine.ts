import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv';
import { Ajv2019 } from 'ajv/dist/2019.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { createAuditEnvelope } from './audit.js';
import { sha256 } from './hash.js';
import { assertJsonSafety, assertSafeSchemaPatterns, JsonResourceLimitError } from './limits.js';
import { evaluatePolicy, policyValidationError } from './policy.js';
import { applyRepairs, finalizeRepairReceipts } from './repair.js';
import { parseUnambiguousJson } from './strict-json.js';
import {
  PROTOCOL_VERSION,
  type AcceptedDecision,
  type GuardDecision,
  type JsonObject,
  type PolicyResult,
  type ReasonCode,
  type RepairRecord,
  type RejectedDecision,
  type ValidateRequest,
  type ValidationIssue,
} from './types.js';

export function rejectAcceptedDecisionByPolicy(
  decision: AcceptedDecision,
  input: {
    policy_id: string;
    policy_reasons: string[];
    reason: string;
    repair_hint: string;
  },
): RejectedDecision {
  if (
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(input.policy_id) ||
    !input.policy_reasons.length ||
    input.policy_reasons.some((reason) => reason.length === 0 || reason.length > 512) ||
    input.reason.length === 0 ||
    input.reason.length > 1_000 ||
    input.repair_hint.length > 1_000
  )
    throw new TypeError('external policy rejection metadata is invalid');
  const repairedFields = finalizeRepairReceipts(decision.repaired_fields, {
    schema: 'passed',
    policy: 'denied',
  });
  const policyResult: PolicyResult = {
    outcome: 'denied',
    applied_policy_hash: sha256({
      upstream_policy_hash: decision.policy_result.applied_policy_hash,
      policy_id: input.policy_id,
      reasons: input.policy_reasons,
    }),
    reasons: [...input.policy_reasons],
  };
  const audit: GuardDecision['audit'] = {
    ...decision.audit,
    decision: 'rejected',
    reason_code: 'POLICY_DENIED',
    repair_receipt_hashes: repairedFields.map((repair) => repair.receipt_hash),
    policy_hash: policyResult.applied_policy_hash,
  };
  delete audit.validated_arguments_hash;
  return {
    protocol_version: PROTOCOL_VERSION,
    decision: 'rejected',
    reason_code: 'POLICY_DENIED',
    reason: input.reason,
    repair_hint: input.repair_hint,
    repaired_fields: repairedFields,
    policy_result: policyResult,
    audit_id: decision.audit_id,
    audit,
  };
}

const ajvOptions = {
  allErrors: true,
  strict: true,
  // JSON Schema permits `required` without a sibling `properties`; real tool
  // declarations use this to require keys while intentionally leaving values open.
  strictRequired: false,
  validateSchema: true,
} as const;
const ajvDraft7 = new Ajv(ajvOptions);
const ajv2019 = new Ajv2019(ajvOptions);
const ajv2020 = new Ajv2020(ajvOptions);
// ajv-formats is CommonJS and TypeScript's NodeNext interpretation varies by
// package-manager layout. The runtime default is the callable plugin.
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
for (const instance of [ajvDraft7, ajv2019, ajv2020]) addFormats(instance);

function compileSchema(schema: AnySchema): ValidateFunction {
  if (typeof schema === 'boolean') return ajv2020.compile(schema);
  const dialect = (schema as Record<string, unknown>).$schema;
  if (typeof dialect !== 'string') return ajv2020.compile(schema);
  if (/draft-0[467](?:\/|#|$)/u.test(dialect)) return ajvDraft7.compile(schema);
  if (/2019-09/u.test(dialect)) return ajv2019.compile(schema);
  return ajv2020.compile(schema);
}
function withoutPolicy(request: ValidateRequest): ValidateRequest {
  const safe = { ...request };
  delete safe.policy;
  return safe;
}

function parseArguments(raw: ValidateRequest['raw_arguments']): JsonObject {
  const parsed: unknown = typeof raw === 'string' ? parseUnambiguousJson(raw) : raw;
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
  repairPostValidation?: RepairRecord['post_validation'];
}): GuardDecision {
  const pendingRepairs = input.repairs ?? [];
  const policy =
    input.policyResult ?? evaluatePolicy(input.request.policy, input.args, pendingRepairs);
  const repairs = finalizeRepairReceipts(
    pendingRepairs,
    input.repairPostValidation ?? { schema: 'not_run', policy: 'not_run' },
  );
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
      validate = compileSchema(request.tool_schema as AnySchema);
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
        validatedArguments: args,
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
        repairPostValidation: { schema: 'failed', policy: 'not_run' },
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
        repairPostValidation: { schema: 'passed', policy: 'denied' },
      });
    const acceptedRepairs = finalizeRepairReceipts(repaired.repairs, {
      schema: 'passed',
      policy: 'allowed',
    });
    const audit = createAuditEnvelope({
      toolName: request.tool_name,
      schema: request.tool_schema,
      arguments: args,
      validatedArguments: repairedArgs,
      decision: 'valid_with_repair',
      repairs: acceptedRepairs,
      policyHash: policy.applied_policy_hash,
    });
    return {
      protocol_version: PROTOCOL_VERSION,
      decision: 'valid_with_repair',
      valid_arguments: repairedArgs,
      repaired_fields: acceptedRepairs,
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
