import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createManagedServer } from '../packages/managed/src/server.js';
import { dispatchSharedAlertWebhooksOnce } from '../packages/managed/src/webhook.js';
import type {
  AlertState,
  SharedAlert,
  SharedAlertClaim,
  SharedAlertDelivery,
  SharedAlertWebhook,
} from '../packages/shared-state/src/index.js';

const secret = 'managed-shared-alert-test-secret-at-least-32-characters';
type Delivery = SharedAlertDelivery & {
  tenantId: string;
  alertRef: string;
  payload: string;
  endpoint: string;
  signingSecret: string;
  leaseId?: string;
};

class MemoryAlertState implements AlertState {
  readonly alerts = new Map<string, SharedAlert[]>();
  readonly webhooks = new Map<
    string,
    Array<SharedAlertWebhook & { endpoint: string; secret: string }>
  >();
  readonly deliveries: Delivery[] = [];
  readonly sources = new Map<string, SharedAlert>();
  available = true;
  migrate(): Promise<void> {
    return Promise.resolve();
  }
  ready(): Promise<boolean> {
    return Promise.resolve(this.available);
  }
  bootstrapTenant(tenantId: string): Promise<void> {
    this.alerts.set(tenantId, []);
    this.webhooks.set(tenantId, []);
    return Promise.resolve();
  }
  recordAlert(
    tenantId: string,
    kind: string,
    severity: string,
    detail: unknown,
    sourceKey: string,
  ): Promise<SharedAlert> {
    const prior = this.sources.get(`${tenantId}:${sourceKey}`);
    if (prior) return Promise.resolve(structuredClone(prior));
    const rows = this.alerts.get(tenantId)!;
    const alert: SharedAlert = {
      id: rows.length + 1,
      alert_id: `alert-${tenantId}-${rows.length + 1}`,
      kind,
      severity,
      detail: structuredClone(detail as Record<string, unknown>),
      created_at: new Date().toISOString(),
      acknowledged_at: null,
    };
    rows.push(alert);
    this.sources.set(`${tenantId}:${sourceKey}`, alert);
    for (const webhook of this.webhooks.get(tenantId)!.filter((row) => !row.disabled_at))
      this.deliveries.push({
        delivery_id: `delivery-${this.deliveries.length + 1}`,
        webhook_id: webhook.webhook_id,
        alert_id: alert.id,
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: alert.created_at,
        last_attempt_at: null,
        delivered_at: null,
        response_status: null,
        error_code: null,
        created_at: alert.created_at,
        tenantId,
        alertRef: alert.alert_id,
        payload: JSON.stringify({
          event_type: 'schema_guard.alert',
          event_id: alert.alert_id,
          kind,
          severity,
          detail,
        }),
        endpoint: webhook.endpoint,
        signingSecret: webhook.secret,
      });
    return Promise.resolve(structuredClone(alert));
  }
  listAlerts(tenantId: string, limit = 100): Promise<SharedAlert[]> {
    return Promise.resolve(structuredClone(this.alerts.get(tenantId)!.slice(-limit).reverse()));
  }
  createWebhook(
    tenantId: string,
    label: string,
    normalizedEndpoint: string,
  ): Promise<SharedAlertWebhook & { signing_secret: string }> {
    const rows = this.webhooks.get(tenantId)!;
    const created_at = new Date().toISOString();
    const row = {
      webhook_id: `wh-${tenantId}-${rows.length + 1}`,
      label,
      endpoint_hash: `endpoint-${rows.length + 1}`,
      created_at,
      disabled_at: null,
      endpoint: normalizedEndpoint,
      secret: `shared-signing-secret-${rows.length + 1}`,
    };
    rows.push(row);
    return Promise.resolve({
      webhook_id: row.webhook_id,
      label,
      endpoint_hash: row.endpoint_hash,
      created_at,
      disabled_at: null,
      signing_secret: row.secret,
    });
  }
  listWebhooks(tenantId: string): Promise<SharedAlertWebhook[]> {
    return Promise.resolve(
      this.webhooks.get(tenantId)!.map((row) => ({
        webhook_id: row.webhook_id,
        label: row.label,
        endpoint_hash: row.endpoint_hash,
        created_at: row.created_at,
        disabled_at: row.disabled_at,
      })),
    );
  }
  disableWebhook(tenantId: string, webhookId: string): Promise<boolean> {
    const row = this.webhooks.get(tenantId)!.find((item) => item.webhook_id === webhookId);
    if (!row) return Promise.resolve(false);
    row.disabled_at ??= new Date().toISOString();
    for (const delivery of this.deliveries)
      if (
        delivery.tenantId === tenantId &&
        delivery.webhook_id === webhookId &&
        delivery.status === 'pending'
      )
        delivery.status = 'dead';
    return Promise.resolve(true);
  }
  listDeliveries(tenantId: string, limit = 100): Promise<SharedAlertDelivery[]> {
    return Promise.resolve(
      structuredClone(
        this.deliveries
          .filter((row) => row.tenantId === tenantId)
          .slice(-limit)
          .reverse()
          .map((row) => ({
            delivery_id: row.delivery_id,
            webhook_id: row.webhook_id,
            alert_id: row.alert_id,
            status: row.status,
            attempt_count: row.attempt_count,
            next_attempt_at: row.next_attempt_at,
            last_attempt_at: row.last_attempt_at,
            delivered_at: row.delivered_at,
            response_status: row.response_status,
            error_code: row.error_code,
            created_at: row.created_at,
          })),
      ),
    );
  }
  redriveDelivery(tenantId: string, deliveryId: string): Promise<boolean> {
    const row = this.deliveries.find(
      (item) => item.tenantId === tenantId && item.delivery_id === deliveryId,
    );
    if (!row || row.status !== 'dead') return Promise.resolve(false);
    row.status = 'pending';
    row.attempt_count = 0;
    row.error_code = null;
    return Promise.resolve(true);
  }
  claimDeliveries(limit: number): Promise<SharedAlertClaim[]> {
    const rows = this.deliveries.filter((row) => row.status === 'pending').slice(0, limit);
    return Promise.resolve(
      rows.map((row) => {
        row.status = 'processing';
        row.attempt_count += 1;
        row.leaseId = `lease-${row.delivery_id}-${row.attempt_count}`;
        return {
          deliveryId: row.delivery_id,
          leaseId: row.leaseId,
          endpoint: row.endpoint,
          signingSecret: row.signingSecret,
          payload: row.payload,
          attemptCount: row.attempt_count,
        };
      }),
    );
  }
  finishDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): Promise<'delivered' | 'pending' | 'dead' | undefined> {
    const row = this.deliveries.find(
      (item) => item.delivery_id === input.deliveryId && item.leaseId === input.leaseId,
    );
    if (!row) return Promise.resolve(undefined);
    row.status = input.delivered ? 'delivered' : input.retryable ? 'pending' : 'dead';
    row.response_status = input.responseStatus ?? null;
    row.error_code = input.errorCode ?? null;
    row.delivered_at = input.delivered ? new Date().toISOString() : null;
    delete row.leaseId;
    return Promise.resolve(row.status);
  }
  verifyTenant(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return Promise.resolve({ valid: this.available, checked: this.alerts.get(tenantId)!.length });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-shared-alert-')), 'managed.db');
}

