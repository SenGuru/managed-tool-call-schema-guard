#!/usr/bin/env node
import { generateApiKey } from './crypto.js';
import { ManagedStore } from './store.js';
import type { PlanId } from './types.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const databasePath = option('database') ?? process.env.SCHEMA_GUARD_DATABASE;
const masterSecret = process.env.SCHEMA_GUARD_MASTER_SECRET;
if (!databasePath || !masterSecret || masterSecret.length < 32)
  throw new Error(
    '--database/SCHEMA_GUARD_DATABASE and a 32+ character SCHEMA_GUARD_MASTER_SECRET are required',
  );
const apiKey = option('api-key') ?? generateApiKey();
const tenantId = option('tenant-id') ?? 'local-demo';
const tenantName = option('tenant-name') ?? 'Local demo';
const plan = (option('plan') ?? 'trial') as PlanId;
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
