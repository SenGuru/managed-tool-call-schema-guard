import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, validateToolCall } from '../packages/core/src/index.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import {
  PostgresActionState,
  PostgresAlertState,
  PostgresControlState,
  PostgresBillingState,
  PostgresSchemaState,
  PostgresIntelligenceState,
  createSharedStatePool,
  deleteSharedTenantData,
  exportSharedTenantData,
  SharedQuotaExceededError,
  SharedRateLimitExceededError,
  SharedStateIntegrityError,
  type SharedStatePool,
} from '../packages/shared-state/src/index.js';

const postgresUrl = process.env.SCHEMA_GUARD_TEST_POSTGRES_URL;
const secret = 'postgres-shared-state-test-secret-at-least-32-characters';
let first: PostgresActionState;
let second: PostgresActionState;
let firstControl: PostgresControlState;
let secondControl: PostgresControlState;
let firstSchema: PostgresSchemaState;
let secondSchema: PostgresSchemaState;
let firstAlerts: PostgresAlertState;
let secondAlerts: PostgresAlertState;
let firstIntelligence: PostgresIntelligenceState;
let secondIntelligence: PostgresIntelligenceState;
let firstBilling: PostgresBillingState;
let secondBilling: PostgresBillingState;
let firstPool: SharedStatePool;
let secondPool: SharedStatePool;

async function sqliteDatabase(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-postgres-http-')), 'managed.db');
}

