import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAuthState,
  humanPrincipalId,
  humanRateLimitId,
  scopesForHumanRoles,
  verifyAuthState,
  WorkOSIdentityProvider,
  type HumanIdentity,
  type HumanIdentityProvider,
} from '../packages/managed/src/identity.js';
import { createManagedServer, validateManagedConfig } from '../packages/managed/src/server.js';

const secret = 'managed-identity-test-secret-that-is-at-least-32-characters';
const open: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const service of open.splice(0)) await service.close();
});

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-identity-')), 'managed.db');
}

class FakeIdentityProvider implements HumanIdentityProvider {
  fail = false;
  identity: HumanIdentity = {
    userId: 'user_test_identity',
    sessionId: 'session_test_identity',
    organizationId: 'org_test_identity',
    tenantId: 'identity',
    email: 'owner@example.test',
    roles: ['owner'],
    permissions: ['manage'],
    scopes: ['admin'],
    authenticationMethod: 'GoogleOAuth',
  };

  authorizationUrl(state: string): string {
    if (this.fail) throw new Error('provider unavailable');
    return `https://identity.example.test/authorize?state=${encodeURIComponent(state)}`;
  }

  exchangeCode(input: {
    code: string;
  }): Promise<{ identity: HumanIdentity; sealedSession: string }> {
    if (this.fail || input.code !== 'valid-code') return Promise.reject(new Error('invalid code'));
    return Promise.resolve({ identity: this.identity, sealedSession: 'sealed-session-value' });
  }

  authenticateSession(sealedSession: string): Promise<HumanIdentity | undefined> {
    if (this.fail) return Promise.reject(new Error('provider unavailable'));
    return Promise.resolve(sealedSession === 'sealed-session-value' ? this.identity : undefined);
  }

  refreshSession(
    sealedSession: string,
  ): Promise<{ identity: HumanIdentity; sealedSession: string } | undefined> {
    if (this.fail) return Promise.reject(new Error('provider unavailable'));
    return Promise.resolve(
      sealedSession === 'sealed-session-value'
        ? { identity: this.identity, sealedSession: 'sealed-session-refreshed' }
        : undefined,
    );
  }

  logoutUrl(sealedSession: string): Promise<string> {
    if (this.fail || !sealedSession) return Promise.reject(new Error('provider unavailable'));
    return Promise.resolve('https://identity.example.test/logout');
  }
}

async function runningIdentityService(provider = new FakeIdentityProvider()) {
  const service = createManagedServer(
    {
      databasePath: await database(),
      masterSecret: secret,
      externalUrl: 'https://guard.example.test',
    },
    { identityProvider: provider },
  );
  open.push(service);
  service.store.bootstrapTenant({
    id: 'identity',
    name: 'Identity tenant',
    plan: 'trial',
    apiKey: 'identity-admin-key',
  });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return { provider, base: `http://127.0.0.1:${address.port}` };
}

function cookieValue(header: string, name: string): string {
  const pair = header
    .split(/[;,]/u)
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!pair) throw new Error(`missing ${name} cookie`);
  return decodeURIComponent(pair.slice(name.length + 1));
}

async function authenticatedSession(base: string): Promise<string> {
  const login = await fetch(`${base}/v1/auth/login?return_to=/dashboard/settings`, {
    redirect: 'manual',
  });
  expect(login.status).toBe(302);
  const stateCookie = login.headers.get('set-cookie');
  if (!stateCookie) throw new Error('missing state cookie');
  const state = cookieValue(stateCookie, '__Host-akriven_auth_state');
  const callback = await fetch(
    `${base}/v1/auth/callback?code=valid-code&state=${encodeURIComponent(state)}`,
    {
      redirect: 'manual',
      headers: { cookie: `__Host-akriven_auth_state=${encodeURIComponent(state)}` },
    },
  );
  expect(callback.status).toBe(303);
  expect(callback.headers.get('location')).toBe('/dashboard/settings');
  const sessionHeaders = callback.headers.get('set-cookie');
  if (!sessionHeaders) throw new Error('missing session cookie');
  expect(sessionHeaders).toContain('HttpOnly');
  expect(sessionHeaders).toContain('Secure');
  expect(sessionHeaders).toContain('SameSite=Lax');
  return cookieValue(sessionHeaders, '__Host-akriven_session');
}

