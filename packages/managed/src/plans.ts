import type { PlanId } from './types.js';

export interface ManagedPlan {
  id: PlanId;
  display_name: string;
  audience: string;
  availability: 'internal_only' | 'invite_only';
  price: {
    amount_minor: number;
    currency: 'USD';
    term: 'not_for_sale' | '90_days_prepaid';
    monthly_equivalent_minor: number;
  };
  entitlements: {
    validations_per_month: number;
    retention_days: number;
    managed_workflows: 'evaluation' | 'full';
    overage: 'disabled';
  };
  support: string;
  payment_collection: 'disabled' | 'manual_provider_setup_required';
}

export const MANAGED_PLANS: Readonly<Record<PlanId, ManagedPlan>> = Object.freeze({
  trial: Object.freeze({
    id: 'trial',
    display_name: 'Internal evaluation',
    audience: 'Akriven-operated evaluation tenants; not a customer production plan',
    availability: 'internal_only',
    price: Object.freeze({
      amount_minor: 0,
      currency: 'USD',
      term: 'not_for_sale',
      monthly_equivalent_minor: 0,
    }),
    entitlements: Object.freeze({
      validations_per_month: 1_000,
      retention_days: 7,
      managed_workflows: 'evaluation',
      overage: 'disabled',
    }),
    support: 'No service commitment',
    payment_collection: 'disabled',
  }),
  team: Object.freeze({
    id: 'team',
    display_name: 'Private-beta design partner',
    audience: 'One invited team and one reviewed production-like workflow',
    availability: 'invite_only',
    price: Object.freeze({
      amount_minor: 225_000,
      currency: 'USD',
      term: '90_days_prepaid',
      monthly_equivalent_minor: 75_000,
    }),
    entitlements: Object.freeze({
      validations_per_month: 250_000,
      retention_days: 30,
      managed_workflows: 'full',
      overage: 'disabled',
    }),
    support: 'Founder-led onboarding and weekly evidence review',
    payment_collection: 'manual_provider_setup_required',
  }),
});

export function managedPlan(plan: PlanId): ManagedPlan {
  return MANAGED_PLANS[plan];
}

export function effectivePlanEntitlements(
  plan: PlanId,
  configuredRetentionDays?: number,
): ManagedPlan['entitlements'] {
  return {
    ...MANAGED_PLANS[plan].entitlements,
    ...(configuredRetentionDays === undefined ? {} : { retention_days: configuredRetentionDays }),
  };
}

export function planCatalog(): ManagedPlan[] {
  return (Object.keys(MANAGED_PLANS) as PlanId[]).map((plan) => MANAGED_PLANS[plan]);
}
