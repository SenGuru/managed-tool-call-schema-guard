import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createApprovalChallenge,
  repairReceiptHash,
  validateToolCall,
} from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedError, ManagedStore } from '../packages/managed/src/store.js';

const secret = 'managed-action-test-secret-that-is-at-least-32-characters';
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

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-managed-action-')), 'managed.db');
}

describe('durable managed action workflow', () => {
  it('persists tenant-bound approvals and idempotency across process restarts', async () => {
    const databasePath = await database();
    let store = new ManagedStore({ databasePath, masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'Tenant A', plan: 'trial', apiKey: 'admin-a' });
    store.bootstrapTenant({ id: 'b', name: 'Tenant B', plan: 'trial', apiKey: 'admin-b' });
    const adminA = store.authenticate('admin-a')!;
    const adminB = store.authenticate('admin-b')!;
    const evaluatorKey = store.issueApiKey(adminA, ['evaluate:action']);
    const approverKey = store.issueApiKey(adminA, ['approve:action']);
    const evaluator = store.authenticate(evaluatorKey.api_key)!;
    const approver = store.authenticate(approverKey.api_key)!;
    store.registerActionDescriptor(adminA, 'transfer', 'production', 'high', 'irreversible');

    const decision = store.recordValidation(adminA, validateToolCall(request));
    expect(store.verifyActionDecision(evaluator, decision, 'transfer')).toBe(true);
    expect(store.verifyActionDecision(adminB, decision, 'transfer')).toBe(false);

    const created = new Date();
    const challenge = createApprovalChallenge({
      decision,
      action: store.actionDescriptor(evaluator, 'transfer', 'production'),
      environment: 'production',
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + 60_000).toISOString(),
      challenge_id: 'ach_durable_test',
    });
    store.recordActionChallenge(evaluator, challenge);
    expect(() => store.approveActionChallenge(adminB, challenge.challenge_id)).toThrow(
      ManagedError,
    );
    const approval = store.approveActionChallenge(approver, challenge.challenge_id);
    expect(store.approveActionChallenge(approver, challenge.challenge_id)).toEqual(approval);

    const context = { approval, idempotency_key: 'transfer-durable-1' } as const;
    const allowed = store.evaluateManagedAction({
      principal: evaluator,
      decision,
      toolName: 'transfer',
      environment: 'production',
      context,
    });
    expect(allowed).toMatchObject({ status: 'allowed', reason_code: 'EXECUTION_ALLOWED' });
    const reservedCheckpoint = store.actionIdempotencyCheckpoint(adminA);
    expect(reservedCheckpoint).toMatchObject({
      checkpoint_version: '1',
      revision: 1,
      row_count: 1,
    });
    expect(reservedCheckpoint.accumulator).toMatch(/^xor256:[0-9a-f]{64}$/u);
    expect(reservedCheckpoint.checkpoint_hash).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    expect(
      store.evaluateManagedAction({
        principal: evaluator,
        decision,
        toolName: 'transfer',
        environment: 'production',
        context,
      }),
    ).toMatchObject({ status: 'duplicate_blocked', reason_code: 'DUPLICATE_EXECUTION' });
    store
      .actionIdempotencyLedger(evaluator)
      .complete('transfer-durable-1', allowed.execution_fingerprint);
    const completedCheckpoint = store.actionIdempotencyCheckpoint(adminA);
    expect(completedCheckpoint).toMatchObject({ revision: 2, row_count: 1 });
    expect(completedCheckpoint.accumulator).not.toBe(reservedCheckpoint.accumulator);
    expect(completedCheckpoint.checkpoint_hash).not.toBe(reservedCheckpoint.checkpoint_hash);
    expect(store.compareActionIdempotencyCheckpoint(adminA, reservedCheckpoint)).toMatchObject({
      status: 'advanced',
      anchored_revision: 1,
      current_revision: 2,
    });
    expect(store.compareActionIdempotencyCheckpoint(adminA, completedCheckpoint)).toMatchObject({
      status: 'same',
      current_revision: 2,
    });
    expect(() =>
      store.compareActionIdempotencyCheckpoint(adminA, {
        ...completedCheckpoint,
        checkpoint_hash: `hmac-sha256:${'0'.repeat(64)}`,
      }),
    ).toThrow(/externally retained idempotency checkpoint is invalid/u);
    store.close();

    store = new ManagedStore({ databasePath, masterSecret: secret });
    const reopenedEvaluator = store.authenticate(evaluatorKey.api_key)!;
    expect(
      store.evaluateManagedAction({
        principal: reopenedEvaluator,
        decision,
        toolName: 'transfer',
        environment: 'production',
        context,
      }),
    ).toMatchObject({ status: 'duplicate_blocked', reason_code: 'DUPLICATE_EXECUTION' });
    store.close();
  });

  it('fails closed on missing trusted classifications and tampered accepted output', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
    const admin = store.authenticate('admin-a')!;
    const decision = store.recordValidation(admin, validateToolCall(request));
    expect(() => store.actionDescriptor(admin, 'transfer', 'production')).toThrow(
      'risk must be registered',
    );
    store.registerActionDescriptor(admin, 'transfer', 'production', 'high', 'irreversible');
    if (decision.decision === 'rejected') throw new Error('fixture decision must be accepted');
    const tampered = structuredClone(decision);
    tampered.valid_arguments.amount = 26;
    expect(store.verifyActionDecision(admin, tampered, 'transfer')).toBe(false);
    expect(() =>
      store.evaluateManagedAction({
        principal: admin,
        decision: tampered,
        toolName: 'transfer',
        environment: 'production',
        context: {},
      }),
    ).toThrow('does not match a stored accepted audit');

    const receiptSwapped = structuredClone(decision);
    const repair = receiptSwapped.repaired_fields[0];
    if (!repair) throw new Error('fixture decision must contain a repair receipt');
    repair.explanation = 'self-consistent but not the audited receipt';
    repair.receipt_hash = repairReceiptHash(repair);
    expect(store.verifyActionDecision(admin, receiptSwapped, 'transfer')).toBe(false);
    store.close();
  });

  it('enforces an integrity-protected action hold and compares a shadow policy without reserving', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'controls', name: 'Controls', plan: 'trial', apiKey: 'admin' });
    const admin = store.authenticate('admin')!;
    store.registerActionDescriptor(admin, 'lookup', 'production', 'low', 'none');
    const decision = store.recordValidation(
      admin,
      validateToolCall({
        tool_name: 'lookup',
        tool_schema: {
          type: 'object',
          additionalProperties: false,
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        raw_arguments: { query: 'safe' },
      }),
    );
    const configured = store.updateActionControl(admin, {
      hold: false,
      reason_code: null,
      enforced_policy: { max_auto_execute_risk: 'low' },
      shadow_policy: { max_auto_execute_risk: 'read' },
    });
    expect(configured).toMatchObject({
      hold: false,
      enforced_policy: { max_auto_execute_risk: 'low' },
      shadow_policy: { max_auto_execute_risk: 'read' },
    });
    expect(
      store.evaluateManagedAction({
        principal: admin,
        decision,
        toolName: 'lookup',
        environment: 'production',
        context: {},
      }),
    ).toMatchObject({
      status: 'allowed',
      reason_code: 'EXECUTION_ALLOWED',
      shadow_evaluation: {
        status: 'approval_required',
        reason_code: 'APPROVAL_REQUIRED',
        differs_from_enforced: true,
      },
    });
    expect(
      store.db
        .prepare('SELECT count(*) count FROM action_idempotency WHERE tenant_id=?')
        .get(admin.tenantId),
    ).toEqual({ count: 0 });

    store.updateActionControl(admin, {
      hold: true,
      reason_code: 'operator.emergency',
      enforced_policy: { max_auto_execute_risk: 'low' },
      shadow_policy: { max_auto_execute_risk: 'read' },
    });
    store.registerActionDescriptor(admin, 'lookup', 'production', 'low', 'reversible');
    expect(
      store.evaluateManagedAction({
        principal: admin,
        decision,
        toolName: 'lookup',
        environment: 'production',
        context: {
          approval: { malformed: true } as never,
          idempotency_key: 'held-action-key',
        },
      }),
    ).toMatchObject({
      status: 'rejected',
      reason_code: 'ACTIONS_HELD',
      requires_idempotency: true,
    });
    expect(
      store.db
        .prepare('SELECT count(*) count FROM action_idempotency WHERE tenant_id=?')
        .get(admin.tenantId),
    ).toEqual({ count: 0 });
    expect(() =>
      store.updateActionControl(admin, {
        hold: false,
        reason_code: null,
        enforced_policy: { unsupported: true } as never,
        shadow_policy: null,
      }),
    ).toThrow('unsupported field');
    store.close();
  });

  it('serves a separately scoped end-to-end approval and reservation workflow', async () => {
    const anchoredPayloads: string[] = [];
    const service = createManagedServer(
      {
        databasePath: await database(),
        masterSecret: secret,
        actionCheckpointAnchorUrl: 'https://anchor.invokeguard.example/v1/checkpoints',
        actionCheckpointAnchorSigningSecret:
          'managed-action-anchor-signing-secret-at-least-32-characters',
        actionCheckpointAnchorPollIntervalMs: 60_000,
      },
      {
        checkpointAnchorDeliver: (_endpoint, _signingSecret, payload) => {
          anchoredPayloads.push(payload);
          return Promise.resolve({ delivered: true, retryable: false, responseStatus: 202 });
        },
      },
    );
    try {
      service.store.bootstrapTenant({
        id: 'a',
        name: 'A',
        plan: 'trial',
        apiKey: 'admin-key',
      });
      const admin = service.store.authenticate('admin-key')!;
      const evaluator = service.store.issueApiKey(admin, ['validate', 'evaluate:action']);
      const approver = service.store.issueApiKey(admin, ['approve:action']);
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const base = `http://127.0.0.1:${address.port}`;
      const jsonHeaders = (key: string) => ({
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      });

      const descriptor = await fetch(`${base}/v1/admin/actions/descriptors`, {
        method: 'PUT',
        headers: jsonHeaders('admin-key'),
        body: JSON.stringify({
          tool_name: 'transfer',
          environment: 'production',
          risk_level: 'high',
          side_effect: 'irreversible',
        }),
      });
      expect(descriptor.status).toBe(200);
      const defaultControl = await fetch(`${base}/v1/admin/actions/control`, {
        headers: jsonHeaders('admin-key'),
      });
      expect(defaultControl.status).toBe(200);
      await expect(defaultControl.json()).resolves.toMatchObject({
        hold: false,
        enforced_policy: {},
        shadow_policy: null,
      });
      const configuredControl = await fetch(`${base}/v1/admin/actions/control`, {
        method: 'PUT',
        headers: jsonHeaders('admin-key'),
        body: JSON.stringify({
          hold: false,
          reason_code: null,
          enforced_policy: { max_auto_execute_risk: 'low' },
          shadow_policy: { max_auto_execute_risk: 'read' },
        }),
      });
      expect(configuredControl.status).toBe(200);

      const validation = await fetch(`${base}/v1/validate`, {
        method: 'POST',
        headers: jsonHeaders(evaluator.api_key),
        body: JSON.stringify(request),
      });
      expect(validation.status).toBe(200);
      const decision = (await validation.json()) as Record<string, unknown>;

      const challengeResponse = await fetch(`${base}/v1/actions/challenges`, {
        method: 'POST',
        headers: jsonHeaders(evaluator.api_key),
        body: JSON.stringify({
          decision,
          tool_name: 'transfer',
          environment: 'production',
          workload_identity: 'agent-a/workspace-a/run-1',
          expires_in_seconds: 300,
        }),
      });
      expect(challengeResponse.status).toBe(201);
      const challenge = (await challengeResponse.json()) as {
        challenge_id: string;
        workload_identity_hash: string;
      };
      expect(challenge.workload_identity_hash).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
      expect(JSON.stringify(challenge)).not.toContain('agent-a/workspace-a/run-1');
      expect(
        (
          await fetch(`${base}/v1/actions/challenges/${challenge.challenge_id}/approve`, {
            method: 'POST',
            headers: jsonHeaders(evaluator.api_key),
          })
        ).status,
      ).toBe(403);
      const approvalResponse = await fetch(
        `${base}/v1/actions/challenges/${challenge.challenge_id}/approve`,
        { method: 'POST', headers: jsonHeaders(approver.api_key) },
      );
      expect(approvalResponse.status).toBe(200);
      const approval = (await approvalResponse.json()) as Record<string, unknown>;

      const evaluationBody = {
        decision,
        tool_name: 'transfer',
        environment: 'production',
        workload_identity: 'agent-a/workspace-a/run-1',
        approval,
        idempotency_key: 'managed-transfer-1',
      };
      const evaluation = await fetch(`${base}/v1/actions/evaluate`, {
        method: 'POST',
        headers: jsonHeaders(evaluator.api_key),
        body: JSON.stringify(evaluationBody),
      });
      expect(evaluation.status).toBe(200);
      const gate = (await evaluation.json()) as {
        status: string;
        execution_fingerprint: string;
      };
      expect(gate.status).toBe('allowed');
      expect(anchoredPayloads).toHaveLength(2);
      expect(service.store.actionCheckpointAnchorAcknowledged(admin)).toBe(true);
      expect(service.store.listCheckpointAnchorDeliveries(admin)).toMatchObject([
        { revision: 1, status: 'delivered', response_status: 202 },
        { revision: 0, status: 'delivered', response_status: 202 },
      ]);

      const completion = await fetch(`${base}/v1/actions/idempotency/complete`, {
        method: 'POST',
        headers: jsonHeaders(evaluator.api_key),
        body: JSON.stringify({
          idempotency_key: 'managed-transfer-1',
          execution_fingerprint: gate.execution_fingerprint,
        }),
      });
      expect(completion.status).toBe(200);
      expect(service.store.actionCheckpointAnchorAcknowledged(admin)).toBe(false);
      const duplicate = await fetch(`${base}/v1/actions/evaluate`, {
        method: 'POST',
        headers: jsonHeaders(evaluator.api_key),
        body: JSON.stringify(evaluationBody),
      });
      expect(duplicate.status).toBe(200);
      expect(((await duplicate.json()) as { status: string }).status).toBe('duplicate_blocked');

      const stored = service.store.db
        .prepare(
          'SELECT challenge_json,evidence_json FROM action_approvals WHERE tenant_id=? AND challenge_id=?',
        )
        .get('a', challenge.challenge_id) as Record<string, unknown>;
      const storedChallenge = JSON.parse(String(stored.challenge_json)) as Record<string, unknown>;
      const storedEvidence = JSON.parse(String(stored.evidence_json)) as Record<string, unknown>;
      expect(storedChallenge).not.toHaveProperty('valid_arguments');
      expect(storedChallenge).not.toHaveProperty('raw_arguments');
      expect(storedChallenge).not.toHaveProperty('tool_name');
      expect(storedEvidence).not.toHaveProperty('approver_id');
      const idempotency = service.store.db
        .prepare('SELECT key_hash FROM action_idempotency WHERE tenant_id=?')
        .get('a') as Record<string, unknown>;
      expect(String(idempotency.key_hash)).toMatch(/^hmac-sha256:/u);
      expect(String(idempotency.key_hash)).not.toContain('managed-transfer-1');
    } finally {
      await service.close();
    }
  });

  it('fails closed and retains the reservation when the anchor receiver rejects it', async () => {
    const service = createManagedServer(
      {
        databasePath: await database(),
        masterSecret: secret,
        actionCheckpointAnchorUrl: 'https://anchor.invokeguard.example/v1/checkpoints',
        actionCheckpointAnchorSigningSecret:
          'managed-action-anchor-signing-secret-at-least-32-characters',
        actionCheckpointAnchorPollIntervalMs: 60_000,
        actionCheckpointAnchorMaxAttempts: 1,
      },
      {
        checkpointAnchorDeliver: () =>
          Promise.resolve({
            delivered: false,
            retryable: false,
            responseStatus: 409,
            errorCode: 'receiver_rejected',
          }),
      },
    );
    try {
      service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
      const principal = service.store.authenticate('admin-a')!;
      service.store.registerActionDescriptor(
        principal,
        'transfer',
        'production',
        'low',
        'reversible',
      );
      const decision = service.store.recordValidation(
        principal,
        validateToolCall({
          tool_name: 'transfer',
          tool_schema: {
            type: 'object',
            additionalProperties: false,
            properties: { amount: { type: 'integer' } },
            required: ['amount'],
          },
          raw_arguments: { amount: 25 },
        }),
      );
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/actions/evaluate`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-a',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          decision,
          tool_name: 'transfer',
          environment: 'production',
          idempotency_key: 'anchor-rejection-test',
        }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'checkpoint_anchor_unacknowledged' });
      expect(
        service.store.db
          .prepare("SELECT COUNT(*) count FROM action_idempotency WHERE state='pending'")
          .get(),
      ).toEqual({ count: 1 });
      expect(service.store.listCheckpointAnchorDeliveries(principal)[0]).toMatchObject({
        revision: 1,
        status: 'dead',
        error_code: 'receiver_rejected',
      });
      expect(service.store.readinessCheck()).toBe(false);
    } finally {
      await service.close();
    }
  });
});
