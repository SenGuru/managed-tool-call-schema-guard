import { createHash, timingSafeEqual } from 'node:crypto';
import { assertJsonSafety } from '@schema-guard/core';
import { ServerClient, TemplatedMessage } from 'postmark';

export const TRANSACTIONAL_EMAIL_KINDS = [
  'account_invitation',
  'account_recovery',
  'security_alert',
  'billing_notice',
  'support_update',
] as const;
export type TransactionalEmailKind = (typeof TRANSACTIONAL_EMAIL_KINDS)[number];

export interface TransactionalEmailRequest {
  kind: TransactionalEmailKind;
  to: string;
  templateAlias: string;
  templateModel: Record<string, unknown>;
  idempotencyKey: string;
}

export interface TransactionalEmailReceipt {
  provider: 'postmark';
  messageId: string;
  submittedAt: string;
  recipientHash: string;
  idempotencyHash: string;
}

export interface TransactionalEmailProvider {
  send(request: TransactionalEmailRequest): Promise<TransactionalEmailReceipt>;
}

interface PostmarkClient {
  sendEmailWithTemplate(message: TemplatedMessage): Promise<{
    ErrorCode: number;
    Message: string;
    MessageID: string;
    SubmittedAt: string;
  }>;
}

export interface PostmarkEmailProviderConfig {
  serverToken: string;
  from: string;
  messageStream?: string;
  client?: PostmarkClient;
}

export interface PostmarkWebhookCredential {
  username: string;
  password: string;
}

export interface TransactionalEmailEvent {
  provider: 'postmark';
  eventId: string;
  eventType: 'delivered' | 'bounced';
  messageId: string;
  recipientHash: string;
  occurredAt: string;
  bounceType: string | null;
  inactive: boolean;
}

const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/u;

function bounded(value: string, label: string, maximum: number): void {
  if (value.length === 0 || value.length > maximum || value.includes('\0'))
    throw new TypeError(`${label} is invalid`);
}

function exactEmail(value: string, label: string): void {
  if (value.length > 254 || !emailPattern.test(value))
    throw new TypeError(`${label} must be one email address`);
}

function safeEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export class PostmarkEmailProvider implements TransactionalEmailProvider {
  private readonly client: PostmarkClient;

  constructor(private readonly config: PostmarkEmailProviderConfig) {
    if (!/^[A-Za-z0-9-]{20,128}$/u.test(config.serverToken))
      throw new TypeError('Postmark server token is invalid');
    exactEmail(config.from, 'Postmark sender');
    if (
      config.messageStream !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(config.messageStream)
    )
      throw new TypeError('Postmark message stream is invalid');
    this.client =
      config.client ??
      (new ServerClient(config.serverToken, {
        timeout: 5_000,
      }) as PostmarkClient);
  }

  async send(request: TransactionalEmailRequest): Promise<TransactionalEmailReceipt> {
    if (!TRANSACTIONAL_EMAIL_KINDS.includes(request.kind))
      throw new TypeError('transactional email kind is invalid');
    exactEmail(request.to, 'transactional email recipient');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(request.templateAlias))
      throw new TypeError('Postmark template alias is invalid');
    bounded(request.idempotencyKey, 'transactional email idempotency key', 256);
    assertJsonSafety(request.templateModel, 'transactional email template model');
    const modelBytes = Buffer.byteLength(JSON.stringify(request.templateModel));
    if (modelBytes > 64 * 1024)
      throw new TypeError('transactional email template model exceeds 64 KiB');
    const idempotencyHash = sha256(request.idempotencyKey);
    const message = new TemplatedMessage(
      this.config.from,
      request.templateAlias,
      request.templateModel,
      request.to,
      undefined,
      undefined,
      undefined,
      request.kind,
      false,
    );
    message.MessageStream = this.config.messageStream ?? 'outbound';
    message.Metadata = {
      notification_kind: request.kind,
      idempotency_sha256: idempotencyHash,
    };
    const result = await this.client.sendEmailWithTemplate(message);
    if (
      result.ErrorCode !== 0 ||
      !/^[A-Za-z0-9-]{8,128}$/u.test(result.MessageID) ||
      !Number.isFinite(Date.parse(result.SubmittedAt))
    )
      throw new Error('Postmark did not acknowledge the transactional email');
    return {
      provider: 'postmark',
      messageId: result.MessageID,
      submittedAt: new Date(result.SubmittedAt).toISOString(),
      recipientHash: sha256(request.to.toLowerCase()),
      idempotencyHash,
    };
  }
}

export function parsePostmarkWebhook(
  rawBody: Buffer,
  authorization: string | undefined,
  credential: PostmarkWebhookCredential,
): TransactionalEmailEvent {
  if (
    credential.username.length < 16 ||
    credential.username.length > 128 ||
    credential.password.length < 32 ||
    credential.password.length > 256
  )
    throw new TypeError('Postmark webhook credential is invalid');
  if (!authorization?.startsWith('Basic ') || authorization.length > 1024)
    throw new TypeError('Postmark webhook authentication is required');
  let supplied: string;
  try {
    supplied = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    throw new TypeError('Postmark webhook authentication is invalid');
  }
  const separator = supplied.indexOf(':');
  if (
    separator < 1 ||
    !safeEqual(supplied.slice(0, separator), credential.username) ||
    !safeEqual(supplied.slice(separator + 1), credential.password)
  )
    throw new TypeError('Postmark webhook authentication is invalid');
  if (rawBody.byteLength === 0 || rawBody.byteLength > 64 * 1024)
    throw new TypeError('Postmark webhook body is invalid');
  let value: unknown;
  try {
    value = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new TypeError('Postmark webhook body is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Postmark webhook body is invalid');
  const body = value as Record<string, unknown>;
  const recordType = body.RecordType;
  const messageId = body.MessageID;
  const recipient = recordType === 'Delivery' ? body.Recipient : body.Email;
  const occurredAt = recordType === 'Delivery' ? body.DeliveredAt : body.BouncedAt;
  if (
    !['Delivery', 'Bounce'].includes(String(recordType)) ||
    typeof messageId !== 'string' ||
    !/^[A-Za-z0-9-]{8,128}$/u.test(messageId) ||
    typeof recipient !== 'string' ||
    !emailPattern.test(recipient) ||
    typeof occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(occurredAt))
  )
    throw new TypeError('Postmark webhook envelope is invalid');
  const eventType = recordType === 'Delivery' ? 'delivered' : 'bounced';
  const bounceType =
    eventType === 'bounced' && typeof body.Type === 'string' ? body.Type.slice(0, 128) : null;
  const inactive = eventType === 'bounced' && body.Inactive === true;
  const normalizedTime = new Date(occurredAt).toISOString();
  return {
    provider: 'postmark',
    eventId: sha256(`${eventType}\0${messageId}\0${normalizedTime}`),
    eventType,
    messageId,
    recipientHash: sha256(recipient.toLowerCase()),
    occurredAt: normalizedTime,
    bounceType,
    inactive,
  };
}
