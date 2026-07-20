import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson, sha256 } from './hash.js';
import { verifyRepairReceipt } from './repair.js';
import {
  type ActionControlPolicy,
  type ActionDescriptor,
  type ActionGateContext,
  type ActionGateDecision,
  type ActionRiskLevel,
  type ApprovalChallenge,
  type ApprovalEvidence,
  type GuardDecision,
} from './types.js';

const CHALLENGE_VERSION = '2026-07-20' as const;
const RISK_RANK: Record<ActionRiskLevel, number> = {
  read: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const DEFAULT_POLICY: Required<
  Pick<
    ActionControlPolicy,
    | 'max_auto_execute_risk'
    | 'max_repaired_auto_execute_risk'
    | 'require_idempotency_for_side_effects'
  >
> = {
  max_auto_execute_risk: 'low',
  max_repaired_auto_execute_risk: 'read',
  require_idempotency_for_side_effects: true,
};

type LedgerState = 'new' | 'duplicate' | 'conflict';
export interface IdempotencyLedger {
  reserve(key: string, executionFingerprint: string): LedgerState;
  complete(key: string, executionFingerprint: string): void;
  release(key: string, executionFingerprint: string): void;
}

export class InMemoryIdempotencyLedger implements IdempotencyLedger {
  private readonly entries = new Map<
    string,
    { fingerprint: string; state: 'pending' | 'completed' }
  >();

  reserve(key: string, executionFingerprint: string): LedgerState {
    const existing = this.entries.get(key);
    if (!existing) {
      this.entries.set(key, { fingerprint: executionFingerprint, state: 'pending' });
      return 'new';
    }
    return existing.fingerprint === executionFingerprint ? 'duplicate' : 'conflict';
  }

  complete(key: string, executionFingerprint: string): void {
    const existing = this.entries.get(key);
    if (!existing || existing.fingerprint !== executionFingerprint)
      throw new TypeError('idempotency completion does not match a pending reservation');
    this.entries.set(key, { ...existing, state: 'completed' });
  }

  release(key: string, executionFingerprint: string): void {
    const existing = this.entries.get(key);
    if (!existing || existing.fingerprint !== executionFingerprint)
      throw new TypeError('idempotency release does not match a reservation');
    if (existing.state === 'completed')
      throw new TypeError('completed reservations cannot be released');
    this.entries.delete(key);
  }
}

function validDate(value: string, field: string): number {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new TypeError(`${field} must be an ISO timestamp`);
  return millis;
}

function actionBinding(
  decision: GuardDecision,
  descriptor: ActionDescriptor,
  environment: string,
): {
  binding_hash: string;
  tool_name_hash: string;
  valid_arguments_hash: string;
} {
  if (decision.decision === 'rejected')
    throw new TypeError('a rejected validation decision cannot be bound for execution');
  const toolNameHash = sha256(descriptor.tool_name);
  if (
    decision.audit.tool_name_hash.startsWith('sha256:') &&
    decision.audit.tool_name_hash !== toolNameHash
  )
    throw new TypeError('action descriptor tool name does not match the validation decision');
  const validArgumentsHash = sha256(decision.valid_arguments);
  return {
    tool_name_hash: toolNameHash,
    valid_arguments_hash: validArgumentsHash,
    binding_hash: sha256({
      protocol_version: decision.protocol_version,
      tool_name_hash: toolNameHash,
      valid_arguments_hash: validArgumentsHash,
      policy_hash: decision.policy_result.applied_policy_hash,
      validation_decision: decision.decision,
      repair_receipt_hashes: decision.repaired_fields.map((repair) => repair.receipt_hash),
      risk_level: descriptor.risk_level,
      side_effect: descriptor.side_effect,
      environment,
    }),
  };
}

function approvalPayload(evidence: Omit<ApprovalEvidence, 'signature'>): string {
  return canonicalJson(evidence);
}

function approvalSignature(secret: string, evidence: Omit<ApprovalEvidence, 'signature'>): string {
  if (secret.length < 32)
    throw new TypeError('approval secret must contain at least 32 characters');
  return `hmac-sha256:${createHmac('sha256', secret)
    .update('schema-guard-approval-v1\0')
    .update(approvalPayload(evidence))
    .digest('hex')}`;
}

function privateIdentityHash(secret: string, identity: string): string {
  if (secret.length < 32)
    throw new TypeError('approval secret must contain at least 32 characters');
  return `hmac-sha256:${createHmac('sha256', secret)
    .update('schema-guard-approval-identity-v1\0')
    .update(identity)
    .digest('hex')}`;
}

export function createApprovalChallenge(input: {
  decision: GuardDecision;
  action: ActionDescriptor;
  environment: string;
  created_at: string;
  expires_at: string;
  challenge_id?: string;
}): ApprovalChallenge {
  const created = validDate(input.created_at, 'created_at');
  const expires = validDate(input.expires_at, 'expires_at');
  if (expires <= created || expires - created > 86_400_000)
    throw new TypeError(
      'approval challenge lifetime must be greater than zero and at most 24 hours',
    );
  const binding = actionBinding(input.decision, input.action, input.environment);
  return {
    challenge_version: CHALLENGE_VERSION,
    challenge_id: input.challenge_id ?? `ach_${randomUUID()}`,
    ...binding,
    risk_level: input.action.risk_level,
    environment: input.environment,
    created_at: new Date(created).toISOString(),
    expires_at: new Date(expires).toISOString(),
  };
}

export function approveChallenge(input: {
  challenge: ApprovalChallenge;
  approver_id: string;
  approved_at: string;
  secret: string;
}): ApprovalEvidence {
  const approved = validDate(input.approved_at, 'approved_at');
  const created = validDate(input.challenge.created_at, 'challenge.created_at');
  const expires = validDate(input.challenge.expires_at, 'challenge.expires_at');
  if (approved < created || approved > expires)
    throw new TypeError('approval must occur within the challenge lifetime');
  if (!input.approver_id) throw new TypeError('approver_id is required');
  const evidence = {
    challenge: structuredClone(input.challenge),
    approver_id_hash: privateIdentityHash(input.secret, input.approver_id),
    approved_at: new Date(approved).toISOString(),
  };
  return { ...evidence, signature: approvalSignature(input.secret, evidence) };
}

export function verifyApprovalEvidence(evidence: ApprovalEvidence, secret: string): boolean {
  try {
    const { signature, ...unsigned } = evidence;
    const expected = approvalSignature(secret, unsigned);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function resolvedPolicy(
  policy: ActionControlPolicy | undefined,
): Required<
  Pick<
    ActionControlPolicy,
    | 'max_auto_execute_risk'
    | 'max_repaired_auto_execute_risk'
    | 'require_idempotency_for_side_effects'
  >
> &
  Pick<ActionControlPolicy, 'allowed_environments'> {
  const resolved = { ...DEFAULT_POLICY, ...policy };
  if (
    !(resolved.max_auto_execute_risk in RISK_RANK) ||
    !(resolved.max_repaired_auto_execute_risk in RISK_RANK)
  )
    throw new TypeError('action policy contains an invalid risk level');
  if (
    resolved.allowed_environments !== undefined &&
    (!Array.isArray(resolved.allowed_environments) ||
      !resolved.allowed_environments.every((item) => typeof item === 'string' && item.length > 0))
  )
    throw new TypeError('allowed_environments must contain non-empty strings');
  if (typeof resolved.require_idempotency_for_side_effects !== 'boolean')
    throw new TypeError('require_idempotency_for_side_effects must be boolean');
  return resolved;
}

function result(
  status: ActionGateDecision['status'],
  reasonCode: ActionGateDecision['reason_code'],
  reason: string,
  executionFingerprint: string,
  requiresApproval: boolean,
  requiresIdempotency: boolean,
  key?: string,
): ActionGateDecision {
  return {
    status,
    reason_code: reasonCode,
    reason,
    execution_fingerprint: executionFingerprint,
    requires_approval: requiresApproval,
    requires_idempotency: requiresIdempotency,
    ...(key ? { reservation: { key_hash: sha256(key), state: 'pending' as const } } : {}),
  };
}

export function evaluateActionGate(input: {
  decision: GuardDecision;
  action: ActionDescriptor;
  context: ActionGateContext;
  policy?: ActionControlPolicy;
  approval_secret?: string;
  idempotency_ledger?: IdempotencyLedger;
}): ActionGateDecision {
  if (input.decision.decision === 'rejected')
    return result(
      'rejected',
      'VALIDATION_REJECTED',
      'Schema Guard rejected the tool arguments.',
      sha256({ audit_id: input.decision.audit_id, rejected: true }),
      false,
      false,
    );
  const proofValid =
    input.decision.audit_id === input.decision.audit.audit_id &&
    input.decision.audit.decision === input.decision.decision &&
    input.decision.policy_result.outcome === 'allowed' &&
    input.decision.policy_result.applied_policy_hash === input.decision.audit.policy_hash &&
    (!input.decision.audit.validated_arguments_hash?.startsWith('sha256:') ||
      input.decision.audit.validated_arguments_hash === sha256(input.decision.valid_arguments)) &&
    canonicalJson(input.decision.audit.repair_rule_ids) ===
      canonicalJson(input.decision.repaired_fields.map((repair) => repair.rule_id)) &&
    canonicalJson(input.decision.audit.repair_receipt_hashes) ===
      canonicalJson(input.decision.repaired_fields.map((repair) => repair.receipt_hash)) &&
    (input.decision.decision === 'valid'
      ? input.decision.repaired_fields.length === 0
      : input.decision.repaired_fields.length > 0 &&
        input.decision.repaired_fields.every(
          (repair) =>
            verifyRepairReceipt(repair) &&
            repair.post_validation.schema === 'passed' &&
            repair.post_validation.policy === 'allowed',
        ));
  if (!proofValid)
    return result(
      'rejected',
      'VALIDATION_PROOF_INVALID',
      'The accepted validation decision or repair receipt failed integrity checks.',
      sha256({ audit_id: input.decision.audit_id, proof_invalid: true }),
      false,
      false,
    );
  if (!input.context.environment) throw new TypeError('action environment is required');
  if (!(input.action.risk_level in RISK_RANK)) throw new TypeError('invalid action risk level');
  if (!['none', 'reversible', 'irreversible'].includes(input.action.side_effect))
    throw new TypeError('invalid action side effect');
  const policy = resolvedPolicy(input.policy);
  const binding = actionBinding(input.decision, input.action, input.context.environment);
  const fingerprint = binding.binding_hash;
  const requiresIdempotency =
    policy.require_idempotency_for_side_effects && input.action.side_effect !== 'none';
  const autoRisk =
    input.decision.decision === 'valid_with_repair'
      ? policy.max_repaired_auto_execute_risk
      : policy.max_auto_execute_risk;
  const requiresApproval =
    input.action.risk_level === 'critical' ||
    RISK_RANK[input.action.risk_level] > RISK_RANK[autoRisk];

  if (
    policy.allowed_environments !== undefined &&
    !policy.allowed_environments.includes(input.context.environment)
  )
    return result(
      'rejected',
      'ENVIRONMENT_DENIED',
      `Action environment ${input.context.environment} is not allowed by policy.`,
      fingerprint,
      requiresApproval,
      requiresIdempotency,
    );

  if (requiresApproval) {
    if (!input.context.approval)
      return result(
        'approval_required',
        'APPROVAL_REQUIRED',
        'This action requires approval bound to the exact validated arguments.',
        fingerprint,
        true,
        requiresIdempotency,
      );
    const now = validDate(input.context.now ?? new Date().toISOString(), 'context.now');
    const evidence = input.context.approval;
    const valid =
      input.approval_secret !== undefined &&
      verifyApprovalEvidence(evidence, input.approval_secret) &&
      evidence.challenge.binding_hash === binding.binding_hash &&
      evidence.challenge.tool_name_hash === binding.tool_name_hash &&
      evidence.challenge.valid_arguments_hash === binding.valid_arguments_hash &&
      evidence.challenge.environment === input.context.environment &&
      evidence.challenge.risk_level === input.action.risk_level &&
      now <= validDate(evidence.challenge.expires_at, 'approval.expires_at');
    if (!valid)
      return result(
        'rejected',
        'APPROVAL_INVALID',
        'Approval is invalid, expired, or bound to different arguments or action context.',
        fingerprint,
        true,
        requiresIdempotency,
      );
  }

  if (requiresIdempotency) {
    const key = input.context.idempotency_key;
    if (!key || key.length < 8 || key.length > 256)
      return result(
        'rejected',
        'IDEMPOTENCY_KEY_REQUIRED',
        'A side-effecting action requires an idempotency key from 8 through 256 characters.',
        fingerprint,
        requiresApproval,
        true,
      );
    if (!input.idempotency_ledger)
      return result(
        'rejected',
        'IDEMPOTENCY_LEDGER_REQUIRED',
        'A side-effecting action requires an idempotency ledger.',
        fingerprint,
        requiresApproval,
        true,
      );
    const state = input.idempotency_ledger.reserve(key, fingerprint);
    if (state === 'duplicate')
      return result(
        'duplicate_blocked',
        'DUPLICATE_EXECUTION',
        'This idempotency key already reserved the same action; reuse its prior result.',
        fingerprint,
        requiresApproval,
        true,
      );
    if (state === 'conflict')
      return result(
        'rejected',
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key is already bound to a different action.',
        fingerprint,
        requiresApproval,
        true,
      );
    return result(
      'allowed',
      'EXECUTION_ALLOWED',
      'Validation, action policy, approval, and idempotency controls allow execution.',
      fingerprint,
      requiresApproval,
      true,
      key,
    );
  }

  return result(
    'allowed',
    'EXECUTION_ALLOWED',
    'Validation and action policy allow execution.',
    fingerprint,
    requiresApproval,
    false,
  );
}
