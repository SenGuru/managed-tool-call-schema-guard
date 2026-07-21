#!/usr/bin/env node
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
const databasePath = option('database') ?? process.env.SCHEMA_GUARD_DATABASE;
const masterSecret = environmentValue('SCHEMA_GUARD_MASTER_SECRET');
if (!databasePath || !masterSecret || masterSecret.length < 32)
  throw new Error(
    '--database/SCHEMA_GUARD_DATABASE and a 32+ character SCHEMA_GUARD_MASTER_SECRET are required',
  );
const apiKey = option('api-key') ?? generateApiKey();
const tenantId = option('tenant-id') ?? 'local-demo';
const tenantName = option('tenant-name') ?? 'Local demo';
const plan = (option('plan') ?? 'trial') as PlanId;
if (plan !== 'trial' && plan !== 'team') throw new Error('--plan must be trial or team');
const sharedControlDatabaseUrl = environmentValue('SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL');
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
console.log(
  JSON.stringify(
    {
      tenant_id: tenantId,
      plan,
      api_key: apiKey,
      warning:
        'The API key is shown once. Store it securely; only its HMAC-derived verifier is persisted.',
    },
    null,
    2,
  ),
);