describe('managed human identity boundary', () => {
  it('signs and bounds callback state without exposing identity values', () => {
    const state = createAuthState(secret, '/dashboard/alerts', 1_000);
    expect(verifyAuthState(secret, state, 1_001)?.returnTo).toBe('/dashboard/alerts');
    expect(verifyAuthState(secret, `${state}x`, 1_001)).toBeUndefined();
    expect(verifyAuthState(secret, state, 1_000 + 10 * 60_000 + 1)).toBeUndefined();
    expect(() => createAuthState(secret, '//attacker.example')).toThrow();
    const principal = humanPrincipalId(secret, 'user_raw', 'session_raw');
    expect(principal).toMatch(/^human_[A-Za-z0-9_-]+$/u);
    expect(principal).not.toContain('user_raw');
    expect(principal).not.toContain('session_raw');
    const rateLimitId = humanRateLimitId(secret, 'user_raw');
    expect(rateLimitId).toMatch(/^human_rate_[A-Za-z0-9_-]+$/u);
    expect(rateLimitId).not.toContain('user_raw');
    expect(humanRateLimitId(secret, 'user_raw')).toBe(rateLimitId);
    expect(humanRateLimitId(secret, 'another_user')).not.toBe(rateLimitId);
  });

  it('maps roles to least-privilege managed scopes', () => {
    expect(scopesForHumanRoles(['owner'])).toEqual(['admin']);
    expect(scopesForHumanRoles(['billing'])).toEqual(['read:billing', 'read:usage']);
    expect(scopesForHumanRoles(['auditor'])).not.toContain('admin');
    expect(scopesForHumanRoles(['operator'])).not.toContain('read:billing');
  });

  it('completes callback, verifies tenant binding, and authorizes a browser session', async () => {
    const { base } = await runningIdentityService();
    const session = await authenticatedSession(base);
    const sessionResponse = await fetch(`${base}/v1/auth/session`, {
      headers: { cookie: `__Host-akriven_session=${encodeURIComponent(session)}` },
    });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toEqual({
      authenticated: true,
      tenant_id: 'identity',
      tenant_name: 'Identity tenant',
      email: 'owner@example.test',
      roles: ['owner'],
      permissions: ['manage'],
      authentication_method: 'GoogleOAuth',
    });
    const lifecycle = await fetch(`${base}/v1/admin/tenant/lifecycle`, {
      headers: { cookie: `__Host-akriven_session=${encodeURIComponent(session)}` },
    });
    expect(lifecycle.status).toBe(200);
    expect(await lifecycle.json()).toMatchObject({
      tenant_id: 'identity',
      tenant_name: 'Identity tenant',
      lifecycle: { status: 'active' },
    });
  });

  it('rejects callback CSRF, cross-origin mutation, invalid sessions, and tenant substitution', async () => {
    const { base, provider } = await runningIdentityService();
    const badCallback = await fetch(`${base}/v1/auth/callback?code=valid-code&state=bad`, {
      redirect: 'manual',
      headers: { cookie: '__Host-akriven_auth_state=other' },
    });
    expect(badCallback.status).toBe(400);

    const session = await authenticatedSession(base);
    const crossOrigin = await fetch(`${base}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `__Host-akriven_session=${encodeURIComponent(session)}`,
        origin: 'https://attacker.example',
      },
    });
    expect(crossOrigin.status).toBe(403);

    const invalid = await fetch(`${base}/v1/auth/session`, {
      headers: { cookie: '__Host-akriven_session=invalid' },
    });
    expect(invalid.status).toBe(401);

    provider.identity = { ...provider.identity, tenantId: 'other-tenant' };
    const substituted = await fetch(`${base}/v1/auth/session`, {
      headers: { cookie: `__Host-akriven_session=${encodeURIComponent(session)}` },
    });
    expect(substituted.status).toBe(404);
  });

  it('fails closed during provider outages and supports refresh and logout', async () => {
    const { base, provider } = await runningIdentityService();
    const session = await authenticatedSession(base);
    const refresh = await fetch(`${base}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `__Host-akriven_session=${encodeURIComponent(session)}`,
        origin: 'https://guard.example.test',
      },
    });
    expect(refresh.status).toBe(200);
    expect(refresh.headers.get('set-cookie')).toContain('__Host-akriven_session=');

    const logout = await fetch(`${base}/v1/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `__Host-akriven_session=${encodeURIComponent(session)}`,
        origin: 'https://guard.example.test',
      },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({
      logout_url: 'https://identity.example.test/logout',
      provider_logout: 'redirect',
    });
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

    provider.fail = true;
    const degradedLogout = await fetch(`${base}/v1/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `__Host-akriven_session=${encodeURIComponent(session)}`,
        origin: 'https://guard.example.test',
      },
    });
    expect(degradedLogout.status).toBe(200);
    expect(await degradedLogout.json()).toEqual({
      logout_url: '/',
      provider_logout: 'unavailable',
    });
    expect(degradedLogout.headers.get('set-cookie')).toContain('Max-Age=0');

    const outage = await fetch(`${base}/v1/auth/session`, {
      headers: { cookie: `__Host-akriven_session=${encodeURIComponent(session)}` },
    });
    expect(outage.status).toBe(503);
  });

  it('advertises human sign-in only when the identity boundary is configured', async () => {
    const { base } = await runningIdentityService();
    const dashboard = await (await fetch(`${base}/dashboard/overview`)).text();
    expect(dashboard).toContain('id="sign-in"');
    expect(dashboard).not.toContain(
      'id="sign-in" href="/v1/auth/login?return_to=/dashboard/overview" hidden',
    );
  });
});

