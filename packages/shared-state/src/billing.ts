import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, sha256 } from '@schema-guard/core';
import { Pool, type PoolClient } from 'pg';
import { SharedStateIntegrityError } from './postgres.js';

export const BILLING_MIGRATION_VERSION = 1;
export const BILLING_MIGRATION_NAME = 'stripe_billing_authority';
export const BILLING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sg_billing_schema_migrations (
    version INTEGER PRIMARY KEY,
    migration_name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_billing_checkout_sessions (
    session_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    control_hmac TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sg_billing_checkout_tenant
    ON sg_billing_checkout_sessions(tenant_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS sg_billing_subscriptions (
    subscription_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL UNIQUE REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL UNIQUE,
    price_id TEXT NOT NULL,
    entitled_plan TEXT NOT NULL CHECK(entitled_plan IN ('trial','team')),
    status TEXT NOT NULL
      CHECK(status IN ('trialing','active','past_due','unpaid','canceled','incomplete',
                       'incomplete_expired','paused')),
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL,
    provider_created_at BIGINT NOT NULL CHECK(provider_created_at >= 0),
    retrieved_at TIMESTAMPTZ NOT NULL,
    control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_billing_events (
    event_id TEXT PRIMARY KEY,
    tenant_id TEXT REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    event_created BIGINT NOT NULL CHECK(event_created >= 0),
    event_type TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    subscription_id TEXT,
    checkout_session_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','ready','applied','ignored')),
    reason_code TEXT,
    received_at TIMESTAMPTZ NOT NULL,
    applied_at TIMESTAMPTZ,
    control_hmac TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sg_billing_events_subscription
    ON sg_billing_events(subscription_id,status,received_at);
`;

export type SharedBillingSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface SharedBillingSubscriptionSnapshot {
  subscription_id: string;
  customer_id: string;
  price_id: string;
  status: SharedBillingSubscriptionStatus;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_created_at: number;
  retrieved_at: string;
}

export interface SharedBillingEventInput {
  event_id: string;
  event_created: number;
  event_type: string;
  payload_sha256: string;
  subscription_id?: string;
  checkout_session_id?: string;
  snapshot?: SharedBillingSubscriptionSnapshot;
  team_price_id: string;
}

export interface SharedBillingIngestResult {
  event_status: 'duplicate' | 'pending' | 'ready' | 'ignored';
  tenant_id?: string;
  desired_plan?: 'trial' | 'team';
  subscription_status?: SharedBillingSubscriptionStatus;
}

export interface SharedBillingStatement {
  provider: 'stripe';
  status: SharedBillingSubscriptionStatus | 'not_started';
  plan: 'trial' | 'team';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface BillingState {
  migrate(): Promise<void>;
  ready(): Promise<boolean>;
  recordCheckoutSession(tenantId: string, sessionId: string, expiresAt: string): Promise<void>;
  customerForTenant(tenantId: string): Promise<string | undefined>;
  ingestStripeEvent(input: SharedBillingEventInput): Promise<SharedBillingIngestResult>;
  markEventApplied(eventId: string): Promise<void>;
  entitlementReady(tenantId: string): Promise<boolean>;
  statement(tenantId: string): Promise<SharedBillingStatement>;
  verifyIntegrity(tenantId?: string): Promise<{ valid: boolean; checked: number }>;
  close(): Promise<void>;
}

type CheckoutRow = {
  session_id: string;
  tenant_id: string;
  expires_at: Date;
  created_at: Date;
  control_hmac: string;
};
type SubscriptionRow = {
  subscription_id: string;
  tenant_id: string;
  customer_id: string;
  price_id: string;
  entitled_plan: 'trial' | 'team';
  status: SharedBillingSubscriptionStatus;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  provider_created_at: string;
  retrieved_at: Date;
  control_hmac: string;
};
type EventRow = {
  event_id: string;
  tenant_id: string | null;
  event_created: string;
  event_type: string;
  payload_sha256: string;
  subscription_id: string | null;
  checkout_session_id: string | null;
  status: 'pending' | 'ready' | 'applied' | 'ignored';
  reason_code: string | null;
  received_at: Date;
  applied_at: Date | null;
  control_hmac: string;
};

const equal = (left: string, right: string): boolean => {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
};
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export class PostgresBillingState implements BillingState {
  readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(
    databaseUrl: string,
    private readonly masterSecret: string,
    pool?: Pool,
  ) {
    if (!databaseUrl || masterSecret.length < 32)
      throw new TypeError('billing state configuration is invalid');
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
    this.ownsPool = pool === undefined;
    this.pool.on('error', () => undefined);
  }

  private hmac(purpose: string, value: unknown): string {
    return `hmac-sha256:${createHmac('sha256', this.masterSecret)
      .update(purpose)
      .update('\0')
      .update(canonicalJson(value))
      .digest('hex')}`;
  }

  private checkoutUnsigned(row: CheckoutRow): Record<string, unknown> {
    return {
      session_id: row.session_id,
      tenant_id: row.tenant_id,
      expires_at: row.expires_at.toISOString(),
      created_at: row.created_at.toISOString(),
    };
  }

  private subscriptionUnsigned(row: SubscriptionRow): Record<string, unknown> {
    return {
      subscription_id: row.subscription_id,
      tenant_id: row.tenant_id,
      customer_id: row.customer_id,
      price_id: row.price_id,
      entitled_plan: row.entitled_plan,
      status: row.status,
      current_period_end: iso(row.current_period_end),
      cancel_at_period_end: row.cancel_at_period_end,
      provider_created_at: Number(row.provider_created_at),
      retrieved_at: row.retrieved_at.toISOString(),
    };
  }

  private eventUnsigned(row: EventRow): Record<string, unknown> {
    return {
      event_id: row.event_id,
      tenant_id: row.tenant_id,
      event_created: Number(row.event_created),
      event_type: row.event_type,
      payload_sha256: row.payload_sha256,
      subscription_id: row.subscription_id,
      checkout_session_id: row.checkout_session_id,
      status: row.status,
      reason_code: row.reason_code,
      received_at: row.received_at.toISOString(),
      applied_at: iso(row.applied_at),
    };
  }

  private assertRow(
    row: CheckoutRow | SubscriptionRow | EventRow,
    purpose: string,
    unsigned: Record<string, unknown>,
  ): void {
    if (!equal(row.control_hmac, this.hmac(purpose, unsigned)))
      throw new SharedStateIntegrityError(`shared billing ${purpose} integrity failed`);
  }

  private async transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    const row = (
      await this.pool.query<{ checksum: string }>(
        'SELECT checksum FROM sg_billing_schema_migrations WHERE version=$1',
        [BILLING_MIGRATION_VERSION],
      )
    ).rows[0];
    if (!row || row.checksum !== sha256(BILLING_SCHEMA))
      throw new SharedStateIntegrityError('shared billing migration is missing or incompatible');
  }

  async ready(): Promise<boolean> {
    try {
      await this.migrate();
      const unresolved = await this.pool.query<{ count: string }>(
        "SELECT COUNT(*) count FROM sg_billing_events WHERE status='ready'",
      );
      return Number(unresolved.rows[0]?.count ?? 0) === 0;
    } catch {
      return false;
    }
  }

  async recordCheckoutSession(
    tenantId: string,
    sessionId: string,
    expiresAt: string,
  ): Promise<void> {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/u.test(tenantId) ||
      !/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/u.test(sessionId)
    )
      throw new TypeError('billing checkout binding is invalid');
    const expiration = new Date(expiresAt);
    if (!Number.isFinite(expiration.getTime()) || expiration <= new Date())
      throw new TypeError('billing checkout expiration is invalid');
    await this.transaction(async (client) => {
      const timestamp = new Date();
      const existing = (
        await client.query<CheckoutRow>(
          'SELECT * FROM sg_billing_checkout_sessions WHERE session_id=$1 FOR UPDATE',
          [sessionId],
        )
      ).rows[0];
      if (existing) {
        this.assertRow(existing, 'checkout-session-v1', this.checkoutUnsigned(existing));
        if (
          existing.tenant_id !== tenantId ||
          existing.expires_at.toISOString() !== expiration.toISOString()
        )
          throw new SharedStateIntegrityError(
            'billing checkout session was replayed with conflicts',
          );
        return;
      }
      const unsigned = {
        session_id: sessionId,
        tenant_id: tenantId,
        expires_at: expiration.toISOString(),
        created_at: timestamp.toISOString(),
      };
      await client.query(
        `INSERT INTO sg_billing_checkout_sessions(session_id,tenant_id,expires_at,created_at,control_hmac)
         VALUES($1,$2,$3,$4,$5)`,
        [sessionId, tenantId, expiration, timestamp, this.hmac('checkout-session-v1', unsigned)],
      );
    });
  }

  async customerForTenant(tenantId: string): Promise<string | undefined> {
    const row = (
      await this.pool.query<SubscriptionRow>(
        'SELECT * FROM sg_billing_subscriptions WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0];
    if (!row) return undefined;
    this.assertRow(row, 'subscription-v1', this.subscriptionUnsigned(row));
    return row.customer_id;
  }

  private validateEvent(input: SharedBillingEventInput): void {
    if (
      !/^evt_[A-Za-z0-9_]+$/u.test(input.event_id) ||
      !Number.isSafeInteger(input.event_created) ||
      input.event_created < 0 ||
      input.event_type.length < 1 ||
      input.event_type.length > 128 ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.payload_sha256) ||
      !/^price_[A-Za-z0-9_]+$/u.test(input.team_price_id)
    )
      throw new TypeError('billing event envelope is invalid');
    if (input.subscription_id !== undefined && !/^sub_[A-Za-z0-9_]+$/u.test(input.subscription_id))
      throw new TypeError('billing subscription identifier is invalid');
    if (
      input.checkout_session_id !== undefined &&
      !/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/u.test(input.checkout_session_id)
    )
      throw new TypeError('billing checkout identifier is invalid');
  }

  async ingestStripeEvent(input: SharedBillingEventInput): Promise<SharedBillingIngestResult> {
    this.validateEvent(input);
    return this.transaction(async (client) => {
      const existing = (
        await client.query<EventRow>(
          'SELECT * FROM sg_billing_events WHERE event_id=$1 FOR UPDATE',
          [input.event_id],
        )
      ).rows[0];
      if (existing) {
        this.assertRow(existing, 'event-v1', this.eventUnsigned(existing));
        if (
          existing.payload_sha256 !== input.payload_sha256 ||
          existing.event_type !== input.event_type ||
          Number(existing.event_created) !== input.event_created
        )
          throw new SharedStateIntegrityError(
            'billing event identifier was replayed with conflicts',
          );
        if (existing.status === 'applied' || existing.status === 'ignored')
          return { event_status: 'duplicate' };
      }

      let tenantId: string | undefined;
      if (input.checkout_session_id) {
        const checkout = (
          await client.query<CheckoutRow>(
            'SELECT * FROM sg_billing_checkout_sessions WHERE session_id=$1 FOR UPDATE',
            [input.checkout_session_id],
          )
        ).rows[0];
        if (checkout) {
          this.assertRow(checkout, 'checkout-session-v1', this.checkoutUnsigned(checkout));
          tenantId = checkout.tenant_id;
        }
      }
      if (!tenantId && input.subscription_id) {
        const subscription = (
          await client.query<SubscriptionRow>(
            'SELECT * FROM sg_billing_subscriptions WHERE subscription_id=$1 FOR UPDATE',
            [input.subscription_id],
          )
        ).rows[0];
        if (subscription) {
          this.assertRow(subscription, 'subscription-v1', this.subscriptionUnsigned(subscription));
          tenantId = subscription.tenant_id;
        }
      }

      const receivedAt = existing?.received_at ?? new Date();
      const eventBase = {
        event_id: input.event_id,
        tenant_id: tenantId ?? null,
        event_created: input.event_created,
        event_type: input.event_type,
        payload_sha256: input.payload_sha256,
        subscription_id: input.subscription_id ?? null,
        checkout_session_id: input.checkout_session_id ?? null,
        received_at: receivedAt.toISOString(),
      };
      if (!tenantId || !input.snapshot) {
        const status = input.subscription_id || input.checkout_session_id ? 'pending' : 'ignored';
        const reasonCode =
          status === 'pending' ? 'billing_binding_unavailable' : 'billing_event_not_actionable';
        const unsigned = {
          ...eventBase,
          status,
          reason_code: reasonCode,
          applied_at: null,
        };
        await client.query(
          `INSERT INTO sg_billing_events(event_id,tenant_id,event_created,event_type,payload_sha256,
             subscription_id,checkout_session_id,status,reason_code,received_at,applied_at,control_hmac)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11)
           ON CONFLICT(event_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,
             subscription_id=EXCLUDED.subscription_id,
             checkout_session_id=EXCLUDED.checkout_session_id,status=EXCLUDED.status,
             reason_code=EXCLUDED.reason_code,control_hmac=EXCLUDED.control_hmac`,
          [
            input.event_id,
            tenantId ?? null,
            input.event_created,
            input.event_type,
            input.payload_sha256,
            input.subscription_id ?? null,
            input.checkout_session_id ?? null,
            status,
            reasonCode,
            receivedAt,
            this.hmac('event-v1', unsigned),
          ],
        );
        return { event_status: status };
      }

      if (
        input.snapshot.subscription_id !== input.subscription_id ||
        !/^cus_[A-Za-z0-9_]+$/u.test(input.snapshot.customer_id) ||
        !/^price_[A-Za-z0-9_]+$/u.test(input.snapshot.price_id)
      )
        throw new TypeError('billing subscription snapshot is invalid');
      const currentPeriodEnd = input.snapshot.current_period_end
        ? new Date(input.snapshot.current_period_end)
        : null;
      const retrievedAt = new Date(input.snapshot.retrieved_at);
      if (
        (currentPeriodEnd && !Number.isFinite(currentPeriodEnd.getTime())) ||
        !Number.isFinite(retrievedAt.getTime()) ||
        !Number.isSafeInteger(input.snapshot.provider_created_at) ||
        input.snapshot.provider_created_at < 0
      )
        throw new TypeError('billing subscription timestamps are invalid');
      const subscriptionUnsigned = {
        subscription_id: input.snapshot.subscription_id,
        tenant_id: tenantId,
        customer_id: input.snapshot.customer_id,
        price_id: input.snapshot.price_id,
        entitled_plan:
          ['active', 'trialing'].includes(input.snapshot.status) &&
          input.snapshot.price_id === input.team_price_id
            ? 'team'
            : 'trial',
        status: input.snapshot.status,
        current_period_end: currentPeriodEnd?.toISOString() ?? null,
        cancel_at_period_end: input.snapshot.cancel_at_period_end,
        provider_created_at: input.snapshot.provider_created_at,
        retrieved_at: retrievedAt.toISOString(),
      };
      const existingBindings = await client.query<SubscriptionRow>(
        `SELECT * FROM sg_billing_subscriptions
         WHERE subscription_id=$1 OR tenant_id=$2 OR customer_id=$3 FOR UPDATE`,
        [input.snapshot.subscription_id, tenantId, input.snapshot.customer_id],
      );
      for (const binding of existingBindings.rows) {
        this.assertRow(binding, 'subscription-v1', this.subscriptionUnsigned(binding));
        if (binding.tenant_id !== tenantId)
          throw new SharedStateIntegrityError(
            'billing subscription or customer is already bound to another tenant',
          );
      }
      const replacedSubscription = existingBindings.rows.find(
        (binding) => binding.subscription_id !== input.snapshot!.subscription_id,
      );
      if (replacedSubscription)
        await client.query('DELETE FROM sg_billing_subscriptions WHERE tenant_id=$1', [tenantId]);
      await client.query(
        `INSERT INTO sg_billing_subscriptions(subscription_id,tenant_id,customer_id,price_id,
           entitled_plan,status,current_period_end,cancel_at_period_end,provider_created_at,
           retrieved_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(subscription_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,
           customer_id=EXCLUDED.customer_id,price_id=EXCLUDED.price_id,
           entitled_plan=EXCLUDED.entitled_plan,status=EXCLUDED.status,
           current_period_end=EXCLUDED.current_period_end,
           cancel_at_period_end=EXCLUDED.cancel_at_period_end,
           provider_created_at=EXCLUDED.provider_created_at,retrieved_at=EXCLUDED.retrieved_at,
           control_hmac=EXCLUDED.control_hmac`,
        [
          input.snapshot.subscription_id,
          tenantId,
          input.snapshot.customer_id,
          input.snapshot.price_id,
          subscriptionUnsigned.entitled_plan,
          input.snapshot.status,
          currentPeriodEnd,
          input.snapshot.cancel_at_period_end,
          input.snapshot.provider_created_at,
          retrievedAt,
          this.hmac('subscription-v1', subscriptionUnsigned),
        ],
      );
      const supersededAt = new Date();
      const pendingEvents = await client.query<EventRow>(
        `SELECT * FROM sg_billing_events
         WHERE subscription_id=$1 AND status='pending' AND event_id<>$2 FOR UPDATE`,
        [input.snapshot.subscription_id, input.event_id],
      );
      for (const pending of pendingEvents.rows) {
        this.assertRow(pending, 'event-v1', this.eventUnsigned(pending));
        const superseded: EventRow = {
          ...pending,
          tenant_id: tenantId,
          status: 'ignored',
          reason_code: 'superseded_by_provider_reconciliation',
          applied_at: supersededAt,
        };
        await client.query(
          `UPDATE sg_billing_events SET tenant_id=$1,status='ignored',reason_code=$2,
             applied_at=$3,control_hmac=$4 WHERE event_id=$5`,
          [
            tenantId,
            superseded.reason_code,
            supersededAt,
            this.hmac('event-v1', this.eventUnsigned(superseded)),
            pending.event_id,
          ],
        );
      }
      const eventUnsigned = {
        ...eventBase,
        status: 'ready',
        reason_code: null,
        applied_at: null,
      };
      await client.query(
        `INSERT INTO sg_billing_events(event_id,tenant_id,event_created,event_type,payload_sha256,
           subscription_id,checkout_session_id,status,reason_code,received_at,applied_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6,$7,'ready',NULL,$8,NULL,$9)
         ON CONFLICT(event_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,
           subscription_id=EXCLUDED.subscription_id,
           checkout_session_id=EXCLUDED.checkout_session_id,status='ready',reason_code=NULL,
           applied_at=NULL,control_hmac=EXCLUDED.control_hmac`,
        [
          input.event_id,
          tenantId,
          input.event_created,
          input.event_type,
          input.payload_sha256,
          input.subscription_id ?? null,
          input.checkout_session_id ?? null,
          receivedAt,
          this.hmac('event-v1', eventUnsigned),
        ],
      );
      const desiredPlan = subscriptionUnsigned.entitled_plan as 'trial' | 'team';
      return {
        event_status: 'ready',
        tenant_id: tenantId,
        desired_plan: desiredPlan,
        subscription_status: input.snapshot.status,
      };
    });
  }

  async markEventApplied(eventId: string): Promise<void> {
    await this.transaction(async (client) => {
      const row = (
        await client.query<EventRow>(
          'SELECT * FROM sg_billing_events WHERE event_id=$1 FOR UPDATE',
          [eventId],
        )
      ).rows[0];
      if (!row) throw new SharedStateIntegrityError('shared billing event is missing');
      this.assertRow(row, 'event-v1', this.eventUnsigned(row));
      if (row.status === 'applied') return;
      if (row.status !== 'ready')
        throw new SharedStateIntegrityError('shared billing event is not ready to apply');
      const appliedAt = new Date();
      const updated: EventRow = { ...row, status: 'applied', applied_at: appliedAt };
      await client.query(
        `UPDATE sg_billing_events SET status='applied',applied_at=$1,control_hmac=$2
         WHERE event_id=$3`,
        [appliedAt, this.hmac('event-v1', this.eventUnsigned(updated)), eventId],
      );
    });
  }

  async entitlementReady(tenantId: string): Promise<boolean> {
    const unresolved = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) count FROM sg_billing_events WHERE tenant_id=$1 AND status='ready'",
      [tenantId],
    );
    return Number(unresolved.rows[0]?.count ?? 0) === 0;
  }

  async statement(tenantId: string): Promise<SharedBillingStatement> {
    const row = (
      await this.pool.query<SubscriptionRow>(
        'SELECT * FROM sg_billing_subscriptions WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0];
    if (!row)
      return {
        provider: 'stripe',
        status: 'not_started',
        plan: 'trial',
        current_period_end: null,
        cancel_at_period_end: false,
      };
    this.assertRow(row, 'subscription-v1', this.subscriptionUnsigned(row));
    return {
      provider: 'stripe',
      status: row.status,
      plan: row.entitled_plan,
      current_period_end: iso(row.current_period_end),
      cancel_at_period_end: row.cancel_at_period_end,
    };
  }

  async verifyIntegrity(tenantId?: string): Promise<{ valid: boolean; checked: number }> {
    try {
      const [checkouts, subscriptions, events] = await Promise.all([
        this.pool.query<CheckoutRow>(
          `SELECT * FROM sg_billing_checkout_sessions${tenantId ? ' WHERE tenant_id=$1' : ''}`,
          tenantId ? [tenantId] : [],
        ),
        this.pool.query<SubscriptionRow>(
          `SELECT * FROM sg_billing_subscriptions${tenantId ? ' WHERE tenant_id=$1' : ''}`,
          tenantId ? [tenantId] : [],
        ),
        this.pool.query<EventRow>(
          `SELECT * FROM sg_billing_events${tenantId ? ' WHERE tenant_id=$1' : ''}`,
          tenantId ? [tenantId] : [],
        ),
      ]);
      for (const row of checkouts.rows)
        this.assertRow(row, 'checkout-session-v1', this.checkoutUnsigned(row));
      for (const row of subscriptions.rows)
        this.assertRow(row, 'subscription-v1', this.subscriptionUnsigned(row));
      for (const row of events.rows) this.assertRow(row, 'event-v1', this.eventUnsigned(row));
      return {
        valid: true,
        checked: checkouts.rows.length + subscriptions.rows.length + events.rows.length,
      };
    } catch {
      return { valid: false, checked: 0 };
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
