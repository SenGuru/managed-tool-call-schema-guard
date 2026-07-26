#!/usr/bin/env node
import { chmod, lstat, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  PostgresControlState,
  createSharedStatePool,
  deleteSharedTenantData,
  exportSharedTenantData,
  type SharedStatePool,
  type SharedTenantLifecycleStatus,
} from '@schema-guard/shared-state';
import { canonicalJson, sha256 } from '@schema-guard/core';
import { constantTimeEqual, hmac } from './crypto.js';
import { environmentValue } from './environment.js';
import { managedPlan } from './plans.js';
import { ManagedStore } from './store.js';
import type { PlanId, TenantLifecycleStatus } from './types.js';

type JsonRecord = Record<string, unknown>;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function tenantId(): string {
  const value = requiredOption('tenant-id');
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(value)) throw new Error('--tenant-id is invalid');
  return value;
}

async function secureJsonFile(path: string): Promise<JsonRecord> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error('confirmation file must not be a symbolic link');
  if (!metadata.isFile() || metadata.size > 64 * 1024)
    throw new Error('confirmation file must be a regular JSON file no larger than 64 KiB');
  if ((metadata.mode & 0o077) !== 0)
    throw new Error('confirmation file must not be readable or writable by group or others');
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('confirmation file must contain a JSON object');
  return value as JsonRecord;
}

async function assertSecureReceiptParent(path: string): Promise<void> {
  const metadata = await stat(dirname(path));
  if (!metadata.isDirectory()) throw new Error('receipt output parent must be a directory');
  if ((metadata.mode & 0o077) !== 0)
    throw new Error('receipt output parent must not be accessible by group or others');
}

function lifecycleStatus(): TenantLifecycleStatus {
  const status = requiredOption('status');
  if (!['active', 'suspended', 'canceled', 'deletion_pending'].includes(status))
    throw new Error('--status must be active, suspended, canceled, or deletion_pending');
  return status as TenantLifecycleStatus;
}

function reasonCode(): string | null {
  const reason = option('reason-code');
  if (reason === undefined) return null;
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/u.test(reason)) throw new Error('--reason-code is invalid');
  return reason;
}

function entitlementPlan(): PlanId {
  const plan = requiredOption('plan');
  if (plan !== 'trial' && plan !== 'team') throw new Error('--plan must be trial or team');
  return plan;
}

function boundedConfirmationText(
  confirmation: JsonRecord,
  name: string,
  maximumLength = 256,
): string {
  const value = confirmation[name];
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    throw new Error(`confirmation ${name} is invalid`);
  return value;
}

function manualEntitlementReason(plan: PlanId, confirmation: JsonRecord): string {
  const reason = boundedConfirmationText(confirmation, 'reason_code', 64);
  const allowed =
    plan === 'team'
      ? ['manual_invoice_settled']
      : ['manual_cancelled', 'manual_expired', 'manual_correction'];
  if (!allowed.includes(reason))
    throw new Error(`confirmation reason_code is invalid for the ${plan} plan`);
  return reason;
}

function assertAutomatedBillingDisabled(): void {
  const indicators = [
    'SCHEMA_GUARD_STRIPE_MODE',
    'SCHEMA_GUARD_STRIPE_SECRET_KEY',
    'SCHEMA_GUARD_STRIPE_SECRET_KEY_FILE',
    'SCHEMA_GUARD_STRIPE_WEBHOOK_SECRET',
    'SCHEMA_GUARD_STRIPE_WEBHOOK_SECRET_FILE',
    'SCHEMA_GUARD_STRIPE_TEAM_PRICE_ID',
    'SCHEMA_GUARD_STRIPE_CHECKOUT_SUCCESS_URL',
    'SCHEMA_GUARD_STRIPE_CHECKOUT_CANCEL_URL',
    'SCHEMA_GUARD_STRIPE_PORTAL_RETURN_URL',
  ];
  if (indicators.some((name) => (process.env[name] ?? '').trim() !== ''))
    throw new Error('manual entitlement refuses to run while Stripe configuration is present');
}

