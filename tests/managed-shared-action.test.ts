import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  approveChallenge,
  validateToolCall,
  type ActionDescriptor,
  type ApprovalChallenge,
  type ApprovalEvidence,
  type GuardDecision,
} from '../packages/core/src/index.js';
import type {
  ActionState,
  SharedActionCheckpoint,
  SharedActionCheckpointComparison,
  SharedActionReconciliationRecord,
  SharedCheckpointAnchorClaim,
  SharedCheckpointAnchorDelivery,
  SharedPendingActionReservation,
  SharedReservationMetadata,
  SharedReservationResult,
} from '../packages/shared-state/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { hmac } from '../packages/managed/src/crypto.js';

const secret = 'managed-shared-action-test-secret-at-least-32-characters';
const reservationId = 'res_00000000-0000-4000-8000-000000000001';

class MemoryActionState implements ActionState {
  readonly reservations = new Map<
    string,
    {
      fingerprint: string;
      state: 'pending' | 'completed';
      reservationId: string;
      metadata: SharedReservationMetadata;
      createdAt: string;
    }
  >();
  readonly reconciliations: SharedActionReconciliationRecord[] = [];
  readonly decisions = new Map<string, GuardDecision>();
  readonly descriptors = new Map<string, ActionDescriptor & { environment: string }>();
  readonly approvals = new Map<
    string,
    {
      challenge: ApprovalChallenge;
      status: 'pending' | 'approved' | 'revoked';
      evidence?: ApprovalEvidence;
    }
  >();
  revision = 0;
  migrated = false;
  closed = false;

