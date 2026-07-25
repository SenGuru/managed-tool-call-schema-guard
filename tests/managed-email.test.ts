import { describe, expect, it } from 'vitest';
import { TemplatedMessage } from 'postmark';

import { parsePostmarkWebhook, PostmarkEmailProvider } from '../packages/managed/src/email.js';

const webhookCredential = {
  username: 'postmark-webhook-user',
  password: 'postmark-webhook-password-that-is-at-least-thirty-two-characters',
};
const authorization = `Basic ${Buffer.from(
  `${webhookCredential.username}:${webhookCredential.password}`,
).toString('base64')}`;

describe('Postmark transactional email boundary', () => {
  it('sends allowlisted template mail without returning or metadata-storing raw recipient values', async () => {
    let sent: TemplatedMessage | undefined;
    const provider = new PostmarkEmailProvider({
      serverToken: 'server-token-for-contract-tests',
      from: 'security@akriven.example',
      messageStream: 'transactional',
      client: {
        sendEmailWithTemplate(message) {
          sent = message;
          return Promise.resolve({
            ErrorCode: 0,
            Message: 'OK',
            MessageID: 'message-contract-12345678',
            SubmittedAt: '2026-07-25T12:00:00.000Z',
          });
        },
      },
    });
    const receipt = await provider.send({
      kind: 'security_alert',
      to: 'owner@example.test',
      templateAlias: 'security-alert',
      templateModel: { event: 'new-session', action_url: 'https://akriven.example/security' },
      idempotencyKey: 'security-event-1',
    });
    expect(receipt).toMatchObject({
      provider: 'postmark',
      messageId: 'message-contract-12345678',
      submittedAt: '2026-07-25T12:00:00.000Z',
    });
    expect(receipt.recipientHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.idempotencyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(receipt)).not.toContain('owner@example.test');
    expect(sent?.To).toBe('owner@example.test');
    expect(sent?.MessageStream).toBe('transactional');
    expect(sent?.Tag).toBe('security_alert');
    expect(sent?.Metadata).not.toHaveProperty('recipient');
    expect(sent?.Metadata?.idempotency_sha256).not.toContain('security-event-1');
  });

  it('fails closed for invalid recipient, kind, template, oversized model, and provider rejection', async () => {
    const provider = new PostmarkEmailProvider({
      serverToken: 'server-token-for-contract-tests',
      from: 'security@akriven.example',
      client: {
        sendEmailWithTemplate() {
          return Promise.resolve({
            ErrorCode: 10,
            Message: 'rejected',
            MessageID: '',
            SubmittedAt: '',
          });
        },
      },
    });
    await expect(
      provider.send({
        kind: 'security_alert',
        to: 'two@example.test,other@example.test',
        templateAlias: 'security-alert',
        templateModel: {},
        idempotencyKey: 'one',
      }),
    ).rejects.toThrow(/one email/u);
    await expect(
      provider.send({
        kind: 'marketing' as never,
        to: 'owner@example.test',
        templateAlias: 'security-alert',
        templateModel: {},
        idempotencyKey: 'one',
      }),
    ).rejects.toThrow(/kind/u);
    await expect(
      provider.send({
        kind: 'security_alert',
        to: 'owner@example.test',
        templateAlias: '../template',
        templateModel: {},
        idempotencyKey: 'one',
      }),
    ).rejects.toThrow(/alias/u);
    await expect(
      provider.send({
        kind: 'security_alert',
        to: 'owner@example.test',
        templateAlias: 'security-alert',
        templateModel: { oversized: 'x'.repeat(65 * 1024) },
        idempotencyKey: 'one',
      }),
    ).rejects.toThrow(/64 KiB/u);
    await expect(
      provider.send({
        kind: 'security_alert',
        to: 'owner@example.test',
        templateAlias: 'security-alert',
        templateModel: {},
        idempotencyKey: 'one',
      }),
    ).rejects.toThrow(/did not acknowledge/u);
  });

  it('authenticates and normalizes delivery webhooks without retaining provider detail or recipient', () => {
    const event = parsePostmarkWebhook(
      Buffer.from(
        JSON.stringify({
          RecordType: 'Delivery',
          MessageID: 'message-delivery-12345678',
          Recipient: 'Owner@Example.Test',
          DeliveredAt: '2026-07-25T12:00:00Z',
          Details: 'raw SMTP delivery detail must not be retained',
          Metadata: { arbitrary: 'untrusted' },
        }),
      ),
      authorization,
      webhookCredential,
    );
    expect(event).toMatchObject({
      provider: 'postmark',
      eventType: 'delivered',
      messageId: 'message-delivery-12345678',
      occurredAt: '2026-07-25T12:00:00.000Z',
      bounceType: null,
      inactive: false,
    });
    expect(event.eventId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(event.recipientHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(event)).not.toContain('Owner@Example.Test');
    expect(JSON.stringify(event)).not.toContain('SMTP');
  });

  it('normalizes bounce disposition and rejects auth, replay-shaping, malformed, and oversized input', () => {
    const body = Buffer.from(
      JSON.stringify({
        RecordType: 'Bounce',
        MessageID: 'message-bounce-12345678',
        Email: 'owner@example.test',
        BouncedAt: '2026-07-25T12:00:00Z',
        Type: 'HardBounce',
        Inactive: true,
        Content: 'raw message content must not be retained',
      }),
    );
    const first = parsePostmarkWebhook(body, authorization, webhookCredential);
    const duplicate = parsePostmarkWebhook(body, authorization, webhookCredential);
    expect(first.eventType).toBe('bounced');
    expect(first.bounceType).toBe('HardBounce');
    expect(first.inactive).toBe(true);
    expect(duplicate.eventId).toBe(first.eventId);
    expect(() => parsePostmarkWebhook(body, 'Basic invalid', webhookCredential)).toThrow(
      /authentication/u,
    );
    expect(() => parsePostmarkWebhook(Buffer.from('{'), authorization, webhookCredential)).toThrow(
      /body/u,
    );
    expect(() =>
      parsePostmarkWebhook(Buffer.alloc(64 * 1024 + 1), authorization, webhookCredential),
    ).toThrow(/body/u);
  });
});
