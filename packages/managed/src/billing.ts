import { createHash, createHmac } from 'node:crypto';
import Stripe from 'stripe';
import type { SharedBillingSubscriptionSnapshot } from '@schema-guard/shared-state';

export interface BillingCheckoutSession {
  session_id: string;
  url: string;
  expires_at: string;
}

export interface BillingWebhookEnvelope {
  event_id: string;
  event_created: number;
  event_type: string;
  payload_sha256: string;
  subscription_id?: string;
  checkout_session_id?: string;
  event_snapshot?: SharedBillingSubscriptionSnapshot;
}

export interface BillingProvider {
  readonly teamPriceId: string;
  createCheckoutSession(input: { tenantReference: string }): Promise<BillingCheckoutSession>;
  createPortalSession(customerId: string): Promise<{ url: string }>;
  parseWebhook(rawBody: Buffer, signature: string): BillingWebhookEnvelope;
  retrieveSubscription(
    subscriptionId: string,
    deletedEventFallback?: SharedBillingSubscriptionSnapshot,
  ): Promise<SharedBillingSubscriptionSnapshot>;
}

export interface StripeBillingProviderConfig {
  secretKey: string;
  webhookSecret: string;
  teamPriceId: string;
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
  webhookToleranceSeconds?: number;
}

const statuses = new Set<SharedBillingSubscriptionSnapshot['status']>([
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerId(value: unknown, prefix: string): string | undefined {
  const candidate = typeof value === 'string' ? value : record(value)?.id;
  return typeof candidate === 'string' && candidate.startsWith(prefix) ? candidate : undefined;
}

function epoch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function subscriptionSnapshot(value: unknown): SharedBillingSubscriptionSnapshot {
  const subscription = record(value);
  const subscriptionId = providerId(subscription?.id, 'sub_');
  const customerId = providerId(subscription?.customer, 'cus_');
  const status = subscription?.status;
  const items = record(subscription?.items)?.data;
  const firstItem = Array.isArray(items) ? record(items[0]) : undefined;
  const priceId = providerId(record(firstItem?.price)?.id, 'price_');
  const currentPeriodEnd =
    epoch(subscription?.current_period_end) ?? epoch(firstItem?.current_period_end);
  const providerCreatedAt = epoch(subscription?.created);
  if (
    !subscriptionId ||
    !customerId ||
    !priceId ||
    typeof status !== 'string' ||
    !statuses.has(status as SharedBillingSubscriptionSnapshot['status']) ||
    providerCreatedAt === undefined ||
    typeof subscription?.cancel_at_period_end !== 'boolean'
  )
    throw new TypeError('Stripe returned an invalid subscription');
  return {
    subscription_id: subscriptionId,
    customer_id: customerId,
    price_id: priceId,
    status: status as SharedBillingSubscriptionSnapshot['status'],
    current_period_end:
      currentPeriodEnd === undefined ? null : new Date(currentPeriodEnd * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
    provider_created_at: providerCreatedAt,
    retrieved_at: new Date().toISOString(),
  };
}

function invoiceSubscriptionId(value: Record<string, unknown> | undefined): string | undefined {
  return (
    providerId(value?.subscription, 'sub_') ??
    providerId(record(record(value?.parent)?.subscription_details)?.subscription, 'sub_')
  );
}

export function billingTenantReference(masterSecret: string, tenantId: string): string {
  return createHmac('sha256', masterSecret)
    .update('stripe-tenant-reference-v1')
    .update('\0')
    .update(tenantId)
    .digest('base64url');
}

export class StripeBillingProvider implements BillingProvider {
  private readonly stripe: Stripe;
  private readonly tolerance: number;
  readonly teamPriceId: string;

  constructor(private readonly config: StripeBillingProviderConfig) {
    if (
      !config.secretKey.startsWith('sk_test_') ||
      !config.webhookSecret.startsWith('whsec_') ||
      !/^price_[A-Za-z0-9_]+$/u.test(config.teamPriceId)
    )
      throw new TypeError('Stripe billing credentials or price identifier are invalid');
    for (const [label, value] of [
      ['success', config.successUrl],
      ['cancel', config.cancelUrl],
      ['portal return', config.portalReturnUrl],
    ] as const) {
      const url = new URL(value);
      if (url.protocol !== 'https:') throw new TypeError(`Stripe ${label} URL must use HTTPS`);
    }
    this.tolerance = config.webhookToleranceSeconds ?? 300;
    if (!Number.isInteger(this.tolerance) || this.tolerance < 60 || this.tolerance > 900)
      throw new TypeError('Stripe webhook tolerance must be between 60 and 900 seconds');
    this.stripe = new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 5_000 });
    this.teamPriceId = config.teamPriceId;
  }

  async createCheckoutSession(input: { tenantReference: string }): Promise<BillingCheckoutSession> {
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(input.tenantReference))
      throw new TypeError('billing tenant reference is invalid');
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ price: this.config.teamPriceId, quantity: 1 }],
        success_url: this.config.successUrl,
        cancel_url: this.config.cancelUrl,
        client_reference_id: input.tenantReference,
        allow_promotion_codes: true,
      },
      { idempotencyKey: `checkout-${input.tenantReference}` },
    );
    if (!session.url || !session.expires_at)
      throw new TypeError('Stripe did not return a complete checkout session');
    return {
      session_id: session.id,
      url: session.url,
      expires_at: new Date(session.expires_at * 1000).toISOString(),
    };
  }

  async createPortalSession(customerId: string): Promise<{ url: string }> {
    if (!/^cus_[A-Za-z0-9_]+$/u.test(customerId))
      throw new TypeError('Stripe customer identifier is invalid');
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: this.config.portalReturnUrl,
    });
    return { url: session.url };
  }

  parseWebhook(rawBody: Buffer, signature: string): BillingWebhookEnvelope {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.config.webhookSecret,
      this.tolerance,
    );
    const payload = record(event.data.object);
    const envelope: BillingWebhookEnvelope = {
      event_id: event.id,
      event_created: event.created,
      event_type: event.type,
      payload_sha256: `sha256:${createHash('sha256').update(rawBody).digest('hex')}`,
    };
    if (event.type === 'checkout.session.completed') {
      const subscriptionId = providerId(payload?.subscription, 'sub_');
      if (subscriptionId) envelope.subscription_id = subscriptionId;
      if (providerId(payload?.id, 'cs_')) envelope.checkout_session_id = String(payload!.id);
      return envelope;
    }
    if (event.type.startsWith('customer.subscription.')) {
      const snapshot = subscriptionSnapshot(payload);
      envelope.subscription_id = snapshot.subscription_id;
      envelope.event_snapshot = snapshot;
      return envelope;
    }
    if (event.type.startsWith('invoice.')) {
      const subscriptionId = invoiceSubscriptionId(payload);
      if (subscriptionId) envelope.subscription_id = subscriptionId;
    }
    return envelope;
  }

  async retrieveSubscription(
    subscriptionId: string,
    deletedEventFallback?: SharedBillingSubscriptionSnapshot,
  ): Promise<SharedBillingSubscriptionSnapshot> {
    try {
      return subscriptionSnapshot(await this.stripe.subscriptions.retrieve(subscriptionId));
    } catch (error) {
      const status = record(error)?.statusCode;
      if (
        status === 404 &&
        deletedEventFallback?.subscription_id === subscriptionId &&
        deletedEventFallback.status === 'canceled'
      )
        return { ...deletedEventFallback, retrieved_at: new Date().toISOString() };
      throw error;
    }
  }
}