  migrate(): Promise<void> {
    this.migrated = true;
    return Promise.resolve();
  }
  ready(): Promise<boolean> {
    return Promise.resolve(this.migrated && !this.closed);
  }
  recordAcceptedDecision(tenantId: string, decision: GuardDecision): Promise<void> {
    this.decisions.set(`${tenantId}\0${decision.audit_id}`, structuredClone(decision));
    return Promise.resolve();
  }
  verifyAcceptedDecision(tenantId: string, decision: GuardDecision): Promise<boolean> {
    const stored = this.decisions.get(`${tenantId}\0${decision.audit_id}`);
    return Promise.resolve(Boolean(stored && canonicalJson(stored) === canonicalJson(decision)));
  }
  upsertActionDescriptor(
    tenantId: string,
    toolName: string,
    environment: string,
    riskLevel: ActionDescriptor['risk_level'],
    sideEffect: ActionDescriptor['side_effect'],
  ): Promise<ActionDescriptor & { environment: string }> {
    const descriptor = {
      tool_name: toolName,
      environment,
      risk_level: riskLevel,
      side_effect: sideEffect,
    };
    this.descriptors.set(`${tenantId}\0${toolName}\0${environment}`, descriptor);
    return Promise.resolve(descriptor);
  }
  actionDescriptor(
    tenantId: string,
    toolName: string,
    environment: string,
  ): Promise<ActionDescriptor & { environment: string }> {
    const descriptor = this.descriptors.get(`${tenantId}\0${toolName}\0${environment}`);
    if (!descriptor) throw new TypeError('descriptor missing');
    return Promise.resolve(descriptor);
  }
  recordActionChallenge(tenantId: string, challenge: ApprovalChallenge): Promise<void> {
    this.approvals.set(`${tenantId}\0${challenge.challenge_id}`, {
      challenge: structuredClone(challenge),
      status: 'pending',
    });
    return Promise.resolve();
  }
  approveActionChallenge(
    tenantId: string,
    challengeId: string,
    approverId: string,
  ): Promise<ApprovalEvidence> {
    const approval = this.approvals.get(`${tenantId}\0${challengeId}`);
    if (!approval || approval.status === 'revoked') throw new TypeError('approval missing');
    if (approval.evidence) return Promise.resolve(approval.evidence);
    const evidence = approveChallenge({
      challenge: approval.challenge,
      approver_id: approverId,
      approved_at: new Date().toISOString(),
      secret: hmac(secret, 'tenant-action-approval-secret-v1', { tenant_id: tenantId }),
    });
    approval.status = 'approved';
    approval.evidence = evidence;
    return Promise.resolve(evidence);
  }
  revokeActionChallenge(tenantId: string, challengeId: string): Promise<boolean> {
    const approval = this.approvals.get(`${tenantId}\0${challengeId}`);
    if (!approval) return Promise.resolve(false);
    approval.status = 'revoked';
    delete approval.evidence;
    return Promise.resolve(true);
  }
  verifyRecordedApproval(tenantId: string, evidence: ApprovalEvidence): Promise<boolean> {
    const approval = this.approvals.get(`${tenantId}\0${evidence.challenge.challenge_id}`);
    return Promise.resolve(
      Boolean(
        approval?.status === 'approved' &&
        approval.evidence &&
        canonicalJson(approval.evidence) === canonicalJson(evidence),
      ),
    );
  }
  reserve(
    tenantId: string,
    key: string,
    fingerprint: string,
    metadata: SharedReservationMetadata = {},
  ): Promise<SharedReservationResult> {
    const storageKey = `${tenantId}\0${key}`;
    const existing = this.reservations.get(storageKey);
    if (existing)
      return Promise.resolve({
        state: existing.fingerprint === fingerprint ? 'duplicate' : 'conflict',
        reservation_id: existing.reservationId,
      });
    const nextReservationId = `res_00000000-0000-4000-8000-${String(this.reservations.size + 1).padStart(12, '0')}`;
    this.reservations.set(storageKey, {
      fingerprint,
      state: 'pending',
      reservationId: nextReservationId,
      metadata,
      createdAt: new Date(0).toISOString(),
    });
    this.revision += 1;
    return Promise.resolve({
      state: 'new',
      reservation_id: nextReservationId,
      revision: this.revision,
    });
  }
  complete(tenantId: string, key: string, fingerprint: string): Promise<number> {
    const existing = this.reservations.get(`${tenantId}\0${key}`);
    if (!existing || existing.fingerprint !== fingerprint || existing.state !== 'pending')
      throw new TypeError('transition mismatch');
    existing.state = 'completed';
    this.revision += 1;
    return Promise.resolve(this.revision);
  }
  release(tenantId: string, key: string, fingerprint: string): Promise<number> {
    const storageKey = `${tenantId}\0${key}`;
    const existing = this.reservations.get(storageKey);
    if (!existing || existing.fingerprint !== fingerprint || existing.state !== 'pending')
      throw new TypeError('transition mismatch');
    this.reservations.delete(storageKey);
    this.revision += 1;
    return Promise.resolve(this.revision);
  }
  checkpoint(tenantId: string): Promise<SharedActionCheckpoint> {
    const count = [...this.reservations].filter(([key]) => key.startsWith(`${tenantId}\0`)).length;
    return Promise.resolve({
      checkpoint_version: '1',
      tenant_ref: `hmac-sha256:${'1'.repeat(64)}`,
      revision: this.revision,
      row_count: count,
      accumulator: `xor256:${'2'.repeat(64)}`,
      updated_at: new Date(0).toISOString(),
      checkpoint_hash: `hmac-sha256:${'3'.repeat(64)}`,
    });
  }
  async compareCheckpoint(
    tenantId: string,
    anchored: SharedActionCheckpoint,
  ): Promise<SharedActionCheckpointComparison> {
    const current = await this.checkpoint(tenantId);
    return {
      status:
        current.revision > anchored.revision
          ? 'advanced'
          : current.revision < anchored.revision
            ? 'rollback_detected'
            : current.checkpoint_hash === anchored.checkpoint_hash
              ? 'same'
              : 'integrity_conflict',
      anchored_revision: anchored.revision,
      current_revision: current.revision,
      current_checkpoint: current,
    };
  }
  pending(tenantId: string): Promise<SharedPendingActionReservation[]> {
    return Promise.resolve(
      [...this.reservations]
        .filter(([key, value]) => key.startsWith(`${tenantId}\0`) && value.state === 'pending')
        .map(([, value]) => ({
          reservation_id: value.reservationId,
          execution_fingerprint: value.fingerprint,
          audit_id: value.metadata.auditId ?? 'audit',
          tool_name_hash: value.metadata.toolNameHash ?? 'sha256:tool',
          environment: value.metadata.environment ?? 'production',
          created_at: value.createdAt,
          updated_at: value.createdAt,
          age_seconds: 1_000,
        })),
    );
  }
  reconcile(
    tenantId: string,
    selectedReservationId: string,
    outcome: SharedActionReconciliationRecord['outcome'],
  ): Promise<SharedActionReconciliationRecord> {
    const found = [...this.reservations].find(
      ([key, value]) =>
        key.startsWith(`${tenantId}\0`) &&
        value.reservationId === selectedReservationId &&
        value.state === 'pending',
    );
    if (!found) throw new TypeError('shared pending reservation was not found');
    const [storageKey, value] = found;
    if (outcome === 'confirmed_executed') value.state = 'completed';
    else this.reservations.delete(storageKey);
    this.revision += 1;
    const record: SharedActionReconciliationRecord = {
      reconciliation_id: `rec_00000000-0000-4000-8000-${String(this.reconciliations.length + 1).padStart(12, '0')}`,
      reservation_id: value.reservationId,
      execution_fingerprint: value.fingerprint,
      audit_id: value.metadata.auditId ?? 'audit',
      tool_name_hash: value.metadata.toolNameHash ?? 'sha256:tool',
      environment: value.metadata.environment ?? 'production',
      outcome,
      evidence_hash: `hmac-sha256:${'4'.repeat(64)}`,
      reconciled_by_hash: `hmac-sha256:${'5'.repeat(64)}`,
      reconciled_at: new Date(0).toISOString(),
      previous_hash: this.reconciliations.at(-1)?.record_hash ?? 'GENESIS',
      record_hash: `hmac-sha256:${String(this.reconciliations.length + 6)
        .repeat(64)
        .slice(0, 64)}`,
    };
    this.reconciliations.push(record);
    return Promise.resolve(record);
  }
  reconciliationHistory(): Promise<SharedActionReconciliationRecord[]> {
    return Promise.resolve([...this.reconciliations].reverse());
  }
  verifyReconciliations(): Promise<{ valid: boolean; checked: number }> {
    return Promise.resolve({ valid: true, checked: this.reconciliations.length });
  }
  claimCheckpointAnchorDeliveries(limit: number): Promise<[]> {
    void limit;
    return Promise.resolve([]);
  }
  finishCheckpointAnchorDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): Promise<undefined> {
    void input;
    return Promise.resolve(undefined);
  }
  checkpointAnchorAcknowledged(tenantId: string): Promise<boolean> {
    void tenantId;
    return Promise.resolve(true);
  }
  listCheckpointAnchorDeliveries(tenantId: string, limit: number): Promise<[]> {
    void tenantId;
    void limit;
    return Promise.resolve([]);
  }
  redriveCheckpointAnchorDelivery(tenantId: string, deliveryId: string): Promise<boolean> {
    void tenantId;
    void deliveryId;
    return Promise.resolve(false);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class AnchoredMemoryActionState extends MemoryActionState {
  private delivery: SharedCheckpointAnchorDelivery | undefined;
  private payload = '';
  private leaseId: string | undefined;

  override async reserve(
    tenantId: string,
    key: string,
    fingerprint: string,
    metadata: SharedReservationMetadata = {},
  ): Promise<SharedReservationResult> {
    const result = await super.reserve(tenantId, key, fingerprint, metadata);
    if (result.state === 'new') {
      this.payload = JSON.stringify({
        schema_version: '2026-07-20',
        event_type: 'schema_guard.action_idempotency_checkpoint',
        event_id: `hmac-sha256:${'6'.repeat(64)}`,
        checkpoint: await this.checkpoint(tenantId),
      });
      this.delivery = {
        delivery_id: 'anchor_00000000-0000-4000-8000-000000000001',
        revision: this.revision,
        checkpoint_hash: `hmac-sha256:${'3'.repeat(64)}`,
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: new Date(0).toISOString(),
        last_attempt_at: null,
        delivered_at: null,
        response_status: null,
        error_code: null,
        created_at: new Date(0).toISOString(),
      };
    }
    return result;
  }
  override claimCheckpointAnchorDeliveries(): Promise<SharedCheckpointAnchorClaim[]> {
    if (!this.delivery || this.delivery.status !== 'pending') return Promise.resolve([]);
    this.leaseId = 'lease_00000000-0000-4000-8000-000000000001';
    this.delivery.status = 'processing';
    this.delivery.attempt_count += 1;
    return Promise.resolve([
      {
        deliveryId: this.delivery.delivery_id,
        leaseId: this.leaseId,
        payload: this.payload,
        attemptCount: this.delivery.attempt_count,
      },
    ]);
  }
  override finishCheckpointAnchorDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): Promise<'delivered' | 'pending' | 'dead' | undefined> {
    if (
      !this.delivery ||
      input.deliveryId !== this.delivery.delivery_id ||
      input.leaseId !== this.leaseId
    )
      return Promise.resolve(undefined);
    this.delivery.status = input.delivered ? 'delivered' : input.retryable ? 'pending' : 'dead';
    this.delivery.response_status = input.responseStatus ?? null;
    this.delivery.error_code = input.errorCode ?? null;
    this.delivery.delivered_at = input.delivered ? new Date().toISOString() : null;
    return Promise.resolve(this.delivery.status);
  }
  override checkpointAnchorAcknowledged(): Promise<boolean> {
    return Promise.resolve(
      this.delivery?.status === 'delivered' && this.delivery.revision === this.revision,
    );
  }
  override listCheckpointAnchorDeliveries(): Promise<SharedCheckpointAnchorDelivery[]> {
    return Promise.resolve(this.delivery ? [structuredClone(this.delivery)] : []);
  }
}

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-shared-http-')), 'managed.db');
}

