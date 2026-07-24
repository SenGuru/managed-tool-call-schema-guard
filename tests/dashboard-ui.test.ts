/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- happy-dom intentionally exposes browser-native DOM methods across its Window type boundary. */
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { dashboardHtml } from '../packages/managed/src/dashboard-html.js';
import { dashboardScript } from '../packages/managed/src/dashboard-script.js';

const windows: Window[] = [];
const operationalResponses: Record<string, unknown> = {
  '/v1/usage': {
    usage: { validation_count: 3, repair_count: 1, rejection_count: 1 },
    monthly_limit: 100,
    plan_name: 'Private beta',
  },
  '/v1/audits/verify': { valid: true },
  '/v1/audits?limit=25': { audits: [] },
  '/v1/alerts': { alerts: [] },
  '/v1/intelligence': {},
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
  '/v1/actions/reconciliation/history': { history: [] },
  '/v1/actions/reconciliation/verify': { valid: true },
  '/v1/billing/statement': {},
  '/v1/admin/control-plane-integrity': { valid: true },
  '/v1/rulesets/latest': {},
  '/v1/admin/api-keys': { api_keys: [] },
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

    document.querySelector<HTMLElement>('[data-preset="reconcile"]')!.click();
    expect(window.location.pathname).toBe('/dashboard/workbench');
    expect(document.querySelector<HTMLSelectElement>('#operation')!.value).toBe('reconcile');
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

    locked = true;
    document.getElementById('load')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(document.getElementById('workspace')!.dataset.connected).toBe('false');
    expect(document.getElementById('connection-label')!.textContent).toBe('Access locked');
    expect(document.getElementById('status')!.textContent).toContain(
      'operational access is locked',
    );
    expect(document.getElementById('usage-total')!.textContent).toBe('—');
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
});
