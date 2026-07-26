import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WorkOS } from '@workos-inc/node';

import type { Scope } from './types.js';

export const HUMAN_ROLES = ['owner', 'admin', 'operator', 'auditor', 'billing'] as const;
export type HumanRole = (typeof HUMAN_ROLES)[number];

const ROLE_SCOPES: Readonly<Record<HumanRole, readonly Scope[]>> = {
  owner: ['admin'],
  admin: ['admin'],
  operator: [
    'validate',
    'compile',
    'evaluate:action',
    'approve:action',
    'reconcile:action',
    'manage:webhooks',
    'promote:schema',
    'read:audit',
    'read:alerts',
    'read:environment',
    'read:intelligence',
    'read:ruleset',
    'read:usage',
    'write:schema',
  ],
  auditor: [
    'read:audit',
    'read:alerts',
    'read:billing',
    'read:environment',
    'read:intelligence',
    'read:ruleset',
    'read:usage',
  ],
  billing: ['read:billing', 'read:usage'],
};

export interface HumanIdentity {
  userId: string;
  sessionId: string;
  organizationId: string;
  tenantId: string;
  email: string;
  roles: HumanRole[];
  permissions: string[];
  scopes: Scope[];
  authenticationMethod?: string;
}

export interface HumanIdentitySession {
  identity: HumanIdentity;
  sealedSession: string;
}

export interface HumanIdentityProvider {
  authorizationUrl(state: string): string;
  exchangeCode(input: {
    code: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<HumanIdentitySession>;
  authenticateSession(sealedSession: string): Promise<HumanIdentity | undefined>;
  refreshSession(sealedSession: string): Promise<HumanIdentitySession | undefined>;
  logoutUrl(sealedSession: string): Promise<string>;
}

interface WorkOSSessionSuccess {
  authenticated: true;
  sessionId: string;
  organizationId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  authenticationMethod?: string;
  impersonator?: unknown;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
  };
}

interface WorkOSSession {
  authenticate(): Promise<WorkOSSessionSuccess | { authenticated: false; reason: string }>;
  refresh(): Promise<
    | (Omit<WorkOSSessionSuccess, 'authenticationMethod'> & {
        sealedSession?: string;
        authenticationMethod?: string;
      })
    | { authenticated: false; reason: string }
  >;
  getLogoutUrl(input: { returnTo: string }): Promise<string>;
}

interface WorkOSClient {
  userManagement: {
    getAuthorizationUrl(input: {
      provider: 'authkit';
      clientId: string;
      redirectUri: string;
      state: string;
      maxAge: number;
    }): string;
    authenticateWithCode(input: {
      code: string;
      clientId: string;
      ipAddress?: string;
      userAgent?: string;
      session: { sealSession: true; cookiePassword: string };
    }): Promise<{ sealedSession?: string; impersonator?: unknown }>;
    loadSealedSession(input: { sessionData: string; cookiePassword: string }): WorkOSSession;
  };
}

export interface WorkOSIdentityProviderConfig {
  apiKey: string;
  clientId: string;
  cookiePassword: string;
  redirectUri: string;
  logoutReturnUrl: string;
  organizationTenantMap: Readonly<Record<string, string>>;
  workos?: WorkOSClient;
}

function exactIdentifier(value: string, prefix: string, label: string): void {
  if (!value.startsWith(prefix) || !/^[A-Za-z0-9_-]{8,128}$/u.test(value.slice(prefix.length)))
    throw new TypeError(`${label} is invalid`);
}

function httpsUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new TypeError(`${label} must be an absolute HTTPS URL without credentials`);
}

function bounded(value: string, label: string, maximum = 4096): void {
  if (value.length === 0 || value.length > maximum || value.includes('\0'))
    throw new TypeError(`${label} is invalid`);
}

function mappedRoles(values: readonly string[]): HumanRole[] {
  return [
    ...new Set(values.filter((role): role is HumanRole => HUMAN_ROLES.includes(role as HumanRole))),
  ];
}

export function scopesForHumanRoles(roles: readonly HumanRole[]): Scope[] {
  const scopes = new Set<Scope>();
  for (const role of roles) for (const scope of ROLE_SCOPES[role]) scopes.add(scope);
  if (scopes.has('admin')) return ['admin'];
  return [...scopes];
}

export class WorkOSIdentityProvider implements HumanIdentityProvider {
  private readonly workos: WorkOSClient;

