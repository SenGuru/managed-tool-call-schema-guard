import Database from 'better-sqlite3';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedStore } from '../packages/managed/src/store.js';
import { dispatchCheckpointAnchorsOnce } from '../packages/managed/src/webhook.js';

const masterSecret = 'checkpoint-anchor-test-master-secret-that-is-at-least-32-characters';
const signingSecret = 'checkpoint-anchor-outbound-signing-secret-32-characters';
const endpoint = 'https://anchor.invokeguard.example/v1/checkpoints';

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-anchor-')), 'managed.db');
}

function configured(databasePath: string, maxAttempts = 3) {
  return {
    databasePath,
    masterSecret,
    actionCheckpointAnchorUrl: endpoint,
    actionCheckpointAnchorSigningSecret: signingSecret,
    actionCheckpointAnchorMaxAttempts: maxAttempts,
  } as const;
}

describe('automatic action checkpoint anchoring', () => {
  it('atomically queues value-free checkpoints and delivers every manifest revision', async () => {
    const store = new ManagedStore(configured(await database()));
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;

    expect(store.listCheckpointAnchorDeliveries(principal)).toMatchObject([
      { revision: 0, status: 'pending', attempt_count: 0 },
    ]);
    const payloads: string[] = [];
    expect(
      await dispatchCheckpointAnchorsOnce(store, {
        deliver: (actualEndpoint, actualSecret, payload) => {
          expect(actualEndpoint).toBe(endpoint);
          expect(actualSecret).toBe(signingSecret);
          payloads.push(payload);
          return Promise.resolve({ delivered: true, retryable: false, responseStatus: 202 });
        },
      }),
    ).toEqual({ claimed: 1, delivered: 1, retrying: 0, dead: 0 });

    expect(
      store.actionIdempotencyLedger(principal).reserve('customer-operation-123', 'sha256:a'),
    ).toBe('new');
    const deliveries = store.listCheckpointAnchorDeliveries(principal);
    expect(deliveries).toMatchObject([
      { revision: 1, status: 'pending', attempt_count: 0 },
      { revision: 0, status: 'delivered', attempt_count: 1, response_status: 202 },
    ]);
    const queued = store.db
      .prepare(
        'SELECT payload_json FROM checkpoint_anchor_deliveries WHERE tenant_id=? AND revision=1',
      )
      .get('a') as { payload_json: string };
    const parsed = JSON.parse(queued.payload_json) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schema_version: '2026-07-20',
      event_type: 'schema_guard.action_idempotency_checkpoint',
      checkpoint: { checkpoint_version: '1', revision: 1, row_count: 1 },
    });
    expect(queued.payload_json).not.toContain('customer-operation-123');
    expect(queued.payload_json).not.toContain('admin-a');

    expect(
      await dispatchCheckpointAnchorsOnce(store, {
        deliver: (_actualEndpoint, _actualSecret, payload) => {
          payloads.push(payload);
          return Promise.resolve({ delivered: true, retryable: false, responseStatus: 204 });
        },
      }),
    ).toEqual({ claimed: 1, delivered: 1, retrying: 0, dead: 0 });
    expect(payloads).toHaveLength(2);
    expect(store.readinessCheck()).toBe(true);
    store.close();
  });

  it('uses bounded retry, exposes dead letters, and supports explicit redrive', async () => {
    const store = new ManagedStore(configured(await database(), 1));
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    expect(
      await dispatchCheckpointAnchorsOnce(store, {
        deliver: () =>
          Promise.resolve({
            delivered: false,
            retryable: true,
            responseStatus: 503,
            errorCode: 'receiver_unavailable',
          }),
      }),
    ).toEqual({ claimed: 1, delivered: 0, retrying: 0, dead: 1 });
    const [dead] = store.listCheckpointAnchorDeliveries(principal);
    expect(dead).toMatchObject({
      revision: 0,
      status: 'dead',
      attempt_count: 1,
      response_status: 503,
      error_code: 'receiver_unavailable',
    });
    expect(store.readinessCheck()).toBe(false);
    expect(store.redriveCheckpointAnchorDelivery(principal, dead!.delivery_id)).toBe(true);
    expect(store.listCheckpointAnchorDeliveries(principal)[0]).toMatchObject({
      status: 'pending',
      attempt_count: 0,
    });
    expect(store.readinessCheck()).toBe(true);
    store.close();
  });

  it('fails closed on payload substitution and out-of-band deletion of current coverage', async () => {
    const databasePath = await database();
    const store = new ManagedStore(configured(databasePath));
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    store.db
      .prepare("UPDATE checkpoint_anchor_deliveries SET payload_json='{}' WHERE tenant_id='a'")
      .run();
    expect(() => store.listCheckpointAnchorDeliveries(principal)).toThrow(
      /checkpoint anchor payload integrity/u,
    );
    expect(store.readinessCheck()).toBe(false);
    store.close();

    const deletionPath = await database();
    const deletionStore = new ManagedStore(configured(deletionPath));
    deletionStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const deletionPrincipal = deletionStore.authenticate('admin-a')!;
    const external = new Database(deletionPath);
    external.prepare("DELETE FROM checkpoint_anchor_deliveries WHERE tenant_id='a'").run();
    external.close();
    expect(() =>
      deletionStore.actionIdempotencyLedger(deletionPrincipal).reserve('operation-456', 'sha256:b'),
    ).toThrow(/checkpoint anchor delivery deletion or substitution/u);
    deletionStore.close();

    const forgedAckStore = new ManagedStore(configured(await database()));
    forgedAckStore.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const forgedAckPrincipal = forgedAckStore.authenticate('admin-a')!;
    forgedAckStore.db
      .prepare(
        `UPDATE checkpoint_anchor_deliveries SET status='delivered',delivered_at=?,response_status=202 WHERE tenant_id='a'`,
      )
      .run(new Date().toISOString());
    expect(() => forgedAckStore.actionCheckpointAnchorAcknowledged(forgedAckPrincipal)).toThrow(
      /acknowledgement integrity/u,
    );
    expect(forgedAckStore.readinessCheck()).toBe(false);
    expect(forgedAckStore.verifyControlPlaneIntegrity(forgedAckPrincipal)).toMatchObject({
      valid: false,
      first_invalid_table: 'checkpoint_anchor_deliveries',
    });
    forgedAckStore.close();
  });

  it('exposes tenant-scoped delivery operations only to action reconcilers', async () => {
    const service = createManagedServer({
      ...configured(await database()),
      actionCheckpointAnchorPollIntervalMs: 60_000,
    });
    try {
      service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
      const admin = service.store.authenticate('admin-a')!;
      const evaluator = service.store.issueApiKey(admin, ['evaluate:action']);
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const endpointUrl = `http://127.0.0.1:${address.port}/v1/actions/idempotency/anchors/deliveries`;
      expect(
        (
          await fetch(endpointUrl, {
            headers: { authorization: `Bearer ${evaluator.api_key}` },
          })
        ).status,
      ).toBe(403);
      const response = await fetch(endpointUrl, {
        headers: { authorization: 'Bearer admin-a' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        deliveries: [{ revision: 0, status: 'pending' }],
      });
    } finally {
      await service.close();
    }
  });

  it('refuses a direct allowed response when receiver acknowledgement is not managed', async () => {
    const store = new ManagedStore(configured(await database()));
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'team', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    store.registerActionDescriptor(principal, 'transfer', 'production', 'low', 'reversible');
    const decision = store.recordValidation(
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
    expect(() =>
      store.evaluateManagedAction({
        principal,
        decision,
        toolName: 'transfer',
        environment: 'production',
        context: { idempotency_key: 'direct-anchor-test' },
      }),
    ).toThrow(/must use the managed HTTP boundary/u);
    expect(store.actionCheckpointAnchorAcknowledged(principal)).toBe(false);
    expect(
      await dispatchCheckpointAnchorsOnce(store, {
        deliver: () => Promise.resolve({ delivered: true, retryable: false, responseStatus: 202 }),
      }),
    ).toMatchObject({ delivered: 2 });
    expect(store.actionCheckpointAnchorAcknowledged(principal)).toBe(true);
    store.close();
  });
});