describe('managed shared alert state', () => {
  it('shares alerts, webhook outbox claims, and readiness across independent instances', async () => {
    const state = new MemoryAlertState();
    await state.bootstrapTenant('tenant-a');
    const services = await Promise.all(
      [0, 1].map(async () => {
        const service = createManagedServer(
          {
            databasePath: await database(),
            masterSecret: secret,
            alertWebhookPollIntervalMs: 60_000,
          },
          { alertState: state },
        );
        service.store.bootstrapTenant({
          id: 'tenant-a',
          name: 'Tenant A',
          plan: 'team',
          apiKey: 'admin-a',
        });
        await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
        const address = service.server.address();
        if (!address || typeof address === 'string') throw new Error('missing server address');
        return { service, base: `http://127.0.0.1:${address.port}` };
      }),
    );
    try {
      const headers = {
        authorization: 'Bearer admin-a',
        'content-type': 'application/json',
      };
      const webhookResponse = await fetch(`${services[0]!.base}/v1/alert-webhooks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ label: 'oncall', endpoint: 'https://alerts.example.com/schema' }),
      });
      expect(webhookResponse.status).toBe(201);
      const webhook = (await webhookResponse.json()) as { webhook_id: string };
      const rejected = await fetch(`${services[1]!.base}/v1/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool_name: 'search',
          tool_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          raw_arguments: {},
        }),
      });
      expect(rejected.status).toBe(422);
      const alerts = await Promise.all(
        services.map(({ base }) =>
          fetch(`${base}/v1/alerts`, { headers }).then((response) => response.json()),
        ),
      );
      expect(alerts[0]).toEqual(alerts[1]);
      expect(alerts[0]).toMatchObject({
        alerts: [{ kind: 'validation_rejected', severity: 'warning' }],
      });
      expect(
        services[0]!.service.store.alerts(services[0]!.service.store.authenticate('admin-a')!),
      ).toEqual([]);
      const delivered: Array<{ endpoint: string; secret: string; payload: string }> = [];
      await expect(
        dispatchSharedAlertWebhooksOnce(state, {
          deliver: (endpoint, signingSecret, payload) => {
            delivered.push({ endpoint, secret: signingSecret, payload });
            return Promise.resolve({ delivered: true, retryable: false, responseStatus: 204 });
          },
        }),
      ).resolves.toEqual({ claimed: 1, delivered: 1, retrying: 0, dead: 0 });
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.payload).not.toContain('raw_arguments');
      const deliveries = (await fetch(`${services[1]!.base}/v1/alert-webhooks/deliveries`, {
        headers,
      }).then((response) => response.json())) as { deliveries: SharedAlertDelivery[] };
      expect(deliveries.deliveries[0]).toMatchObject({ status: 'delivered', response_status: 204 });
      expect(
        (
          await fetch(`${services[1]!.base}/v1/alert-webhooks/${webhook.webhook_id}`, {
            method: 'DELETE',
            headers,
          })
        ).status,
      ).toBe(200);
      state.available = false;
      expect((await fetch(`${services[0]!.base}/readyz`)).status).toBe(503);
    } finally {
      await Promise.all(services.map(({ service }) => service.close()));
    }
  });
});