describe('WorkOS adapter contract', () => {
  function fakeWorkOS(result: {
    authenticated: boolean;
    emailVerified?: boolean;
    organizationId?: string;
    roles?: string[];
    impersonator?: unknown;
  }) {
    const sealedResult = {
      authenticated: result.authenticated,
      sessionId: 'session_workos_test',
      organizationId: result.organizationId,
      roles: result.roles,
      permissions: ['permission.test'],
      impersonator: result.impersonator,
      user: {
        id: 'user_workos_test',
        email: 'person@example.test',
        emailVerified: result.emailVerified ?? true,
      },
    };
    return {
      userManagement: {
        getAuthorizationUrl: ({ state }: { state: string }) =>
          `https://identity.example.test/authorize?state=${state}`,
        authenticateWithCode: () =>
          Promise.resolve({ sealedSession: 'sealed-workos-session', impersonator: undefined }),
        loadSealedSession: () => ({
          authenticate: () => Promise.resolve(sealedResult),
          refresh: () =>
            Promise.resolve({ ...sealedResult, sealedSession: 'sealed-workos-session-refreshed' }),
          getLogoutUrl: () => Promise.resolve('https://identity.example.test/logout'),
        }),
      },
    };
  }

  function provider(result: Parameters<typeof fakeWorkOS>[0]): WorkOSIdentityProvider {
    return new WorkOSIdentityProvider({
      apiKey: 'sk_test_identity_key_123456789',
      clientId: 'client_test_identity_12345678',
      cookiePassword: 'cookie-password-that-is-longer-than-thirty-two-characters',
      redirectUri: 'https://guard.example.test/v1/auth/callback',
      logoutReturnUrl: 'https://guard.example.test/',
      organizationTenantMap: { org_test_identity_12345678: 'identity' },
      workos: fakeWorkOS(result) as never,
    });
  }

  it('normalizes verified organization sessions and refreshes sealed state', async () => {
    const adapter = provider({
      authenticated: true,
      organizationId: 'org_test_identity_12345678',
      roles: ['operator', 'unknown'],
    });
    const exchanged = await adapter.exchangeCode({ code: 'code-value' });
    expect(exchanged.identity.tenantId).toBe('identity');
    expect(exchanged.identity.roles).toEqual(['operator']);
    expect(exchanged.identity.scopes).toContain('validate');
    expect(await adapter.refreshSession(exchanged.sealedSession)).toBeDefined();
    expect(await adapter.logoutUrl(exchanged.sealedSession)).toBe(
      'https://identity.example.test/logout',
    );
  });

  it.each([
    {
      name: 'unverified email',
      result: {
        authenticated: true,
        emailVerified: false,
        organizationId: 'org_test_identity_12345678',
        roles: ['owner'],
      },
    },
    {
      name: 'unmapped organization',
      result: {
        authenticated: true,
        organizationId: 'org_unmapped_identity_12345678',
        roles: ['owner'],
      },
    },
    {
      name: 'unsupported role',
      result: {
        authenticated: true,
        organizationId: 'org_test_identity_12345678',
        roles: ['unknown'],
      },
    },
    {
      name: 'impersonation',
      result: {
        authenticated: true,
        organizationId: 'org_test_identity_12345678',
        roles: ['owner'],
        impersonator: { email: 'support@example.test' },
      },
    },
  ])('rejects $name sessions', async ({ result }) => {
    await expect(provider(result).authenticateSession('sealed-session')).resolves.toBeUndefined();
  });
});

describe('WorkOS configuration gate', () => {
  it('rejects partial configuration before startup', async () => {
    const databasePath = await database();
    expect(() =>
      validateManagedConfig({
        databasePath,
        masterSecret: secret,
        workosClientId: 'client_test_identity_12345678',
      }),
    ).toThrow(/requires API key/u);
  });
});
