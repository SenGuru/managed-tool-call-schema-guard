import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApprovalChallenge, validateToolCall } from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedError, ManagedStore } from '../packages/managed/src/store.js';

const secret = 'managed-reconciliation-secret-that-is-at-least-32-characters';
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
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-reconciliation-')), 'managed.db');
}

function reserve(store: ManagedStore, key = 'reconciliation-key-1') {
  const principal = store.authenticate('admin-a');
  if (!principal) throw new Error('test principal missing');
  store.registerActionDescriptor(principal, 'transfer', 'production', 'high', 'irreversible');
  const decision = store.recordValidation(principal, validateToolCall(request));
  const created = new Date();
  const challenge = createApprovalChallenge({
    decision,
    action: store.actionDescriptor(principal, 'transfer', 'production'),
    environment: 'production',
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + 3_600_000).toISOString(),
  });
  store.recordActionChallenge(principal, challenge);
  const approval = store.approveActionChallenge(principal, challenge.challenge_id);
  const context = { approval, idempotency_key: key } as const;
  const gate = store.evaluateManagedAction({
    principal,
    decision,
    toolName: 'transfer',
    environment: 'production',
    context,
  });
  if (gate.status !== 'allowed' || !gate.reservation?.reservation_id)
    throw new Error('test reservation was not created');
  return { principal, decision, context, gate, reservationId: gate.reservation.reservation_id };
}

afterEach(() => vi.useRealTimers());

describe('managed uncertain-action reconciliation', () => {
  it('requires aged pending state, keeps authenticated evidence, and confirms execution', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const store = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
      actionReconciliationMinAgeSeconds: 60,
    });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
    store.bootstrapTenant({ id: 'b', name: 'B', plan: 'trial', apiKey: 'admin-b' });
    const { principal, decision, context, reservationId } = reserve(store);
    const tenantB = store.authenticate('admin-b')!;

    expect(store.pendingActionReservations(principal, 60)).toEqual([]);
    expect(() =>
      store.reconcileActionReservation(
        principal,
        reservationId,
        'confirmed_executed',
        'downstream-ledger-entry-123',
      ),
    ).toThrow(/at least 60 seconds/u);
    expect(store.pendingActionReservations(tenantB, 60)).toEqual([]);
    expect(() =>
      store.reconcileActionReservation(
        tenantB,
        reservationId,
        'confirmed_executed',
        'cross-tenant-attempt',
      ),
    ).toThrow(ManagedError);

    vi.advanceTimersByTime(120_000);
    expect(store.pendingActionReservations(principal, 60)).toEqual([
      expect.objectContaining({
        reservation_id: reservationId,
        audit_id: decision.audit_id,
        environment: 'production',
      }),
    ]);
    expect(store.pendingActionReservations(principal, 60)[0]).not.toHaveProperty('key_hash');

    const record = store.reconcileActionReservation(
      principal,
      reservationId,
      'confirmed_executed',
      'downstream-ledger-entry-123',
    );
    expect(record).toMatchObject({
      reservation_id: reservationId,
      outcome: 'confirmed_executed',
    });
    expect(record.evidence_hash).toMatch(/^hmac-sha256:/u);
    expect(record.reconciled_by_hash).toMatch(/^hmac-sha256:/u);
    expect(record.record_hash).toMatch(/^hmac-sha256:/u);
    expect(
      store.reconcileActionReservation(
        principal,
        reservationId,
        'confirmed_executed',
        'downstream-ledger-entry-123',
      ),
    ).toEqual(record);
    expect(store.actionReconciliationHistory(principal)[0]).toMatchObject({
      ...record,
      integrity_valid: true,
    });
    expect(store.verifyActionReconciliationHistory(principal)).toEqual({
      valid: true,
      checked: 1,
    });
    const persisted = JSON.stringify(
      store.db.prepare('SELECT * FROM action_reconciliations').all(),
    );
    expect(persisted).not.toContain('downstream-ledger-entry-123');

    expect(
      store.evaluateManagedAction({
        principal,
        decision,
        toolName: 'transfer',
        environment: 'production',
        context,
      }),
    ).toMatchObject({ status: 'duplicate_blocked' });
    store.close();
  });

  it('releases only after confirmed non-execution and makes tampering visible', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const store = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
      actionReconciliationMinAgeSeconds: 60,
    });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
    const { principal, decision, context, reservationId } = reserve(
      store,
      'reconciliation-retry-key',
    );
    vi.advanceTimersByTime(120_000);
    store.reconcileActionReservation(
      principal,
      reservationId,
      'confirmed_not_executed',
      'provider-query-no-mutation-found',
    );

    const retry = store.evaluateManagedAction({
      principal,
      decision,
      toolName: 'transfer',
      environment: 'production',
      context,
    });
    expect(retry).toMatchObject({ status: 'allowed' });
    expect(retry.reservation?.reservation_id).not.toBe(reservationId);

    store.db
      .prepare(
        'UPDATE action_reconciliations SET evidence_hash=? WHERE tenant_id=? AND reservation_id=?',
      )
      .run(`hmac-sha256:${'0'.repeat(64)}`, 'a', reservationId);
    expect(store.actionReconciliationHistory(principal)[0]).toMatchObject({
      reservation_id: reservationId,
      integrity_valid: false,
    });
    const verification = store.verifyActionReconciliationHistory(principal);
    expect(verification).toMatchObject({ valid: false, checked: 0 });
    expect(verification.first_invalid_reconciliation_id).toMatch(/^rec_/u);
    store.close();
  });

  it('enforces the separate reconciliation scope over HTTP', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
      actionReconciliationMinAgeSeconds: 60,
    });
    try {
      service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
      const admin = service.store.authenticate('admin-a')!;
      const evaluator = service.store.issueApiKey(admin, ['evaluate:action']);
      const reconciler = service.store.issueApiKey(admin, ['reconcile:action']);
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const endpoint = `http://127.0.0.1:${address.port}/v1/actions/reconciliation/pending?older_than_seconds=60`;
      const checkpointEndpoint = `http://127.0.0.1:${address.port}/v1/actions/idempotency/checkpoint`;
      expect(
        (
          await fetch(endpoint, {
            headers: { authorization: `Bearer ${evaluator.api_key}` },
          })
        ).status,
      ).toBe(403);
      const allowed = await fetch(endpoint, {
        headers: { authorization: `Bearer ${reconciler.api_key}` },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ pending: [] });
      expect(
        (
          await fetch(checkpointEndpoint, {
            headers: { authorization: `Bearer ${evaluator.api_key}` },
          })
        ).status,
      ).toBe(403);
      const checkpoint = await fetch(checkpointEndpoint, {
        headers: { authorization: `Bearer ${reconciler.api_key}` },
      });
      expect(checkpoint.status).toBe(200);
      const checkpointBody = (await checkpoint.json()) as Record<string, unknown>;
      expect(checkpointBody).toMatchObject({
        checkpoint_version: '1',
        revision: 0,
        row_count: 0,
      });
      const compared = await fetch(`${checkpointEndpoint}/compare`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${reconciler.api_key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ checkpoint: checkpointBody }),
      });
      expect(compared.status).toBe(200);
      expect(await compared.json()).toMatchObject({
        status: 'same',
        anchored_revision: 0,
        current_revision: 0,
      });
      const forged = await fetch(`${checkpointEndpoint}/compare`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${reconciler.api_key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          checkpoint: {
            ...checkpointBody,
            checkpoint_hash: `hmac-sha256:${'0'.repeat(64)}`,
          },
        }),
      });
      expect(forged.status).toBe(409);
    } finally {
      await service.close();
    }
  });
});
