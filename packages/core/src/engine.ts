import { Ajv2020, type AnySchema, type ErrorObject } from 'ajv/dist/2020.js';
import { createAuditEnvelope } from './audit.js';
import { sha256 } from './hash.js';
import { evaluatePolicy } from './policy.js';
import { applyRepairs } from './repair.js';
import {
  PROTOCOL_VERSION,
  type GuardDecision,
  type JsonObject,
  type ReasonCode,
  type RepairRecord,
  type ValidateRequest,
  type ValidationIssue,
} from './types.js';

const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });

function parseArguments(raw: ValidateRequest['raw_arguments']): JsonObject {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new TypeError('tool arguments must be a JSON object');
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
}): GuardDecision {
  const repairs = input.repairs ?? [];
  const policy = evaluatePolicy(input.request.policy, input.args, repairs);
  const audit = createAuditEnvelope({
    toolName: input.request.tool_name,
    schema: input.request.tool_schema,
    arguments: input.args,
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
function closed(schema: AnySchema): boolean {
  return typeof schema === 'object' && schema !== null && schema.additionalProperties === false;
}
const hint = (found: ValidationIssue[]): string =>
  found
    .slice(0, 3)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');

export function validateToolCall(request: ValidateRequest): GuardDecision {
  let args: JsonObject = {};
  try {
    if (
      typeof request.tool_name !== 'string' ||
      request.tool_name.length === 0 ||
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
          typeof request.raw_arguments === 'string' && error instanceof SyntaxError
            ? 'ARGUMENTS_JSON_INVALID'
            : 'ARGUMENTS_NOT_OBJECT',
        reason: error instanceof Error ? error.message : 'invalid arguments',
        hint: 'supply raw_arguments as a JSON object or a JSON string containing an object',
      });
    }
    let validate;
    try {
      validate = ajv.compile(request.tool_schema as AnySchema);
    } catch (error) {
      return reject({
        request,
        args,
        reasonCode: 'SCHEMA_INVALID',
        reason: error instanceof Error ? error.message : 'invalid tool schema',
        hint: 'supply a valid JSON Schema Draft 2020-12 schema',
      });
    }
    if (validate(args)) {
      const policy = evaluatePolicy(request.policy, args, []);
      if (request.policy?.require_closed_schema && !closed(request.tool_schema)) {
        policy.outcome = 'denied';
        policy.reasons.push('policy requires additionalProperties: false at the root');
      }
      if (policy.outcome === 'denied')
        return reject({
          request,
          args,
          reasonCode: 'POLICY_DENIED',
          reason: policy.reasons.join('; '),
          hint: 'remove denied fields or use an approved schema and policy',
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
    if (request.policy?.require_closed_schema && !closed(request.tool_schema)) {
      policy.outcome = 'denied';
      policy.reasons.push('policy requires additionalProperties: false at the root');
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
  } catch {
    return reject({
      request,
      args,
      reasonCode: 'INTERNAL_ERROR',
      reason: 'the guard failed closed after an internal error',
      hint: `retry safely and report request fingerprint ${sha256({ tool: request.tool_name, schema: request.tool_schema })}`,
    });
  }
}