describe('managed shared action-state boundary', () => {
  it('accepts a decision and descriptor created on a different managed instance', async () => {
    const state = new MemoryActionState();
    const services = await Promise.all(
      [0, 1].map(async () => {
        const service = createManagedServer(
          { databasePath: await database(), masterSecret: secret },
          { actionState: state },
        );
        service.store.bootstrapTenant({
          id: 'cross-instance-tenant',
          name: 'Cross Instance Tenant',
          plan: 'trial',
          apiKey: 'cross-instance-admin',
        });
        await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
        const address = service.server.address();
        if (!address || typeof address === 'string') throw new Error('missing server address');
        return { service, base: `http://127.0.0.1:${address.port}` };
      }),
    );
    try {
      const headers = {
        authorization: 'Bearer cross-instance-admin',
        'content-type': 'application/json',
      };
      expect(
        (
          await fetch(`${services[0]!.base}/v1/admin/actions/descriptors`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              tool_name: 'charge',
              environment: 'production',
              risk_level: 'high',
              side_effect: 'irreversible',
            }),
          })
        ).status,
      ).toBe(200);
      const validation = await fetch(`${services[0]!.base}/v1/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool_name: 'charge',
          tool_schema: {
            type: 'object',
            additionalProperties: false,
            properties: { amount: { type: 'integer' } },
            required: ['amount'],
          },
          raw_arguments: { amount: 25 },
        }),
      });
      const decision = (await validation.json()) as Record<string, unknown>;
      expect(validation.status).toBe(200);
      const challengeResponse = await fetch(`${services[1]!.base}/v1/actions/challenges`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision,
          tool_name: 'charge',
          environment: 'production',
          expires_in_seconds: 300,
        }),
      });
      expect(challengeResponse.status).toBe(201);
      const challenge = (await challengeResponse.json()) as { challenge_id: string };
      const approvalResponse = await fetch(
        `${services[0]!.base}/v1/actions/challenges/${challenge.challenge_id}/approve`,
        { method: 'POST', headers },
      );
      expect(approvalResponse.status).toBe(200);
      const approval = (await approvalResponse.json()) as Record<string, unknown>;
      const evaluation = await fetch(`${services[1]!.base}/v1/actions/evaluate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision,
          tool_name: 'charge',
          environment: 'production',
          idempotency_key: 'cross-instance-charge-1',
          approval,
        }),
      });
      expect(evaluation.status).toBe(200);
      expect(await evaluation.json()).toMatchObject({ status: 'allowed' });
      const secondStore = services[1]!.service.store;
      const secondPrincipal = secondStore.authenticate('cross-instance-admin')!;
      expect(
        secondStore.verifyActionDecision(
          secondPrincipal,
          decision as unknown as GuardDecision,
          'charge',
        ),
      ).toBe(false);
      expect(() => secondStore.actionDescriptor(secondPrincipal, 'charge', 'production')).toThrow(
        /must be registered/u,
      );
    } finally {
      await Promise.all(services.map(({ service }) => service.close()));
    }
  });

  it('routes the HTTP reservation lifecycle and checkpoints through shared state', async () => {
    const state = new MemoryActionState();
    const service = createManagedServer(
      { databasePath: await database(), masterSecret: secret },
      { actionState: state },
    );
    try {
      service.store.bootstrapTenant({
        id: 'shared-tenant',
        name: 'Shared Tenant',
        plan: 'trial',
        apiKey: 'shared-admin-key',
      });
      const admin = service.store.authenticate('shared-admin-key')!;
      service.store.registerActionDescriptor(admin, 'charge', 'production', 'low', 'irreversible');
      await state.upsertActionDescriptor(
        admin.tenantId,
        'charge',
        'production',
        'low',
        'irreversible',
      );
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const base = `http://127.0.0.1:${address.port}`;
      const headers = {
        authorization: 'Bearer shared-admin-key',
        'content-type': 'application/json',
      };
      expect((await fetch(`${base}/readyz`)).status).toBe(200);
      const validation = await fetch(`${base}/v1/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool_name: 'charge',
          tool_schema: {
            type: 'object',
            additionalProperties: false,
            properties: { amount: { type: 'integer' } },
            required: ['amount'],
          },
          raw_arguments: { amount: 25 },
        }),
      });
      expect(validation.status).toBe(200);
      const decision = (await validation.json()) as Record<string, unknown>;
      const evaluationBody = JSON.stringify({
        decision,
        tool_name: 'charge',
        environment: 'production',
        idempotency_key: 'charge-shared-1',
      });
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          fetch(`${base}/v1/actions/evaluate`, { method: 'POST', headers, body: evaluationBody }),
        ),
      );
      const gates = (await Promise.all(results.map((response) => response.json()))) as Array<{
        status: string;
        execution_fingerprint: string;
        reservation?: { reservation_id?: string };
      }>;
      expect(gates.filter((gate) => gate.status === 'allowed')).toHaveLength(1);
      expect(gates.filter((gate) => gate.status === 'duplicate_blocked')).toHaveLength(11);
      const allowed = gates.find((gate) => gate.status === 'allowed')!;
      expect(allowed.reservation?.reservation_id).toBe(reservationId);
      expect(
        (
          await fetch(`${base}/v1/actions/idempotency/complete`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              idempotency_key: 'charge-shared-1',
              execution_fingerprint: allowed.execution_fingerprint,
            }),
          })
        ).status,
      ).toBe(200);
      const checkpoint = await fetch(`${base}/v1/actions/idempotency/checkpoint`, { headers });
      const completedCheckpoint = (await checkpoint.json()) as SharedActionCheckpoint;
      expect(completedCheckpoint).toMatchObject({ revision: 2, row_count: 1 });
      const comparison = await fetch(`${base}/v1/actions/idempotency/checkpoint/compare`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ checkpoint: completedCheckpoint }),
      });
      expect(await comparison.json()).toMatchObject({ status: 'same', current_revision: 2 });
      expect(service.store.actionIdempotencyCheckpoint(admin)).toMatchObject({
        revision: 0,
        row_count: 0,
      });
      const secondEvaluation = await fetch(`${base}/v1/actions/evaluate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision,
          tool_name: 'charge',
          environment: 'production',
          idempotency_key: 'charge-shared-2',
        }),
      });
      const secondGate = (await secondEvaluation.json()) as {
        reservation: { reservation_id: string };
      };
      const pendingResponse = await fetch(`${base}/v1/actions/reconciliation/pending`, {
        headers,
      });
      expect(await pendingResponse.json()).toMatchObject({
        pending: [{ reservation_id: secondGate.reservation.reservation_id }],
      });
      const reconciliation = await fetch(
        `${base}/v1/actions/reconciliation/${secondGate.reservation.reservation_id}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            outcome: 'confirmed_not_executed',
            evidence_reference: 'operator-ticket-1',
          }),
        },
      );
      expect(reconciliation.status).toBe(200);
      expect(await reconciliation.json()).toMatchObject({
        outcome: 'confirmed_not_executed',
      });
      expect(
        await (await fetch(`${base}/v1/actions/reconciliation/history`, { headers })).json(),
      ).toMatchObject({ reconciliations: [{ outcome: 'confirmed_not_executed' }] });
      expect(
        await (await fetch(`${base}/v1/actions/reconciliation/verify`, { headers })).json(),
      ).toEqual({ valid: true, checked: 1 });
    } finally {
      await service.close();
    }
    expect(state.closed).toBe(true);
  });

  it('reports failed shared-state initialization as unavailable', async () => {
    const state = new MemoryActionState();
    state.migrate = () => Promise.reject(new Error('database unavailable'));
    const service = createManagedServer(
      { databasePath: await database(), masterSecret: secret },
      { actionState: state },
    );
    try {
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ status: 'shared_action_state_unavailable' });
    } finally {
      await service.close();
    }
  });

  it('requires shared checkpoint delivery acknowledgement before allowing execution', async () => {
    const state = new AnchoredMemoryActionState();
    const deliveredPayloads: string[] = [];
    const service = createManagedServer(
      {
        databasePath: await database(),
        masterSecret: secret,
        actionCheckpointAnchorUrl: 'https://anchor.invokeguard.example/v1/checkpoints',
        actionCheckpointAnchorSigningSecret: 'shared-anchor-signing-secret-at-least-32-characters',
        actionCheckpointAnchorPollIntervalMs: 60_000,
      },
      {
        actionState: state,
        checkpointAnchorDeliver: (_endpoint, _secret, payload) => {
          deliveredPayloads.push(payload);
          return Promise.resolve({ delivered: true, retryable: false, responseStatus: 202 });
        },
      },
    );
    try {
      service.store.bootstrapTenant({
        id: 'anchored-shared-tenant',
        name: 'Anchored Shared Tenant',
        plan: 'trial',
        apiKey: 'anchored-shared-admin',
      });
      const admin = service.store.authenticate('anchored-shared-admin')!;
      service.store.registerActionDescriptor(admin, 'charge', 'production', 'low', 'irreversible');
      const decision = service.store.recordValidation(
        admin,
        validateToolCall({
          tool_name: 'charge',
          tool_schema: {
            type: 'object',
            additionalProperties: false,
            properties: { amount: { type: 'integer' } },
            required: ['amount'],
          },
          raw_arguments: { amount: 25 },
        }),
      );
      await state.upsertActionDescriptor(
        admin.tenantId,
        'charge',
        'production',
        'low',
        'irreversible',
      );
      await state.recordAcceptedDecision(admin.tenantId, decision);
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const base = `http://127.0.0.1:${address.port}`;
      const headers = {
        authorization: 'Bearer anchored-shared-admin',
        'content-type': 'application/json',
      };
      const evaluation = await fetch(`${base}/v1/actions/evaluate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision,
          tool_name: 'charge',
          environment: 'production',
          idempotency_key: 'anchored-shared-charge-1',
        }),
      });
      expect(evaluation.status).toBe(200);
      expect(await evaluation.json()).toMatchObject({ status: 'allowed' });
      expect(deliveredPayloads).toHaveLength(1);
      expect(JSON.parse(deliveredPayloads[0]!)).toMatchObject({
        checkpoint: { revision: 1, row_count: 1 },
      });
      const deliveries = await fetch(`${base}/v1/actions/idempotency/anchors/deliveries`, {
        headers,
      });
      expect(await deliveries.json()).toMatchObject({
        deliveries: [{ revision: 1, status: 'delivered', response_status: 202 }],
      });
    } finally {
      await service.close();
    }
  });
});
