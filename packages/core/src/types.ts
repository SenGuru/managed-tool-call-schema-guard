import type { AnySchema } from 'ajv';

export const PROTOCOL_VERSION = '2026-07-18' as const;
export const ENGINE_VERSION = '0.1.0' as const;
export const RULESET_VERSION = 'oss-2026-07-18.1' as const;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type DecisionStatus = 'valid' | 'valid_with_repair' | 'rejected';
export type ReasonCode =
  | 'ARGUMENTS_NOT_OBJECT'
  | 'ARGUMENTS_JSON_INVALID'
  | 'SCHEMA_INVALID'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'REPAIR_LIMIT_EXCEEDED'
  | 'POLICY_DENIED'
  | 'INTERNAL_ERROR';
export type RepairRuleId =
  | 'coerce.string_to_number'
  | 'coerce.string_to_integer'
  | 'coerce.string_to_boolean'
  | 'coerce.singleton_to_array';
export type AdapterName = 'json_schema' | 'mcp' | 'openai_agents' | 'pydantic_ai' | 'google_adk';

export interface RepairRecord {
  path: string;
  rule_id: RepairRuleId;
  from_type: string;
  to_type: string;
  original_value_hash: string;
  explanation: string;
}
export interface GuardPolicy {
  allowed_repairs?: RepairRuleId[];
  max_repairs?: number;
  deny_argument_paths?: string[];
  require_closed_schema?: boolean;
}
export interface ValidateRequest {
  protocol_version?: string;
  tool_name: string;
  tool_schema: AnySchema;
  raw_arguments: JsonObject | string;
  policy?: GuardPolicy;
  context?: { adapter?: AdapterName; tool_version?: string; schema_revision?: string };
}
export interface PolicyResult {
  outcome: 'allowed' | 'denied';
  applied_policy_hash: string;
  reasons: string[];
}
export interface ValidationIssue {
  path: string;
  keyword: string;
  message: string;
  expected?: string;
}
export interface AuditEnvelope {
  audit_id: string;
  timestamp: string;
  protocol_version: typeof PROTOCOL_VERSION;
  engine_version: typeof ENGINE_VERSION;
  ruleset_version: typeof RULESET_VERSION;
  tool_name_hash: string;
  schema_hash: string;
  arguments_hash: string;
  argument_shape: string[];
  decision: DecisionStatus;
  reason_code?: ReasonCode;
  repair_rule_ids: RepairRuleId[];
  policy_hash: string;
}
interface DecisionBase {
  protocol_version: typeof PROTOCOL_VERSION;
  decision: DecisionStatus;
  repaired_fields: RepairRecord[];
  policy_result: PolicyResult;
  audit_id: string;
  audit: AuditEnvelope;
}
export interface AcceptedDecision extends DecisionBase {
  decision: 'valid' | 'valid_with_repair';
  valid_arguments: JsonObject;
}
export interface RejectedDecision extends DecisionBase {
  decision: 'rejected';
  reason_code: ReasonCode;
  reason: string;
  repair_hint: string;
  validation_errors?: ValidationIssue[];
}
export type GuardDecision = AcceptedDecision | RejectedDecision;
export interface NormalizedTool {
  adapter: AdapterName;
  tool_name: string;
  tool_schema: AnySchema;
  source_fingerprint: string;
  warnings: string[];
}
export interface DriftChange {
  path: string;
  kind:
    | 'property_added'
    | 'property_removed'
    | 'required_added'
    | 'required_removed'
    | 'type_changed'
    | 'enum_narrowed'
    | 'enum_widened'
    | 'additional_properties_restricted'
    | 'additional_properties_relaxed'
    | 'constraint_tightened'
    | 'constraint_relaxed'
    | 'constraint_changed'
    | 'const_added'
    | 'const_removed'
    | 'const_changed'
    | 'schema_restricted'
    | 'schema_relaxed'
    | 'unclassified_change';
  compatibility: 'breaking' | 'non_breaking' | 'review';
  detail: string;
}
export interface DriftReport {
  changed: boolean;
  previous_schema_hash: string;
  current_schema_hash: string;
  compatibility: 'identical' | 'backward_compatible' | 'breaking' | 'review';
  changes: DriftChange[];
}
