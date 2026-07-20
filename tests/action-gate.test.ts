import { describe, expect, it } from 'vitest';
import {
  approveChallenge,
  createApprovalChallenge,
  evaluateActionGate,
  InMemoryIdempotencyLedger,
  repairReceiptHash,
  validateToolCall,
  verifyApprovalEvidence,
} from '../packages/core/src/index.js';

const secret = 'approval-test-secret-that-has-at-least-thirty-two-characters';
const schema = {
  type: 'object',
  additionalProperties: false,
  properties: { amount: { type: 'integer', minimum: 1 } },
  required: ['amount'],
} as const;
const action = { tool_name: 'transfer', risk_level: 'high', side_effect: 'irreversible' } as const;
const now = '2026-07-20T12:00:00.000Z';

describe('deterministic action gate', () => {
  it('never makes a rejected validation decision executable', () => {
    const decision = validateToolCall({
      tool_name: 'transfer',
      tool_schema: schema,
      raw_arguments: { amount: 'ambiguous' },
    });
    expect(
      evaluateActionGate({
        decision,
        action,
        context: { environment: 'production', now },
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'VALIDATION_REJECTED' });
  });

  it('requires approval for high-risk actions and binds it to exact repaired arguments', () => {
    const decision = validateToolCall({
      tool_name: 'transfer',
      tool_schema: schema,
      raw_arguments: { amount: '50' },
    });
    const withoutApproval = evaluateActionGate({
      decision,
      action,
      context: { environment: 'production', now },
    });
    expect(withoutApproval).toMatchObject({
      status: 'approval_required',
      reason_code: 'APPROVAL_REQUIRED',
      requires_approval: true,
      requires_idempotency: true,
    });

    const challenge = createApprovalChallenge({
      decision,
      action,
      environment: 'production',
      created_at: now,
      expires_at: '2026-07-20T12:15:00.000Z',
      challenge_id: 'ach_test',
    });
    const approval = approveChallenge({
      challenge,
      approver_id: 'reviewer@example.test',
      approved_at: '2026-07-20T12:01:00.000Z',
      secret,
    });
    expect(verifyApprovalEvidence(approval, secret)).toBe(true);
    expect(approval).not.toHaveProperty('approver_id');
    expect(approval.approver_id_hash).toMatch(/^hmac-sha256:/u);

    const changedDecision = validateToolCall({
      tool_name: 'transfer',
      tool_schema: schema,
      raw_arguments: { amount: '51' },
    });
    expect(
      evaluateActionGate({
        decision: changedDecision,
        action,
        context: {
          environment: 'production',
          now,
          approval,
          idempotency_key: 'transfer-request-1',
        },
        approval_secret: secret,
        idempotency_ledger: new InMemoryIdempotencyLedger(),
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'APPROVAL_INVALID' });
  });

  it('rejects tampered accepted decisions and repair receipts before action policy', () => {
    const decision = validateToolCall({
      tool_name: 'transfer',
      tool_schema: schema,
      raw_arguments: { amount: '50' },
    });
    if (decision.decision === 'rejected') throw new Error('fixture must be accepted');
    const tampered = structuredClone(decision);
    const first = tampered.repaired_fields[0];
    if (!first) throw new Error('fixture must contain a repair');
    first.post_validation.policy = 'denied';
    expect(
      evaluateActionGate({
        decision: tampered,
        action,
        context: { environment: 'production', now },
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'VALIDATION_PROOF_INVALID' });

    const changedArguments = structuredClone(decision);
    changedArguments.valid_arguments.amount = 51;
    expect(
      evaluateActionGate({
        decision: changedArguments,
        action,
        context: { environment: 'production', now },
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'VALIDATION_PROOF_INVALID' });

    const swappedReceipt = structuredClone(decision);
    const swapped = swappedReceipt.repaired_fields[0];
    if (!swapped) throw new Error('fixture must contain a repair');
    swapped.explanation = 'self-consistent but not audit-bound';
    swapped.receipt_hash = repairReceiptHash(swapped);
    expect(
      evaluateActionGate({
        decision: swappedReceipt,
        action,
        context: { environment: 'production', now },
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'VALIDATION_PROOF_INVALID' });
  });

  it('reserves idempotency only after approval and blocks duplicates and conflicts', () => {
    const decision = validateToolCall({
      tool_name: 'transfer',
      tool_schema: schema,
      raw_arguments: { amount: 50 },
    });
    const challenge = createApprovalChallenge({
      decision,
      action,
      environment: 'production',
      created_at: now,
      expires_at: '2026-07-20T12:15:00.000Z',
    });
    const approval = approveChallenge({
      challenge,
      approver_id: 'reviewer',
      approved_at: now,
      secret,
    });
    const ledger = new InMemoryIdempotencyLedger();
    const input = {
      decision,
      action,
      context: {
        environment: 'production',
        now,
        approval,
        idempotency_key: 'transfer-request-1',
      },
      approval_secret: secret,
      idempotency_ledger: ledger,
    } as const;
    const allowed = evaluateActionGate(input);
    expect(allowed).toMatchObject({ status: 'allowed', reason_code: 'EXECUTION_ALLOWED' });
    expect(allowed.reservation?.key_hash).toMatch(/^sha256:/u);
    expect(evaluateActionGate(input)).toMatchObject({
      status: 'duplicate_blocked',
      reason_code: 'DUPLICATE_EXECUTION',
    });

    const otherDecision = validateToolCall({
      tool_name: 'transfer',
      tool_schema: schema,
      raw_arguments: { amount: 60 },
    });
    const otherChallenge = createApprovalChallenge({
      decision: otherDecision,
      action,
      environment: 'production',
      created_at: now,
      expires_at: '2026-07-20T12:15:00.000Z',
    });
    const otherApproval = approveChallenge({
      challenge: otherChallenge,
      approver_id: 'reviewer',
      approved_at: now,
      secret,
    });
    expect(
      evaluateActionGate({
        ...input,
        decision: otherDecision,
        context: { ...input.context, approval: otherApproval },
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('auto-allows read-only low-risk calls but restricts environments', () => {
    const decision = validateToolCall({
      tool_name: 'transfer',
      tool_schema: schema,
      raw_arguments: { amount: 10 },
    });
    expect(
      evaluateActionGate({
        decision,
        action: { tool_name: 'transfer', risk_level: 'read', side_effect: 'none' },
        context: { environment: 'staging', now },
        policy: { allowed_environments: ['staging'] },
      }),
    ).toMatchObject({ status: 'allowed', requires_approval: false, requires_idempotency: false });
    expect(
      evaluateActionGate({
        decision,
        action: { tool_name: 'transfer', risk_level: 'read', side_effect: 'none' },
        context: { environment: 'production', now },
        policy: { allowed_environments: ['staging'] },
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'ENVIRONMENT_DENIED' });
  });
});
