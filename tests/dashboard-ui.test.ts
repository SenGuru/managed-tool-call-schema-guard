/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- happy-dom intentionally exposes browser-native DOM methods across its Window type boundary. */
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { dashboardHtml } from '../packages/managed/src/dashboard-html.js';
import { dashboardScript } from '../packages/managed/src/dashboard-script.js';
import { dashboardStyle } from '../packages/managed/src/dashboard-style.js';

const windows: Window[] = [];
const operationalResponses: Record<string, unknown> = {
  '/healthz': { status: 'ok' },
  '/readyz': { status: 'ready' },
  '/v1/usage': {
    usage: { validation_count: 3, repair_count: 1, rejection_count: 1 },
    monthly_limit: 100,
    plan_name: 'Private beta',
    plan: 'trial',
    payment_processing: 'manual_provider_setup_required',
    entitlements: {
      validations_per_month: 1_000,
      retention_days: 7,
      managed_workflows: 'evaluation',
      overage: 'disabled',
    },
  },
  '/v1/audits/verify': { valid: true },
  '/v1/audits?limit=25': { audits: [] },
  '/v1/alerts': { alerts: [] },
  '/v1/intelligence': {},
  '/v1/intelligence/evaluation-export': {
    export_version: 1,
    format: 'akriven_value_free_evaluation',
    generated_at: '2026-07-25T00:00:00.000Z',
    content_sha256: 'sha256:test',
    privacy: { value_free: true },
    records: [],
  },
  '/v1/inventory': {
    inventory_kind: 'registered_and_observed',
    summary: {
      registered_tools: 1,
      promoted_releases: 1,
      environments: 1,
      action_profiles: 1,
      observed_providers: 1,
      observed_frameworks: 1,
    },
    tools: [
      {
        tool_name_hash: 'tool-hash-0123456789',
        adapters: ['json_schema'],
        versions: ['1'],
        releases: [{ environment: 'production', compatibility: 'compatible' }],
      },
    ],
    action_profiles: [
      {
        tool_name_hash: 'action-tool-hash-0123456789',
        environment: 'production',
        risk_level: 'high',
        side_effect: 'external_write',
      },
    ],
    observed_runtime: {
      providers: [
        {
          provider: 'openai',
          frameworks: ['agents-sdk'],
          statuses: ['verified'],
        },
      ],
      frameworks: [
        {
          framework: 'agents-sdk',
          adapters: ['openai'],
          versions: ['1.0'],
        },
      ],
    },
    discovery: {
      automatic: false,
      limitations: [
        'Only explicitly registered or observed assets are included.',
        'This is not endpoint, cloud-account, shadow-agent, or shadow-MCP discovery.',
      ],
    },
  },
  '/v1/environments': { environments: [] },
  '/v1/schema-releases?limit=25': { releases: [] },
  '/v1/schema-releases/verify': { valid: true },
  '/v1/schemas': { schemas: [] },
  '/v1/admin/policy': {},
  '/v1/admin/actions/descriptors': { descriptors: [] },
  '/v1/actions/challenges?limit=100': { challenges: [] },
  '/v1/alert-webhooks': { webhooks: [] },
  '/v1/alert-webhooks/deliveries?limit=100': { deliveries: [] },
  '/v1/actions/idempotency/checkpoint': { revision: 1 },
  '/v1/actions/idempotency/anchors/deliveries?limit=100': { deliveries: [] },
  '/v1/actions/reconciliation/pending': { pending: [] },
  '/v1/actions/reconciliation/history': { reconciliations: [] },
  '/v1/actions/reconciliation/verify': { valid: true },
  '/v1/billing/statement': { payment_processing: 'integration_required' },
  '/v1/admin/control-plane-integrity': { valid: true },
  '/v1/rulesets/latest': { signature: 'test-signature', public_key: 'test-public-key' },
  '/v1/admin/api-keys': { api_keys: [] },
  '/v1/plans': {
    plans: [
      {
        id: 'trial',
        display_name: 'Internal evaluation',
        audience: 'Akriven-operated evaluation tenants',
        availability: 'internal_only',
        price: { amount_minor: 0, monthly_equivalent_minor: 0 },
        entitlements: {
          validations_per_month: 1_000,
          retention_days: 7,
          managed_workflows: 'evaluation',
        },
        support: 'No service commitment',
        payment_collection: 'disabled',
      },
      {
        id: 'team',
        display_name: 'Private-beta design partner',
        audience: 'One invited team and one reviewed workflow',
        availability: 'invite_only',
        price: { amount_minor: 225_000, monthly_equivalent_minor: 75_000 },
        entitlements: {
          validations_per_month: 250_000,
          retention_days: 30,
          managed_workflows: 'full',
        },
        support: 'Founder-led onboarding and weekly evidence review',
        payment_collection: 'manual_provider_setup_required',
      },
    ],
  },
};

