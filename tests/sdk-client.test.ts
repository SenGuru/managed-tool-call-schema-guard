import { describe, expect, it, vi } from 'vitest';
import { validateToolCall } from '../packages/core/src/index.js';
import {
  SchemaGuardClient,
  SchemaGuardConfigurationError,
  SchemaGuardServiceError,
  SchemaGuardTimeoutError,
} from '../packages/sdk-typescript/src/index.js';

const request = {
  tool_name: 'counter',
  tool_schema: { type: 'object', properties: { count: { type: 'integer' } } },
  raw_arguments: { count: '2' },
} as const;

describe('SchemaGuardClient remote boundary', () => {
  it('requires credentials for remote operation and rejects invalid deadlines', () => {
    expect(() => new SchemaGuardClient({ baseUrl: 'https://guard.example' })).toThrow(
      SchemaGuardConfigurationError,
    );
    for (const timeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, 1.5])
      expect(() => new SchemaGuardClient({ timeoutMs })).toThrow(SchemaGuardConfigurationError);
  });

  it('sends bearer authentication and accepts a valid decision envelope', async () => {
    const decision = validateToolCall(request);
    const mockFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-key');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(
        new Response(JSON.stringify(decision), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example/',
      apiKey: 'secret-key',
      fetch: mockFetch,
    });
    await expect(client.validate(request)).resolves.toMatchObject({
      decision: 'valid_with_repair',
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns structured service errors and fails closed on invalid envelopes', async () => {
    const unauthorized = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'bad-key',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'invalid_api_key', message: 'invalid key' }), {
            status: 401,
          }),
        ),
      ) as typeof fetch,
    });
    await expect(unauthorized.validate(request)).rejects.toMatchObject({
      name: 'SchemaGuardServiceError',
      status: 401,
      code: 'invalid_api_key',
    });

    const invalid = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'key',
      fetch: vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch,
    });
    await expect(invalid.validate(request)).rejects.toBeInstanceOf(SchemaGuardServiceError);
  });

  it('aborts remote validation at the configured deadline', async () => {
    const hangingFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), {
            once: true,
          });
        }),
    ) as typeof fetch;
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'key',
      timeoutMs: 10,
      fetch: hangingFetch,
    });
    await expect(client.validate(request)).rejects.toBeInstanceOf(SchemaGuardTimeoutError);
  });

  it('compiles locally and through the authenticated managed boundary', async () => {
    const compileRequest = {
      target: 'mcp',
      tool_name: 'counter',
      tool_schema: { type: 'object', properties: {} },
    } as const;
    expect(new SchemaGuardClient().compileLocal(compileRequest).status).toBe('runtime_unverified');
    const remote = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'secret',
      fetch: vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
        return Promise.resolve(
          new Response(JSON.stringify(new SchemaGuardClient().compileLocal(compileRequest)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }) as typeof fetch,
    });
    await expect(remote.compile(compileRequest)).resolves.toMatchObject({
      target: 'mcp',
      status: 'runtime_unverified',
    });
  });

  it('exposes the managed reconciliation lifecycle without sending GET bodies', async () => {
    const reservationId = 'res_11111111-1111-4111-8111-111111111111';
    const fingerprint = `sha256:${'2'.repeat(64)}`;
    const record = {
      reconciliation_id: 'rec_22222222-2222-4222-8222-222222222222',
      reservation_id: reservationId,
      execution_fingerprint: fingerprint,
      audit_id: 'aud_33333333-3333-4333-8333-333333333333',
      tool_name_hash: `hmac-sha256:${'4'.repeat(64)}`,
      environment: 'production',
      outcome: 'confirmed_executed',
      evidence_hash: `hmac-sha256:${'5'.repeat(64)}`,
      reconciled_by_hash: `hmac-sha256:${'6'.repeat(64)}`,
      reconciled_at: '2026-07-20T12:00:00.000Z',
      previous_hash: 'GENESIS',
      record_hash: `hmac-sha256:${'7'.repeat(64)}`,
    } as const;
    const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'reconciler-key',
      fetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        if (url.includes('/idempotency/anchors/deliveries?'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                deliveries: [
                  {
                    delivery_id: 'anchor_44444444-4444-4444-8444-444444444444',
                    revision: 2,
                    checkpoint_hash: `hmac-sha256:${'3'.repeat(64)}`,
                    status: 'delivered',
                    attempt_count: 1,
                    next_attempt_at: '2026-07-20T12:00:00.000Z',
                    last_attempt_at: '2026-07-20T12:00:01.000Z',
                    delivered_at: '2026-07-20T12:00:01.000Z',
                    response_status: 202,
                    error_code: null,
                    created_at: '2026-07-20T12:00:00.000Z',
                  },
                ],
              }),
            ),
          );
        if (url.includes('/idempotency/anchors/deliveries/') && url.endsWith('/redrive'))
          return Promise.resolve(new Response(JSON.stringify({ redriven: true })));
        if (url.endsWith('/idempotency/checkpoint/compare'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: 'same',
                anchored_revision: 2,
                current_revision: 2,
                current_checkpoint: {
                  checkpoint_version: '1',
                  tenant_ref: `hmac-sha256:${'1'.repeat(64)}`,
                  revision: 2,
                  row_count: 1,
                  accumulator: `xor256:${'2'.repeat(64)}`,
                  updated_at: '2026-07-20T12:00:00.000Z',
                  checkpoint_hash: `hmac-sha256:${'3'.repeat(64)}`,
                },
              }),
            ),
          );
        if (url.endsWith('/idempotency/checkpoint'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                checkpoint_version: '1',
                tenant_ref: `hmac-sha256:${'1'.repeat(64)}`,
                revision: 2,
                row_count: 1,
                accumulator: `xor256:${'2'.repeat(64)}`,
                updated_at: '2026-07-20T12:00:00.000Z',
                checkpoint_hash: `hmac-sha256:${'3'.repeat(64)}`,
              }),
            ),
          );
        if (url.includes('/pending'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                pending: [
                  {
                    reservation_id: reservationId,
                    execution_fingerprint: fingerprint,
                    audit_id: record.audit_id,
                    tool_name_hash: record.tool_name_hash,
                    environment: 'production',
                    created_at: '2026-07-20T11:00:00.000Z',
                    updated_at: '2026-07-20T11:30:00.000Z',
                    age_seconds: 1800,
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        if (url.endsWith('/verify'))
          return Promise.resolve(
            new Response(JSON.stringify({ valid: true, checked: 1 }), { status: 200 }),
          );
        if (url.endsWith('/history'))
          return Promise.resolve(
            new Response(
              JSON.stringify({ reconciliations: [{ ...record, integrity_valid: true }] }),
              {
                status: 200,
              },
            ),
          );
        return Promise.resolve(new Response(JSON.stringify(record), { status: 200 }));
      }) as typeof fetch,
    });

    await expect(client.listPendingManagedActions(300)).resolves.toHaveLength(1);
    const checkpoint = await client.getManagedActionIdempotencyCheckpoint();
    expect(checkpoint).toMatchObject({
      revision: 2,
      row_count: 1,
    });
    await expect(
      client.compareManagedActionIdempotencyCheckpoint(checkpoint),
    ).resolves.toMatchObject({
      status: 'same',
      current_revision: 2,
    });
    const anchorDeliveries = await client.listManagedActionCheckpointAnchorDeliveries();
    expect(anchorDeliveries).toMatchObject([{ revision: 2, status: 'delivered' }]);
    await expect(
      client.redriveManagedActionCheckpointAnchorDelivery(
        'anchor_44444444-4444-4444-8444-444444444444',
      ),
    ).resolves.toBeUndefined();
    await expect(
      client.reconcileManagedAction(reservationId, 'confirmed_executed', 'downstream-record-123'),
    ).resolves.toMatchObject({ reservation_id: reservationId });
    await expect(client.listManagedActionReconciliations()).resolves.toHaveLength(1);
    await expect(client.verifyManagedActionReconciliations()).resolves.toEqual({
      valid: true,
      checked: 1,
    });
    expect(
      calls.filter((call) => call.method === 'GET').every((call) => call.body === undefined),
    ).toBe(true);
  });

  it('exposes the managed alert-webhook lifecycle without returning stored secrets', async () => {
    const webhook = {
      webhook_id: 'wh_11111111-1111-4111-8111-111111111111',
      label: 'oncall',
      endpoint_hash: `hmac-sha256:${'1'.repeat(64)}`,
      created_at: '2026-07-20T12:00:00.000Z',
      disabled_at: null,
    } as const;
    const delivery = {
      delivery_id: 'delivery_22222222-2222-4222-8222-222222222222',
      webhook_id: webhook.webhook_id,
      alert_id: 1,
      status: 'dead',
      attempt_count: 8,
      next_attempt_at: '2026-07-20T12:00:00.000Z',
      last_attempt_at: '2026-07-20T12:00:00.000Z',
      delivered_at: null,
      response_status: 503,
      error_code: 'http_503',
      created_at: '2026-07-20T11:00:00.000Z',
    } as const;
    const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'webhook-manager',
      fetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        if (init?.method === 'POST' && url.endsWith('/v1/alert-webhooks'))
          return Promise.resolve(
            new Response(JSON.stringify({ ...webhook, signing_secret: 'sgwhsec_once' }), {
              status: 201,
            }),
          );
        if (url.includes('/deliveries?'))
          return Promise.resolve(new Response(JSON.stringify({ deliveries: [delivery] })));
        if (init?.method === 'GET')
          return Promise.resolve(new Response(JSON.stringify({ webhooks: [webhook] })));
        return Promise.resolve(new Response(JSON.stringify({ updated: true })));
      }) as typeof fetch,
    });
    await expect(
      client.createManagedAlertWebhook('oncall', 'https://alerts.example.com/hook'),
    ).resolves.toMatchObject({ signing_secret: 'sgwhsec_once' });
    await expect(client.listManagedAlertWebhooks()).resolves.toEqual([webhook]);
    await expect(client.listManagedAlertWebhookDeliveries(10)).resolves.toEqual([delivery]);
    await expect(client.redriveManagedAlertWebhookDelivery(delivery.delivery_id)).resolves.toBe(
      undefined,
    );
    await expect(client.disableManagedAlertWebhook(webhook.webhook_id)).resolves.toBe(undefined);
    expect(
      calls.filter((call) => call.method === 'GET').every((call) => call.body === undefined),
    ).toBe(true);
    expect(calls.some((call) => call.method === 'DELETE' && call.body === undefined)).toBe(true);
  });

  it('exposes managed schema promotion, enforcement, listing, and chain verification', async () => {
    const release = {
      release_id: 'release_11111111-1111-4111-8111-111111111111',
      tool_name_hash: `hmac-sha256:${'1'.repeat(64)}`,
      environment: 'production',
      schema_hash: `sha256:${'2'.repeat(64)}`,
      adapter: 'mcp',
      version: '1',
      compatibility: 'initial',
      evidence_hash: `hmac-sha256:${'3'.repeat(64)}`,
      promoted_by_hash: `hmac-sha256:${'4'.repeat(64)}`,
      promoted_at: '2026-07-20T12:00:00.000Z',
      previous_hash: 'GENESIS',
      record_hash: `hmac-sha256:${'5'.repeat(64)}`,
      drift: null,
    } as const;
    const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'promoter-key',
      fetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        if (url.endsWith('/verify'))
          return Promise.resolve(new Response(JSON.stringify({ valid: true, checked: 1 })));
        if (init?.method === 'GET')
          return Promise.resolve(
            new Response(JSON.stringify({ releases: [{ ...release, integrity_valid: true }] })),
          );
        if (url.endsWith('/schema-enforcement'))
          return Promise.resolve(new Response(JSON.stringify({ updated: true, mode: 'enforce' })));
        return Promise.resolve(new Response(JSON.stringify(release), { status: 201 }));
      }) as typeof fetch,
    });
    await expect(
      client.promoteManagedSchema({
        tool_name: 'search',
        version: '1',
        environment: 'production',
        expected_schema_hash: release.schema_hash,
      }),
    ).resolves.toMatchObject({ release_id: release.release_id });
    await expect(
      client.listManagedSchemaReleases({ environment: 'production', limit: 10 }),
    ).resolves.toHaveLength(1);
    await expect(client.verifyManagedSchemaReleases()).resolves.toEqual({
      valid: true,
      checked: 1,
    });
    await expect(
      client.setManagedEnvironmentSchemaEnforcement('env_production', 'enforce'),
    ).resolves.toBeUndefined();
    expect(
      calls.filter((call) => call.method === 'GET').every((call) => call.body === undefined),
    ).toBe(true);
  });

  it('exposes tenant-scoped managed control-plane verification without a GET body', async () => {
    const calls: Array<{ method: string; body: BodyInit | null | undefined }> = [];
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'admin-key',
      fetch: vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', body: init?.body });
        return Promise.resolve(
          new Response(JSON.stringify({ valid: true, checked: 5 }), { status: 200 }),
        );
      }) as typeof fetch,
    });
    await expect(client.verifyManagedControlPlaneIntegrity()).resolves.toEqual({
      valid: true,
      checked: 5,
    });
    expect(calls).toEqual([{ method: 'GET', body: undefined }]);
  });

  it('exposes the daily managed read workflow and API-key lifecycle', async () => {
    const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    const client = new SchemaGuardClient({
      baseUrl: 'https://guard.example',
      apiKey: 'operator-key',
      fetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        if (url.endsWith('/v1/usage'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                plan: 'team',
                plan_name: 'Private-beta design partner',
                monthly_limit: 250_000,
                entitlements: {
                  validations_per_month: 250_000,
                  retention_days: 30,
                  managed_workflows: 'full',
                  overage: 'disabled',
                },
                usage: {
                  tenant_id: 'tenant',
                  month: '2026-07',
                  validation_count: 4,
                  repair_count: 1,
                  rejection_count: 1,
                  drift_count: 0,
                },
                payment_processing: 'not_configured_local_mode',
              }),
            ),
          );
        if (url.endsWith('/v1/plans'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                plans: [
                  {
                    id: 'team',
                    display_name: 'Private-beta design partner',
                    audience: 'Invited team',
                    availability: 'invite_only',
                    price: {
                      amount_minor: 225_000,
                      currency: 'USD',
                      term: '90_days_prepaid',
                      monthly_equivalent_minor: 75_000,
                    },
                    entitlements: {
                      validations_per_month: 250_000,
                      retention_days: 30,
                      managed_workflows: 'full',
                      overage: 'disabled',
                    },
                    support: 'Founder-led',
                    payment_collection: 'manual_provider_setup_required',
                  },
                ],
              }),
            ),
          );
        if (url.endsWith('/v1/admin/policy'))
          return Promise.resolve(new Response(JSON.stringify({ policy: { allowed_repairs: [] } })));
        if (url.endsWith('/v1/schemas') && init?.method === 'GET')
          return Promise.resolve(
            new Response(
              JSON.stringify({
                schemas: [
                  {
                    tool_name_hash: `hmac-sha256:${'a'.repeat(64)}`,
                    adapter: 'mcp',
                    version: '1',
                    schema_hash: `sha256:${'b'.repeat(64)}`,
                    schema: { type: 'object' },
                    drift: null,
                    created_at: '2026-07-23T00:00:00.000Z',
                  },
                ],
              }),
            ),
          );
        if (url.endsWith('/v1/admin/actions/descriptors'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                descriptors: [
                  {
                    tool_name_hash: `hmac-sha256:${'c'.repeat(64)}`,
                    environment: 'production',
                    risk_level: 'high',
                    side_effect: 'irreversible',
                    created_at: '2026-07-23T00:00:00.000Z',
                    updated_at: '2026-07-23T00:00:00.000Z',
                  },
                ],
              }),
            ),
          );
        if (url.includes('/v1/actions/challenges?'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                challenges: [
                  {
                    challenge_id: 'challenge_1',
                    status: 'pending',
                    challenge: {},
                    evidence: null,
                    created_at: '2026-07-23T00:00:00.000Z',
                    expires_at: '2026-07-23T00:05:00.000Z',
                    approved_at: null,
                  },
                ],
              }),
            ),
          );
        if (url.includes('/v1/audits?'))
          return Promise.resolve(new Response(JSON.stringify({ audits: [] })));
        if (url.endsWith('/v1/audits/verify'))
          return Promise.resolve(new Response(JSON.stringify({ valid: true, checked: 0 })));
        if (url.endsWith('/v1/alerts'))
          return Promise.resolve(new Response(JSON.stringify({ alerts: [] })));
        if (url.endsWith('/v1/alerts/7/acknowledge'))
          return Promise.resolve(new Response(JSON.stringify({ acknowledged: true, alert_id: 7 })));
        if (url.endsWith('/v1/environments'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                environments: [
                  {
                    id: 'env_1',
                    name: 'production',
                    policy: {},
                    schema_enforcement: 'observe',
                    created_at: '2026-07-20T00:00:00.000Z',
                    updated_at: '2026-07-20T00:00:00.000Z',
                  },
                ],
              }),
            ),
          );
        if (url.endsWith('/v1/intelligence'))
          return Promise.resolve(
            new Response(JSON.stringify({ failure_clusters: [], recommendations: [] })),
          );
        if (url.endsWith('/v1/billing/statement'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                period: '2026-07',
                payment_processing: 'integration_required',
              }),
            ),
          );
        if (url.endsWith('/v1/billing/checkout-session'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                session_id: 'cs_test_sdk',
                url: 'https://checkout.stripe.com/c/pay/sdk',
                expires_at: '2030-01-01T00:00:00.000Z',
              }),
              { status: 201 },
            ),
          );
        if (url.endsWith('/v1/billing/portal-session'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                url: 'https://billing.stripe.com/p/session/sdk',
              }),
              { status: 201 },
            ),
          );
        if (url.endsWith('/v1/admin/tenant/lifecycle'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                lifecycle: {
                  status: 'active',
                  reason_code: null,
                  deletion_requested_at: null,
                  updated_at: '2026-07-23T00:00:00.000Z',
                },
              }),
            ),
          );
        if (url.endsWith('/v1/admin/tenant/export'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                export_version: 1,
                generated_at: '2026-07-23T00:00:00.000Z',
                tenant_id: 'tenant-a',
                content_sha256: `sha256:${'a'.repeat(64)}`,
                tenant: {},
                tables: {},
              }),
            ),
          );
        if (url.endsWith('/v1/admin/tenant/deletion-request'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                lifecycle: {
                  status: 'deletion_pending',
                  reason_code: 'customer_requested',
                  deletion_requested_at: '2026-07-23T00:00:00.000Z',
                  updated_at: '2026-07-23T00:00:00.000Z',
                },
                execution: 'operator_confirmation_required',
              }),
              { status: 202 },
            ),
          );
        if (url.endsWith('/v1/schemas'))
          return Promise.resolve(
            new Response(JSON.stringify({ schema_hash: `sha256:${'a'.repeat(64)}`, drift: null }), {
              status: 201,
            }),
          );
        if (url.endsWith('/v1/admin/api-keys') && init?.method === 'POST')
          return Promise.resolve(
            new Response(
              JSON.stringify({
                key_id: 'key_1',
                api_key: 'one-time-key',
                scopes: ['read:usage'],
              }),
              { status: 201 },
            ),
          );
        if (url.endsWith('/v1/admin/api-keys') && init?.method === 'GET')
          return Promise.resolve(
            new Response(
              JSON.stringify({
                api_keys: [
                  {
                    key_id: 'key_1',
                    prefix: 'sg_live_1234',
                    scopes: ['read:usage'],
                    created_at: '2026-07-23T00:00:00.000Z',
                    revoked_at: null,
                    current: false,
                  },
                ],
              }),
            ),
          );
        if (url.endsWith('/v1/admin/api-keys/key_1') && init?.method === 'DELETE')
          return Promise.resolve(new Response(JSON.stringify({ revoked: true })));
        return Promise.resolve(new Response('{}', { status: 404 }));
      }) as typeof fetch,
    });

    await expect(client.getManagedUsage()).resolves.toMatchObject({ plan: 'team' });
    await expect(client.listManagedPlans()).resolves.toMatchObject([
      { id: 'team', display_name: 'Private-beta design partner' },
    ]);
    await expect(client.getManagedPolicy()).resolves.toEqual({ allowed_repairs: [] });
    await expect(client.listManagedSchemas()).resolves.toMatchObject([
      { adapter: 'mcp', version: '1' },
    ]);
    await expect(client.listManagedActionDescriptors()).resolves.toMatchObject([
      { environment: 'production', risk_level: 'high' },
    ]);
    await expect(
      client.listManagedActionChallenges({ status: 'pending', limit: 25 }),
    ).resolves.toMatchObject([{ challenge_id: 'challenge_1', status: 'pending' }]);
    await expect(client.listManagedActionChallenges({ limit: 0 })).rejects.toThrow(
      /between 1 and 500/u,
    );
    await expect(client.listManagedAudits(25)).resolves.toEqual([]);
    await expect(client.verifyManagedAudits()).resolves.toEqual({ valid: true, checked: 0 });
    await expect(client.listManagedAlerts()).resolves.toEqual([]);
    await expect(client.acknowledgeManagedAlert(7)).resolves.toBeUndefined();
    await expect(client.acknowledgeManagedAlert(0)).rejects.toThrow(/positive safe integer/u);
    await expect(client.listManagedApiKeys()).resolves.toMatchObject([
      { key_id: 'key_1', current: false },
    ]);
    await expect(client.listManagedEnvironments()).resolves.toHaveLength(1);
    await expect(client.getManagedIntelligence()).resolves.toMatchObject({
      failure_clusters: [],
    });
    await expect(client.getManagedBillingStatement()).resolves.toMatchObject({
      payment_processing: 'integration_required',
    });
    await expect(client.createManagedBillingCheckoutSession()).resolves.toMatchObject({
      session_id: 'cs_test_sdk',
    });
    await expect(client.createManagedBillingPortalSession()).resolves.toMatchObject({
      url: 'https://billing.stripe.com/p/session/sdk',
    });
    await expect(client.getManagedTenantLifecycle()).resolves.toMatchObject({
      status: 'active',
    });
    await expect(client.exportManagedTenantData()).resolves.toMatchObject({
      tenant_id: 'tenant-a',
    });
    await expect(client.requestManagedTenantDeletion('tenant-a')).resolves.toMatchObject({
      status: 'deletion_pending',
    });
    await expect(
      client.registerManagedSchema({
        tool_name: 'search',
        adapter: 'mcp',
        version: '1',
        schema: { type: 'object' },
      }),
    ).resolves.toMatchObject({ drift: null });
    const issued = await client.issueManagedApiKey(['read:usage']);
    expect(issued).toMatchObject({ key_id: 'key_1', scopes: ['read:usage'] });
    await expect(client.revokeManagedApiKey(issued.key_id)).resolves.toBeUndefined();

    expect(
      calls.filter((call) => call.method === 'GET').every((call) => call.body === undefined),
    ).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/v1/audits?limit=25'))).toBe(true);
  });
});
