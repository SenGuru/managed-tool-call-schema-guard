import type { AnySchema } from 'ajv';

export const PROTOCOL_VERSION = '2026-07-20' as const;
export const ENGINE_VERSION = '0.2.0' as const;
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
  ruleset_version: typeof RULESET_VERSION;
  from_type: string;
  to_type: string;
  original_value_hash: string;
  output_value_hash: string;
  schema_fragment_hash: string;
  matched_preconditions: string[];
  ambiguity_checks: Array<{
    check: string;
    result: 'passed';
  }>;
  post_validation: {
    schema: 'passed' | 'failed' | 'not_run';
    policy: 'allowed' | 'denied' | 'not_run';
  };
  receipt_hash: string;
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
  context?: {
    adapter?: AdapterName;
    tool_version?: string;
    schema_revision?: string;
    provider?: string;
    provider_version?: string;
    framework?: string;
    framework_version?: string;
    environment?: string;
  };
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
  validated_arguments_hash?: string;
  argument_shape: string[];
  decision: DecisionStatus;
  reason_code?: ReasonCode;
  repair_rule_ids: RepairRuleId[];
  repair_receipt_hashes: string[];
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

export type ContractTarget = 'openai' | 'anthropic' | 'google_gemini' | 'mcp';
export type ContractCompatibilityStatus =
  'native' | 'lossless_transform' | 'policy_required' | 'unsupported' | 'runtime_unverified';
export type ContractIssueSeverity = 'info' | 'warning' | 'blocker';
export interface ContractIssue {
  path: string;
  code: string;
  severity: ContractIssueSeverity;
  message: string;
  action: string;
}
export interface ContractTransformation {
  path: string;
  transform_id:
    | 'const_to_singleton_enum'
    | 'drop_dialect_annotation'
    | 'google_nullable_type'
    | 'google_reference_syntax'
    | 'openai_strict_optional_nullable'
    | 'openai_strict_close_object';
  semantics: 'lossless' | 'policy_authorized';
  before_hash: string;
  after_hash: string;
}
export interface CompileContractRequest {
  target: ContractTarget;
  tool_name: string;
  tool_schema: AnySchema;
  description?: string;
  target_version?: string;
  /** Set only after an external live probe has verified this exact target/profile. */
  runtime_verified?: boolean;
  /** Explicitly authorizes OpenAI strict-mode semantic normalization. */
  openai_strict_policy?: 'reject' | 'normalize';
}
export interface CompiledContract {
  compiler_version: typeof ENGINE_VERSION;
  target: ContractTarget;
  target_version: string;
  capability_profile: string;
  status: ContractCompatibilityStatus;
  source_schema_hash: string;
  compiled_declaration_hash?: string;
  declaration: JsonObject | null;
  issues: ContractIssue[];
  transformations: ContractTransformation[];
  runtime_verification: 'verified_by_caller' | 'not_verified';
}

export interface ReplayExpectation {
  decision: DecisionStatus;
  reason_code?: ReasonCode;
  repair_rule_ids: RepairRuleId[];
  repaired_paths: string[];
  valid_arguments_hash?: string;
  policy_outcome: PolicyResult['outcome'];
  policy_reasons: string[];
  validation_issue_signatures: string[];
}
export interface ReplayFixture {
  fixture_version: '2026-07-20';
  fixture_id: string;
  request: ValidateRequest;
  expected: ReplayExpectation;
  source_audit_id?: string;
  privacy: {
    classification: 'local_sensitive';
    contains_raw_argument_values: true;
    safe_for_managed_upload: false;
  };
}
export interface ReplayMismatch {
  field: keyof ReplayExpectation;
  expected: JsonValue;
  actual: JsonValue;
}
export interface ReplayReport {
  fixture_id: string;
  passed: boolean;
  expected: ReplayExpectation;
  actual: ReplayExpectation;
  mismatches: ReplayMismatch[];
}
export interface ReplaySuiteReport {
  passed: boolean;
  total: number;
  passed_count: number;
  failed_count: number;
  reports: ReplayReport[];
}

export type ActionRiskLevel = 'read' | 'low' | 'medium' | 'high' | 'critical';
export type ActionSideEffect = 'none' | 'reversible' | 'irreversible';
export interface ActionDescriptor {
  tool_name: string;
  risk_level: ActionRiskLevel;
  side_effect: ActionSideEffect;
}
export interface ActionControlPolicy {
  max_auto_execute_risk?: ActionRiskLevel;
  max_repaired_auto_execute_risk?: ActionRiskLevel;
  allowed_environments?: string[];
  require_idempotency_for_side_effects?: boolean;
}
export interface ApprovalChallenge {
  challenge_version: '2026-07-20';
  challenge_id: string;
  binding_hash: string;
  tool_name_hash: string;
  valid_arguments_hash: string;
  risk_level: ActionRiskLevel;
  environment: string;
  created_at: string;
  expires_at: string;
}
export interface ApprovalEvidence {
  challenge: ApprovalChallenge;
  approver_id_hash: string;
  approved_at: string;
  signature: string;
}
export interface ActionGateContext {
  environment: string;
  now?: string;
  approval?: ApprovalEvidence;
  idempotency_key?: string;
}
export type ActionGateReasonCode =
  | 'EXECUTION_ALLOWED'
  | 'VALIDATION_REJECTED'
  | 'VALIDATION_PROOF_INVALID'
  | 'ENVIRONMENT_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_INVALID'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_LEDGER_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DUPLICATE_EXECUTION';
export interface ActionGateDecision {
  status: 'allowed' | 'approval_required' | 'rejected' | 'duplicate_blocked';
  reason_code: ActionGateReasonCode;
  reason: string;
  execution_fingerprint: string;
  requires_approval: boolean;
  requires_idempotency: boolean;
  reservation?: {
    key_hash: string;
    state: 'pending';
    reservation_id?: string;
  };
}
