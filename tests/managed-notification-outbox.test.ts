import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  TransactionalEmailProvider,
  TransactionalEmailRequest,
  TransactionalEmailReceipt,
} from '../packages/managed/src/email.js';
import { createManagedServer } from '../packages/managed/src/server.js';

const secret = 'managed-notification-test-secret-that-is-at-least-32-characters';
const open: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const service of open.splice(0)) await service.close();
});

class FakeEmailProvider implements TransactionalEmailProvider {
  fail = false;
  readonly sent: TransactionalEmailRequest[] = [];

  send(request: TransactionalEmailRequest): Promise<TransactionalEmailReceipt> {
    this.sent.push(request);
    if (this.fail) return Promise.reject(new Error('provider unavailable'));
    return Promise.resolve({
      provider: 'postmark',
      messageId: `message-outbox-${this.sent.length}-12345678`,
      submittedAt: '2026-07-25T18:00:00.000Z',
      recipientHash: `sha256:${'a'.repeat(64)}`,
      idempotencyHash: `sha256:${'b'.repeat(64)}`,
    });
  }
}

async function runningNotificationService(provider = new FakeEmailProvider()) {
  const directory = await mkdtemp(join(tmpdir(), 'schema-guard-notification-'));
  const databasePath = join(directory, 'managed.db');
  const service = createManagedServer(
    {
      databasePath,
      masterSecret: secret,
      notificationPollIntervalMs: 60_000,
      notificationMaxAttempts: 1,
      postmarkServerToken: 'server-token-for-notification-tests',
      postmarkFrom: 'security@akriven.example',
      postmarkWebhookUsername: 'notification-webhook-user',
      postmarkWebhookPassword:
        'notification-webhook-password-that-is-at-least-thirty-two-characters',
    },
    { emailProvider: provider },
  );
  open.push(service);
  service.store.bootstrapTenant({
    id: 'notifications',
    name: 'Notifications',
    plan: 'trial',
    apiKey: 'notification-admin-key',
  });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    auth: { authorization: 'Bearer notification-admin-key' },
    databasePath,
    provider,
  };
}

const notification = {
  kind: 'security_alert',
  to: 'owner@example.test',
  template_alias: 'security-alert',
  template_model: {
    event: 'new-session',
    action_url: 'https://akriven.example/security/session',
  },
  idempotency_key: 'security-event-1',
};

describe('durable transactional notification outbox', () => {
  it('encrypts queued content, dispatches once, and returns privacy-safe operator state', async () => {
    const { base, auth, databasePath, provider } = await runningNotificationService();
    const queued = await fetch(`${base}/v1/admin/notifications`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(notification),
    });
    expect(queued.status).toBe(202);
    const queuedBody = (await queued.json()) as { notification_id: string; created: boolean };
    expect(queuedBody.notification_id).toMatch(/^notification_/u);
    expect(queuedBody.created).toBe(true);
    expect(provider.sent).toEqual([
      {
        kind: 'security_alert',
        to: 'owner@example.test',
        templateAlias: 'security-alert',
        templateModel: notification.template_model,
        idempotencyKey: 'security-event-1',
      },
    ]);

    const listed = await fetch(`${base}/v1/admin/notifications`, { headers: auth });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      notifications: Array<Record<string, unknown>>;
    };
    expect(listBody.notifications).toHaveLength(1);
    expect(listBody.notifications[0]).toMatchObject({
      notification_id: queuedBody.notification_id,
      kind: 'security_alert',
      status: 'delivered',
      attempt_count: 1,
      provider_message_id: 'message-outbox-1-12345678',
    });
    expect(JSON.stringify(listBody)).not.toContain('owner@example.test');
    expect(JSON.stringify(listBody)).not.toContain('action_url');

    const database = new Database(databasePath, { readonly: true });
    try {
      const persisted = database
        .prepare(
          'SELECT payload_ciphertext,recipient_hash,idempotency_hash,request_hash FROM notification_outbox',
        )
        .get() as Record<string, string>;
      expect(persisted.payload_ciphertext).not.toContain('owner@example.test');
      expect(persisted.payload_ciphertext).not.toContain('action_url');
      expect(persisted.recipient_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(persisted.idempotency_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(persisted.request_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    } finally {
      database.close();
    }
  });

  it('deduplicates identical requests and rejects idempotency conflicts', async () => {
    const { base, auth, provider } = await runningNotificationService();
    const send = (body: unknown) =>
      fetch(`${base}/v1/admin/notifications`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await send(notification)).status).toBe(202);
    const duplicate = await send(notification);
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as { created: boolean }).created).toBe(false);
    expect(provider.sent).toHaveLength(1);
    const conflict = await send({
      ...notification,
      template_model: { event: 'different-event' },
    });
    expect(conflict.status).toBe(409);
    expect(provider.sent).toHaveLength(1);
  });

  it('dead-letters provider failures and supports explicit redrive after recovery', async () => {
    const provider = new FakeEmailProvider();
    provider.fail = true;
    const { base, auth } = await runningNotificationService(provider);
    const queued = await fetch(`${base}/v1/admin/notifications`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(notification),
    });
    const notificationId = ((await queued.json()) as { notification_id: string }).notification_id;
    let state = (await (
      await fetch(`${base}/v1/admin/notifications`, { headers: auth })
    ).json()) as { notifications: Array<{ status: string; error_code: string }> };
    expect(state.notifications[0]).toMatchObject({
      status: 'dead',
      error_code: 'provider_unavailable',
    });

    provider.fail = false;
    const redrive = await fetch(
      `${base}/v1/admin/notifications/${encodeURIComponent(notificationId)}/redrive`,
      { method: 'POST', headers: auth },
    );
    expect(redrive.status).toBe(200);
    state = (await (await fetch(`${base}/v1/admin/notifications`, { headers: auth })).json()) as {
      notifications: Array<{ status: string; error_code: string | null }>;
    };
    expect(state.notifications[0]).toMatchObject({ status: 'delivered', error_code: null });
  });

  it('authenticates, binds, and deduplicates Postmark delivery events', async () => {
    const { base, auth } = await runningNotificationService();
    await fetch(`${base}/v1/admin/notifications`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(notification),
    });
    const webhookAuth = `Basic ${Buffer.from(
      'notification-webhook-user:notification-webhook-password-that-is-at-least-thirty-two-characters',
    ).toString('base64')}`;
    const body = JSON.stringify({
      RecordType: 'Delivery',
      MessageID: 'message-outbox-1-12345678',
      Recipient: 'owner@example.test',
      DeliveredAt: '2026-07-25T18:01:00.000Z',
      Details: 'raw delivery detail',
      Metadata: {},
    });
    const first = await fetch(`${base}/v1/notifications/postmark/webhook`, {
      method: 'POST',
      headers: { authorization: webhookAuth, 'content-type': 'application/json' },
      body,
    });
    expect(first.status).toBe(200);
    const duplicate = await fetch(`${base}/v1/notifications/postmark/webhook`, {
      method: 'POST',
      headers: { authorization: webhookAuth, 'content-type': 'application/json' },
      body,
    });
    expect(duplicate.status).toBe(200);
    const unauthorized = await fetch(`${base}/v1/notifications/postmark/webhook`, {
      method: 'POST',
      headers: { authorization: 'Basic invalid', 'content-type': 'application/json' },
      body,
    });
    expect(unauthorized.status).toBe(401);
  });
});