function entitlementReceipt(
  masterSecret: string,
  input: {
    status: 'pending' | 'applied' | 'rolled_back';
    tenantId: string;
    previousPlan: PlanId;
    targetPlan: PlanId;
    previousMonthlyLimit: number;
    previousRetentionDays: number;
    targetMonthlyLimit: number;
    targetRetentionDays: number;
    reasonCode: string;
    evidenceReference: string;
    operatorId: string;
    recordedAt: string;
    changed?: boolean;
    failureCode?: string;
    recovered?: boolean;
  },
): JsonRecord {
  const unsigned: JsonRecord = {
    receipt_version: '1',
    status: input.status,
    tenant_ref: hmac(masterSecret, 'managed-manual-billing-tenant-reference-v1', input.tenantId),
    previous_plan: input.previousPlan,
    target_plan: input.targetPlan,
    previous_entitlement: {
      validations_per_month: input.previousMonthlyLimit,
      retention_days: input.previousRetentionDays,
    },
    target_entitlement: {
      validations_per_month: input.targetMonthlyLimit,
      retention_days: input.targetRetentionDays,
    },
    reason_code: input.reasonCode,
    evidence_reference_hash: hmac(
      masterSecret,
      'managed-manual-billing-evidence-reference-v1',
      input.evidenceReference,
    ),
    operator_hash: hmac(
      masterSecret,
      'managed-manual-billing-operator-reference-v1',
      input.operatorId,
    ),
    recorded_at: input.recordedAt,
    automated_charging: 'disabled',
    ...(input.changed === undefined ? {} : { changed: input.changed }),
    ...(input.failureCode === undefined ? {} : { failure_code: input.failureCode }),
    ...(input.recovered === undefined ? {} : { recovered: input.recovered }),
  };
  return {
    ...unsigned,
    receipt_hmac: hmac(masterSecret, 'managed-manual-billing-receipt-v1', unsigned),
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (
    !['inspect', 'transition', 'entitlement', 'entitlement-reconcile', 'export', 'delete'].includes(
      command ?? '',
    )
  )
    throw new Error(
      'usage: tenant-operator inspect|transition|entitlement|entitlement-reconcile|export|delete --tenant-id ID [options]',
    );
  const databasePath = option('database') ?? process.env.SCHEMA_GUARD_DATABASE;
  const masterSecret = environmentValue('SCHEMA_GUARD_MASTER_SECRET');
  if (!databasePath || !masterSecret || masterSecret.length < 32)
    throw new Error(
      '--database/SCHEMA_GUARD_DATABASE and a 32+ character SCHEMA_GUARD_MASTER_SECRET are required',
    );
  const id = tenantId();
  const sharedUrl = environmentValue('SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL');
  const store = new ManagedStore({ databasePath, masterSecret });
  let pool: SharedStatePool | undefined;
  let control: PostgresControlState | undefined;
  try {
    if (sharedUrl) {
      pool = createSharedStatePool(sharedUrl);
      control = new PostgresControlState(sharedUrl, masterSecret, pool);
      await control.migrate();
    }
    if (command === 'inspect') {
      const local = store.operatorTenantLifecycle(id);
      const shared = control ? await control.tenantLifecycle(id) : undefined;
      const localEntitlement = store.operatorTenantEntitlement(id);
      const sharedEntitlement = control ? await control.tenantEntitlement(id) : undefined;
      console.log(
        JSON.stringify(
          {
            tenant_id: id,
            local,
            entitlement: {
              local: localEntitlement,
              ...(sharedEntitlement
                ? {
                    shared: sharedEntitlement,
                    synchronized:
                      sharedEntitlement.plan === localEntitlement.plan &&
                      sharedEntitlement.monthly_limit === localEntitlement.monthlyLimit &&
                      sharedEntitlement.retention_days === localEntitlement.retentionDays,
                  }
                : {}),
            },
            ...(shared ? { shared, synchronized: shared.status === local.status } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }
    if (option('service-state') !== 'stopped')
      throw new Error('--service-state stopped is required for offline mutations');
    if (command === 'entitlement' || command === 'entitlement-reconcile') {
      assertAutomatedBillingDisabled();
      const plan = entitlementPlan();
      const confirmation = await secureJsonFile(requiredOption('confirmation-file'));
      const evidenceReference = boundedConfirmationText(confirmation, 'evidence_reference');
      const operatorId = boundedConfirmationText(confirmation, 'operator_id');
      const reason = manualEntitlementReason(plan, confirmation);
      if (
        confirmation.tenant_id !== id ||
        confirmation.billing_variant !== 'manual' ||
        confirmation.target_plan !== plan ||
        confirmation.automated_charging_disabled !== true ||
        confirmation.confirm !== `set tenant ${id} plan ${plan}`
      )
        throw new Error('confirmation file does not exactly authorize this manual entitlement');
      const receiptOutput = requiredOption('receipt-output');
      await assertSecureReceiptParent(receiptOutput);
      const target = {
        plan,
        monthlyLimit: managedPlan(plan).entitlements.validations_per_month,
        retentionDays: managedPlan(plan).entitlements.retention_days,
      };
      if (command === 'entitlement-reconcile') {
        const pending = await secureJsonFile(receiptOutput);
        const receiptHmac = pending.receipt_hmac;
        const unsigned = Object.fromEntries(
          Object.entries(pending).filter(([name]) => name !== 'receipt_hmac'),
        );
        if (
          typeof receiptHmac !== 'string' ||
          !constantTimeEqual(
            receiptHmac,
            hmac(masterSecret, 'managed-manual-billing-receipt-v1', unsigned),
          )
        )
          throw new Error('pending entitlement receipt integrity verification failed');
        const previousEntitlement = pending.previous_entitlement;
        const targetEntitlement = pending.target_entitlement;
        if (
          !previousEntitlement ||
          typeof previousEntitlement !== 'object' ||
          Array.isArray(previousEntitlement) ||
          !targetEntitlement ||
          typeof targetEntitlement !== 'object' ||
          Array.isArray(targetEntitlement)
        )
          throw new Error('pending entitlement receipt is malformed');
        const previous = previousEntitlement as JsonRecord;
        const expectedTarget = targetEntitlement as JsonRecord;
        const previousMonthlyLimit = previous.validations_per_month;
        const previousRetentionDays = previous.retention_days;
        const recordedAt = pending.recorded_at;
        if (
          pending.receipt_version !== '1' ||
          pending.status !== 'pending' ||
          pending.tenant_ref !==
            hmac(masterSecret, 'managed-manual-billing-tenant-reference-v1', id) ||
          pending.target_plan !== plan ||
          pending.reason_code !== reason ||
          pending.evidence_reference_hash !==
            hmac(masterSecret, 'managed-manual-billing-evidence-reference-v1', evidenceReference) ||
          pending.operator_hash !==
            hmac(masterSecret, 'managed-manual-billing-operator-reference-v1', operatorId) ||
          pending.automated_charging !== 'disabled' ||
          expectedTarget.validations_per_month !== target.monthlyLimit ||
          expectedTarget.retention_days !== target.retentionDays ||
          (pending.previous_plan !== 'trial' && pending.previous_plan !== 'team') ||
          typeof previousMonthlyLimit !== 'number' ||
          !Number.isSafeInteger(previousMonthlyLimit) ||
          previousMonthlyLimit < 1 ||
          typeof previousRetentionDays !== 'number' ||
          !Number.isInteger(previousRetentionDays) ||
          previousRetentionDays < 0 ||
          previousRetentionDays > 3_650 ||
          typeof recordedAt !== 'string' ||
          !Number.isFinite(Date.parse(recordedAt))
        )
          throw new Error(
            'pending entitlement receipt does not match the authorized reconciliation',
          );
        try {
          if (control) await control.updatePlan(id, plan);
          store.operatorUpdatePlan(id, plan);
          const local = store.operatorTenantEntitlement(id);
          const shared = control ? await control.tenantEntitlement(id) : undefined;
          if (
            local.plan !== target.plan ||
            local.monthlyLimit !== target.monthlyLimit ||
            local.retentionDays !== target.retentionDays ||
            (shared &&
              (shared.plan !== target.plan ||
                shared.monthly_limit !== target.monthlyLimit ||
                shared.retention_days !== target.retentionDays))
          )
            throw new Error('reconciled entitlement does not match the target');
        } catch (error) {
          throw new Error(
            'manual entitlement reconciliation failed; keep the service stopped and retain the pending receipt',
            { cause: error },
          );
        }
        const applied = entitlementReceipt(masterSecret, {
          status: 'applied',
          tenantId: id,
          previousPlan: pending.previous_plan as PlanId,
          targetPlan: plan,
          previousMonthlyLimit,
          previousRetentionDays,
          targetMonthlyLimit: target.monthlyLimit,
          targetRetentionDays: target.retentionDays,
          reasonCode: reason,
          evidenceReference,
          operatorId,
          recordedAt,
          changed: true,
          recovered: true,
        });
        await writeFile(receiptOutput, `${JSON.stringify(applied, null, 2)}\n`, {
          mode: 0o600,
        });
        await chmod(receiptOutput, 0o600);
        console.log(
          JSON.stringify(
            {
              tenant_ref: applied.tenant_ref,
              plan,
              validations_per_month: target.monthlyLimit,
              retention_days: target.retentionDays,
              changed: true,
              recovered: true,
              receipt_output: receiptOutput,
              receipt_hmac: applied.receipt_hmac,
              automated_charging: 'disabled',
            },
            null,
            2,
          ),
        );
        return;
      }
      const previousLocal = store.operatorTenantEntitlement(id);
      const previousShared = control ? await control.tenantEntitlement(id) : undefined;
      if (
        previousShared &&
        (previousShared.plan !== previousLocal.plan ||
          previousShared.monthly_limit !== previousLocal.monthlyLimit ||
          previousShared.retention_days !== previousLocal.retentionDays)
      )
        throw new Error('local and shared tenant entitlements are not synchronized');
      const recordedAt = new Date().toISOString();
      const receiptInput = {
        tenantId: id,
        previousPlan: previousLocal.plan,
        targetPlan: plan,
        previousMonthlyLimit: previousLocal.monthlyLimit,
        previousRetentionDays: previousLocal.retentionDays,
        targetMonthlyLimit: target.monthlyLimit,
        targetRetentionDays: target.retentionDays,
        reasonCode: reason,
        evidenceReference,
        operatorId,
        recordedAt,
      };
      await writeFile(
        receiptOutput,
        `${JSON.stringify(
          entitlementReceipt(masterSecret, { ...receiptInput, status: 'pending' }),
          null,
          2,
        )}\n`,
        { mode: 0o600, flag: 'wx' },
      );
      await chmod(receiptOutput, 0o600);
      const changed =
        previousLocal.plan !== target.plan ||
        previousLocal.monthlyLimit !== target.monthlyLimit ||
        previousLocal.retentionDays !== target.retentionDays;
      try {
        if (changed && control) await control.updatePlan(id, plan);
        if (changed) store.operatorUpdatePlan(id, plan);
      } catch (error) {
        let rollbackFailed = false;
        try {
          if (control && previousShared) {
            const observed = await control.tenantEntitlement(id);
            if (
              observed.plan !== previousShared.plan ||
              observed.monthly_limit !== previousShared.monthly_limit ||
              observed.retention_days !== previousShared.retention_days
            )
              await control.updateEntitlement(
                id,
                previousShared.plan,
                previousShared.retention_days,
              );
          }
          const observedLocal = store.operatorTenantEntitlement(id);
          if (
            observedLocal.plan !== previousLocal.plan ||
            observedLocal.monthlyLimit !== previousLocal.monthlyLimit ||
            observedLocal.retentionDays !== previousLocal.retentionDays
          )
            store.operatorUpdateEntitlement(id, previousLocal.plan, previousLocal.retentionDays);
        } catch {
          rollbackFailed = true;
        }
        await writeFile(
          receiptOutput,
          `${JSON.stringify(
            entitlementReceipt(masterSecret, {
              ...receiptInput,
              status: 'rolled_back',
              changed: false,
              failureCode: rollbackFailed ? 'rollback_unconfirmed' : 'mutation_failed',
            }),
            null,
            2,
          )}\n`,
          { mode: 0o600 },
        );
        await chmod(receiptOutput, 0o600);
        if (rollbackFailed)
          throw new Error(
            'manual entitlement failed and rollback could not be confirmed; keep service stopped',
            { cause: error },
          );
        throw error;
      }
      const applied = entitlementReceipt(masterSecret, {
        ...receiptInput,
        status: 'applied',
        changed,
      });
      await writeFile(receiptOutput, `${JSON.stringify(applied, null, 2)}\n`, {
        mode: 0o600,
      });
      await chmod(receiptOutput, 0o600);
      console.log(
        JSON.stringify(
          {
            tenant_ref: applied.tenant_ref,
            plan,
            validations_per_month: target.monthlyLimit,
            retention_days: target.retentionDays,
            changed,
            receipt_output: receiptOutput,
            receipt_hmac: applied.receipt_hmac,
            automated_charging: 'disabled',
          },
          null,
          2,
        ),
      );
      return;
    }
    if (command === 'transition') {
      const status = lifecycleStatus();
      const reason = reasonCode();
      const previousLocal = store.operatorTenantLifecycle(id);
      const local = store.operatorUpdateTenantLifecycle(id, status, reason);
      try {
        const shared = control
          ? await control.updateTenantLifecycle(id, status as SharedTenantLifecycleStatus, reason)
          : undefined;
        console.log(
          JSON.stringify({ tenant_id: id, local, ...(shared ? { shared } : {}) }, null, 2),
        );
      } catch (error) {
        store.operatorUpdateTenantLifecycle(id, previousLocal.status, previousLocal.reason_code);
        throw error;
      }
      return;
    }
    if (command === 'export') {
      const outputPath = requiredOption('output');
      const local = store.operatorExportTenantData(id);
      const shared = control && pool ? await exportSharedTenantData(pool, pool, id) : undefined;
      const content = { tenant_id: id, local, ...(shared ? { shared } : {}) };
      const bundle = {
        bundle_version: 1,
        generated_at: new Date().toISOString(),
        bundle_sha256: sha256(JSON.parse(canonicalJson(content)) as unknown),
        ...content,
      };
      await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await chmod(outputPath, 0o600);
      console.log(
        JSON.stringify(
          {
            tenant_id: id,
            output: outputPath,
            bundle_sha256: bundle.bundle_sha256,
            local_export_sha256: local.content_sha256,
            ...(shared ? { shared_export_sha256: shared.content_sha256 } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }
    const confirmation = await secureJsonFile(requiredOption('confirmation-file'));
    if (
      confirmation.tenant_id !== id ||
      confirmation.confirm !== `delete tenant ${id}` ||
      typeof confirmation.local_export_sha256 !== 'string' ||
      (control && typeof confirmation.shared_export_sha256 !== 'string')
    )
      throw new Error('confirmation file does not exactly authorize this tenant deletion');
    const lifecycle = store.operatorTenantLifecycle(id);
    const sharedLifecycle = control ? await control.tenantLifecycle(id) : undefined;
    if (
      lifecycle.status !== 'deletion_pending' ||
      (sharedLifecycle && sharedLifecycle.status !== 'deletion_pending')
    )
      throw new Error('tenant deletion must be pending in every configured state store');
    const sharedReceipt =
      control && pool
        ? await deleteSharedTenantData(
            pool,
            pool,
            id,
            confirmation.shared_export_sha256 as string,
            masterSecret,
          )
        : undefined;
    const localReceipt = store.operatorDeleteTenant(id, confirmation.local_export_sha256);
    console.log(
      JSON.stringify(
        {
          tenant_id: id,
          deleted: true,
          local_receipt: localReceipt,
          ...(sharedReceipt ? { shared_receipt: sharedReceipt } : {}),
          anchor_retention:
            'value-free independent checkpoint records remain subject to the configured legal retention policy',
        },
        null,
        2,
      ),
    );
  } finally {
    store.close();
    await control?.close();
    await pool?.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
