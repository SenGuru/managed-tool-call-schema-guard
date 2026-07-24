import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BillingState,
  SharedBillingEventInput,
  SharedBillingIngestResult,
  SharedBillingStatement,
  SharedBillingSubscriptionSnapshot,
} from '../packages/shared-state/src/index.js';
import {
  StripeBillingProvider,
  type BillingProvider,
  type BillingWebhookEnvelope,
} from '../packages/managed/src/billing.js';
import { createManagedServer } from '../packages/managed/src/server.js';

const secret = 'managed-billing-test-secret-that-is-at-least-32-characters';
const open: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const service of open.splice(0)) await service.close();
});

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-billing-')), 'managed.db');
}

class MemoryBillingState implements BillingState {
  readonly checkoutTenants = new Map<string, string>();
  readonly subscriptionTenants = new Map<string, string>();
  readonly customers = new Map<string, string>();
  readonly events = new Map<string, 'ready' | 'applied' | 'ignored'>();
  readonly statements = new Map<string, SharedBillingStatement>();
  failMark = false;

  migrate(): Promise<void> {
    return Promise.resolve();
  }
  ready(): Promise<boolean> {
    return Promise.resolve(true);
  }
  recordCheckoutSession(tenantId: string, sessionId: string, expiresAt: string): Promise<void> {
    void expiresAt;
    this.checkoutTenants.set(sessionId, tenantId);
    return Promise.resolve();
  }
  customerForTenant(tenantId: string): Promise<string | undefined> {
    return Promise.resolve(this.customers.get(tenantId));
  }
  ingestStripeEvent(input: SharedBillingEventInput): Promise<SharedBillingIngestResult> {
    if (['applied', 'ignored'].includes(this.events.get(input.event_id) ?? ''))
      return Promise.resolve({ event_status: 'duplicate' });
    const tenantId = input.checkout_session_id
      ? this.checkoutTenants.get(input.checkout_session_id)
      : input.subscription_id
        ? this.subscriptionTenants.get(input.subscription_id)
        : undefined;
    if (!tenantId || !input.snapshot) return Promise.resolve({ event_status: 'pending' });
    this.subscriptionTenants.set(input.snapshot.subscription_id, tenantId);
    this.customers.set(tenantId, input.snapshot.customer_id);
    const plan =
      ['active', 'trialing'].includes(input.snapshot.status) &&
      input.snapshot.price_id === input.team_price_id
        ? 'team'
        : 'trial';
    this.statements.set(tenantId, {
      provider: 'stripe',
      status: input.snapshot.status,
      plan,
      current_period_end: input.snapshot.current_period_end,
      cancel_at_period_end: input.snapshot.cancel_at_period_end,
    });
    this.events.set(input.event_id, 'ready');
    return Promise.resolve({
      event_status: 'ready',
      tenant_id: tenantId,
      desired_plan: plan,
      subscription_status: input.snapshot.status,
    });
  }
  markEventApplied(eventId: string): Promise<void> {
    if (this.failMark) return Promise.reject(new Error('billing state unavailable'));
    if (this.events.get(eventId) !== 'ready') return Promise.reject(new Error('event not ready'));
    this.events.set(eventId, 'applied');
    return Promise.resolve();
  }
  entitlementReady(): Promise<boolean> {
    return Promise.resolve(![...this.events.values()].includes('ready'));
  }
  statement(tenantId: string): Promise<SharedBillingStatement> {
    return Promise.resolve(
      this.statements.get(tenantId) ?? {
        provider: 'stripe',
        status: 'not_started',
        plan: 'trial',
        current_period_end: null,
        cancel_at_period_end: false,
      },
    );
  }
  verifyIntegrity(): Promise<{ valid: boolean; checked: number }> {
    return Promise.resolve({ valid: true, checked: this.events.size });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeBillingProvider implements BillingProvider {
  readonly teamPriceId = 'price_test_team';
  envelope: BillingWebhookEnvelope = {
    event_id: 'evt_checkout',
    event_created: 1_700_000_000,
    event_type: 'checkout.session.completed',
    payload_sha256: `sha256:${'a'.repeat(64)}`,
    subscription_id: 'sub_test_one',
    checkout_session_id: 'cs_test_one',
  };
  snapshot: SharedBillingSubscriptionSnapshot = {
    subscription_id: 'sub_test_one',
    customer_id: 'cus_test_one',
    price_id: this.teamPriceId,
    status: 'active',
    current_period_end: '2030-01-01T00:00:00.000Z',
    cancel_at_period_end: false,
    provider_created_at: 1_700_000_000,
    retrieved_at: '2026-07-24T00:00:00.000Z',
  };
  failRetrieval = false;

  createCheckoutSession(): Promise<{
    session_id: string;
    url: string;
    expires_at: string;
  }> {
    return Promise.resolve({
      session_id: 'cs_test_one',
      url: 'https://checkout.stripe.com/c/pay/test',
      expires_at: '2030-01-01T00:00:00.000Z',
    });
  }
  createPortalSession(customerId: string): Promise<{ url: string }> {
    return Promise.resolve({ url: `https://billing.stripe.com/p/session/${customerId}` });
  }
  parseWebhook(_rawBody: Buffer, signature: string): BillingWebhookEnvelope {
    if (signature !== 'valid') throw new Error('invalid signature');
    return this.envelope;
  }
  retrieveSubscription(): Promise<SharedBillingSubscriptionSnapshot> {
    if (this.failRetrieval) return Promise.reject(new Error('provider unavailable'));
    return Promise.resolve(this.snapshot);
  }
}

async function runningBillingService() {
  const state = new MemoryBillingState();
  const provider = new FakeBillingProvider();
  const service = createManagedServer(
    { databasePath: await database(), masterSecret: secret },
    { billingState: state, billingProvider: provider },
  );
  open.push(service);
  service.store.bootstrapTenant({
    id: 'billing',
    name: 'Billing',
    plan: 'trial',
    apiKey: 'billing-admin-key',
  });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return {
    service,
    state,
    provider,
    base: `http://127.0.0.1:${address.port}`,
    auth: { authorization: 'Bearer billing-admin-key' },
  };
}

describe('managed Stripe billing authority', () => {
  it('keeps checkout disabled when no billing authority is configured', async () => {
    const service = createManagedServer({
      databasePath: await database(),
      masterSecret: secret,
    });
    open.push(service);
    service.store.bootstrapTenant({
      id: 'disabled',
      name: 'Disabled',
      plan: 'trial',
      apiKey: 'disabled-key',
    });
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/billing/checkout-session`, {
      method: 'POST',
      headers: { authorization: 'Bearer disabled-key' },
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: 'billing_integration_required' });
  });

  it('binds checkout, reconciles a signed webhook, updates entitlement, and opens the portal', async () => {
    const { base, auth, service, state, provider } = await runningBillingService();
    const checkout = await fetch(`${base}/v1/billing/checkout-session`, {
      method: 'POST',
      headers: auth,
    });
    expect(checkout.status).toBe(201);
    expect(await checkout.json()).toMatchObject({ session_id: 'cs_test_one' });
    expect(state.checkoutTenants.get('cs_test_one')).toBe('billing');

    const webhook = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'valid', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toMatchObject({ received: true, event_status: 'ready' });
    expect(service.store.authenticate('billing-admin-key')).toMatchObject({
      plan: 'team',
      monthlyLimit: 250_000,
    });

    const duplicate = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ event_status: 'duplicate' });

    provider.envelope = {
      event_id: 'evt_past_due',
      event_created: 1_699_999_999,
      event_type: 'customer.subscription.updated',
      payload_sha256: `sha256:${'b'.repeat(64)}`,
      subscription_id: 'sub_test_one',
    };
    provider.snapshot = {
      ...provider.snapshot,
      status: 'past_due',
      retrieved_at: '2026-07-24T00:01:00.000Z',
    };
    const pastDue = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    });
    expect(pastDue.status).toBe(200);
    expect(service.store.authenticate('billing-admin-key')?.plan).toBe('trial');

    provider.envelope = {
      event_id: 'evt_recovered',
      event_created: 1_699_999_998,
      event_type: 'customer.subscription.updated',
      payload_sha256: `sha256:${'c'.repeat(64)}`,
      subscription_id: 'sub_test_one',
    };
    provider.snapshot = {
      ...provider.snapshot,
      status: 'active',
      retrieved_at: '2026-07-24T00:02:00.000Z',
    };
    const recovered = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    });
    expect(recovered.status).toBe(200);
    expect(service.store.authenticate('billing-admin-key')?.plan).toBe('team');

    const statement = await fetch(`${base}/v1/billing/statement`, { headers: auth });
    expect(statement.status).toBe(200);
    expect(await statement.json()).toMatchObject({
      plan: 'team',
      payment_processing: 'stripe',
      subscription: { status: 'active', plan: 'team' },
    });
    const portal = await fetch(`${base}/v1/billing/portal-session`, {
      method: 'POST',
      headers: auth,
    });
    expect(portal.status).toBe(201);
    expect(await portal.json()).toMatchObject({
      url: 'https://billing.stripe.com/p/session/cus_test_one',
    });
  });

  it('rejects forged webhooks and fails closed when provider reconciliation is unavailable', async () => {
    const { base, auth, provider, service } = await runningBillingService();
    await fetch(`${base}/v1/billing/checkout-session`, { method: 'POST', headers: auth });
    const forged = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'forged' },
      body: '{}',
    });
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ error: 'invalid_billing_signature' });

    provider.failRetrieval = true;
    const unavailable = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: 'billing_provider_unavailable',
    });
    expect(service.store.authenticate('billing-admin-key')?.plan).toBe('trial');
  });

  it('blocks tenant traffic across the crash window until a retained entitlement event is applied', async () => {
    const { base, auth, state } = await runningBillingService();
    await fetch(`${base}/v1/billing/checkout-session`, { method: 'POST', headers: auth });
    state.failMark = true;
    const interrupted = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    });
    expect(interrupted.status).toBe(503);
    expect(await interrupted.json()).toMatchObject({ error: 'billing_state_unavailable' });
    const blocked = await fetch(`${base}/v1/usage`, { headers: auth });
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: 'billing_reconciliation_pending' });

    state.failMark = false;
    const retried = await fetch(`${base}/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ event_status: 'ready' });
    expect((await fetch(`${base}/v1/usage`, { headers: auth })).status).toBe(200);
  });

  it('verifies Stripe raw-body signatures and normalizes subscription events', () => {
    const webhookSecret = 'whsec_test_billing_signature';
    const provider = new StripeBillingProvider({
      secretKey: 'sk_test_billing_signature',
      webhookSecret,
      teamPriceId: 'price_test_team',
      successUrl: 'https://akriven.com/account/billing/success',
      cancelUrl: 'https://akriven.com/account/billing',
      portalReturnUrl: 'https://akriven.com/account/billing',
    });
    const payload = JSON.stringify({
      id: 'evt_test_subscription',
      object: 'event',
      created: 1_700_000_000,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test_one',
          object: 'subscription',
          customer: 'cus_test_one',
          status: 'active',
          created: 1_699_000_000,
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: 'price_test_team' },
                current_period_end: 1_800_000_000,
              },
            ],
          },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1000),
    });
    const envelope = provider.parseWebhook(Buffer.from(payload), signature);
    expect(envelope).toMatchObject({
      event_id: 'evt_test_subscription',
      event_type: 'customer.subscription.updated',
      subscription_id: 'sub_test_one',
      event_snapshot: {
        customer_id: 'cus_test_one',
        price_id: 'price_test_team',
        status: 'active',
      },
    });
    const invoicePayload = JSON.stringify({
      id: 'evt_test_invoice_failed',
      object: 'event',
      created: 1_700_000_001,
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_test_failed',
          object: 'invoice',
          parent: {
            subscription_details: {
              subscription: 'sub_test_one',
            },
          },
        },
      },
    });
    const invoiceSignature = Stripe.webhooks.generateTestHeaderString({
      payload: invoicePayload,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1000),
    });
    expect(provider.parseWebhook(Buffer.from(invoicePayload), invoiceSignature)).toMatchObject({
      event_id: 'evt_test_invoice_failed',
      event_type: 'invoice.payment_failed',
      subscription_id: 'sub_test_one',
    });
    expect(() => provider.parseWebhook(Buffer.from(`${payload} `), signature)).toThrow();
    const staleSignature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1000) - 901,
    });
    expect(() => provider.parseWebhook(Buffer.from(payload), staleSignature)).toThrow();
  });
});