  constructor(private readonly config: WorkOSIdentityProviderConfig) {
    if (!/^sk_[A-Za-z0-9_-]{16,256}$/u.test(config.apiKey))
      throw new TypeError('WorkOS API key is invalid');
    exactIdentifier(config.clientId, 'client_', 'WorkOS client ID');
    if (config.cookiePassword.length < 32 || config.cookiePassword.length > 256)
      throw new TypeError('WorkOS cookie password must contain 32 through 256 characters');
    httpsUrl(config.redirectUri, 'WorkOS redirect URI');
    httpsUrl(config.logoutReturnUrl, 'WorkOS logout return URL');
    const entries = Object.entries(config.organizationTenantMap);
    if (entries.length === 0) throw new TypeError('WorkOS organization-to-tenant mapping is empty');
    for (const [organizationId, tenantId] of entries) {
      exactIdentifier(organizationId, 'org_', 'WorkOS organization ID');
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(tenantId))
        throw new TypeError('WorkOS organization tenant ID is invalid');
    }
    this.workos =
      config.workos ??
      (new WorkOS({
        apiKey: config.apiKey,
        clientId: config.clientId,
        timeout: 5_000,
        maxRetries: 2,
      }) as unknown as WorkOSClient);
  }

  authorizationUrl(state: string): string {
    bounded(state, 'authorization state', 2048);
    return this.workos.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      state,
      maxAge: 43_200,
    });
  }

  async exchangeCode(input: {
    code: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<HumanIdentitySession> {
    bounded(input.code, 'authorization code');
    if (input.ipAddress !== undefined) bounded(input.ipAddress, 'client IP address', 128);
    if (input.userAgent !== undefined) bounded(input.userAgent, 'user agent', 512);
    const response = await this.workos.userManagement.authenticateWithCode({
      code: input.code,
      clientId: this.config.clientId,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      session: { sealSession: true, cookiePassword: this.config.cookiePassword },
    });
    if (response.impersonator || !response.sealedSession)
      throw new TypeError('WorkOS authentication did not produce an eligible sealed session');
    const identity = await this.authenticateSession(response.sealedSession);
    if (!identity) throw new TypeError('WorkOS sealed session failed immediate verification');
    return { identity, sealedSession: response.sealedSession };
  }

  async authenticateSession(sealedSession: string): Promise<HumanIdentity | undefined> {
    bounded(sealedSession, 'sealed session', 16_384);
    const result = await this.workos.userManagement
      .loadSealedSession({
        sessionData: sealedSession,
        cookiePassword: this.config.cookiePassword,
      })
      .authenticate();
    if (
      !result.authenticated ||
      result.impersonator ||
      !result.user.emailVerified ||
      !result.organizationId
    )
      return undefined;
    const tenantId = this.config.organizationTenantMap[result.organizationId];
    if (!tenantId) return undefined;
    const roles = mappedRoles(result.roles ?? (result.role ? [result.role] : []));
    const scopes = scopesForHumanRoles(roles);
    if (roles.length === 0 || scopes.length === 0) return undefined;
    return {
      userId: result.user.id,
      sessionId: result.sessionId,
      organizationId: result.organizationId,
      tenantId,
      email: result.user.email,
      roles,
      permissions: [...(result.permissions ?? [])],
      scopes,
      ...(result.authenticationMethod ? { authenticationMethod: result.authenticationMethod } : {}),
    };
  }

  async refreshSession(sealedSession: string): Promise<HumanIdentitySession | undefined> {
    bounded(sealedSession, 'sealed session', 16_384);
    const refreshed = await this.workos.userManagement
      .loadSealedSession({
        sessionData: sealedSession,
        cookiePassword: this.config.cookiePassword,
      })
      .refresh();
    if (!refreshed.authenticated || !refreshed.sealedSession) return undefined;
    const identity = await this.authenticateSession(refreshed.sealedSession);
    return identity ? { identity, sealedSession: refreshed.sealedSession } : undefined;
  }

  async logoutUrl(sealedSession: string): Promise<string> {
    bounded(sealedSession, 'sealed session', 16_384);
    const url = await this.workos.userManagement
      .loadSealedSession({
        sessionData: sealedSession,
        cookiePassword: this.config.cookiePassword,
      })
      .getLogoutUrl({ returnTo: this.config.logoutReturnUrl });
    httpsUrl(url, 'WorkOS logout URL');
    return url;
  }
}

interface AuthStatePayload {
  nonce: string;
  returnTo: string;
  expiresAt: number;
}

function authStateMac(secret: string, encoded: string): Buffer {
  return createHmac('sha256', secret)
    .update('managed-human-auth-state-v1')
    .update('\0')
    .update(encoded)
    .digest();
}

export function createAuthState(
  secret: string,
  returnTo = '/dashboard/overview',
  now = Date.now(),
): string {
  if (!/^\/dashboard(?:\/[A-Za-z0-9_-]+)?$/u.test(returnTo))
    throw new TypeError('authentication return path is invalid');
  const payload: AuthStatePayload = {
    nonce: randomBytes(24).toString('base64url'),
    returnTo,
    expiresAt: now + 10 * 60_000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${authStateMac(secret, encoded).toString('base64url')}`;
}

export function verifyAuthState(
  secret: string,
  value: string,
  now = Date.now(),
): AuthStatePayload | undefined {
  const [encoded, suppliedMac, extra] = value.split('.');
  if (!encoded || !suppliedMac || extra) return undefined;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedMac, 'base64url');
  } catch {
    return undefined;
  }
  const expected = authStateMac(secret, encoded);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as AuthStatePayload;
    if (
      !/^[A-Za-z0-9_-]{32,64}$/u.test(payload.nonce) ||
      !/^\/dashboard(?:\/[A-Za-z0-9_-]+)?$/u.test(payload.returnTo) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt < now ||
      payload.expiresAt > now + 10 * 60_000
    )
      return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export function humanPrincipalId(secret: string, userId: string, sessionId: string): string {
  bounded(userId, 'human user ID', 256);
  bounded(sessionId, 'human session ID', 256);
  return `human_${createHmac('sha256', secret)
    .update('managed-human-principal-v1')
    .update('\0')
    .update(userId)
    .update('\0')
    .update(sessionId)
    .digest('base64url')}`;
}

export function humanRateLimitId(secret: string, userId: string): string {
  bounded(userId, 'human user ID', 256);
  return `human_rate_${createHmac('sha256', secret)
    .update('managed-human-rate-limit-v1')
    .update('\0')
    .update(userId)
    .digest('base64url')}`;
}