function dashboard(path = '/dashboard/overview') {
  const window = new Window({ url: `http://localhost${path}` });
  windows.push(window);
  Object.defineProperty(window, 'structuredClone', { value: structuredClone });
  window.document.write(dashboardHtml(false));
  window.eval(dashboardScript);
  return window;
}

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

describe('managed dashboard interactions', () => {
  it('keeps every operator mutation out of the workbench-only fallback', () => {
    const directScript = dashboardScript.slice(0, dashboardScript.indexOf('const presets='));
    for (const endpoint of [
      '/v1/validate',
      '/v1/contracts/compile',
      '/v1/schemas',
      '/v1/schema-releases',
      '/v1/admin/environments',
      '/policy',
      '/schema-enforcement',
      '/v1/admin/actions/descriptors',
      '/v1/actions/challenges',
      '/approve',
      '/v1/actions/evaluate',
      '/v1/actions/idempotency/',
      '/v1/actions/idempotency/checkpoint/compare',
      '/v1/actions/idempotency/anchors/deliveries/',
      '/v1/actions/reconciliation/',
      '/v1/alerts/',
      '/v1/alert-webhooks',
      '/redrive',
      '/v1/conformance-runs',
      '/v1/intelligence/evaluation-export',
      '/v1/admin/rulesets',
      '/v1/admin/api-keys',
      '/v1/billing/checkout-session',
      '/v1/billing/portal-session',
      '/v1/admin/plan',
      '/v1/admin/policy',
      '/v1/admin/retention/purge',
      '/v1/admin/tenant/export',
      '/v1/admin/tenant/deletion-request',
    ])
      expect(directScript, endpoint).toContain(endpoint);
  });

  it('collapses navigation, changes real routes, and sends presets to the workbench', () => {
    const window = dashboard();
    const document = window.document;
    const shell = document.getElementById('app-shell')!;

    document.getElementById('sidebar-toggle')!.click();
    expect(shell.dataset.sidebar).toBe('collapsed');
    expect(window.localStorage.getItem('akriven-sidebar')).toBe('collapsed');
    expect(document.getElementById('sidebar-toggle')!.getAttribute('aria-label')).toBe(
      'Expand navigation',
    );

    const schemas = document.querySelector<HTMLAnchorElement>('[data-route="schemas"]')!;
    schemas.click();
    expect(window.location.pathname).toBe('/dashboard/schemas');
    expect(schemas.getAttribute('aria-current')).toBe('page');
    expect(document.querySelector<HTMLElement>('[data-route-view="schemas"]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-route-view="overview"]')!.hidden).toBe(true);

    const modifiedClick = new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    schemas.dispatchEvent(modifiedClick);
    expect(modifiedClick.defaultPrevented).toBe(false);

    document.querySelector<HTMLAnchorElement>('[data-route="workbench"]')!.click();
    document.querySelector<HTMLSelectElement>('#operation')!.value = 'reconcile';
    document.getElementById('operation-load')!.click();
    expect(window.location.pathname).toBe('/dashboard/workbench');
    expect(document.querySelector<HTMLSelectElement>('#operation')!.value).toBe('reconcile');
  });

  it('keeps recovery controls available when readiness is fail-closed', async () => {
    const window = dashboard('/dashboard/actions');
    const document = window.document;
    window.fetch = (input) => {
      const path = typeof input === 'string' ? input : input.url;
      const body =
        path === '/readyz'
          ? { status: 'not_ready', checks: { checkpoint_anchor: false } }
          : path === '/v1/admin/tenant/lifecycle'
            ? {
                tenant_id: 'degraded-tenant',
                tenant_name: 'Degraded tenant',
                lifecycle: { status: 'active' },
              }
            : path === '/v1/actions/idempotency/anchors/deliveries?limit=100'
              ? {
                  deliveries: [
                    {
                      delivery_id: 'anchor-dead',
                      revision: 4,
                      status: 'dead',
                      attempt_count: 5,
                      updated_at: '2026-07-25T00:00:00.000Z',
                    },
                  ],
                }
              : operationalResponses[path];
      return Promise.resolve(
        new window.Response(JSON.stringify(body), {
          status: path === '/readyz' ? 503 : 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(document.getElementById('workspace')!.dataset.connected).toBe('true');
    expect(document.getElementById('status')!.textContent).toBe('Workspace loaded');
    expect(document.getElementById('readiness-list')!.textContent).toContain(
      'Managed service readiness',
    );
    expect(document.getElementById('anchor-delivery-rows')!.textContent).toContain('dead');
    expect(document.querySelector('#anchor-delivery-rows button')!.textContent).toBe('Redrive');
    expect(document.getElementById('integrity-components')!.textContent).toContain(
      'RulesetVerified',
    );
  });

  it('moves focus into the mobile drawer, traps it, and restores the opener on escape', async () => {
    const window = dashboard();
    const document = window.document;
    const toggle = document.getElementById('mobile-nav-toggle') as HTMLButtonElement;

    toggle.focus();
    toggle.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(document.getElementById('app-shell')!.dataset.mobileNav).toBe('open');
    expect(document.getElementById('sidebar')!.contains(document.activeElement)).toBe(true);

    const focusable = Array.from(
      document
        .getElementById('sidebar')!
        .querySelectorAll<HTMLElement>('a[href],button:not([disabled])'),
    );
    focusable.at(-1)!.focus();
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(focusable[0]);

    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('app-shell')!.dataset.mobileNav).toBe('closed');
    expect(document.activeElement).toBe(toggle);
  });

  it('keeps responsive single-column grids shrinkable instead of overflowing narrow viewports', () => {
    expect(dashboardStyle).toContain(
      '.content-grid,.content-grid.equal,.task-grid{grid-template-columns:minmax(0,1fr)}',
    );
    expect(dashboardStyle).not.toContain(
      '.content-grid,.content-grid.equal,.task-grid{grid-template-columns:1fr}',
    );
  });

  it('does not show a connected state for a locked tenant', async () => {
    const window = dashboard();
    const document = window.document;
    let locked = false;
    window.fetch = (input) => {
      const path = typeof input === 'string' ? input : input.url;
      const body =
        path === '/v1/admin/tenant/lifecycle'
          ? locked
            ? {
                tenant_id: 'tenant_locked',
                tenant_name: 'Locked tenant',
                lifecycle: { status: 'deletion_pending' },
              }
            : {
                tenant_id: 'tenant_active',
                tenant_name: 'Active tenant',
                lifecycle: { status: 'active' },
              }
          : operationalResponses[path];
      return Promise.resolve(
        new window.Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(document.getElementById('workspace')!.dataset.connected).toBe('true');
    expect(document.getElementById('usage-total')!.textContent).toBe('3');
    expect(document.getElementById('inventory-tool-total')!.textContent).toBe('1');
    expect(document.getElementById('inventory-action-total')!.textContent).toBe('1');
    expect(document.getElementById('inventory-tool-rows')!.textContent).toContain(
      'tool-hash-012345',
    );
    expect(
      document
        .querySelector<HTMLButtonElement>('#inventory-tool-rows button')!
        .getAttribute('aria-label'),
    ).toContain('tool-hash-0123456789');
    expect(document.getElementById('inventory-runtime-list')!.textContent).toContain('openai');
    expect(document.getElementById('inventory-boundary')!.textContent).toContain(
      'not endpoint, cloud-account, shadow-agent, or shadow-MCP discovery',
    );
    expect((document.querySelector('.credential-editor') as HTMLElement).hidden).toBe(true);
    expect((document.getElementById('credential-connected') as HTMLElement).hidden).toBe(false);
    document.getElementById('change-key')!.click();
    expect((document.querySelector('.credential-editor') as HTMLElement).hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('key'));

    locked = true;
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(document.getElementById('workspace')!.dataset.connected).toBe('false');
    expect(document.getElementById('connection-label')!.textContent).toBe('Access locked');
    expect(document.getElementById('status')!.textContent).toContain(
      'operational access is locked',
    );
    expect(document.getElementById('usage-total')!.textContent).toBe('—');
    expect(document.getElementById('inventory-tool-total')!.textContent).toBe('—');
    expect(document.getElementById('decision-rows')!.children).toHaveLength(0);
    expect(document.getElementById('alerts-page-list')!.textContent).toContain(
      'Load the workspace',
    );
  });

  it('keeps the newest tenant load when an older credential finishes later', async () => {
    const window = dashboard();
    const document = window.document;
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.url;
      const authorization = new window.Headers(init?.headers).get('authorization') ?? '';
      const tenant = authorization.endsWith('tenant-a-key') ? 'A' : 'B';
      const body =
        path === '/v1/admin/tenant/lifecycle'
          ? {
              tenant_id: `tenant_${tenant.toLowerCase()}`,
              tenant_name: `Tenant ${tenant}`,
              lifecycle: { status: 'active' },
            }
          : path === '/v1/usage'
            ? {
                usage: {
                  validation_count: tenant === 'A' ? 1 : 9,
                  repair_count: 0,
                  rejection_count: 0,
                },
                monthly_limit: 100,
                plan_name: 'Private beta',
              }
            : operationalResponses[path];
      return new Promise((resolve) =>
        window.setTimeout(
          () =>
            resolve(
              new window.Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            ),
          tenant === 'A' ? 35 : 1,
        ),
      );
    };

    const key = document.getElementById('key') as HTMLInputElement;
    key.value = 'tenant-a-key';
    document.getElementById('load')!.click();
    key.value = 'tenant-b-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 90));

    expect(document.getElementById('workspace')!.dataset.connected).toBe('true');
    expect(document.getElementById('tenant-name')!.textContent).toBe('Tenant B');
    expect(document.getElementById('usage-total')!.textContent).toBe('9');
  });

  it('executes the dedicated validation flow and refreshes accountable evidence', async () => {
    const window = dashboard('/dashboard/decisions');
    const document = window.document;
    let validationCount = 3;
    let submitted: unknown;
    let rejectNext = false;
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.url;
      if (path === '/v1/admin/tenant/lifecycle')
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              tenant_id: 'tenant_active',
              tenant_name: 'Active tenant',
              lifecycle: { status: 'active' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      if (path === '/v1/validate' && init?.method === 'POST') {
        if (typeof init.body !== 'string') throw new TypeError('expected a JSON request body');
        submitted = JSON.parse(init.body);
        validationCount += 1;
        if (rejectNext)
          return Promise.resolve(
            new window.Response(
              JSON.stringify({
                decision: 'rejected',
                reason_code: 'SCHEMA_VALIDATION_FAILED',
                audit_id: 'audit_browser_rejection',
                repair_rules: [],
              }),
              { status: 422, headers: { 'content-type': 'application/json' } },
            ),
          );
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              decision: 'valid_with_repair',
              reason_code: 'SAFE_REPAIR_APPLIED',
              audit_id: 'audit_browser_test',
              repair_rules: ['coerce.string_to_integer'],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (path === '/v1/contracts/compile' && init?.method === 'POST')
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              target: 'google_gemini',
              status: 'unsupported',
              declaration: null,
              issues: [
                {
                  code: 'GOOGLE_KEYWORD_UNSUPPORTED',
                  severity: 'blocker',
                  message: 'additionalProperties is not supported in the provider declaration',
                },
              ],
            }),
            { status: 422, headers: { 'content-type': 'application/json' } },
          ),
        );
      const body =
        path === '/v1/usage'
          ? {
              ...operationalResponses['/v1/usage'],
              usage: {
                validation_count: validationCount,
                repair_count: 1,
                rejection_count: 1,
              },
            }
          : operationalResponses[path];
      return Promise.resolve(
        new window.Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    document.querySelector<HTMLButtonElement>('#validate-form button[type="submit"]')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(submitted).toMatchObject({
      tool_name: 'counter',
      raw_arguments: { count: '2' },
      context: { environment: 'development', adapter: 'json_schema' },
    });
    expect(document.getElementById('validate-status')!.textContent).toBe('Decision recorded');
    expect(document.getElementById('validate-result')!.textContent).toContain('valid_with_repair');
    expect(document.getElementById('usage-total')!.textContent).toBe('4');

    rejectNext = true;
    (document.getElementById('validate-arguments') as HTMLTextAreaElement).value = '{"count":"02"}';
    document.querySelector<HTMLButtonElement>('#validate-form button[type="submit"]')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(document.getElementById('validate-status')!.textContent).toBe('Decision recorded');
    expect(document.getElementById('validate-result')!.textContent).toContain('rejected');
    expect(document.getElementById('validate-result')!.textContent).toContain(
      'SCHEMA_VALIDATION_FAILED',
    );

    document.querySelector<HTMLSelectElement>('#compile-target')!.value = 'google_gemini';
    document.querySelector<HTMLButtonElement>('#compile-form button[type="submit"]')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(document.getElementById('compile-status')!.textContent).toBe(
      'Contract unsupported — review the blocker issues',
    );
    expect(document.getElementById('compile-result')!.hidden).toBe(false);
    expect(document.getElementById('compile-result')!.textContent).toContain(
      'GOOGLE_KEYWORD_UNSUPPORTED',
    );
  });

  it('makes signed audit evidence inspectable and explains the complete paid offer', async () => {
    const window = dashboard('/dashboard/decisions');
    const document = window.document;
    const audits = [
      {
        sequence: 2,
        audit_id: 'aud_rejected',
        occurred_at: '2026-07-24T01:00:00.000Z',
        decision: 'rejected',
        reason_code: 'SCHEMA_VALIDATION_FAILED',
        repair_rules: [],
        event_hash: 'sha256:event-rejected',
        previous_hash: 'sha256:event-valid',
        signature: 'hmac:rejected',
        envelope: {
          audit_id: 'aud_rejected',
          decision: 'rejected',
          arguments_hash: 'sha256:value-free',
        },
      },
      {
        sequence: 1,
        audit_id: 'aud_repaired',
        occurred_at: '2026-07-24T00:00:00.000Z',
        decision: 'valid_with_repair',
        reason_code: null,
        repair_rules: ['coerce.string_to_integer'],
        event_hash: 'sha256:event-valid',
        previous_hash: null,
        signature: 'hmac:valid',
        envelope: {
          audit_id: 'aud_repaired',
          decision: 'valid_with_repair',
          arguments_hash: 'sha256:value-free',
        },
      },
    ];
    window.fetch = (input) => {
      const path = typeof input === 'string' ? input : String(input.url);
      const body =
        path === '/v1/admin/tenant/lifecycle'
          ? {
              tenant_id: 'tenant_active',
              tenant_name: 'Active tenant',
              lifecycle: { status: 'active' },
            }
          : path === '/v1/audits?limit=25'
            ? { audits }
            : operationalResponses[path];
      return Promise.resolve(
        new window.Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    const outcome = document.getElementById('decision-filter') as HTMLSelectElement;
    outcome.value = 'rejected';
    outcome.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(document.getElementById('decision-filter-count')!.textContent).toBe('1 of 2 records');
    expect(document.getElementById('decision-rows')!.textContent).toContain('aud_rejected');
    expect(document.getElementById('decision-rows')!.textContent).not.toContain('aud_repaired');

    const inspect = document.querySelector<HTMLButtonElement>('#decision-rows button')!;
    inspect.focus();
    inspect.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const dialog = document.getElementById('audit-dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(document.getElementById('audit-detail-grid')!.textContent).toContain(
      'SCHEMA_VALIDATION_FAILED',
    );
    expect(document.getElementById('audit-dialog-json')!.textContent).toContain(
      'sha256:event-rejected',
    );
    expect(document.getElementById('audit-dialog-json')!.textContent).not.toContain(
      'raw_arguments',
    );
    document.getElementById('audit-dialog-close')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(inspect);

    document.querySelector<HTMLAnchorElement>('[data-route="usage"]')!.click();
    expect(document.getElementById('entitlement-list')!.textContent).toContain('1,000');
    expect(document.getElementById('entitlement-list')!.textContent).toContain('7 days');
    expect(document.getElementById('plan-grid')!.textContent).toContain('$2,250 / 90 days');
    expect(document.getElementById('plan-grid')!.textContent).toContain(
      '250,000 validations / month',
    );
    expect(document.getElementById('plan-grid')!.textContent).toContain(
      'Founder-led onboarding and weekly evidence review',
    );
    expect((document.getElementById('billing-checkout') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('billing-portal') as HTMLButtonElement).disabled).toBe(true);
  });

  it('acknowledges alerts through an accessible in-product dialog and honors cancellation', async () => {
    const window = dashboard('/dashboard/alerts');
    const document = window.document;
    const acknowledgementPaths: string[] = [];
    Object.defineProperty(window, 'confirm', {
      value: () => {
        throw new Error('native confirm must not be used');
      },
    });
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : String(input.url);
      if (init?.method === 'POST') acknowledgementPaths.push(path);
      const body =
        path === '/v1/admin/tenant/lifecycle'
          ? {
              tenant_id: 'tenant_active',
              tenant_name: 'Active tenant',
              lifecycle: { status: 'active' },
            }
          : path === '/v1/alerts'
            ? {
                alerts: [
                  {
                    id: 'alert_exact',
                    kind: 'schema_drift',
                    severity: 'warning',
                    created_at: '2026-07-24T00:00:00.000Z',
                    acknowledged_at: null,
                  },
                ],
              }
            : operationalResponses[path];
      return Promise.resolve(
        new window.Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    const opener = document.querySelector<HTMLButtonElement>('#alerts-page-list button')!;
    opener.focus();
    opener.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const dialog = document.getElementById('action-dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(document.getElementById('action-dialog-title')!.textContent).toBe('Acknowledge alert?');
    expect(document.getElementById('action-dialog-copy')!.textContent).toContain('schema_drift');
    expect(acknowledgementPaths).toEqual([]);

    document.getElementById('action-dialog-cancel')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(acknowledgementPaths).toEqual([]);

    opener.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    dialog.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(acknowledgementPaths).toEqual([]);

    opener.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    document.getElementById('action-dialog-confirm')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(dialog.open).toBe(false);
    expect(acknowledgementPaths).toEqual(['/v1/alerts/alert_exact/acknowledge']);
  });

  it('renders real managed response shapes and sends row actions to exact IDs', async () => {
    const window = dashboard('/dashboard/actions');
    const document = window.document;
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const acceptDialog = async (input?: string) => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const dialog = document.getElementById('action-dialog') as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      if (input !== undefined)
        (document.getElementById('action-dialog-input') as HTMLInputElement).value = input;
      document.getElementById('action-dialog-confirm')!.click();
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(dialog.open).toBe(false);
    };
    const shapedResponses: Record<string, unknown> = {
      ...operationalResponses,
      '/v1/actions/challenges?limit=100': {
        challenges: [
          {
            status: 'pending',
            challenge: {
              challenge_id: 'ach_exact',
              tool_name_hash: 'hmac:tool',
              environment: 'production',
              risk_level: 'critical',
              expires_at: '2026-07-25T00:00:00.000Z',
            },
          },
        ],
      },
      '/v1/alert-webhooks': {
        webhooks: [
          {
            webhook_id: 'wh_exact',
            label: 'On-call',
            endpoint_hash: 'hmac:endpoint',
            created_at: '2026-07-24T00:00:00.000Z',
            disabled_at: null,
          },
        ],
      },
      '/v1/alert-webhooks/deliveries?limit=100': {
        deliveries: [
          {
            delivery_id: 'delivery_exact',
            webhook_id: 'wh_exact',
            status: 'dead',
            attempt_count: 8,
            next_attempt_at: '2026-07-24T00:00:00.000Z',
            error_code: 'receiver_timeout',
          },
        ],
      },
      '/v1/actions/idempotency/anchors/deliveries?limit=100': {
        deliveries: [
          {
            delivery_id: 'anchor_exact',
            revision: 7,
            status: 'dead',
            attempt_count: 8,
            last_attempt_at: '2026-07-24T00:00:00.000Z',
          },
        ],
      },
      '/v1/actions/reconciliation/pending': {
        pending: [
          {
            reservation_id: 'reservation_exact',
            execution_fingerprint: 'fingerprint_exact',
            audit_id: 'audit_exact',
            tool_name_hash: 'hmac:tool',
            updated_at: '2026-07-24T00:00:00.000Z',
          },
        ],
      },
      '/v1/actions/reconciliation/history': {
        reconciliations: [
          {
            reservation_id: 'reservation_done',
            outcome: 'confirmed_executed',
            evidence_hash: 'hmac:evidence',
            reconciled_at: '2026-07-24T00:00:00.000Z',
            audit_id: 'audit_done',
          },
        ],
      },
      '/v1/intelligence': {
        compatibility_matrix: [
          {
            provider: 'openai',
            latest_provider_version: '2026-07',
            framework: 'agents',
            latest_framework_version: '1.2.3',
            adapter: 'openai_agents',
            latest_suite_version: 'suite-4',
            passed: 9,
            failed: 1,
            last_tested_at: '2026-07-24T00:00:00.000Z',
          },
        ],
      },
      '/v1/admin/api-keys': {
        api_keys: [
          {
            key_id: 'key_current',
            prefix: 'sg_live_curr',
            scopes: ['admin'],
            created_at: '2026-07-24T00:00:00.000Z',
            revoked_at: null,
            current: true,
          },
          {
            key_id: 'key_other',
            prefix: 'sg_live_other',
            scopes: ['validate'],
            created_at: '2026-07-24T00:00:00.000Z',
            revoked_at: null,
            current: false,
          },
        ],
      },
    };
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.url;
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        calls.push({
          method,
          path,
          ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
        });
        return Promise.resolve(
          new window.Response(
            JSON.stringify(
              path === '/v1/admin/retention/purge'
                ? { deleted: 4 }
                : { redriven: true, revoked: true, disabled: true },
            ),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      }
      const body =
        path === '/v1/admin/tenant/lifecycle'
          ? {
              tenant_id: 'tenant_active',
              tenant_name: 'Active tenant',
              lifecycle: { status: 'active' },
            }
          : shapedResponses[path];
      return Promise.resolve(
        new window.Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(document.getElementById('challenge-rows')!.textContent).toContain('hmac:tool');
    expect(document.getElementById('reconciliation-history-rows')!.textContent).toContain(
      'confirmed_executed',
    );
    expect(document.getElementById('compatibility-rows')!.textContent).toContain('2026-07');
    expect(document.querySelectorAll('#api-key-rows button')).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('#anchor-delivery-rows button')!.click();
    document.querySelector<HTMLButtonElement>('#delivery-rows button')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    document.querySelector<HTMLButtonElement>('#webhook-rows button')!.click();
    await acceptDialog();
    document.querySelector<HTMLButtonElement>('#api-key-rows button')!.click();
    await acceptDialog();
    document.querySelector<HTMLButtonElement>('#reconciliation-pending-rows button')!.click();
    await acceptDialog('ledger/browser-e2e');
    (document.getElementById('retention-confirm') as HTMLInputElement).checked = true;
    document.getElementById('retention-purge')!.click();
    await acceptDialog();

    expect(document.getElementById('retention-status')!.textContent).toBe('Purged 4 audit records');
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/v1/actions/idempotency/anchors/deliveries/anchor_exact/redrive',
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/v1/alert-webhooks/deliveries/delivery_exact/redrive',
        }),
        expect.objectContaining({ method: 'DELETE', path: '/v1/alert-webhooks/wh_exact' }),
        expect.objectContaining({ method: 'DELETE', path: '/v1/admin/api-keys/key_other' }),
        expect.objectContaining({
          method: 'POST',
          path: '/v1/actions/reconciliation/reservation_exact',
          body: {
            outcome: 'confirmed_executed',
            evidence_reference: 'ledger/browser-e2e',
          },
        }),
      ]),
    );
  });

  it('shows a one-time API key even when the inventory refresh fails', async () => {
    const window = dashboard('/dashboard/access');
    const document = window.document;
    let issued = false;
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.url;
      if (path === '/v1/admin/tenant/lifecycle')
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              tenant_id: 'tenant_active',
              tenant_name: 'Active tenant',
              lifecycle: { status: 'active' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      if (path === '/v1/admin/api-keys' && init?.method === 'POST') {
        expect(typeof init.body).toBe('string');
        expect(JSON.parse(init.body as string)).toEqual({ scopes: ['validate'] });
        issued = true;
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              key_id: 'new',
              api_key: 'test-one-time-secret',
              scopes: ['validate'],
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (path === '/v1/admin/api-keys' && issued)
        return Promise.resolve(
          new window.Response(JSON.stringify({ error: 'refresh_failed' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        );
      return Promise.resolve(
        new window.Response(
          JSON.stringify(
            path === '/v1/admin/api-keys'
              ? { api_keys: [] }
              : path === '/v1/plans'
                ? { plans: [] }
                : operationalResponses[path],
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('#scope-picker input')).some(
        (input) => input.checked,
      ),
    ).toBe(false);
    document.querySelector<HTMLInputElement>('#scope-picker input[value="validate"]')!.checked =
      true;
    (document.getElementById('api-key-confirm') as HTMLInputElement).checked = true;
    document.querySelector<HTMLButtonElement>('#api-key-form button[type="submit"]')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(document.getElementById('api-key-secret')!.hidden).toBe(false);
    expect(document.getElementById('api-key-status')!.textContent).toContain('copy the key now');
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('#scope-picker input')).some(
        (input) => input.checked,
      ),
    ).toBe(false);
    expect((document.getElementById('api-key-confirm') as HTMLInputElement).checked).toBe(false);
  });

  it('reports a committed schema mutation when only the supplemental inventory refresh fails', async () => {
    const window = dashboard('/dashboard/schemas');
    const document = window.document;
    let registered = false;
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.url;
      if (path === '/v1/admin/tenant/lifecycle')
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              tenant_id: 'tenant_active',
              tenant_name: 'Active tenant',
              lifecycle: { status: 'active' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      if (path === '/v1/schemas' && init?.method === 'POST') {
        registered = true;
        return Promise.resolve(
          new window.Response(JSON.stringify({ schema_id: 'schema-new' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (path === '/v1/inventory' && registered)
        return Promise.resolve(
          new window.Response(JSON.stringify({ error: 'inventory_unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        );
      return Promise.resolve(
        new window.Response(JSON.stringify(operationalResponses[path]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    document
      .getElementById('schema-register-form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(document.getElementById('schema-register-status')!.textContent).toContain(
      'Schema version registered',
    );
    expect(document.getElementById('schema-register-status')!.textContent).toContain(
      'supplemental inventory refresh pending',
    );
    expect(document.getElementById('schema-register-status')!.textContent).not.toContain(
      'Request failed',
    );
  });

  it('downloads value-free evaluation evidence and recovers the export button', async () => {
    const window = dashboard('/dashboard/intelligence');
    const document = window.document;
    let downloaded = '';
    Object.defineProperty(window.URL, 'createObjectURL', {
      value: () => 'blob:test-evaluation-export',
      configurable: true,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: () => undefined,
      configurable: true,
    });
    window.HTMLAnchorElement.prototype.click = function click() {
      downloaded = this.download;
    };
    let failExport = false;
    window.fetch = (input) => {
      const path = typeof input === 'string' ? input : input.url;
      if (path === '/v1/intelligence/evaluation-export' && failExport)
        return Promise.resolve(
          new window.Response(JSON.stringify({ error: 'export_unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        );
      return Promise.resolve(
        new window.Response(JSON.stringify(operationalResponses[path]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const button = document.getElementById('evaluation-export') as HTMLButtonElement;
    button.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(downloaded).toBe('akriven-value-free-evaluation.json');
    expect(button.disabled).toBe(false);
    expect(document.getElementById('status')!.textContent).toBe(
      'Value-free evaluation evidence downloaded',
    );

    failExport = true;
    button.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(button.disabled).toBe(false);
    expect(document.getElementById('status')!.textContent).toContain('export_unavailable');
  });

  it('shows a one-time webhook secret even when the inventory refresh fails', async () => {
    const window = dashboard('/dashboard/alerts');
    const document = window.document;
    let issued = false;
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.url;
      if (path === '/v1/admin/tenant/lifecycle')
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              tenant_id: 'tenant_active',
              tenant_name: 'Active tenant',
              lifecycle: { status: 'active' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      if (path === '/v1/alert-webhooks' && init?.method === 'POST') {
        issued = true;
        return Promise.resolve(
          new window.Response(
            JSON.stringify({
              webhook_id: 'wh_new',
              signing_secret: 'test-one-time-webhook-secret',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (path === '/v1/alert-webhooks' && issued)
        return Promise.resolve(
          new window.Response(JSON.stringify({ error: 'refresh_failed' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        );
      return Promise.resolve(
        new window.Response(
          JSON.stringify(path === '/v1/plans' ? { plans: [] } : operationalResponses[path]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    (document.getElementById('key') as HTMLInputElement).value = 'test-only-key';
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    (document.getElementById('webhook-label') as HTMLInputElement).value = 'On-call';
    (document.getElementById('webhook-endpoint') as HTMLInputElement).value =
      'https://alerts.example.test/hook';
    (document.getElementById('webhook-create-confirm') as HTMLInputElement).checked = true;
    document
      .querySelector<HTMLButtonElement>('#webhook-create-form button[type="submit"]')!
      .click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(document.getElementById('webhook-secret')!.hidden).toBe(false);
    expect(document.getElementById('webhook-create-status')!.textContent).toContain(
      'copy the secret now',
    );
  });
});
