#!/usr/bin/env node
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import {
  compileToolContract,
  createReplayFixture,
  detectSchemaDrift,
  normalizeTool,
  replaySuite,
  validateToolCall,
  type AdapterName,
  type ContractTarget,
  type ReplayFixture,
  type ValidateRequest,
} from '@schema-guard/core';

function options(args: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith('--') || value === undefined)
      throw new Error(`invalid option near ${key ?? '<end>'}`);
    found.set(key.slice(2), value);
  }
  return found;
}
async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
function required(found: Map<string, string>, key: string): string {
  const value = found.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
}
async function apiKeyFile(path: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error('--api-key-file must reference a regular file');
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
    throw new Error('--api-key-file must not be accessible by group or other users');
  const apiKey = (await readFile(path, 'utf8')).trim();
  if (!apiKey) throw new Error('--api-key-file is empty');
  return apiKey;
}
function managedResourcePath(resource: string, found: Map<string, string>): string {
  const limit = found.get('limit');
  if (limit !== undefined && (!/^[1-9][0-9]{0,2}$/u.test(limit) || Number(limit) > 1000))
    throw new Error('--limit must be an integer between 1 and 1000');
  const limited = (path: string): string => `${path}${limit ? `?limit=${limit}` : ''}`;
  if (resource === 'plans') return '/v1/plans';
  if (resource === 'api-keys') return '/v1/admin/api-keys';
  if (resource === 'policy') return '/v1/admin/policy';
  if (resource === 'schemas') return '/v1/schemas';
  if (resource === 'action-descriptors') return '/v1/admin/actions/descriptors';
  if (resource === 'action-control') return '/v1/admin/actions/control';
  if (resource === 'action-challenges') {
    const query = new URLSearchParams();
    if (found.has('status')) query.set('status', required(found, 'status'));
    if (limit) query.set('limit', limit);
    return `/v1/actions/challenges${query.size ? `?${query}` : ''}`;
  }
  if (resource === 'usage') return '/v1/usage';
  if (resource === 'audits') return limited('/v1/audits');
  if (resource === 'audit-verification') return '/v1/audits/verify';
  if (resource === 'alerts') return '/v1/alerts';
  if (resource === 'notifications') return '/v1/admin/notifications';
  if (resource === 'environments') return '/v1/environments';
  if (resource === 'intelligence') return '/v1/intelligence';
  if (resource === 'evaluation-export') return '/v1/intelligence/evaluation-export';
  if (resource === 'inventory') return '/v1/inventory';
  if (resource === 'billing-statement') return '/v1/billing/statement';
  if (resource === 'schema-releases') {
    const query = new URLSearchParams();
    if (found.has('environment')) query.set('environment', required(found, 'environment'));
    if (limit) query.set('limit', limit);
    return `/v1/schema-releases${query.size ? `?${query}` : ''}`;
  }
  if (resource === 'schema-release-verification') return '/v1/schema-releases/verify';
  if (resource === 'control-plane-integrity') return '/v1/admin/control-plane-integrity';
  if (resource === 'tenant-lifecycle') return '/v1/admin/tenant/lifecycle';
  if (resource === 'tenant-export') return '/v1/admin/tenant/export';
  throw new Error(
    '--resource must be plans, api-keys, policy, schemas, action-descriptors, action-control, action-challenges, usage, audits, audit-verification, alerts, notifications, environments, intelligence, evaluation-export, inventory, billing-statement, schema-releases, schema-release-verification, control-plane-integrity, tenant-lifecycle, or tenant-export',
  );
}
async function managedRequest(
  found: Map<string, string>,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<unknown> {
  const base = new URL(required(found, 'base-url'));
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))
    throw new Error('--base-url must use HTTPS, except for an explicit loopback host');
  if (base.username || base.password || base.search || base.hash)
    throw new Error('--base-url must not contain credentials, a query, or a fragment');
  const timeoutText = found.get('timeout-ms') ?? '5000';
  if (!/^[1-9][0-9]*$/u.test(timeoutText) || Number(timeoutText) > 60_000)
    throw new Error('--timeout-ms must be an integer between 1 and 60000');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutText));
  try {
    const response = await fetch(new URL(path, `${base.href}/`), {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${await apiKeyFile(required(found, 'api-key-file'))}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      const record =
        payload !== null && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      throw new Error(
        `managed request failed with ${response.status}${
          typeof record.error === 'string' ? ` (${record.error})` : ''
        }`,
      );
    }
    if (payload === undefined) throw new Error('managed service returned invalid JSON');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
async function readManagedResource(found: Map<string, string>): Promise<unknown> {
  return managedRequest(found, managedResourcePath(required(found, 'resource'), found));
}
async function writeSensitiveManagedResult(
  found: Map<string, string>,
  result: unknown,
): Promise<void> {
  const output = required(found, 'out');
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(JSON.stringify({ written: output }, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const found = options(rest);
  if (command === 'validate') {
    const schema = await jsonFile(required(found, 'schema'));
    const args = await jsonFile(required(found, 'args'));
    const request: ValidateRequest = {
      tool_name: found.get('tool') ?? 'unnamed_tool',
      tool_schema: schema as ValidateRequest['tool_schema'],
      raw_arguments: args as ValidateRequest['raw_arguments'],
    };
    if (found.has('policy'))
      request.policy = (await jsonFile(required(found, 'policy'))) as NonNullable<
        ValidateRequest['policy']
      >;
    const decision = validateToolCall(request);
    if (found.has('audit'))
      await appendFile(required(found, 'audit'), `${JSON.stringify(decision.audit)}\n`, {
        mode: 0o600,
      });
    console.log(JSON.stringify(decision, null, 2));
    process.exitCode = decision.decision === 'rejected' ? 1 : 0;
    return;
  }
  if (command === 'normalize') {
    console.log(
      JSON.stringify(
        normalizeTool(
          required(found, 'adapter') as AdapterName,
          await jsonFile(required(found, 'input')),
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'drift') {
    console.log(
      JSON.stringify(
        detectSchemaDrift(
          (await jsonFile(required(found, 'before'))) as ValidateRequest['tool_schema'],
          (await jsonFile(required(found, 'after'))) as ValidateRequest['tool_schema'],
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'compile') {
    const target = required(found, 'target');
    if (!['openai', 'anthropic', 'google_gemini', 'mcp'].includes(target))
      throw new Error('--target must be openai, anthropic, google_gemini, or mcp');
    const strictPolicy = found.get('openai-strict-policy');
    if (strictPolicy !== undefined && strictPolicy !== 'reject' && strictPolicy !== 'normalize')
      throw new Error('--openai-strict-policy must be reject or normalize');
    const result = compileToolContract({
      target: target as ContractTarget,
      tool_name: found.get('tool') ?? 'unnamed_tool',
      tool_schema: (await jsonFile(required(found, 'schema'))) as ValidateRequest['tool_schema'],
      ...(found.has('description') ? { description: required(found, 'description') } : {}),
      ...(found.has('target-version') ? { target_version: required(found, 'target-version') } : {}),
      ...(strictPolicy ? { openai_strict_policy: strictPolicy } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'unsupported' || result.declaration === null ? 1 : 0;
    return;
  }
  if (command === 'fixture') {
    const request: ValidateRequest = {
      tool_name: found.get('tool') ?? 'unnamed_tool',
      tool_schema: (await jsonFile(required(found, 'schema'))) as ValidateRequest['tool_schema'],
      raw_arguments: (await jsonFile(required(found, 'args'))) as ValidateRequest['raw_arguments'],
    };
    if (found.has('policy'))
      request.policy = (await jsonFile(required(found, 'policy'))) as NonNullable<
        ValidateRequest['policy']
      >;
    const fixture = createReplayFixture(request);
    await writeFile(required(found, 'out'), `${JSON.stringify(fixture, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      JSON.stringify(
        {
          written: required(found, 'out'),
          fixture_id: fixture.fixture_id,
          expected_decision: fixture.expected.decision,
          privacy: fixture.privacy,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'replay') {
    const input = await jsonFile(required(found, 'fixture'));
    const fixtures = (Array.isArray(input) ? input : [input]) as ReplayFixture[];
    const report = replaySuite(fixtures);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  if (command === 'managed') {
    console.log(JSON.stringify(await readManagedResource(found), null, 2));
    return;
  }
  if (command === 'managed-request-deletion') {
    console.log(
      JSON.stringify(
        await managedRequest(found, '/v1/admin/tenant/deletion-request', 'POST', {
          confirm_tenant_id: required(found, 'confirm-tenant-id'),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'managed-set-action-control') {
    console.log(
      JSON.stringify(
        await managedRequest(
          found,
          '/v1/admin/actions/control',
          'PUT',
          await jsonFile(required(found, 'control')),
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'managed-acknowledge-alert') {
    const alertId = required(found, 'alert-id');
    if (!/^[1-9][0-9]*$/u.test(alertId) || !Number.isSafeInteger(Number(alertId)))
      throw new Error('--alert-id must be a positive safe integer');
    console.log(
      JSON.stringify(
        await managedRequest(found, `/v1/alerts/${alertId}/acknowledge`, 'POST'),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'managed-queue-notification') {
    console.log(
      JSON.stringify(
        await managedRequest(
          found,
          '/v1/admin/notifications',
          'POST',
          await jsonFile(required(found, 'notification')),
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'managed-redrive-notification') {
    const notificationId = required(found, 'notification-id');
    if (!/^notification_[A-Za-z0-9_-]{16,128}$/u.test(notificationId))
      throw new Error('--notification-id must be a valid notification identifier');
    console.log(
      JSON.stringify(
        await managedRequest(
          found,
          `/v1/admin/notifications/${encodeURIComponent(notificationId)}/redrive`,
          'POST',
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'managed-billing-checkout') {
    await writeSensitiveManagedResult(
      found,
      await managedRequest(found, '/v1/billing/checkout-session', 'POST'),
    );
    return;
  }
  if (command === 'managed-billing-portal') {
    await writeSensitiveManagedResult(
      found,
      await managedRequest(found, '/v1/billing/portal-session', 'POST'),
    );
    return;
  }
  throw new Error(
    'usage: schemaguard validate --schema FILE --args FILE [--tool NAME] [--policy FILE] [--audit FILE]\n       schemaguard normalize --adapter NAME --input FILE\n       schemaguard drift --before FILE --after FILE\n       schemaguard compile --target openai|anthropic|google_gemini|mcp --schema FILE [--tool NAME] [--description TEXT] [--openai-strict-policy reject|normalize]\n       schemaguard fixture --schema FILE --args FILE --out FILE [--tool NAME] [--policy FILE]\n       schemaguard replay --fixture FILE\n       schemaguard managed --base-url URL --api-key-file FILE --resource NAME [--limit N] [--environment NAME] [--timeout-ms N]\n       schemaguard managed-set-action-control --base-url URL --api-key-file FILE --control FILE [--timeout-ms N]\n       schemaguard managed-acknowledge-alert --base-url URL --api-key-file FILE --alert-id ID [--timeout-ms N]\n       schemaguard managed-queue-notification --base-url URL --api-key-file FILE --notification FILE [--timeout-ms N]\n       schemaguard managed-redrive-notification --base-url URL --api-key-file FILE --notification-id ID [--timeout-ms N]\n       schemaguard managed-request-deletion --base-url URL --api-key-file FILE --confirm-tenant-id ID [--timeout-ms N]\n       schemaguard managed-billing-checkout --base-url URL --api-key-file FILE --out OWNER_ONLY_FILE [--timeout-ms N]\n       schemaguard managed-billing-portal --base-url URL --api-key-file FILE --out OWNER_ONLY_FILE [--timeout-ms N]',
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
