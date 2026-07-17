export type PlanId = 'trial' | 'team';
export type Scope = 'validate' | 'read:audit' | 'write:schema' | 'read:intelligence' | 'admin';

export interface Principal {
  tenantId: string;
  tenantName: string;
  keyId: string;
  scopes: Scope[];
  plan: PlanId;
  monthlyLimit: number;
  retentionDays: number;
  policy: GuardPolicy;
}

export interface ManagedConfig {
  databasePath: string;
  masterSecret: string;
  host?: string;
  port?: number;
  rateLimitPerMinute?: number;
  aggregateTenantThreshold?: number;
  alertFile?: string;
  requestTimeoutMs?: number;
}

export interface SignedRuleSet {
  version: string;
  issued_at: string;
  expires_at: string;
  rules: { id: string; enabled_by_default: boolean; description: string }[];
  key_id: string;
  public_key: string;
  signature: string;
}
import type { GuardPolicy } from '@schema-guard/core';
