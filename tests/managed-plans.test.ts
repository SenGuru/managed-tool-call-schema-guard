import { describe, expect, it } from 'vitest';
import {
  effectivePlanEntitlements,
  managedPlan,
  planCatalog,
} from '../packages/managed/src/plans.js';

describe('managed private-beta plan catalog', () => {
  it('keeps evaluation non-purchasable and the design-partner offer invite-only', () => {
    expect(managedPlan('trial')).toMatchObject({
      availability: 'internal_only',
      payment_collection: 'disabled',
      price: { term: 'not_for_sale', amount_minor: 0 },
      entitlements: { validations_per_month: 1_000, retention_days: 7 },
    });
    expect(managedPlan('team')).toMatchObject({
      display_name: 'Private-beta design partner',
      availability: 'invite_only',
      payment_collection: 'manual_provider_setup_required',
      price: {
        amount_minor: 225_000,
        monthly_equivalent_minor: 75_000,
        term: '90_days_prepaid',
      },
      entitlements: {
        validations_per_month: 250_000,
        retention_days: 30,
        managed_workflows: 'full',
        overage: 'disabled',
      },
    });
  });

  it('returns immutable catalog records and exposes a configured retention override', () => {
    expect(planCatalog()).toHaveLength(2);
    expect(Object.isFrozen(managedPlan('team'))).toBe(true);
    expect(effectivePlanEntitlements('team', 45)).toMatchObject({
      validations_per_month: 250_000,
      retention_days: 45,
    });
    expect(managedPlan('team').entitlements.retention_days).toBe(30);
  });
});
