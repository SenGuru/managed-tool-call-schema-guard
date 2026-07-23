#!/usr/bin/env node
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import {
  PostgresControlState,
  createSharedStatePool,
  deleteSharedTenantData,
  exportSharedTenantData,
  type SharedStatePool,
  type SharedTenantLifecycleStatus,
} from '@schema-guard/shared-state';
import { canonicalJson, sha256 } from '@schema-guard/core';
import { environmentValue } from './environment.js';
import { ManagedStore } from './store.js';
import type { TenantLifecycleStatus } from './types.js';

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
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 64 * 1024)
    throw new Error('confirmation file must be a regular JSON file no larger than 64 KiB');
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('confirmation file must contain a JSON object');
  return value as JsonRecord;
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

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['inspect', 'transition', 'export', 'delete'].includes(command ?? ''))
    throw new Error(
      'usage: tenant-operator inspect|transition|export|delete --tenant-id ID [options]',
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
      console.log(
        JSON.stringify(
          {
            tenant_id: id,
            local,
            ...(shared ? { shared, synchronized: shared.status === local.status } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }
    if (option('service-state') !== 'stopped')
      throw new Error('--service-state stopped is required for lifecycle mutations');
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