describe.runIf(Boolean(postgresUrl))('PostgreSQL multi-instance action state', () => {
  beforeAll(async () => {
    firstPool = createSharedStatePool(postgresUrl!, 20);
    secondPool = createSharedStatePool(postgresUrl!, 20);
    first = new PostgresActionState(postgresUrl!, secret, firstPool);
    second = new PostgresActionState(postgresUrl!, secret, secondPool);
    firstControl = new PostgresControlState(postgresUrl!, secret, firstPool, {
      trialMonthlyLimit: 8,
    });
    secondControl = new PostgresControlState(postgresUrl!, secret, secondPool, {
      trialMonthlyLimit: 8,
    });
    firstSchema = new PostgresSchemaState(postgresUrl!, secret, firstPool);
    secondSchema = new PostgresSchemaState(postgresUrl!, secret, secondPool);
    firstAlerts = new PostgresAlertState(postgresUrl!, secret, firstPool, 2);
    secondAlerts = new PostgresAlertState(postgresUrl!, secret, secondPool, 2);
    firstIntelligence = new PostgresIntelligenceState(postgresUrl!, secret, firstPool);
    secondIntelligence = new PostgresIntelligenceState(postgresUrl!, secret, secondPool);
    await Promise.all([first.migrate(), firstControl.migrate()]);
    firstBilling = new PostgresBillingState(postgresUrl!, secret, firstPool);
    secondBilling = new PostgresBillingState(postgresUrl!, secret, secondPool);
    await firstBilling.migrate();
    await firstSchema.migrate();
    await firstAlerts.migrate();
    await firstIntelligence.migrate();
    await first.pool.query(
      'TRUNCATE sg_billing_events,sg_billing_subscriptions,sg_billing_checkout_sessions,sg_tenant_deletion_receipts,sg_tenant_lifecycle,sg_tenant_rulesets,sg_conformance_runs,sg_failure_observations,sg_intelligence_manifests,sg_alert_deliveries,sg_alert_acknowledgements,sg_alerts,sg_alert_webhooks,sg_alert_manifests,sg_schema_releases,sg_tool_schemas,sg_tool_schema_manifests,sg_schema_environments,sg_schema_release_manifests,sg_control_audit_events,sg_control_audit_anchors,sg_control_audit_manifests,sg_control_api_keys,sg_control_tenants,sg_action_approvals,sg_action_descriptors,sg_accepted_action_decisions,sg_checkpoint_anchor_deliveries,sg_action_reconciliations,sg_action_reconciliation_manifests,sg_action_reservations,sg_action_manifests RESTART IDENTITY',
    );
  });

  afterAll(async () => {
    await Promise.all([
      first.close(),
      second.close(),
      firstControl.close(),
      secondControl.close(),
      firstSchema.close(),
      secondSchema.close(),
      firstAlerts.close(),
      secondAlerts.close(),
      firstIntelligence.close(),
      secondIntelligence.close(),
      firstBilling.close(),
      secondBilling.close(),
    ]);
    await Promise.all([firstPool.end(), secondPool.end()]);
  });

  it('shares authentication, revocation, policy, and an atomic tenant quota across pools', async () => {
    expect(firstPool.listenerCount('error')).toBeGreaterThan(0);
    expect(secondPool.listenerCount('error')).toBeGreaterThan(0);
    await firstControl.bootstrapTenant({
      id: 'control-tenant',
      name: 'Control Tenant',
      plan: 'trial',
      apiKey: 'control-admin',
      scopes: ['admin'],
    });
    await firstSchema.bootstrapTenant('control-tenant');
    await firstAlerts.bootstrapTenant('control-tenant');
    await expect(secondControl.authenticate('control-admin')).resolves.toMatchObject({
      tenantId: 'control-tenant',
      plan: 'trial',
      lifecycleStatus: 'active',
    });
    await firstControl.updateTenantLifecycle(
      'control-tenant',
      'suspended',
      'operator_security_review',
    );
    await expect(secondControl.tenantLifecycle('control-tenant')).resolves.toMatchObject({
      status: 'suspended',
      reason_code: 'operator_security_review',
    });
    await expect(secondControl.authenticate('control-admin')).resolves.toMatchObject({
      lifecycleStatus: 'suspended',
    });
    await secondControl.updateTenantLifecycle('control-tenant', 'active', 'operator_restored');
    const issued = await firstControl.issueApiKey('control-tenant', ['validate']);
    await expect(secondControl.authenticate(issued.api_key)).resolves.toMatchObject({
      keyId: issued.key_id,
      scopes: ['validate'],
    });
    const rateWindowStart = new Date();
    const rateAttempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_unused, index) =>
        (index % 2 ? firstControl : secondControl).consumeRateLimit(
          'control-tenant',
          issued.key_id,
          4,
          rateWindowStart,
        ),
      ),
    );
    expect(rateAttempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(4);
    expect(
      rateAttempts
        .filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected')
        .every(
          (attempt) =>
            attempt.reason instanceof SharedRateLimitExceededError ||
            (attempt.reason instanceof Error &&
              attempt.reason.name === 'SharedRateLimitExceededError'),
        ),
    ).toBe(true);
    await expect(
      secondControl.consumeRateLimit(
        'control-tenant',
        issued.key_id,
        4,
        new Date(rateWindowStart.getTime() + 60_000),
      ),
    ).resolves.toBeUndefined();
    const disposable = await firstControl.issueApiKey('control-tenant', ['validate']);
    await firstControl.consumeRateLimit('control-tenant', disposable.key_id, 10);
    await firstControl.pool.query(
      'UPDATE sg_control_api_keys SET rate_window_count=0 WHERE tenant_id=$1 AND id=$2',
      ['control-tenant', disposable.key_id],
    );
    await expect(secondControl.ready()).resolves.toBe(false);
    await firstControl.pool.query('DELETE FROM sg_control_api_keys WHERE tenant_id=$1 AND id=$2', [
      'control-tenant',
      disposable.key_id,
    ]);
    await expect(secondControl.ready()).resolves.toBe(true);
    await firstControl.updateTenantPolicy('control-tenant', { allowed_repairs: [] });
    await expect(secondControl.authenticate('control-admin')).resolves.toMatchObject({
      policy: { allowed_repairs: [] },
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 16 }, (_unused, index) =>
        (index % 2 ? firstControl : secondControl).recordValidation(
          'control-tenant',
          validateToolCall({
            tool_name: 'quota_probe',
            tool_schema: {
              type: 'object',
              properties: { value: { type: 'integer' } },
              required: ['value'],
            },
            raw_arguments: { value: index },
          }),
        ),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(8);
    const failures = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );
    expect(failures).toHaveLength(8);
    expect(
      failures.every(
        (attempt) =>
          attempt.reason instanceof SharedQuotaExceededError ||
          (attempt.reason instanceof Error && attempt.reason.name === 'SharedQuotaExceededError'),
      ),
    ).toBe(true);
    await expect(secondControl.usage('control-tenant')).resolves.toMatchObject({
      validation_count: 8,
    });
    await expect(secondControl.verifyAuditChain('control-tenant')).resolves.toMatchObject({
      valid: true,
      checked: 8,
    });
    await firstControl.pool.query(
      `UPDATE sg_control_tenants SET policy_json='{}' WHERE id='control-tenant'`,
    );
    await expect(secondControl.ready()).resolves.toBe(false);
    await firstControl.pool.query(
      `UPDATE sg_control_tenants SET policy_json='{"allowed_repairs":[]}' WHERE id='control-tenant'`,
    );
    await expect(secondControl.ready()).resolves.toBe(true);
    await expect(
      secondControl.revokeApiKey('control-tenant', 'bootstrap-control-tenant', issued.key_id),
    ).resolves.toBe(true);
    await expect(firstControl.authenticate(issued.api_key)).resolves.toBeUndefined();

    await firstControl.bootstrapTenant({
      id: 'retention-tenant',
      name: 'Retention Tenant',
      plan: 'trial',
      apiKey: 'retention-admin',
    });
    await firstSchema.bootstrapTenant('retention-tenant');
    await firstAlerts.bootstrapTenant('retention-tenant');
    await firstControl.recordValidation(
      'retention-tenant',
      validateToolCall({
        tool_name: 'retention_probe',
        tool_schema: { type: 'object', properties: {} },
        raw_arguments: {},
      }),
    );
    await expect(firstControl.purgeExpiredAudits('retention-tenant', 0)).resolves.toBe(1);
    await expect(secondControl.verifyAuditChain('retention-tenant')).resolves.toEqual({
      valid: true,
      checked: 0,
    });
    await expect(
      firstControl.pool.query<{ deleted_event_count: string }>(
        `SELECT deleted_event_count FROM sg_control_audit_anchors WHERE tenant_id='retention-tenant'`,
      ),
    ).resolves.toMatchObject({ rows: [{ deleted_event_count: '1' }] });

    await firstControl.bootstrapTenant({
      id: 'tamper-tenant',
      name: 'Tamper Tenant',
      plan: 'trial',
      apiKey: 'tamper-admin',
    });
    await firstSchema.bootstrapTenant('tamper-tenant');
    await firstAlerts.bootstrapTenant('tamper-tenant');
    for (const value of [1, 2])
      await firstControl.recordValidation(
        'tamper-tenant',
        validateToolCall({
          tool_name: 'tamper_probe',
          tool_schema: {
            type: 'object',
            properties: { value: { type: 'integer' } },
            required: ['value'],
          },
          raw_arguments: { value },
        }),
      );
    await firstControl.pool.query(
      `DELETE FROM sg_control_audit_events WHERE sequence=(SELECT MIN(sequence) FROM sg_control_audit_events WHERE tenant_id='tamper-tenant')`,
    );
    await expect(secondControl.ready()).resolves.toBe(false);
    await firstControl.pool.query(`DELETE FROM sg_control_tenants WHERE id='tamper-tenant'`);
    await expect(secondControl.ready()).resolves.toBe(true);
  }, 30_000);

  it('durably reconciles Stripe reordering, replay, entitlements, export, and tamper evidence', async () => {
    const [controlHistory, billingHistory] = await Promise.all([
      firstPool.query<{ version: number }>(
        'SELECT version FROM sg_control_schema_migrations ORDER BY version',
      ),
      firstPool.query<{ version: number }>(
        'SELECT version FROM sg_billing_schema_migrations ORDER BY version',
      ),
    ]);
    expect(controlHistory.rows.map((row) => row.version)).toEqual([1, 2]);
    expect(billingHistory.rows.map((row) => row.version)).toEqual([1]);

    await firstControl.bootstrapTenant({
      id: 'billing-pg',
      name: 'Billing PostgreSQL',
      plan: 'trial',
      apiKey: 'billing-pg-admin',
    });
    const snapshot = {
      subscription_id: 'sub_test_pg',
      customer_id: 'cus_test_pg',
      price_id: 'price_test_team',
      status: 'active' as const,
      current_period_end: '2030-01-01T00:00:00.000Z',
      cancel_at_period_end: false,
      provider_created_at: 1_700_000_000,
      retrieved_at: '2026-07-24T00:00:00.000Z',
    };
    const pending = await firstBilling.ingestStripeEvent({
      event_id: 'evt_test_before_checkout',
      event_created: 1_700_000_001,
      event_type: 'customer.subscription.created',
      payload_sha256: `sha256:${'1'.repeat(64)}`,
      subscription_id: snapshot.subscription_id,
      snapshot,
      team_price_id: 'price_test_team',
    });
    expect(pending).toEqual({ event_status: 'pending' });

    await secondBilling.recordCheckoutSession(
      'billing-pg',
      'cs_test_pg',
      '2030-01-01T00:00:00.000Z',
    );
    const checkoutInput = {
      event_id: 'evt_test_checkout',
      event_created: 1_700_000_002,
      event_type: 'checkout.session.completed',
      payload_sha256: `sha256:${'2'.repeat(64)}`,
      subscription_id: snapshot.subscription_id,
      checkout_session_id: 'cs_test_pg',
      snapshot,
      team_price_id: 'price_test_team',
    };
    const checkout = await firstBilling.ingestStripeEvent(checkoutInput);
    expect(checkout).toMatchObject({
      event_status: 'ready',
      tenant_id: 'billing-pg',
      desired_plan: 'team',
    });
    await expect(secondBilling.entitlementReady('billing-pg')).resolves.toBe(false);
    await firstControl.updatePlan('billing-pg', checkout.desired_plan!);
    await secondBilling.markEventApplied(checkoutInput.event_id);
    await expect(firstBilling.entitlementReady('billing-pg')).resolves.toBe(true);
    await expect(firstBilling.ingestStripeEvent(checkoutInput)).resolves.toEqual({
      event_status: 'duplicate',
    });
    await expect(secondBilling.statement('billing-pg')).resolves.toMatchObject({
      provider: 'stripe',
      status: 'active',
      plan: 'team',
    });
    await expect(secondControl.authenticate('billing-pg-admin')).resolves.toMatchObject({
      plan: 'team',
      monthlyLimit: 250_000,
    });
    const superseded = (
      await firstPool.query<{ status: string; reason_code: string }>(
        "SELECT status,reason_code FROM sg_billing_events WHERE event_id='evt_test_before_checkout'",
      )
    ).rows[0];
    expect(superseded).toEqual({
      status: 'ignored',
      reason_code: 'superseded_by_provider_reconciliation',
    });

    const canceledSnapshot = {
      ...snapshot,
      status: 'canceled' as const,
      retrieved_at: '2026-07-24T00:01:00.000Z',
    };
    const cancellationInput = {
      event_id: 'evt_test_canceled',
      event_created: 1_699_999_999,
      event_type: 'customer.subscription.deleted',
      payload_sha256: `sha256:${'3'.repeat(64)}`,
      subscription_id: snapshot.subscription_id,
      snapshot: canceledSnapshot,
      team_price_id: 'price_test_team',
    };
    const cancellation = await secondBilling.ingestStripeEvent(cancellationInput);
    expect(cancellation).toMatchObject({
      event_status: 'ready',
      tenant_id: 'billing-pg',
      desired_plan: 'trial',
    });
    await expect(firstBilling.entitlementReady('billing-pg')).resolves.toBe(false);
    await secondControl.updatePlan('billing-pg', cancellation.desired_plan!);
    await firstBilling.markEventApplied(cancellationInput.event_id);
    await expect(firstControl.authenticate('billing-pg-admin')).resolves.toMatchObject({
      plan: 'trial',
    });

    await secondBilling.recordCheckoutSession(
      'billing-pg',
      'cs_test_pg_replacement',
      '2030-01-02T00:00:00.000Z',
    );
    const replacementSnapshot = {
      ...snapshot,
      subscription_id: 'sub_test_pg_replacement',
      retrieved_at: '2026-07-24T00:02:00.000Z',
    };
    const replacementInput = {
      event_id: 'evt_test_replacement',
      event_created: 1_700_000_003,
      event_type: 'checkout.session.completed',
      payload_sha256: `sha256:${'5'.repeat(64)}`,
      subscription_id: replacementSnapshot.subscription_id,
      checkout_session_id: 'cs_test_pg_replacement',
      snapshot: replacementSnapshot,
      team_price_id: 'price_test_team',
    };
    const replacement = await firstBilling.ingestStripeEvent(replacementInput);
    expect(replacement).toMatchObject({
      event_status: 'ready',
      tenant_id: 'billing-pg',
      desired_plan: 'team',
    });
    await firstControl.updatePlan('billing-pg', replacement.desired_plan!);
    await secondBilling.markEventApplied(replacementInput.event_id);
    await expect(firstBilling.statement('billing-pg')).resolves.toMatchObject({
      status: 'active',
      plan: 'team',
    });

    await firstControl.bootstrapTenant({
      id: 'billing-pg-other',
      name: 'Other Billing PostgreSQL',
      plan: 'trial',
      apiKey: 'billing-pg-other-admin',
    });
    await firstBilling.recordCheckoutSession(
      'billing-pg-other',
      'cs_test_pg_other',
      '2030-01-03T00:00:00.000Z',
    );
    await expect(
      secondBilling.ingestStripeEvent({
        ...replacementInput,
        event_id: 'evt_test_cross_tenant',
        payload_sha256: `sha256:${'6'.repeat(64)}`,
        checkout_session_id: 'cs_test_pg_other',
      }),
    ).rejects.toThrow(/another tenant/u);
    await firstControl.pool.query("DELETE FROM sg_control_tenants WHERE id='billing-pg-other'");

    await expect(
      firstBilling.ingestStripeEvent({
        ...cancellationInput,
        payload_sha256: `sha256:${'4'.repeat(64)}`,
      }),
    ).rejects.toThrow(/replayed with conflicts/u);

    const exported = await exportSharedTenantData(firstPool, firstPool, 'billing-pg');
    expect((exported.tables as Record<string, unknown[]>).sg_billing_events).toHaveLength(4);
    expect((exported.tables as Record<string, unknown[]>).sg_billing_subscriptions).toHaveLength(1);
    await expect(firstBilling.verifyIntegrity('billing-pg')).resolves.toMatchObject({
      valid: true,
      checked: 7,
    });
    await firstPool.query(
      "UPDATE sg_billing_subscriptions SET status='past_due' WHERE tenant_id='billing-pg'",
    );
    await expect(secondBilling.verifyIntegrity('billing-pg')).resolves.toEqual({
      valid: false,
      checked: 0,
    });
    await firstControl.pool.query("DELETE FROM sg_control_tenants WHERE id='billing-pg'");
  });

  it('shares environment policy, reviewed releases, and fail-closed schema admission', async () => {
    await firstControl.bootstrapTenant({
      id: 'schema-tenant',
      name: 'Schema Tenant',
      plan: 'trial',
      apiKey: 'schema-admin',
    });
    await firstSchema.bootstrapTenant('schema-tenant');
    await firstAlerts.bootstrapTenant('schema-tenant');
    const production = (await secondSchema.listEnvironments('schema-tenant')).find(
      (environment) => environment.name === 'production',
    )!;
    await firstSchema.updateEnvironmentPolicy('schema-tenant', production.id, {
      allowed_repairs: [],
    });
    await expect(secondSchema.environmentPolicy('schema-tenant', 'production')).resolves.toEqual({
      allowed_repairs: [],
    });
    const v1 = {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string' } },
      required: ['query'],
    } as const;
    const v2 = {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query', 'limit'],
    } as const;
    const firstRegistration = await firstSchema.registerSchema('schema-tenant', {
      tool_name: 'search',
      adapter: 'mcp',
      version: '1',
      schema: v1,
    });
    const secondRegistration = await secondSchema.registerSchema('schema-tenant', {
      tool_name: 'search',
      adapter: 'mcp',
      version: '2',
      schema: v2,
    });
    const parallel = await Promise.all(
      Array.from({ length: 16 }, (_unused, index) =>
        (index % 2 ? firstSchema : secondSchema).registerSchema('schema-tenant', {
          tool_name: 'parallel-search',
          adapter: 'mcp',
          version: '1',
          schema: v1,
        }),
      ),
    );
    expect(new Set(parallel.map((registration) => registration.schema_hash)).size).toBe(1);
    const versionOneRows = await firstSchema.pool.query<{ count: string }>(
      `SELECT COUNT(*) count FROM sg_tool_schemas
       WHERE tenant_id='schema-tenant' AND version='1'
       GROUP BY tool_name_hash ORDER BY tool_name_hash`,
    );
    expect(versionOneRows.rows).toEqual([{ count: '1' }, { count: '1' }]);
    await expect(
      secondSchema.registerSchema('schema-tenant', {
        tool_name: 'parallel-search',
        adapter: 'google_adk',
        version: '1',
        schema: v1,
      }),
    ).rejects.toThrow(/version conflicts/u);
    await firstSchema.updateEnvironmentSchemaEnforcement('schema-tenant', production.id, 'enforce');
    await expect(
      secondSchema.schemaAdmission('schema-tenant', 'production', 'search', v1),
    ).resolves.toMatchObject({ allowed: false, reason: 'schema_not_promoted' });
    await secondSchema.promoteSchemaRelease('schema-tenant', 'schema-admin-key', {
      tool_name: 'search',
      version: '1',
      environment: 'production',
      expected_schema_hash: firstRegistration.schema_hash,
    });
    await expect(
      firstSchema.schemaAdmission('schema-tenant', 'production', 'search', v1),
    ).resolves.toMatchObject({ allowed: true, mode: 'enforce' });
    await expect(
      firstSchema.schemaAdmission('schema-tenant', 'production', 'search', v2),
    ).resolves.toMatchObject({ allowed: false, reason: 'schema_release_mismatch' });
    await expect(
      firstSchema.promoteSchemaRelease('schema-tenant', 'schema-admin-key', {
        tool_name: 'search',
        version: '2',
        environment: 'production',
        expected_schema_hash: secondRegistration.schema_hash,
      }),
    ).rejects.toThrow(/review evidence/u);
    await firstSchema.promoteSchemaRelease('schema-tenant', 'schema-admin-key', {
      tool_name: 'search',
      version: '2',
      environment: 'production',
      expected_schema_hash: secondRegistration.schema_hash,
      allow_breaking: true,
      evidence_reference: 'change-review/CR-2048',
    });
    await expect(secondSchema.verifySchemaReleaseHistory('schema-tenant')).resolves.toEqual({
      valid: true,
      checked: 5,
    });
    expect(
      JSON.stringify((await firstSchema.pool.query('SELECT * FROM sg_schema_releases')).rows),
    ).not.toContain('change-review/CR-2048');

    await firstControl.bootstrapTenant({
      id: 'schema-tamper-tenant',
      name: 'Schema Tamper Tenant',
      plan: 'trial',
      apiKey: 'schema-tamper-admin',
    });
    await firstSchema.bootstrapTenant('schema-tamper-tenant');
    await firstAlerts.bootstrapTenant('schema-tamper-tenant');
    const registered = await firstSchema.registerSchema('schema-tamper-tenant', {
      tool_name: 'probe',
      adapter: 'json_schema',
      version: '1',
      schema: v1,
    });
    await firstSchema.promoteSchemaRelease('schema-tamper-tenant', 'operator', {
      tool_name: 'probe',
      version: '1',
      environment: 'production',
      expected_schema_hash: registered.schema_hash,
    });
    await firstSchema.pool.query(
      `DELETE FROM sg_schema_releases WHERE tenant_id='schema-tamper-tenant'`,
    );
    await expect(secondSchema.ready()).resolves.toBe(false);
    await firstControl.pool.query(`DELETE FROM sg_control_tenants WHERE id='schema-tamper-tenant'`);
    await expect(secondSchema.ready()).resolves.toBe(true);

    await firstControl.bootstrapTenant({
      id: 'schema-registry-tamper-tenant',
      name: 'Schema Registry Tamper Tenant',
      plan: 'trial',
      apiKey: 'schema-registry-tamper-admin',
    });
    await firstSchema.bootstrapTenant('schema-registry-tamper-tenant');
    await firstSchema.registerSchema('schema-registry-tamper-tenant', {
      tool_name: 'unpromoted-probe',
      adapter: 'json_schema',
      version: '1',
      schema: v1,
    });
    await firstSchema.pool.query(
      "DELETE FROM sg_tool_schemas WHERE tenant_id='schema-registry-tamper-tenant'",
    );
    await expect(secondSchema.ready()).resolves.toBe(false);
    await expect(secondSchema.listLatestSchemas('schema-registry-tamper-tenant')).rejects.toThrow(
      /schema history/u,
    );
    await firstControl.pool.query(
      "DELETE FROM sg_control_tenants WHERE id='schema-registry-tamper-tenant'",
    );
    await expect(secondSchema.ready()).resolves.toBe(true);

    const migration = (
      await firstSchema.pool.query<{ checksum: string }>(
        'SELECT checksum FROM sg_schema_state_migrations WHERE version=1',
      )
    ).rows[0]!;
    await firstSchema.pool.query(
      `UPDATE sg_schema_state_migrations SET checksum='sha256:invalid' WHERE version=1`,
    );
    await expect(secondSchema.migrate()).rejects.toThrow(/migration history/u);
    await firstSchema.pool.query(
      'UPDATE sg_schema_state_migrations SET checksum=$1 WHERE version=1',
      [migration.checksum],
    );
  }, 30_000);

  it('shares a deletion-evident alert outbox and leases each delivery once', async () => {
    await firstControl.bootstrapTenant({
      id: 'alert-tenant',
      name: 'Alert Tenant',
      plan: 'trial',
      apiKey: 'alert-admin',
    });
    await firstSchema.bootstrapTenant('alert-tenant');
    await firstAlerts.bootstrapTenant('alert-tenant');
    const webhook = await firstAlerts.createWebhook(
      'alert-tenant',
      'primary-oncall',
      'https://alerts.example.com/schema-guard',
    );
    const attempts = await Promise.all(
      Array.from({ length: 16 }, (_unused, index) =>
        (index % 2 ? firstAlerts : secondAlerts).recordAlert(
          'alert-tenant',
          'validation_rejected',
          'warning',
          {
            audit_id: 'aud_00000000-0000-4000-8000-000000000001',
            reason_code: 'SCHEMA_VALIDATION_FAILED',
            raw_arguments: { private: 'must-not-persist' },
          },
          'validation:aud_00000000-0000-4000-8000-000000000001',
        ),
      ),
    );
    expect(new Set(attempts.map((alert) => alert.alert_id)).size).toBe(1);
    expect(attempts[0]!.detail).not.toHaveProperty('raw_arguments');
    await expect(secondAlerts.verifyTenant('alert-tenant')).resolves.toEqual({
      valid: true,
      checked: 1,
    });
    const [firstClaims, secondClaims] = await Promise.all([
      firstAlerts.claimDeliveries(10),
      secondAlerts.claimDeliveries(10),
    ]);
    const claims = [...firstClaims, ...secondClaims];
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ endpoint: 'https://alerts.example.com/schema-guard' });
    expect(claims[0]!.payload).not.toContain('must-not-persist');
    await expect(
      secondAlerts.finishDelivery({
        deliveryId: claims[0]!.deliveryId,
        leaseId: claims[0]!.leaseId,
        delivered: true,
        retryable: false,
        responseStatus: 204,
      }),
    ).resolves.toBe('delivered');
    await expect(secondAlerts.listDeliveries('alert-tenant')).resolves.toMatchObject([
      { status: 'delivered', response_status: 204 },
    ]);
    const persisted = JSON.stringify(
      (
        await firstAlerts.pool.query(
          `SELECT encrypted_endpoint,encrypted_signing_secret FROM sg_alert_webhooks WHERE tenant_id='alert-tenant'`,
        )
      ).rows,
    );
    expect(persisted).not.toContain('alerts.example.com');
    expect(persisted).not.toContain(webhook.signing_secret);
    const listedAlert = (await secondAlerts.listAlerts('alert-tenant'))[0]!;
    await expect(secondAlerts.acknowledgeAlert('alert-tenant', listedAlert.id)).resolves.toBe(true);
    await expect(firstAlerts.acknowledgeAlert('alert-tenant', listedAlert.id)).resolves.toBe(true);
    const acknowledgedAlerts = await firstAlerts.listAlerts('alert-tenant');
    expect(acknowledgedAlerts[0]).toMatchObject({ id: listedAlert.id });
    expect(acknowledgedAlerts[0]!.acknowledged_at).toMatch(/Z$/u);
    const acknowledgement = (
      await firstAlerts.pool.query<{ control_hmac: string }>(
        `SELECT control_hmac FROM sg_alert_acknowledgements WHERE tenant_id='alert-tenant'`,
      )
    ).rows[0]!;
    await firstAlerts.pool.query(
      `UPDATE sg_alert_acknowledgements SET control_hmac='tampered' WHERE tenant_id='alert-tenant'`,
    );
    await expect(secondAlerts.verifyTenant('alert-tenant')).resolves.toMatchObject({
      valid: false,
    });
    await firstAlerts.pool.query(
      `UPDATE sg_alert_acknowledgements SET control_hmac=$1 WHERE tenant_id='alert-tenant'`,
      [acknowledgement.control_hmac],
    );
    await expect(secondAlerts.verifyTenant('alert-tenant')).resolves.toMatchObject({
      valid: true,
    });

    await firstAlerts.recordAlert(
      'alert-tenant',
      'validation_rejected',
      'warning',
      {
        audit_id: 'aud_00000000-0000-4000-8000-000000000002',
        reason_code: 'POLICY_DENIED',
      },
      'validation:aud_00000000-0000-4000-8000-000000000002',
    );
    await firstAlerts.pool.query(
      `DELETE FROM sg_alert_deliveries WHERE alert_id=(SELECT alert_id FROM sg_alerts WHERE tenant_id='alert-tenant' ORDER BY sequence DESC LIMIT 1)`,
    );
    await expect(secondAlerts.ready()).resolves.toBe(false);
    await firstControl.pool.query(`DELETE FROM sg_control_tenants WHERE id='alert-tenant'`);
    await expect(secondAlerts.ready()).resolves.toBe(true);

    const coupledControl = new PostgresControlState(postgresUrl!, secret, firstPool, {
      alertWriter: firstAlerts,
    });
    const coupledSchema = new PostgresSchemaState(postgresUrl!, secret, firstPool, {
      alertWriter: firstAlerts,
    });
    try {
      await coupledControl.bootstrapTenant({
        id: 'alert-atomic-tenant',
        name: 'Alert Atomic Tenant',
        plan: 'trial',
        apiKey: 'alert-atomic-admin',
      });
      await firstAlerts.bootstrapTenant('alert-atomic-tenant');
      await coupledSchema.bootstrapTenant('alert-atomic-tenant');
      await coupledSchema.registerSchema('alert-atomic-tenant', {
        tool_name: 'atomic-search',
        adapter: 'mcp',
        version: '1',
        schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      });
      await firstAlerts.pool.query(
        `UPDATE sg_alert_manifests SET tip_hash='hmac-sha256:invalid' WHERE tenant_id='alert-atomic-tenant'`,
      );
      await expect(
        coupledControl.recordValidation(
          'alert-atomic-tenant',
          validateToolCall({
            tool_name: 'atomic_probe',
            tool_schema: {
              type: 'object',
              properties: { required_value: { type: 'string' } },
              required: ['required_value'],
            },
            raw_arguments: {},
          }),
        ),
      ).rejects.toThrow(/alert state/u);
      await expect(coupledControl.usage('alert-atomic-tenant')).resolves.toMatchObject({
        validation_count: 0,
        rejection_count: 0,
      });
      await expect(coupledControl.verifyAuditChain('alert-atomic-tenant')).resolves.toEqual({
        valid: true,
        checked: 0,
      });
      await expect(
        coupledSchema.registerSchema('alert-atomic-tenant', {
          tool_name: 'atomic-search',
          adapter: 'mcp',
          version: '2',
          schema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer' } },
            required: ['query', 'limit'],
          },
        }),
      ).rejects.toThrow(/alert state/u);
      await expect(
        coupledSchema.pool.query<{ count: string }>(
          `SELECT COUNT(*) count FROM sg_tool_schemas WHERE tenant_id='alert-atomic-tenant' AND version='2'`,
        ),
      ).resolves.toMatchObject({ rows: [{ count: '0' }] });
    } finally {
      await firstControl.pool.query(
        `DELETE FROM sg_control_tenants WHERE id='alert-atomic-tenant'`,
      );
      await Promise.all([coupledControl.close(), coupledSchema.close()]);
    }

    const coupledAction = new PostgresActionState(postgresUrl!, secret, firstPool, {
      alertWriter: firstAlerts,
    });
    try {
      await coupledAction.migrate();
      await firstControl.bootstrapTenant({
        id: 'action-alert-atomic-tenant',
        name: 'Action Alert Atomic Tenant',
        plan: 'trial',
        apiKey: 'action-alert-atomic-admin',
      });
      await firstAlerts.bootstrapTenant('action-alert-atomic-tenant');
      const reserved = await coupledAction.reserve(
        'action-alert-atomic-tenant',
        'atomic-action-key',
        'sha256:atomic-action',
        {
          auditId: 'aud_00000000-0000-4000-8000-000000000003',
          toolNameHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          environment: 'production',
        },
      );
      await firstAlerts.pool.query(
        `UPDATE sg_alert_manifests SET tip_hash='hmac-sha256:invalid' WHERE tenant_id='action-alert-atomic-tenant'`,
      );
      await expect(
        coupledAction.reconcile(
          'action-alert-atomic-tenant',
          reserved.reservation_id!,
          'confirmed_not_executed',
          'ticket/action-alert-atomic',
          'operator-key',
          0,
        ),
      ).rejects.toThrow(/alert state/u);
      await expect(coupledAction.pending('action-alert-atomic-tenant', 0)).resolves.toHaveLength(1);
      await expect(
        coupledAction.reconciliationHistory('action-alert-atomic-tenant'),
      ).resolves.toEqual([]);
    } finally {
      await coupledAction.pool.query(
        `DELETE FROM sg_action_reconciliations WHERE tenant_id='action-alert-atomic-tenant';
         DELETE FROM sg_action_reconciliation_manifests WHERE tenant_id='action-alert-atomic-tenant';
         DELETE FROM sg_action_reservations WHERE tenant_id='action-alert-atomic-tenant';
         DELETE FROM sg_action_manifests WHERE tenant_id='action-alert-atomic-tenant'`,
      );
      await firstControl.pool.query(
        `DELETE FROM sg_control_tenants WHERE id='action-alert-atomic-tenant'`,
      );
      await coupledAction.close();
    }

    const migration = (
      await firstAlerts.pool.query<{ checksum: string }>(
        'SELECT checksum FROM sg_alert_state_migrations WHERE version=1',
      )
    ).rows[0]!;
    await firstAlerts.pool.query(
      `UPDATE sg_alert_state_migrations SET checksum='sha256:invalid' WHERE version=1`,
    );
    await expect(secondAlerts.migrate()).rejects.toThrow(/migration history/u);
    await firstAlerts.pool.query(
      'UPDATE sg_alert_state_migrations SET checksum=$1 WHERE version=1',
      [migration.checksum],
    );
  }, 30_000);

  it('serializes same-key reservations across independent pools', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 40 }, (_unused, index) =>
        (index % 2 ? first : second).reserve('tenant-a', 'payment-123', 'sha256:fingerprint'),
      ),
    );
    expect(attempts.filter((attempt) => attempt.state === 'new')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.state === 'duplicate')).toHaveLength(39);
    expect(new Set(attempts.map((attempt) => attempt.reservation_id)).size).toBe(1);
    await expect(
      second.reserve('tenant-a', 'payment-123', 'sha256:different'),
    ).resolves.toMatchObject({ state: 'conflict' });
    await expect(first.checkpoint('tenant-a')).resolves.toMatchObject({
      revision: 1,
      row_count: 1,
    });
  });

  it('atomically completes/releases and isolates tenants', async () => {
    await expect(first.complete('tenant-a', 'payment-123', 'sha256:fingerprint')).resolves.toBe(2);
    await expect(second.checkpoint('tenant-a')).resolves.toMatchObject({
      revision: 2,
      row_count: 1,
    });
    await expect(
      second.reserve('tenant-b', 'payment-123', 'sha256:tenant-b'),
    ).resolves.toMatchObject({ state: 'new', revision: 1 });
    await expect(first.release('tenant-b', 'payment-123', 'sha256:tenant-b')).resolves.toBe(2);
    await expect(second.checkpoint('tenant-b')).resolves.toMatchObject({
      revision: 2,
      row_count: 0,
    });
  });

  it('suppresses a duplicate across two managed HTTP instances', async () => {
    await firstControl.bootstrapTenant({
      id: 'tenant-http',
      name: 'HTTP Tenant',
      plan: 'trial',
      apiKey: 'tenant-http-admin',
    });
    await firstSchema.bootstrapTenant('tenant-http');
    await firstAlerts.bootstrapTenant('tenant-http');
    const services = await Promise.all(
      [0, 1].map(async () => {
        const service = createManagedServer({
          databasePath: await sqliteDatabase(),
          masterSecret: secret,
          sharedActionDatabaseUrl: postgresUrl!,
          sharedControlDatabaseUrl: postgresUrl!,
        });
        service.store.bootstrapTenant({
          id: 'tenant-http',
          name: 'HTTP Tenant',
          plan: 'trial',
          apiKey: 'tenant-http-admin',
        });
        await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
        const address = service.server.address();
        if (!address || typeof address === 'string') throw new Error('missing server address');
        return { service, base: `http://127.0.0.1:${address.port}` };
      }),
    );
    try {
      const headers = {
        authorization: 'Bearer tenant-http-admin',
        'content-type': 'application/json',
      };
      const descriptor = await fetch(`${services[0]!.base}/v1/admin/actions/descriptors`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          tool_name: 'charge',
          environment: 'production',
          risk_level: 'high',
          side_effect: 'irreversible',
        }),
      });
      expect(descriptor.status, await descriptor.clone().text()).toBe(200);
      const validation = await fetch(`${services[0]!.base}/v1/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool_name: 'charge',
          tool_schema: {
            type: 'object',
            additionalProperties: false,
            properties: { amount: { type: 'integer' } },
            required: ['amount'],
          },
          raw_arguments: { amount: 25 },
        }),
      });
      expect(validation.status).toBe(200);
      const decision = (await validation.json()) as Record<string, unknown>;
      const challengeResponse = await fetch(`${services[1]!.base}/v1/actions/challenges`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision,
          tool_name: 'charge',
          environment: 'production',
          expires_in_seconds: 300,
        }),
      });
      expect(challengeResponse.status).toBe(201);
      const challenge = (await challengeResponse.json()) as { challenge_id: string };
      const [descriptorInventory, pendingInventory] = await Promise.all([
        fetch(`${services[1]!.base}/v1/admin/actions/descriptors`, { headers }),
        fetch(`${services[0]!.base}/v1/actions/challenges?status=pending`, { headers }),
      ]);
      expect(descriptorInventory.status).toBe(200);
      expect(await descriptorInventory.json()).toMatchObject({
        descriptors: [{ environment: 'production', risk_level: 'high' }],
      });
      expect(pendingInventory.status).toBe(200);
      expect(await pendingInventory.json()).toMatchObject({
        challenges: [{ challenge_id: challenge.challenge_id, status: 'pending' }],
      });
      const approvalResponse = await fetch(
        `${services[0]!.base}/v1/actions/challenges/${challenge.challenge_id}/approve`,
        { method: 'POST', headers },
      );
      expect(approvalResponse.status).toBe(200);
      const approval = (await approvalResponse.json()) as Record<string, unknown>;
      const responses = await Promise.all(
        services.map(({ base }) =>
          fetch(`${base}/v1/actions/evaluate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              decision,
              tool_name: 'charge',
              environment: 'production',
              idempotency_key: 'shared-http-charge-1',
              approval,
            }),
          }),
        ),
      );
      const gates = (await Promise.all(responses.map((response) => response.json()))) as Array<{
        status: string;
        execution_fingerprint: string;
      }>;
      expect(gates.map((gate) => gate.status).sort()).toEqual(['allowed', 'duplicate_blocked']);
      const allowed = gates.find((gate) => gate.status === 'allowed')!;
      const completion = await fetch(`${services[1]!.base}/v1/actions/idempotency/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotency_key: 'shared-http-charge-1',
          execution_fingerprint: allowed.execution_fingerprint,
        }),
      });
      expect(completion.status).toBe(200);
      const checkpoint = await fetch(`${services[0]!.base}/v1/actions/idempotency/checkpoint`, {
        headers,
      });
      expect(await checkpoint.json()).toMatchObject({ revision: 2, row_count: 1 });
      const lifecycle = await fetch(`${services[0]!.base}/v1/admin/tenant/lifecycle`, { headers });
      expect(await lifecycle.json()).toMatchObject({ lifecycle: { status: 'active' } });
      const exported = await fetch(`${services[1]!.base}/v1/admin/tenant/export`, {
        headers,
      });
      expect(exported.status).toBe(200);
      expect(await exported.json()).toMatchObject({
        export_version: 1,
        tenant_id: 'tenant-http',
        source: 'shared_postgresql',
      });
      await firstControl.updateTenantLifecycle(
        'tenant-http',
        'suspended',
        'operator_security_review',
      );
      const locked = await fetch(`${services[1]!.base}/v1/usage`, { headers });
      expect(locked.status).toBe(423);
      expect(await locked.json()).toMatchObject({ error: 'tenant_suspended' });
      expect(
        (
          await fetch(`${services[1]!.base}/v1/admin/tenant/export`, {
            headers,
          })
        ).status,
      ).toBe(200);
      await secondControl.updateTenantLifecycle('tenant-http', 'active', 'operator_restored');
    } finally {
      await Promise.all(services.map(({ service }) => service.close()));
    }
  });

  it('detects shared admission-proof and descriptor substitution in readiness', async () => {
    const accepted = await first.pool.query<{ audit_json: string }>(
      "SELECT audit_json FROM sg_accepted_action_decisions WHERE tenant_id='tenant-http' LIMIT 1",
    );
    expect(accepted.rows).toHaveLength(1);
    await first.pool.query(
      "UPDATE sg_accepted_action_decisions SET audit_json='{}' WHERE tenant_id='tenant-http'",
    );
    await expect(second.ready()).resolves.toBe(false);
    await first.pool.query(
      "UPDATE sg_accepted_action_decisions SET audit_json=$1 WHERE tenant_id='tenant-http'",
      [accepted.rows[0]!.audit_json],
    );
    await first.pool.query(
      "UPDATE sg_action_descriptors SET risk_level='critical' WHERE tenant_id='tenant-http'",
    );
    await expect(second.ready()).resolves.toBe(false);
    await first.pool.query(
      "UPDATE sg_action_descriptors SET risk_level='high' WHERE tenant_id='tenant-http'",
    );
    await first.pool.query(
      "UPDATE sg_action_approvals SET status='revoked' WHERE tenant_id='tenant-http'",
    );
    await expect(second.ready()).resolves.toBe(false);
    await first.pool.query(
      "UPDATE sg_action_approvals SET status='approved' WHERE tenant_id='tenant-http'",
    );
    await expect(first.ready()).resolves.toBe(true);
  });

  it('reconciles an uncertain action in the same transaction domain', async () => {
    const reserved = await first.reserve(
      'tenant-reconcile',
      'payment-uncertain',
      'sha256:uncertain',
      {
        auditId: 'audit-uncertain',
        toolNameHash: 'sha256:tool-uncertain',
        environment: 'production',
      },
    );
    expect(await second.pending('tenant-reconcile', 0)).toMatchObject([
      { reservation_id: reserved.reservation_id, audit_id: 'audit-uncertain' },
    ]);
    const reconciled = await second.reconcile(
      'tenant-reconcile',
      reserved.reservation_id!,
      'confirmed_not_executed',
      'operator-ticket-42',
      'operator-key-1',
      0,
    );
    expect(reconciled).toMatchObject({
      reservation_id: reserved.reservation_id,
      outcome: 'confirmed_not_executed',
      previous_hash: 'GENESIS',
    });
    expect(await first.checkpoint('tenant-reconcile')).toMatchObject({ revision: 2, row_count: 0 });
    expect(await first.verifyReconciliations('tenant-reconcile')).toEqual({
      valid: true,
      checked: 1,
    });
    expect(await first.reconciliationHistory('tenant-reconcile')).toEqual([reconciled]);
    await expect(
      first.reconcile(
        'tenant-reconcile',
        reserved.reservation_id!,
        'confirmed_not_executed',
        'operator-ticket-42',
        'different-operator',
        0,
      ),
    ).resolves.toEqual(reconciled);
    await expect(
      first.reconcile(
        'tenant-reconcile',
        reserved.reservation_id!,
        'confirmed_executed',
        'operator-ticket-42',
        'operator-key-1',
        0,
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('detects out-of-band reconciliation deletion before another transition', async () => {
    await first.pool.query(
      "DELETE FROM sg_action_reconciliations WHERE tenant_id='tenant-reconcile'",
    );
    await expect(
      second.reserve('tenant-reconcile', 'payment-after-delete', 'sha256:new'),
    ).rejects.toBeInstanceOf(SharedStateIntegrityError);
  });

  it('queues, acknowledges, and deletion-checks shared checkpoint anchors', async () => {
    const anchored = new PostgresActionState(postgresUrl!, secret, firstPool, {
      checkpointAnchoring: true,
      checkpointAnchorMaxAttempts: 1,
    });
    try {
      await anchored.migrate();
      const reserved = await anchored.reserve(
        'tenant-anchor',
        'anchored-payment',
        'sha256:anchored',
      );
      expect(await anchored.checkpointAnchorAcknowledged('tenant-anchor')).toBe(false);
      const claims = await anchored.claimCheckpointAnchorDeliveries(10);
      expect(claims).toHaveLength(1);
      expect(JSON.parse(claims[0]!.payload)).toMatchObject({
        event_type: 'schema_guard.action_idempotency_checkpoint',
        checkpoint: { revision: 1, row_count: 1 },
      });
      expect(
        await anchored.finishCheckpointAnchorDelivery({
          deliveryId: claims[0]!.deliveryId,
          leaseId: claims[0]!.leaseId,
          delivered: false,
          retryable: true,
          responseStatus: 503,
        }),
      ).toBe('dead');
      expect(await anchored.ready()).toBe(false);
      expect(await anchored.listCheckpointAnchorDeliveries('tenant-anchor', 10)).toMatchObject([
        { revision: 1, status: 'dead', response_status: 503 },
      ]);
      expect(
        await anchored.redriveCheckpointAnchorDelivery('tenant-anchor', claims[0]!.deliveryId),
      ).toBe(true);
      const redriven = await anchored.claimCheckpointAnchorDeliveries(10);
      expect(redriven).toHaveLength(1);
      expect(
        await anchored.finishCheckpointAnchorDelivery({
          deliveryId: redriven[0]!.deliveryId,
          leaseId: redriven[0]!.leaseId,
          delivered: true,
          retryable: false,
          responseStatus: 202,
        }),
      ).toBe('delivered');
      expect(await anchored.checkpointAnchorAcknowledged('tenant-anchor')).toBe(true);
      await anchored.complete('tenant-anchor', 'anchored-payment', 'sha256:anchored');
      expect(await anchored.checkpointAnchorAcknowledged('tenant-anchor')).toBe(false);
      await anchored.pool.query(
        "DELETE FROM sg_checkpoint_anchor_deliveries WHERE tenant_id='tenant-anchor' AND revision=2",
      );
      await expect(anchored.checkpoint('tenant-anchor')).rejects.toBeInstanceOf(
        SharedStateIntegrityError,
      );
      expect(reserved.reservation_id).toMatch(/^res_/u);
    } finally {
      await anchored.close();
    }
  });

  it('detects out-of-band reservation deletion before another transition', async () => {
    await first.pool.query("DELETE FROM sg_action_reservations WHERE tenant_id='tenant-a'");
    await expect(second.reserve('tenant-a', 'payment-456', 'sha256:new')).rejects.toBeInstanceOf(
      SharedStateIntegrityError,
    );
  });

  it('shares atomic value-free intelligence, conformance, and signed ruleset history', async () => {
    await firstIntelligence.migrate();
    const coupledFirst = new PostgresControlState(postgresUrl!, secret, firstPool, {
      intelligenceWriter: firstIntelligence,
    });
    const coupledSecond = new PostgresControlState(postgresUrl!, secret, secondPool, {
      intelligenceWriter: secondIntelligence,
    });
    try {
      await coupledFirst.bootstrapTenant({
        id: 'intelligence-tenant',
        name: 'Intelligence Tenant',
        plan: 'trial',
        apiKey: 'intelligence-admin',
      });
      await firstIntelligence.bootstrapTenant('intelligence-tenant');
      const rejected = validateToolCall({
        tool_name: 'private-tool-name',
        tool_schema: {
          type: 'object',
          properties: { query: { type: 'string', enum: ['secret-contract-value'] } },
          required: ['query'],
        },
        raw_arguments: { query: 'private-customer-value' },
      });
      const attempts = await Promise.all(
        Array.from({ length: 16 }, (_unused, index) =>
          (index % 2 ? coupledFirst : coupledSecond).recordValidation(
            'intelligence-tenant',
            rejected,
            {
              adapter: 'mcp',
              provider: 'anthropic',
              provider_version: 'v1',
              framework: 'langgraph',
            },
          ),
        ),
      );
      expect(attempts.at(-1)).toMatchObject({ validation_count: 1, rejection_count: 1 });
      await expect(
        secondIntelligence.tenantFailureClusters('intelligence-tenant'),
      ).resolves.toMatchObject([
        {
          provider: 'anthropic',
          framework: 'langgraph',
          event_count: 1,
          affected_versions: ['v1'],
        },
      ]);
      const persistedObservations = JSON.stringify(
        (
          await firstIntelligence.pool.query(
            "SELECT * FROM sg_failure_observations WHERE tenant_id='intelligence-tenant'",
          )
        ).rows,
      );
      expect(persistedObservations).not.toContain('private-customer-value');
      expect(persistedObservations).not.toContain('secret-contract-value');
      expect(persistedObservations).not.toContain('private-tool-name');

      const conformance = {
        provider: 'anthropic',
        provider_version: 'v1',
        framework: 'langgraph',
        framework_version: '1.0.0',
        adapter: 'mcp' as const,
        suite_version: '2026.07',
        executed_at: '2026-07-20T00:00:00Z',
        passed: 20,
        failed: 0,
        repaired: 2,
        rejected: 0,
      };
      const conformanceAttempts = await Promise.all(
        Array.from({ length: 16 }, (_unused, index) =>
          (index % 2 ? firstIntelligence : secondIntelligence).recordConformanceRun(
            'intelligence-tenant',
            conformance,
          ),
        ),
      );
      expect(conformanceAttempts.filter((attempt) => attempt.recorded)).toHaveLength(1);
      await expect(
        secondIntelligence.compatibilityMatrix('intelligence-tenant'),
      ).resolves.toMatchObject([{ status: 'compatible', total_cases: 20 }]);

      const rulesetInput = {
        version: '2026.07.1',
        issued_at: new Date(Date.now() - 1_000).toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        rules: [
          {
            id: 'coerce.string_to_integer',
            enabled_by_default: false,
            description: 'Typed integer repair.',
          },
        ],
      };
      const published = await Promise.all(
        Array.from({ length: 8 }, (_unused, index) =>
          (index % 2 ? firstIntelligence : secondIntelligence).publishRuleset(
            'intelligence-tenant',
            rulesetInput,
          ),
        ),
      );
      expect(new Set(published.map((ruleset) => ruleset.signature)).size).toBe(1);
      const latest = await secondIntelligence.latestRuleset('intelligence-tenant');
      expect(latest).toMatchObject({ version: '2026.07.1' });
      await expect(secondIntelligence.verifyRuleset(latest!)).resolves.toBe(true);
      await expect(secondIntelligence.verifyTenantHistory('intelligence-tenant')).resolves.toEqual({
        valid: true,
        checked: 3,
      });

      await firstIntelligence.pool.query(
        "DELETE FROM sg_conformance_runs WHERE tenant_id='intelligence-tenant'",
      );
      await expect(secondIntelligence.ready()).resolves.toBe(false);
      await firstControl.pool.query(
        "DELETE FROM sg_control_tenants WHERE id='intelligence-tenant'",
      );
      await expect(secondIntelligence.ready()).resolves.toBe(true);

      await coupledFirst.bootstrapTenant({
        id: 'intelligence-atomic-tenant',
        name: 'Intelligence Atomic Tenant',
        plan: 'trial',
        apiKey: 'intelligence-atomic-admin',
      });
      await firstIntelligence.bootstrapTenant('intelligence-atomic-tenant');
      await firstIntelligence.pool.query(
        "UPDATE sg_intelligence_manifests SET observation_tip_hash='hmac-sha256:invalid' WHERE tenant_id='intelligence-atomic-tenant'",
      );
      await expect(
        coupledFirst.recordValidation('intelligence-atomic-tenant', rejected, {
          provider: 'anthropic',
          framework: 'langgraph',
        }),
      ).rejects.toThrow(/intelligence/u);
      await expect(coupledFirst.usage('intelligence-atomic-tenant')).resolves.toMatchObject({
        validation_count: 0,
        rejection_count: 0,
      });
      await expect(coupledFirst.verifyAuditChain('intelligence-atomic-tenant')).resolves.toEqual({
        valid: true,
        checked: 0,
      });
      await firstControl.pool.query(
        "DELETE FROM sg_control_tenants WHERE id='intelligence-atomic-tenant'",
      );
    } finally {
      await Promise.all([coupledFirst.close(), coupledSecond.close()]);
    }
  }, 30_000);

  it('rolls back shared validation when same-database accepted-decision proof fails', async () => {
    const acceptedAction = new PostgresActionState(postgresUrl!, secret, firstPool);
    const acceptedControl = new PostgresControlState(postgresUrl!, secret, firstPool, {
      acceptedDecisionWriter: acceptedAction,
    });
    try {
      await acceptedAction.migrate();
      await acceptedControl.bootstrapTenant({
        id: 'accepted-atomic-tenant',
        name: 'Accepted Atomic Tenant',
        plan: 'trial',
        apiKey: 'accepted-atomic-admin',
      });
      const accepted = validateToolCall({
        tool_name: 'accepted-atomic-tool',
        tool_schema: {
          type: 'object',
          properties: { value: { type: 'integer' } },
          required: ['value'],
        },
        raw_arguments: { value: 4 },
      });
      await acceptedAction.pool.query(
        `INSERT INTO sg_accepted_action_decisions(tenant_id,audit_id,decision,audit_json,occurred_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,'hmac-sha256:invalid')`,
        [
          'accepted-atomic-tenant',
          accepted.audit_id,
          accepted.decision,
          canonicalJson(accepted.audit),
          new Date(accepted.audit.timestamp),
        ],
      );
      await expect(
        acceptedControl.recordValidation('accepted-atomic-tenant', accepted),
      ).rejects.toThrow(/accepted decision integrity/u);
      await expect(acceptedControl.usage('accepted-atomic-tenant')).resolves.toMatchObject({
        validation_count: 0,
        repair_count: 0,
        rejection_count: 0,
      });
      await expect(acceptedControl.verifyAuditChain('accepted-atomic-tenant')).resolves.toEqual({
        valid: true,
        checked: 0,
      });
    } finally {
      await acceptedAction.pool.query(
        "DELETE FROM sg_accepted_action_decisions WHERE tenant_id='accepted-atomic-tenant'",
      );
      await firstControl.pool.query(
        "DELETE FROM sg_control_tenants WHERE id='accepted-atomic-tenant'",
      );
      await Promise.all([acceptedAction.close(), acceptedControl.close()]);
    }
  }, 30_000);

  it('exports and deletes a pending shared tenant while retaining a signed value-free receipt', async () => {
    await firstControl.bootstrapTenant({
      id: 'lifecycle-delete-tenant',
      name: 'Lifecycle Delete Tenant',
      plan: 'team',
      apiKey: 'lifecycle-delete-admin',
    });
    await firstSchema.bootstrapTenant('lifecycle-delete-tenant');
    await firstAlerts.bootstrapTenant('lifecycle-delete-tenant');
    await firstIntelligence.bootstrapTenant('lifecycle-delete-tenant');
    await firstControl.updateTenantLifecycle(
      'lifecycle-delete-tenant',
      'deletion_pending',
      'customer_requested',
    );
    await firstAlerts.recordAlert(
      'lifecycle-delete-tenant',
      'validation_rejected',
      'warning',
      { audit_id: 'audit-export-regression', reason_code: 'SCHEMA_VALIDATION_FAILED' },
      'private-alert-deduplication-key',
    );
    const exported = await exportSharedTenantData(firstPool, firstPool, 'lifecycle-delete-tenant');
    expect(exported.content_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(exported)).not.toContain('lifecycle-delete-admin');
    expect(JSON.stringify(exported)).not.toContain('control_hmac');
    expect(JSON.stringify(exported)).not.toContain('key_hash');
    expect(JSON.stringify(exported)).not.toContain('private-alert-deduplication-key');
    const receipt = await deleteSharedTenantData(
      firstPool,
      firstPool,
      'lifecycle-delete-tenant',
      String(exported.content_sha256),
      secret,
    );
    expect(receipt.tenant_ref).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    expect(receipt.receipt_hmac).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    await expect(secondControl.authenticate('lifecycle-delete-admin')).resolves.toBeUndefined();
    expect(
      (
        await firstPool.query<{ count: string }>(
          `SELECT (
             (SELECT COUNT(*) FROM sg_control_tenants WHERE id=$1) +
             (SELECT COUNT(*) FROM sg_action_manifests WHERE tenant_id=$1) +
             (SELECT COUNT(*) FROM sg_action_reservations WHERE tenant_id=$1)
           )::text count`,
          ['lifecycle-delete-tenant'],
        )
      ).rows[0]?.count,
    ).toBe('0');
    await expect(firstControl.ready()).resolves.toBe(true);
    await firstPool.query(
      "UPDATE sg_tenant_deletion_receipts SET export_sha256='sha256:forged' WHERE tenant_ref=$1",
      [receipt.tenant_ref],
    );
    await expect(secondControl.ready()).resolves.toBe(false);
    await firstPool.query(
      'UPDATE sg_tenant_deletion_receipts SET export_sha256=$1,receipt_hmac=$2 WHERE tenant_ref=$3',
      [receipt.export_sha256, receipt.receipt_hmac, receipt.tenant_ref],
    );
    await expect(secondControl.ready()).resolves.toBe(true);
  }, 30_000);

  it('serializes migrations and rejects migration-history substitution', async () => {
    const original = await first.pool.query<{ checksum: string }>(
      'SELECT checksum FROM sg_schema_migrations WHERE version=1',
    );
    expect(original.rows[0]?.checksum).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await first.pool.query(
      "UPDATE sg_schema_migrations SET checksum='sha256:forged' WHERE version=1",
    );
    await expect(second.migrate()).rejects.toBeInstanceOf(SharedStateIntegrityError);
    await first.pool.query('UPDATE sg_schema_migrations SET checksum=$1 WHERE version=1', [
      original.rows[0]!.checksum,
    ]);
    await expect(Promise.all([first.migrate(), second.migrate()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    const controlOriginal = await firstControl.pool.query<{ checksum: string }>(
      'SELECT checksum FROM sg_control_schema_migrations WHERE version=1',
    );
    expect(controlOriginal.rows[0]?.checksum).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await firstControl.pool.query(
      "UPDATE sg_control_schema_migrations SET checksum='sha256:forged' WHERE version=1",
    );
    await expect(secondControl.migrate()).rejects.toBeInstanceOf(SharedStateIntegrityError);
    await firstControl.pool.query(
      'UPDATE sg_control_schema_migrations SET checksum=$1 WHERE version=1',
      [controlOriginal.rows[0]!.checksum],
    );
    await expect(Promise.all([firstControl.migrate(), secondControl.migrate()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    const intelligenceOriginal = await firstIntelligence.pool.query<{ checksum: string }>(
      'SELECT checksum FROM sg_intelligence_migrations WHERE version=1',
    );
    await firstIntelligence.pool.query(
      "UPDATE sg_intelligence_migrations SET checksum='sha256:forged' WHERE version=1",
    );
    await expect(secondIntelligence.migrate()).rejects.toBeInstanceOf(SharedStateIntegrityError);
    await firstIntelligence.pool.query(
      'UPDATE sg_intelligence_migrations SET checksum=$1 WHERE version=1',
      [intelligenceOriginal.rows[0]!.checksum],
    );
    await expect(
      Promise.all([firstIntelligence.migrate(), secondIntelligence.migrate()]),
    ).resolves.toEqual([undefined, undefined]);
  });
});
