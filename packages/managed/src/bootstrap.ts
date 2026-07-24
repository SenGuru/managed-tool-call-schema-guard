#!/usr/bin/env node
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { generateApiKey } from './crypto.js';
import { ManagedStore } from './store.js';
import {
  PostgresAlertState,
  PostgresControlState,
  PostgresSchemaState,
  PostgresIntelligenceState,
  createSharedStatePool,
} from '@schema-guard/shared-state';
import type { PlanId } from './types.js';
import { environmentValue } from './environment.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function apiKeyFromFile(path: string): string {
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > 65_536)
    throw new Error(
      '--api-key-file must reference a non-empty regular file no larger than 65536 bytes',
    );
  if ((metadata.mode & 0o022) !== 0)
    throw new Error('--api-key-file must not be writable by group or other users');
  const value = readFileSync(path, 'utf8').replace(/\r?\n$/u, '');
  if (value.includes('\0')) throw new Error('--api-key-file contains an invalid null byte');
  return value;
}

const databasePath = option('database') ?? process.env.SCHEMA_GUARD_DATABASE;
const masterSecret = environmentValue('SCHEMA_GUARD_MASTER_SECRET');
if (!databasePath || !masterSecret || masterSecret.length < 32)
  throw new Error(
    '--database/SCHEMA_GUARD_DATABASE and a 32+ character SCHEMA_GUARD_MASTER_SECRET are required',
  );
const tenantId = option('tenant-id') ?? 'local-demo';
const tenantName = option('tenant-name') ?? 'Local demo';
const plan = (option('plan') ?? 'trial') as PlanId;
if (plan !== 'trial' && plan !== 'team') throw new Error('--plan must be trial or team');
const sharedControlDatabaseUrl = environmentValue('SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL');
const publicOrShared =
  process.env.SCHEMA_GUARD_PUBLIC_MODE === 'true' || sharedControlDatabaseUrl !== undefined;
if (publicOrShared && option('service-state') !== 'stopped')
  throw new Error(
    '--service-state stopped is required for public/shared tenant bootstrap; restart the managed service after onboarding',
  );

const directApiKey = option('api-key');
const apiKeyFile = option('api-key-file');
const apiKeyOutputFile = option('api-key-output-file');
if ([directApiKey, apiKeyFile, apiKeyOutputFile].filter((value) => value !== undefined).length > 1)
  throw new Error('--api-key, --api-key-file, and --api-key-output-file are mutually exclusive');
if (publicOrShared && directApiKey !== undefined)
  throw new Error(
    '--api-key is forbidden for public/shared bootstrap because command arguments may be observable; use --api-key-file',
  );
if (publicOrShared && apiKeyFile === undefined && apiKeyOutputFile === undefined)
  throw new Error(
    '--api-key-file or --api-key-output-file is required for public/shared bootstrap so the key is never printed',
  );

const apiKey = directApiKey ?? (apiKeyFile ? apiKeyFromFile(apiKeyFile) : generateApiKey());
if (apiKey.length < 20) throw new Error('bootstrap API keys must contain at least 20 characters');
if (apiKeyOutputFile) {
  writeFileSync(apiKeyOutputFile, `${apiKey}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  chmodSync(apiKeyOutputFile, 0o600);
}

if (sharedControlDatabaseUrl) {
  const pool = createSharedStatePool(sharedControlDatabaseUrl);
  const control = new PostgresControlState(sharedControlDatabaseUrl, masterSecret, pool);
  const schema = new PostgresSchemaState(sharedControlDatabaseUrl, masterSecret, pool);
  const alerts = new PostgresAlertState(sharedControlDatabaseUrl, masterSecret, pool);
  const intelligence = new PostgresIntelligenceState(sharedControlDatabaseUrl, masterSecret, pool);
  try {
    await control.migrate();
    await control.bootstrapTenant({ id: tenantId, name: tenantName, plan, apiKey });
    await schema.migrate();
    await schema.bootstrapTenant(tenantId);
    await alerts.migrate();
    await alerts.bootstrapTenant(tenantId);
    await intelligence.migrate();
    await intelligence.bootstrapTenant(tenantId);
  } finally {
    await Promise.all([control.close(), schema.close(), alerts.close(), intelligence.close()]);
    await pool.end();
  }
}
const store = new ManagedStore({ databasePath, masterSecret });
store.bootstrapTenant({ id: tenantId, name: tenantName, plan, apiKey });
store.close();
const result: Record<string, unknown> = { tenant_id: tenantId, plan };
if (apiKeyOutputFile) {
  result.api_key_file = apiKeyOutputFile;
  result.warning =
    'The API key was written once to the requested owner-only file; only its HMAC-derived verifier is persisted.';
} else if (apiKeyFile) {
  result.api_key_source = 'file';
} else {
  result.api_key = apiKey;
  result.warning =
    'The API key is shown once. Store it securely; only its HMAC-derived verifier is persisted.';
}
console.log(JSON.stringify(result, null, 2));
