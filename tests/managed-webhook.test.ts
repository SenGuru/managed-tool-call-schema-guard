import { createHmac } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedStore } from '../packages/managed/src/store.js';
import {
  deliverAlertWebhook,
  dispatchAlertWebhooksOnce,
  signAlertWebhookPayload,
} from '../packages/managed/src/webhook.js';

const secret = 'managed-webhook-secret-that-is-at-least-32-characters';

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-webhook-')), 'managed.db');
}

function rejected(
  privateValue = 'private-value-that-must-not-leave',
): ReturnType<typeof validateToolCall> {
  return validateToolCall({
    tool_name: 'private_tool',
    tool_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['count'],
      properties: { count: { type: 'integer' } },
    },
    raw_arguments: { count: privateValue },
  });
}

describe('managed alert webhook outbox', () => {
  it('encrypts endpoint credentials, projects value-free payloads, and records delivery', async () => {
    const store = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
      alertWebhookMaxAttempts: 3,
    });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    const endpoint = 'https://alerts.example.com/hooks/private-path?token=private-query-token';
    const webhook = store.createAlertWebhook(principal, 'primary-oncall', endpoint);
    expect(webhook.signing_secret).toMatch(/^sgwhsec_/u);
    expect(store.listAlertWebhooks(principal)[0]).not.toHaveProperty('signing_secret');

    store.recordValidation(principal, rejected());
    let captured: { endpoint: string; signingSecret: string; payload: string } | undefined;
    const summary = await dispatchAlertWebhooksOnce(store, {
      deliver: (sentEndpoint, signingSecret, payload) => {
        captured = { endpoint: sentEndpoint, signingSecret, payload };
        return Promise.resolve({ delivered: true, retryable: false, responseStatus: 204 });
      },
    });
    expect(summary).toEqual({ claimed: 1, delivered: 1, retrying: 0, dead: 0 });
    expect(captured).toMatchObject({ endpoint, signingSecret: webhook.signing_secret });
    const payload = JSON.parse(captured!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      schema_version: '2026-07-20',
      event_type: 'schema_guard.alert',
      kind: 'validation_rejected',
      severity: 'warning',
    });
    expect(JSON.stringify(payload)).not.toContain('private-value-that-must-not-leave');
    expect(store.listAlertWebhookDeliveries(principal)).toEqual([
      expect.objectContaining({ status: 'delivered', attempt_count: 1, response_status: 204 }),
    ]);
    const persisted = JSON.stringify(store.db.prepare('SELECT * FROM alert_webhooks').all());
    expect(persisted).not.toContain(endpoint);
    expect(persisted).not.toContain('private-query-token');
    expect(persisted).not.toContain(webhook.signing_secret);
    store.close();
  });

  it('uses bounded retries, dead letters, explicit redrive, and disabling', async () => {
    const store = new ManagedStore({
      databasePath: await database(),
      masterSecret: secret,
      alertWebhookMaxAttempts: 2,
    });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    const webhook = store.createAlertWebhook(
      principal,
      'failing-oncall',
      'https://alerts.example.com/fail',
    );
    store.recordValidation(principal, rejected());
    const fail = () =>
      Promise.resolve({
        delivered: false,
        retryable: true,
        responseStatus: 503,
        errorCode: 'http_503',
      });
    expect(await dispatchAlertWebhooksOnce(store, { deliver: fail })).toMatchObject({
      retrying: 1,
    });
    store.db
      .prepare("UPDATE alert_deliveries SET next_attempt_at='2000-01-01T00:00:00.000Z'")
      .run();
    expect(await dispatchAlertWebhooksOnce(store, { deliver: fail })).toMatchObject({ dead: 1 });
    const dead = store.listAlertWebhookDeliveries(principal)[0]!;
    expect(dead).toMatchObject({ status: 'dead', attempt_count: 2, error_code: 'http_503' });
    expect(store.redriveAlertWebhookDelivery(principal, dead.delivery_id)).toBe(true);
    expect(store.listAlertWebhookDeliveries(principal)[0]).toMatchObject({
      status: 'pending',
      attempt_count: 0,
    });
    expect(store.disableAlertWebhook(principal, webhook.webhook_id)).toBe(true);
    expect(store.listAlertWebhookDeliveries(principal)[0]).toMatchObject({
      status: 'dead',
      error_code: 'webhook_disabled',
    });
    expect(store.redriveAlertWebhookDelivery(principal, dead.delivery_id)).toBe(false);
    store.close();
  });

  it('rejects SSRF-shaped endpoints and signs an exact timestamp/body pair', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
    const principal = store.authenticate('admin-a')!;
    for (const endpoint of [
      'http://alerts.example.com/hook',
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://metadata.internal/hook',
      'https://alerts.example.com:8443/hook',
      'https://user:pass@alerts.example.com/hook',
    ])
      expect(() => store.createAlertWebhook(principal, `bad-${Math.random()}`, endpoint)).toThrow(
        /public HTTPS/u,
      );
    const timestamp = '2026-07-20T00:00:00.000Z';
    const payload = '{"kind":"validation_rejected"}';
    expect(signAlertWebhookPayload('secret', timestamp, payload)).toBe(
      `v1=${createHmac('sha256', 'secret').update(timestamp).update('.').update(payload).digest('hex')}`,
    );
    await expect(
      deliverAlertWebhook('https://127.0.0.1/hook', 'secret', payload, 500),
    ).resolves.toEqual({ delivered: false, retryable: false, errorCode: 'unsafe_destination' });
    store.close();
  });

  it('exposes tenant-scoped webhook management over the authenticated API', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
      alertWebhookPollIntervalMs: 60_000,
    });
    try {
      service.store.bootstrapTenant({ id: 'a', name: 'A', plan: 'trial', apiKey: 'admin-a' });
      const admin = service.store.authenticate('admin-a')!;
      const validateOnly = service.store.issueApiKey(admin, ['validate']);
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const base = `http://127.0.0.1:${address.port}`;
      expect(
        (
          await fetch(`${base}/v1/alert-webhooks`, {
            headers: { authorization: `Bearer ${validateOnly.api_key}` },
          })
        ).status,
      ).toBe(403);
      const created = await fetch(`${base}/v1/alert-webhooks`, {
        method: 'POST',
        headers: { authorization: 'Bearer admin-a', 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'oncall', endpoint: 'https://alerts.example.com/hook' }),
      });
      expect(created.status).toBe(201);
      expect((await created.json()) as Record<string, unknown>).toHaveProperty('signing_secret');
      const listed = (await fetch(`${base}/v1/alert-webhooks`, {
        headers: { authorization: 'Bearer admin-a' },
      }).then((response) => response.json())) as { webhooks: Record<string, unknown>[] };
      expect(listed.webhooks).toHaveLength(1);
      expect(listed.webhooks[0]).not.toHaveProperty('signing_secret');
    } finally {
      await service.close();
    }
  });
});
