import { describe, expect, it, vi } from 'vitest';
import {
  approveChallenge,
  createApprovalChallenge,
  InMemoryIdempotencyLedger,
  type JsonObject,
  validateToolCall,
} from '../packages/core/src/index.js';
import {
  executeGuardedAction,
  executeManagedApprovedAction,
  SchemaGuardActionCompletionError,
  SchemaGuardActionRejectedError,
  SchemaGuardClient,
} from '../packages/sdk-typescript/src/index.js';

const secret = 'sdk-action-approval-secret-at-least-thirty-two-characters';
const request = {
  tool_name: 'transfer',
  tool_schema: {
    type: 'object',
    additionalProperties: false,
    properties: { amount: { type: 'integer', minimum: 1 } },
    required: ['amount'],
  },
  raw_arguments: { amount: '25' },
} as const;
const action = { tool_name: 'transfer', risk_level: 'high', side_effect: 'irreversible' } as const;
const now = '2026-07-20T12:00:00.000Z';

function approval() {
  const decision = validateToolCall(request);
  const challenge = createApprovalChallenge({
    decision,
    action,
    environment: 'production',
    created_at: now,
    expires_at: '2026-07-20T12:15:00.000Z',
  });
  return approveChallenge({ challenge, approver_id: 'operator', approved_at: now, secret });
}

describe('SDK guarded action execution', () => {
  it('runs only after approval/idempotency and completes the reservation', async () => {
    const ledger = new InMemoryIdempotencyLedger();
    const execute = vi.fn((args: JsonObject) => Promise.resolve({ transferred: args.amount }));
    const result = await executeGuardedAction({
      request,
      action,
      context: {
        environment: 'production',
        now,
        approval: approval(),
        idempotency_key: 'sdk-transfer-1',
      },
      approvalSecret: secret,
      idempotencyLedger: ledger,
      execute,
    });
    expect(result.result).toEqual({ transferred: 25 });
    expect(result.decision.decision).toBe('valid_with_repair');
    expect(execute).toHaveBeenCalledOnce();
    await expect(
      executeGuardedAction({
        request,
        action,
        context: {
          environment: 'production',
          now,
          approval: approval(),
          idempotency_key: 'sdk-transfer-1',
        },
        approvalSecret: secret,
        idempotencyLedger: ledger,
        execute,
      }),
    ).rejects.toBeInstanceOf(SchemaGuardActionRejectedError);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('releases a pending reservation when downstream execution fails', async () => {
    const ledger = new InMemoryIdempotencyLedger();
    const context = {
      environment: 'production',
      now,
      approval: approval(),
      idempotency_key: 'sdk-transfer-retry',
    } as const;
    await expect(
      executeGuardedAction({
        request,
        action,
        context,
        approvalSecret: secret,
        idempotencyLedger: ledger,
        execute: () => {
          throw new Error('downstream failed');
        },
      }),
    ).rejects.toThrow('downstream failed');

    await expect(
      executeGuardedAction({
        request,
        action,
        context,
        approvalSecret: secret,
        idempotencyLedger: ledger,
        execute: () => 'retried safely',
      }),
    ).resolves.toMatchObject({ result: 'retried safely' });
  });

  it('retains a local reservation when completion fails after execution', async () => {
    const release = vi.fn();
    const ledger = {
      reserve: vi.fn(() => 'new' as const),
      complete: vi.fn(() => {
        throw new Error('completion unavailable');
      }),
      release,
    };
    const execute = vi.fn(() => 'side effect happened');

    await expect(
      executeGuardedAction({
        request,
        action,
        context: {
          environment: 'production',
          now,
          approval: approval(),
          idempotency_key: 'sdk-transfer-completion-uncertain',
        },
        approvalSecret: secret,
        idempotencyLedger: ledger,
        execute,
      }),
    ).rejects.toBeInstanceOf(SchemaGuardActionCompletionError);
    expect(execute).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it('retains a managed reservation when remote completion is uncertain', async () => {
    const calls: string[] = [];
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'evaluator-key',
      fetch: vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push(url);
        if (url.endsWith('/v1/actions/evaluate'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: 'allowed',
                reason: 'allowed',
                hints: [],
                policy_hash: `sha256:${'1'.repeat(64)}`,
                execution_fingerprint: `sha256:${'2'.repeat(64)}`,
                requires_approval: true,
                requires_idempotency: true,
                reservation: {
                  key_hash: `sha256:${'3'.repeat(64)}`,
                  state: 'pending',
                  reservation_id: 'res_11111111-1111-4111-8111-111111111111',
                },
              }),
              { status: 200 },
            ),
          );
        if (url.endsWith('/v1/actions/idempotency/complete'))
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: 'storage_unavailable', message: 'completion unavailable' }),
              { status: 503 },
            ),
          );
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as typeof fetch,
    });
    const decision = validateToolCall(request);
    if (decision.decision === 'rejected') throw new Error('test setup unexpectedly rejected');

    let completionError: unknown;
    try {
      await executeManagedApprovedAction({
        client,
        decision,
        toolName: 'transfer',
        environment: 'production',
        approval: approval(),
        idempotencyKey: 'managed-completion-uncertain',
        execute: () => 'side effect happened',
      });
    } catch (error) {
      completionError = error;
    }
    expect(completionError).toBeInstanceOf(SchemaGuardActionCompletionError);
    expect(completionError).toMatchObject({
      reservationId: 'res_11111111-1111-4111-8111-111111111111',
      executionFingerprint: `sha256:${'2'.repeat(64)}`,
    });
    expect(calls).toEqual([
      'https://guard.example/v1/actions/evaluate',
      'https://guard.example/v1/actions/idempotency/complete',
    ]);
  });
});
