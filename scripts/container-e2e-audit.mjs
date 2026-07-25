#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const startedAt = Date.now();
const suffix = `${process.pid}-${startedAt}`;
const names = {
  network: `schema-guard-e2e-${suffix}`,
  postgres: `schema-guard-e2e-postgres-${suffix}`,
  managed: `schema-guard-e2e-managed-${suffix}`,
  anchor: `schema-guard-e2e-anchor-${suffix}`,
  anchorProxy: `schema-guard-e2e-anchor-proxy-${suffix}`,
  postgresVolume: `schema-guard-e2e-postgres-${suffix}`,
  managedVolume: `schema-guard-e2e-managed-${suffix}`,
  anchorVolume: `schema-guard-e2e-anchor-${suffix}`,
};
const images = {
  managed: 'schema-guard-managed:container-e2e',
  anchor: 'schema-guard-anchor-receiver:container-e2e',
  postgres: 'schema-guard-postgres:container-e2e',
  anchorProxy:
    'caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d',
};
const networkSecondOctet = 64 + (process.pid % 64);
const networkSubnet = `11.${networkSecondOctet}.0.0/24`;
const anchorProxyAddress = `11.${networkSecondOctet}.0.250`;
const anchorAddress = `11.${networkSecondOctet}.0.251`;
const anchorHostname = 'anchor-e2e.invalid';
const masterSecret = 'container-e2e-master-secret-'.padEnd(80, 'm');
const adminKey = 'container-e2e-admin-key-at-least-32-characters';
const tenantTwoId = 'container-e2e-tenant-two';
const tenantTwoAdminKey = 'container-e2e-tenant-two-admin-key-at-least-32-characters';
const postgresPassword = 'container-e2e-postgres-password';
const anchorSigningSecret = 'container-e2e-anchor-signing-secret'.padEnd(48, 's');
const anchorReadToken = 'container-e2e-anchor-read-token'.padEnd(48, 'r');
const anchorChainSecret = 'container-e2e-anchor-chain-secret'.padEnd(48, 'c');
const metricsBearerToken = 'container-e2e-metrics-token'.padEnd(48, 't');
const checks = [];
const secretDirectory = mkdtempSync(join(process.cwd(), '.schema-guard-container-e2e-secrets.'));

function secretFile(name, value) {
  const path = join(secretDirectory, name);
  writeFileSync(path, `${value}\n`);
  chmodSync(path, 0o444);
  return path;
}

const secretFiles = {
  master: secretFile('master', masterSecret),
  adminKey: secretFile('admin-key', adminKey),
  tenantTwoAdminKey: secretFile('tenant-two-admin-key', tenantTwoAdminKey),
  anchorSigning: secretFile('anchor-signing', anchorSigningSecret),
  anchorRead: secretFile('anchor-read', anchorReadToken),
  anchorChain: secretFile('anchor-chain', anchorChainSecret),
  metricsBearer: secretFile('metrics-bearer', metricsBearerToken),
};
const tlsCertificate = join(secretDirectory, 'anchor-tls.crt');
const tlsPrivateKey = join(secretDirectory, 'anchor-tls.key');
const opensslConfig = join(secretDirectory, 'openssl.cnf');
const caddyConfig = join(secretDirectory, 'Caddyfile');
writeFileSync(
  opensslConfig,
  `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=${anchorHostname}\n[ext]\nsubjectAltName=DNS:${anchorHostname}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`,
);
writeFileSync(
  caddyConfig,
  `{\n  auto_https off\n  admin off\n}\nhttps://${anchorHostname} {\n  tls /run/certs/tls.crt /run/certs/tls.key\n  reverse_proxy anchor-internal:8790\n}\n`,
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure)
    throw new Error(
      `${command} ${args.join(' ')} failed (${String(result.status)}): ${(result.stderr || result.stdout).slice(-2000)}`,
    );
  return result;
}

function docker(args, options) {
  return run('docker', args, options);
}

function record(name, detail = true) {
  checks.push({ name, passed: true, detail });
}

function assert(condition, message, detail) {
  if (!condition) throw new Error(message);
  record(message, detail);
}

async function waitForHttp(url, expected = 200, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      last = `${response.status} ${await response.text()}`;
      if (response.status === expected) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${last.slice(-500)}`);
}

async function waitForDockerExec(container, args, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'command not attempted';
  while (Date.now() < deadline) {
    const result = docker(['exec', container, ...args], { allowFailure: true });
    if (result.status === 0) return;
    last = (result.stderr || result.stdout || `exit ${String(result.status)}`).slice(-500);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${container} dependency: ${last}`);
}

function publishedPort(container, internalPort) {
  const output = docker(['port', container, `${internalPort}/tcp`]).stdout.trim();
  const match = output.match(/127\.0\.0\.1:(\d+)$/u);
  if (!match) throw new Error(`could not resolve ${container} port: ${output}`);
  return Number(match[1]);
}

async function request(
  base,
  path,
  expectedStatus,
  { method = 'GET', key, body, headers: extraHeaders = {} } = {},
) {
  const headers = { ...extraHeaders };
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (response.status !== expectedStatus)
    throw new Error(
      `${method} ${path} returned ${response.status}, expected ${expectedStatus}: ${text.slice(0, 1000)}`,
    );
  record(`${method} ${path}`, { status: response.status });
  return { body: parsed, headers: Object.fromEntries(response.headers) };
}

function cleanup() {
  for (const container of [names.managed, names.anchorProxy, names.anchor, names.postgres])
    docker(['rm', '-f', container], { allowFailure: true });
  docker(['network', 'rm', names.network], { allowFailure: true });
  for (const volume of [names.managedVolume, names.anchorVolume, names.postgresVolume])
    docker(['volume', 'rm', volume], { allowFailure: true });
  rmSync(secretDirectory, { recursive: true, force: true });
}

let failure;
try {
  docker(['version']);
  run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    tlsPrivateKey,
    '-out',
    tlsCertificate,
    '-days',
    '1',
    '-config',
    opensslConfig,
  ]);
  chmodSync(tlsPrivateKey, 0o444);
  chmodSync(tlsCertificate, 0o444);
  docker(['build', '--target', 'managed', '--tag', images.managed, '.']);
  docker(['build', '--target', 'anchor-receiver', '--tag', images.anchor, '.']);
  docker(['build', '--file', 'deploy/Dockerfile.postgres', '--tag', images.postgres, '.']);
  record('production images build');

  docker(['network', 'create', '--subnet', networkSubnet, names.network]);
  for (const volume of [names.managedVolume, names.anchorVolume, names.postgresVolume])
    docker(['volume', 'create', volume]);
  docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--cap-add',
    'FOWNER',
    '--user',
    '0:0',
    '--entrypoint',
    'sh',
    '-v',
    `${names.postgresVolume}:/var/lib/postgresql/data`,
    images.postgres,
    '-c',
    'chown -R 999:999 /var/lib/postgresql/data',
  ]);
  docker([
    'run',
    '-d',
    '--name',
    names.postgres,
    '--network',
    names.network,
    '--network-alias',
    'postgres',
    '--user',
    '999:999',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/tmp:size=64m,mode=1777',
    '--tmpfs',
    '/var/run/postgresql:size=16m,uid=999,gid=999,mode=3775',
    '-v',
    `${names.postgresVolume}:/var/lib/postgresql/data`,
    '-e',
    'POSTGRES_USER=schema_guard',
    '-e',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    '-e',
    'POSTGRES_DB=schema_guard',
    images.postgres,
  ]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = docker(
      ['exec', names.postgres, 'pg_isready', '-U', 'schema_guard', '-d', 'schema_guard'],
      { allowFailure: true },
    );
    if (ready.status === 0) break;
    if (attempt === 99) throw new Error('PostgreSQL container did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  record('fresh PostgreSQL 16 is ready');

  const sharedDatabaseUrl = `postgresql://schema_guard:${postgresPassword}@postgres:5432/schema_guard`;
  const sharedActionDatabaseFile = secretFile('shared-action-database', sharedDatabaseUrl);
  const sharedControlDatabaseFile = secretFile('shared-control-database', sharedDatabaseUrl);
  const managedSecretMounts = [
    '-v',
    `${secretFiles.master}:/run/secrets/schema_guard_master:ro`,
    '-v',
    `${secretFiles.adminKey}:/run/secrets/schema_guard_admin_key:ro`,
    '-v',
    `${secretFiles.tenantTwoAdminKey}:/run/secrets/schema_guard_tenant_two_admin_key:ro`,
    '-v',
    `${sharedActionDatabaseFile}:/run/secrets/schema_guard_action_database:ro`,
    '-v',
    `${sharedControlDatabaseFile}:/run/secrets/schema_guard_control_database:ro`,
    '-v',
    `${secretFiles.anchorSigning}:/run/secrets/schema_guard_anchor_signing:ro`,
    '-v',
    `${tlsCertificate}:/run/secrets/schema_guard_anchor_ca:ro`,
    '-v',
    `${secretFiles.metricsBearer}:/run/secrets/schema_guard_metrics_bearer:ro`,
  ];
  const sharedEnvironment = [
    '-e',
    'SCHEMA_GUARD_DATABASE=/data/managed.db',
    '-e',
    'SCHEMA_GUARD_MASTER_SECRET_FILE=/run/secrets/schema_guard_master',
    '-e',
    'SCHEMA_GUARD_SHARED_ACTION_DATABASE_URL_FILE=/run/secrets/schema_guard_action_database',
    '-e',
    'SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL_FILE=/run/secrets/schema_guard_control_database',
    '-e',
    `SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL=https://${anchorHostname}/v1/checkpoints`,
    '-e',
    'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET_FILE=/run/secrets/schema_guard_anchor_signing',
    '-e',
    'NODE_EXTRA_CA_CERTS=/run/secrets/schema_guard_anchor_ca',
    '-e',
    'SCHEMA_GUARD_METRICS_BEARER_TOKEN_FILE=/run/secrets/schema_guard_metrics_bearer',
  ];
  docker([
    'run',
    '--rm',
    '--network',
    names.network,
    '--add-host',
    `${anchorHostname}:${anchorProxyAddress}`,
    '-v',
    `${names.managedVolume}:/data`,
    ...managedSecretMounts,
    ...sharedEnvironment,
    images.managed,
    'packages/managed/dist/bootstrap.js',
    '--tenant-id',
    'container-e2e',
    '--tenant-name',
    'Container E2E',
    '--plan',
    'team',
    '--api-key-file',
    '/run/secrets/schema_guard_admin_key',
    '--service-state',
    'stopped',
  ]);
  docker([
    'run',
    '--rm',
    '--network',
    names.network,
    '--add-host',
    `${anchorHostname}:${anchorProxyAddress}`,
    '-v',
    `${names.managedVolume}:/data`,
    ...managedSecretMounts,
    ...sharedEnvironment,
    images.managed,
    'packages/managed/dist/bootstrap.js',
    '--tenant-id',
    tenantTwoId,
    '--tenant-name',
    'Container E2E Tenant Two',
    '--plan',
    'team',
    '--api-key-file',
    '/run/secrets/schema_guard_tenant_two_admin_key',
    '--service-state',
    'stopped',
  ]);
  record('two tenants bootstrap against SQLite projection and shared PostgreSQL');

  docker([
    'run',
    '-d',
    '--name',
    names.managed,
    '--network',
    names.network,
    '--add-host',
    `${anchorHostname}:${anchorProxyAddress}`,
    '--read-only',
    '--tmpfs',
    '/tmp:size=64m,mode=1777',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '256',
    '-v',
    `${names.managedVolume}:/data`,
    ...managedSecretMounts,
    '-p',
    '127.0.0.1::8788',
    ...sharedEnvironment,
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=8788',
    '-e',
    'SCHEMA_GUARD_INSTANCE_COUNT=1',
    '-e',
    'SCHEMA_GUARD_RATE_LIMIT_PER_MINUTE=600',
    '-e',
    'SCHEMA_GUARD_ACCESS_LOG=true',
    '-e',
    'SCHEMA_GUARD_ALERT_WEBHOOK_POLL_INTERVAL_MS=60000',
    '-e',
    'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_POLL_INTERVAL_MS=100',
    '-e',
    'SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS=500',
    images.managed,
  ]);
  docker([
    'run',
    '-d',
    '--name',
    names.anchor,
    '--network',
    names.network,
    '--network-alias',
    'anchor-internal',
    '--ip',
    anchorAddress,
    '--read-only',
    '--tmpfs',
    '/tmp:size=32m,mode=1777',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '128',
    '-v',
    `${names.anchorVolume}:/anchor-data`,
    '-v',
    `${secretFiles.anchorSigning}:/run/secrets/schema_guard_anchor_signing:ro`,
    '-v',
    `${secretFiles.anchorRead}:/run/secrets/schema_guard_anchor_read:ro`,
    '-v',
    `${secretFiles.anchorChain}:/run/secrets/schema_guard_anchor_chain:ro`,
    '-p',
    '127.0.0.1::8790',
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=8790',
    '-e',
    'SCHEMA_GUARD_ANCHOR_DATABASE=/anchor-data/anchor.db',
    '-e',
    'SCHEMA_GUARD_ANCHOR_SIGNING_SECRET_FILE=/run/secrets/schema_guard_anchor_signing',
    '-e',
    'SCHEMA_GUARD_ANCHOR_READ_TOKEN_FILE=/run/secrets/schema_guard_anchor_read',
    '-e',
    'SCHEMA_GUARD_ANCHOR_CHAIN_SECRET_FILE=/run/secrets/schema_guard_anchor_chain',
    images.anchor,
  ]);
  docker([
    'run',
    '-d',
    '--name',
    names.anchorProxy,
    '--network',
    names.network,
    '--ip',
    anchorProxyAddress,
    '-v',
    `${caddyConfig}:/etc/caddy/Caddyfile:ro`,
    '-v',
    `${tlsCertificate}:/run/certs/tls.crt:ro`,
    '-v',
    `${tlsPrivateKey}:/run/certs/tls.key:ro`,
    images.anchorProxy,
  ]);
  let managedBase = `http://127.0.0.1:${publishedPort(names.managed, 8788)}`;
  let anchorBase = `http://127.0.0.1:${publishedPort(names.anchor, 8790)}`;
  await waitForHttp(`${managedBase}/readyz`);
  await waitForHttp(`${anchorBase}/readyz`);
  await waitForDockerExec(names.managed, [
    '/nodejs/bin/node',
    '-e',
    `fetch('https://${anchorHostname}/healthz').then(async r=>{if(!r.ok)throw new Error(await r.text())}).catch(e=>{console.error(e);process.exit(1)})`,
  ]);
  record('managed container reaches anchor through trusted HTTPS');
  record('managed and independent anchor containers are ready');
  record('managed and anchor secrets are loaded from read-only files');

  const managedHealth = await request(managedBase, '/healthz', 200);
  assert(
    /^req_[0-9a-f-]{36}$/u.test(managedHealth.headers['x-request-id']),
    'managed responses include correlation IDs',
  );
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const tracedHealth = await request(managedBase, '/healthz', 200, {
    headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
  });
  assert(
    tracedHealth.headers.traceparent?.startsWith(`00-${traceId}-`) &&
      tracedHealth.headers['x-akriven-trace-id'] === traceId,
    'managed container preserves W3C trace correlation without exposing it in logs',
  );
  await request(managedBase, '/metrics', 401);
  const managedMetrics = await request(managedBase, '/metrics', 200, {
    key: metricsBearerToken,
  });
  assert(
    typeof managedMetrics.body === 'string' &&
      managedMetrics.body.includes('schema_guard_http_requests_total') &&
      managedMetrics.body.includes(
        'schema_guard_operational_metrics_source_ready{source="quota"} 1',
      ) &&
      managedMetrics.body.includes(
        'schema_guard_operational_metrics_source_ready{source="alert"} 1',
      ) &&
      managedMetrics.body.includes(
        'schema_guard_operational_metrics_source_ready{source="action"} 1',
      ) &&
      managedMetrics.body.includes('schema_guard_quota_tenants_total') &&
      managedMetrics.body.includes('schema_guard_delivery_queue_depth') &&
      managedMetrics.body.includes('schema_guard_delivery_oldest_pending_age_seconds') &&
      managedMetrics.body.includes('schema_guard_pending_action_reservations') &&
      !managedMetrics.body.includes(adminKey) &&
      !managedMetrics.body.includes(metricsBearerToken),
    'authenticated production metrics include persisted privacy-safe operator gauges',
  );
  await request(managedBase, '/readyz', 200);
  const dashboard = await request(managedBase, '/dashboard', 200);
  assert(
    typeof dashboard.body === 'string' && dashboard.body.includes('Schema Guard'),
    'dashboard asset is served from the production image',
  );
  assert(
    dashboard.body.includes('Tenant lifecycle') &&
      dashboard.body.includes('Managed API workbench') &&
      dashboard.body.includes('Control-plane integrity') &&
      dashboard.body.includes('Request tenant deletion') &&
      dashboard.body.includes('Registered &amp; observed estate') &&
      dashboard.body.includes('Export value-free evidence'),
    'dashboard exposes complete operations, workbench, export, and deletion controls',
  );
  assert(
    !dashboard.headers['content-security-policy'].includes("'unsafe-inline'"),
    'dashboard CSP forbids inline script and style execution',
  );
  const dashboardScript = await request(managedBase, '/dashboard/app.js', 200);
  assert(
    dashboardScript.body.includes('/v1/actions/reconciliation/{RESERVATION_ID}') &&
      dashboardScript.body.includes('Replace every JSON placeholder before execution') &&
      dashboardScript.body.includes('Confirm this mutation before executing'),
    'dashboard workbench includes action reconciliation and fail-closed request guards',
  );
  await request(managedBase, '/dashboard/app.css', 200);
  await request(managedBase, '/v1/usage', 401);

  const v1 = {
    type: 'object',
    additionalProperties: false,
    properties: { query: { type: 'string' } },
    required: ['query'],
  };
  const v2 = {
    type: 'object',
    additionalProperties: false,
    properties: { query: { type: 'string' }, limit: { type: 'integer' } },
    required: ['query'],
  };
  const counterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: { count: { type: 'integer' } },
    required: ['count'],
  };
  const registered = await request(managedBase, '/v1/schemas', 201, {
    method: 'POST',
    key: adminKey,
    body: { tool_name: 'search', adapter: 'json_schema', version: '1', schema: v1 },
  });
  assert(
    typeof registered.body.schema_hash === 'string',
    'schema registration returns an authenticated schema hash',
  );
  const environments = await request(managedBase, '/v1/environments', 200, { key: adminKey });
  const production = environments.body.environments.find((item) => item.name === 'production');
  assert(Boolean(production?.id), 'default production environment exists');
  await request(managedBase, '/v1/schema-releases', 201, {
    method: 'POST',
    key: adminKey,
    body: {
      tool_name: 'search',
      version: '1',
      environment: 'production',
      expected_schema_hash: registered.body.schema_hash,
    },
  });
  await request(
    managedBase,
    `/v1/admin/environments/${encodeURIComponent(production.id)}/schema-enforcement`,
    200,
    { method: 'PUT', key: adminKey, body: { mode: 'enforce' } },
  );
  await request(managedBase, '/v1/schema-releases?environment=production', 200, { key: adminKey });
  const releaseHistory = await request(managedBase, '/v1/schema-releases/verify', 200, {
    key: adminKey,
  });
  assert(releaseHistory.body.valid === true, 'schema release history verifies');
  const valid = await request(managedBase, '/v1/validate', 200, {
    method: 'POST',
    key: adminKey,
    body: {
      tool_name: 'search',
      tool_schema: v1,
      raw_arguments: { query: 'safe' },
      context: { environment: 'production', adapter: 'json_schema' },
    },
  });
  assert(valid.body.decision === 'valid', 'exact production tool call is valid');
  const driftBlocked = await request(managedBase, '/v1/validate', 422, {
    method: 'POST',
    key: adminKey,
    body: {
      tool_name: 'search',
      tool_schema: v2,
      raw_arguments: { query: 'safe', limit: 2 },
      context: { environment: 'production', adapter: 'json_schema' },
    },
  });
  assert(driftBlocked.body.decision === 'rejected', 'unpromoted production schema is rejected');
  const repaired = await request(managedBase, '/v1/validate', 200, {
    method: 'POST',
    key: adminKey,
    body: {
      tool_name: 'counter',
      tool_schema: counterSchema,
      raw_arguments: { count: '2' },
      context: { environment: 'development', adapter: 'mcp' },
    },
  });
  assert(repaired.body.decision === 'valid_with_repair', 'allowlisted repair works in container');
  const rejected = await request(managedBase, '/v1/validate', 422, {
    method: 'POST',
    key: adminKey,
    body: {
      tool_name: 'counter',
      tool_schema: counterSchema,
      raw_arguments: { count: '02' },
      context: { environment: 'development', adapter: 'mcp' },
    },
  });
  assert(rejected.body.decision === 'rejected', 'ambiguous numeric input fails closed');
  const compiled = await request(managedBase, '/v1/contracts/compile', 200, {
    method: 'POST',
    key: adminKey,
    body: { target: 'mcp', tool_name: 'counter', tool_schema: counterSchema },
  });
  assert(
    compiled.body.status === 'runtime_unverified',
    'contract compilation is explicit about runtime evidence',
  );

  const audits = await request(managedBase, '/v1/audits?limit=100', 200, { key: adminKey });
  assert(audits.body.audits.length >= 4, 'shared audit history contains lifecycle decisions');
  const isolatedAudits = await request(managedBase, '/v1/audits?limit=100', 200, {
    key: tenantTwoAdminKey,
  });
  assert(isolatedAudits.body.audits.length === 0, 'second tenant cannot read first tenant audits');
  const isolatedUsage = await request(managedBase, '/v1/usage', 200, {
    key: tenantTwoAdminKey,
  });
  assert(
    isolatedUsage.body.usage.validation_count === 0,
    'second tenant cannot read first tenant usage',
  );
  const tenantTwoLifecycle = await request(managedBase, '/v1/admin/tenant/lifecycle', 200, {
    key: tenantTwoAdminKey,
  });
  assert(
    tenantTwoLifecycle.body.lifecycle.status === 'active',
    'new tenant lifecycle starts active in the production image',
  );
  const tenantTwoExport = await request(managedBase, '/v1/admin/tenant/export', 200, {
    key: tenantTwoAdminKey,
  });
  assert(
    /^sha256:[0-9a-f]{64}$/u.test(tenantTwoExport.body.content_sha256) &&
      !JSON.stringify(tenantTwoExport.body).includes('control_hmac') &&
      !JSON.stringify(tenantTwoExport.body).includes('key_hash'),
    'tenant export is complete, hashed, and excludes credential verifiers',
  );
  await request(managedBase, '/v1/admin/tenant/deletion-request', 400, {
    method: 'POST',
    key: tenantTwoAdminKey,
    body: { confirm_tenant_id: 'wrong-tenant' },
  });
  const deletionRequested = await request(managedBase, '/v1/admin/tenant/deletion-request', 202, {
    method: 'POST',
    key: tenantTwoAdminKey,
    body: { confirm_tenant_id: tenantTwoId },
  });
  assert(
    deletionRequested.body.lifecycle.status === 'deletion_pending',
    'exact tenant confirmation records a deletion request',
  );
  const projectedLifecycle = JSON.parse(
    docker([
      'exec',
      names.managed,
      '/nodejs/bin/node',
      'packages/managed/dist/tenant-operator.js',
      'inspect',
      '--tenant-id',
      tenantTwoId,
    ]).stdout,
  );
  assert(
    projectedLifecycle.synchronized === true &&
      projectedLifecycle.local?.status === 'deletion_pending' &&
      projectedLifecycle.shared?.status === 'deletion_pending',
    'public deletion request synchronizes local and shared lifecycle projections',
  );
  await request(managedBase, '/v1/usage', 423, { key: tenantTwoAdminKey });
  await request(managedBase, '/v1/admin/tenant/lifecycle', 200, {
    key: tenantTwoAdminKey,
  });
  await request(managedBase, '/v1/admin/tenant/export', 200, {
    key: tenantTwoAdminKey,
  });
  record('deletion-pending tenants fail closed while lifecycle and export remain available');
  const auditIntegrity = await request(managedBase, '/v1/audits/verify', 200, { key: adminKey });
  assert(auditIntegrity.body.valid === true, 'shared audit chain verifies');
  const conformance = {
    provider: 'anthropic',
    provider_version: 'container-e2e',
    framework: 'mcp',
    framework_version: '1',
    adapter: 'mcp',
    suite_version: 'container-e2e-1',
    executed_at: new Date().toISOString(),
    passed: 20,
    failed: 0,
    repaired: 2,
    rejected: 0,
    failure_signature_ids: [],
  };
  await request(managedBase, '/v1/conformance-runs', 201, {
    method: 'POST',
    key: adminKey,
    body: conformance,
  });
  const duplicateConformance = await request(managedBase, '/v1/conformance-runs', 200, {
    method: 'POST',
    key: adminKey,
    body: conformance,
  });
  assert(duplicateConformance.body.recorded === false, 'conformance ingestion is idempotent');
  await request(managedBase, '/v1/intelligence', 200, { key: adminKey });
  const inventory = await request(managedBase, '/v1/inventory', 200, { key: adminKey });
  assert(
    inventory.body.inventory_kind === 'registered_and_observed' &&
      inventory.body.summary.registered_tools >= 1 &&
      inventory.body.discovery.automatic === false,
    'registered and observed inventory is derived from persisted production state',
  );
  const evaluationExport = await request(managedBase, '/v1/intelligence/evaluation-export', 200, {
    key: adminKey,
  });
  assert(
    evaluationExport.body.format === 'akriven_value_free_evaluation' &&
      evaluationExport.body.privacy.value_free === true &&
      evaluationExport.body.privacy.raw_arguments_included === false &&
      /^sha256:[0-9a-f]{64}$/u.test(evaluationExport.body.content_sha256) &&
      !JSON.stringify(evaluationExport.body).includes('"tenant_id":') &&
      !JSON.stringify(evaluationExport.body).includes('"raw_arguments":') &&
      !JSON.stringify(evaluationExport.body).includes('"prompt":') &&
      !JSON.stringify(evaluationExport.body).includes('"tool_name":'),
    'value-free evaluation export is content-addressed and excludes tenant and raw values',
  );
  const usage = await request(managedBase, '/v1/usage', 200, { key: adminKey });
  assert(usage.body.usage.validation_count >= 4, 'usage is shared and metered');
  const billingStatement = await request(managedBase, '/v1/billing/statement', 200, {
    key: adminKey,
  });
  assert(
    billingStatement.body.payment_processing === 'integration_required',
    'unconfigured container exposes the billing integration boundary',
  );
  const checkoutDisabled = await request(managedBase, '/v1/billing/checkout-session', 501, {
    method: 'POST',
    key: adminKey,
  });
  assert(
    checkoutDisabled.body.error === 'billing_integration_required',
    'unconfigured container blocks checkout fail closed',
  );
  const portalDisabled = await request(managedBase, '/v1/billing/portal-session', 501, {
    method: 'POST',
    key: adminKey,
  });
  assert(
    portalDisabled.body.error === 'billing_integration_required',
    'unconfigured container blocks the billing portal fail closed',
  );
  const webhookDisabled = await request(managedBase, '/v1/billing/stripe/webhook', 501, {
    method: 'POST',
    body: {},
  });
  assert(
    webhookDisabled.body.error === 'billing_integration_required',
    'unconfigured container blocks Stripe webhooks fail closed',
  );
  await request(managedBase, '/v1/alerts', 200, { key: adminKey });

  const rulesetVersion = `container-e2e-${startedAt}`;
  await request(managedBase, '/v1/admin/rulesets', 201, {
    method: 'POST',
    key: adminKey,
    body: {
      version: rulesetVersion,
      issued_at: new Date(Date.now() - 1_000).toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      rules: [
        {
          id: 'coerce.string_to_integer',
          enabled_by_default: false,
          description: 'Typed integer repair.',
        },
      ],
    },
  });
  const ruleset = await request(managedBase, '/v1/rulesets/latest', 200, { key: adminKey });
  assert(ruleset.body.version === rulesetVersion, 'signed ruleset round-trip works');

  const issuedKey = await request(managedBase, '/v1/admin/api-keys', 201, {
    method: 'POST',
    key: adminKey,
    body: { scopes: ['validate'] },
  });
  await request(managedBase, '/v1/usage', 403, { key: issuedKey.body.api_key });
  await request(managedBase, '/v1/validate', 200, {
    method: 'POST',
    key: issuedKey.body.api_key,
    body: { tool_name: 'counter', tool_schema: counterSchema, raw_arguments: { count: 3 } },
  });
  await request(
    managedBase,
    `/v1/admin/api-keys/${encodeURIComponent(issuedKey.body.key_id)}`,
    200,
    {
      method: 'DELETE',
      key: adminKey,
    },
  );
  await request(managedBase, '/v1/validate', 401, {
    method: 'POST',
    key: issuedKey.body.api_key,
    body: { tool_name: 'counter', tool_schema: counterSchema, raw_arguments: { count: 3 } },
  });
  await request(managedBase, '/v1/admin/policy', 200, {
    method: 'PUT',
    key: adminKey,
    body: { max_repairs: 4, require_closed_schema: false },
  });
  const locked = await request(managedBase, '/v1/admin/environments', 201, {
    method: 'POST',
    key: adminKey,
    body: { name: 'locked', policy: { allowed_repairs: [] } },
  });
  await request(
    managedBase,
    `/v1/admin/environments/${encodeURIComponent(locked.body.id)}/policy`,
    200,
    {
      method: 'PUT',
      key: adminKey,
      body: { allowed_repairs: [] },
    },
  );
  await request(managedBase, '/v1/validate', 422, {
    method: 'POST',
    key: adminKey,
    body: {
      tool_name: 'counter',
      tool_schema: counterSchema,
      raw_arguments: { count: '2' },
      context: { environment: 'locked' },
    },
  });

  await request(managedBase, '/v1/admin/actions/descriptors', 200, {
    method: 'PUT',
    key: adminKey,
    body: {
      tool_name: 'transfer',
      environment: 'production',
      risk_level: 'high',
      side_effect: 'irreversible',
    },
  });
  const defaultActionControl = await request(managedBase, '/v1/admin/actions/control', 200, {
    key: adminKey,
  });
  assert(
    defaultActionControl.body.hold === false && defaultActionControl.body.shadow_policy === null,
    'shared action control starts enforcing without a hold or shadow policy',
  );
  await request(managedBase, '/v1/admin/actions/control', 200, {
    method: 'PUT',
    key: adminKey,
    body: {
      hold: false,
      reason_code: null,
      enforced_policy: {
        max_auto_execute_risk: 'low',
        max_repaired_auto_execute_risk: 'read',
        require_idempotency_for_side_effects: true,
      },
      shadow_policy: {
        max_auto_execute_risk: 'high',
        max_repaired_auto_execute_risk: 'high',
        require_idempotency_for_side_effects: true,
      },
    },
  });
  const transferDecision = await request(managedBase, '/v1/validate', 200, {
    method: 'POST',
    key: adminKey,
    body: {
      tool_name: 'transfer',
      tool_schema: counterSchema,
      raw_arguments: { count: 5 },
      context: { environment: 'development' },
    },
  });
  const challenge = await request(managedBase, '/v1/actions/challenges', 201, {
    method: 'POST',
    key: adminKey,
    body: {
      decision: transferDecision.body,
      tool_name: 'transfer',
      environment: 'production',
      workload_identity: 'container-agent/workspace/run-1',
      expires_in_seconds: 300,
    },
  });
  assert(
    /^hmac-sha256:[0-9a-f]{64}$/u.test(challenge.body.workload_identity_hash) &&
      !JSON.stringify(challenge.body).includes('container-agent/workspace/run-1'),
    'workload identity is tenant-keyed before approval persistence',
  );
  const approval = await request(
    managedBase,
    `/v1/actions/challenges/${encodeURIComponent(challenge.body.challenge_id)}/approve`,
    200,
    { method: 'POST', key: adminKey },
  );
  const evaluationBody = {
    decision: transferDecision.body,
    tool_name: 'transfer',
    environment: 'production',
    workload_identity: 'container-agent/workspace/run-1',
    approval: approval.body,
    idempotency_key: 'container-e2e-transfer-1',
  };
  const gate = await request(managedBase, '/v1/actions/evaluate', 200, {
    method: 'POST',
    key: adminKey,
    body: evaluationBody,
  });
  assert(gate.body.status === 'allowed', 'approved irreversible action is admitted once');
  assert(
    gate.body.shadow_evaluation?.status === 'allowed' &&
      gate.body.shadow_evaluation?.differs_from_enforced === true,
    'shadow action policy reports a non-authorizing diff beside enforced admission',
  );
  const checkpoint = await request(managedBase, '/v1/actions/idempotency/checkpoint', 200, {
    key: adminKey,
  });
  await request(managedBase, '/v1/actions/idempotency/checkpoint/compare', 200, {
    method: 'POST',
    key: adminKey,
    body: { checkpoint: checkpoint.body },
  });
  await request(managedBase, '/v1/actions/idempotency/complete', 200, {
    method: 'POST',
    key: adminKey,
    body: {
      idempotency_key: 'container-e2e-transfer-1',
      execution_fingerprint: gate.body.execution_fingerprint,
    },
  });
  const duplicateGate = await request(managedBase, '/v1/actions/evaluate', 200, {
    method: 'POST',
    key: adminKey,
    body: evaluationBody,
  });
  assert(duplicateGate.body.status === 'duplicate_blocked', 'duplicate side effect is blocked');
  const checkpointBeforeHold = await request(
    managedBase,
    '/v1/actions/idempotency/checkpoint',
    200,
    { key: adminKey },
  );
  await request(managedBase, '/v1/admin/actions/control', 200, {
    method: 'PUT',
    key: adminKey,
    body: {
      hold: true,
      reason_code: 'container.emergency',
      enforced_policy: {
        max_auto_execute_risk: 'low',
        max_repaired_auto_execute_risk: 'read',
        require_idempotency_for_side_effects: true,
      },
      shadow_policy: null,
    },
  });
  const heldGate = await request(managedBase, '/v1/actions/evaluate', 200, {
    method: 'POST',
    key: adminKey,
    body: evaluationBody,
  });
  assert(
    heldGate.body.status === 'rejected' && heldGate.body.reason_code === 'ACTIONS_HELD',
    'tenant emergency hold rejects before duplicate or execution admission',
  );
  const checkpointAfterHold = await request(
    managedBase,
    '/v1/actions/idempotency/checkpoint',
    200,
    { key: adminKey },
  );
  assert(
    checkpointAfterHold.body.revision === checkpointBeforeHold.body.revision,
    'emergency hold creates no idempotency reservation',
  );
  await request(managedBase, '/v1/admin/actions/control', 200, {
    method: 'PUT',
    key: adminKey,
    body: {
      hold: false,
      reason_code: 'container.recovered',
      enforced_policy: {
        max_auto_execute_risk: 'low',
        max_repaired_auto_execute_risk: 'read',
        require_idempotency_for_side_effects: true,
      },
      shadow_policy: null,
    },
  });

  const outageChallenge = await request(managedBase, '/v1/actions/challenges', 201, {
    method: 'POST',
    key: adminKey,
    body: {
      decision: transferDecision.body,
      tool_name: 'transfer',
      environment: 'production',
      workload_identity: 'container-agent/workspace/run-outage',
      expires_in_seconds: 300,
    },
  });
  const outageApproval = await request(
    managedBase,
    `/v1/actions/challenges/${encodeURIComponent(outageChallenge.body.challenge_id)}/approve`,
    200,
    { method: 'POST', key: adminKey },
  );
  const outageEvaluation = {
    decision: transferDecision.body,
    tool_name: 'transfer',
    environment: 'production',
    workload_identity: 'container-agent/workspace/run-outage',
    approval: outageApproval.body,
    idempotency_key: 'container-e2e-transfer-anchor-outage',
  };
  docker(['stop', names.anchorProxy]);
  const blockedByAnchor = await request(managedBase, '/v1/actions/evaluate', 503, {
    method: 'POST',
    key: adminKey,
    body: outageEvaluation,
  });
  if (
    typeof blockedByAnchor.body.error !== 'string' ||
    !blockedByAnchor.body.error.startsWith('checkpoint_anchor_')
  )
    throw new Error(`unexpected anchor outage response: ${JSON.stringify(blockedByAnchor.body)}`);
  record('independent anchor outage fails action admission closed', {
    error: blockedByAnchor.body.error,
  });
  docker(['start', names.anchorProxy]);
  let deliveryRecovered = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(
      `${managedBase}/v1/actions/idempotency/anchors/deliveries?limit=100`,
      { headers: { authorization: `Bearer ${adminKey}` } },
    );
    const result = await response.json();
    if (
      response.ok &&
      Array.isArray(result.deliveries) &&
      result.deliveries.length > 0 &&
      result.deliveries.every((delivery) => delivery.status === 'delivered')
    ) {
      deliveryRecovered = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(deliveryRecovered, 'checkpoint outbox recovers after anchor restart');
  const recoveredGate = await request(managedBase, '/v1/actions/evaluate', 200, {
    method: 'POST',
    key: adminKey,
    body: outageEvaluation,
  });
  assert(
    recoveredGate.body.status === 'duplicate_blocked',
    'outage reservation remains duplicate-blocked after recovery',
  );
  await request(managedBase, '/v1/actions/idempotency/release', 200, {
    method: 'POST',
    key: adminKey,
    body: {
      idempotency_key: 'container-e2e-transfer-anchor-outage',
      execution_fingerprint: recoveredGate.body.execution_fingerprint,
    },
  });
  await request(managedBase, '/v1/actions/reconciliation/pending', 200, { key: adminKey });
  await request(managedBase, '/v1/actions/reconciliation/history', 200, { key: adminKey });
  await request(managedBase, '/v1/actions/reconciliation/verify', 200, { key: adminKey });

  await request(managedBase, '/v1/alert-webhooks', 400, {
    method: 'POST',
    key: adminKey,
    body: { label: 'private-target', endpoint: 'http://127.0.0.1:9999/hook' },
  });
  const integrity = await request(managedBase, '/v1/admin/control-plane-integrity', 200, {
    key: adminKey,
  });
  assert(integrity.body.valid === true, 'control-plane integrity report is valid');
  await request(managedBase, '/v1/admin/retention/purge', 200, {
    method: 'POST',
    key: adminKey,
  });

  const anchorHealth = await request(anchorBase, '/healthz', 200);
  assert(
    /^req_[0-9a-f-]{36}$/u.test(anchorHealth.headers['x-request-id']),
    'anchor responses include correlation IDs',
  );
  await request(anchorBase, '/readyz', 200);
  await request(anchorBase, '/v1/checkpoints', 401, {
    method: 'POST',
    body: {},
  });
  const tenantRef = `hmac-sha256:${'1'.repeat(64)}`;
  const anchorEvent = {
    schema_version: '2026-07-20',
    event_type: 'schema_guard.action_idempotency_checkpoint',
    event_id: `hmac-sha256:${'2'.repeat(64)}`,
    checkpoint: {
      checkpoint_version: '1',
      tenant_ref: tenantRef,
      revision: 1,
      row_count: 1,
      accumulator: `xor256:${'3'.repeat(64)}`,
      updated_at: new Date().toISOString(),
      checkpoint_hash: `hmac-sha256:${'4'.repeat(64)}`,
    },
  };
  const exactAnchorBody = JSON.stringify(anchorEvent);
  const timestamp = new Date().toISOString();
  const signature = `v1=${createHmac('sha256', anchorSigningSecret)
    .update(timestamp)
    .update('.')
    .update(exactAnchorBody)
    .digest('hex')}`;
  const anchorResponse = await fetch(`${anchorBase}/v1/checkpoints`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-schema-guard-timestamp': timestamp,
      'x-schema-guard-signature': signature,
    },
    body: exactAnchorBody,
  });
  assert(anchorResponse.status === 201, 'signed checkpoint is stored by independent anchor');
  const latestAnchor = await fetch(
    `${anchorBase}/v1/checkpoints/${encodeURIComponent(tenantRef)}`,
    {
      headers: { authorization: `Bearer ${anchorReadToken}` },
    },
  );
  assert(latestAnchor.status === 200, 'anchor checkpoint is readable with its separate token');
  const latestAnchorBody = await latestAnchor.json();
  assert(latestAnchorBody.revision === 1, 'anchor returns the monotonic latest revision');

  docker(['restart', names.postgres]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = docker(
      ['exec', names.postgres, 'pg_isready', '-U', 'schema_guard', '-d', 'schema_guard'],
      { allowFailure: true },
    );
    if (ready.status === 0) break;
    if (attempt === 99) throw new Error('PostgreSQL did not recover after restart');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await waitForHttp(`${managedBase}/readyz`);
  const recoveredAudit = await request(managedBase, '/v1/audits/verify', 200, { key: adminKey });
  assert(recoveredAudit.body.valid === true, 'managed service recovers after PostgreSQL restart');

  docker(['restart', names.managed]);
  managedBase = `http://127.0.0.1:${publishedPort(names.managed, 8788)}`;
  await waitForHttp(`${managedBase}/readyz`, 200, 10_000);
  const persistedRuleset = await request(managedBase, '/v1/rulesets/latest', 200, {
    key: adminKey,
  });
  assert(
    persistedRuleset.body.version === rulesetVersion,
    'managed state persists across container restart',
  );

  docker(['restart', names.anchor]);
  anchorBase = `http://127.0.0.1:${publishedPort(names.anchor, 8790)}`;
  await waitForHttp(`${anchorBase}/readyz`);
  const persistedAnchor = await fetch(
    `${anchorBase}/v1/checkpoints/${encodeURIComponent(tenantRef)}`,
    { headers: { authorization: `Bearer ${anchorReadToken}` } },
  );
  assert(persistedAnchor.status === 200, 'anchor state persists across container restart');

  const managedInspect = JSON.parse(docker(['inspect', names.managed]).stdout)[0];
  assert(managedInspect.Config.User === '65532:65532', 'managed container runs as non-root');
  assert(
    managedInspect.HostConfig.ReadonlyRootfs === true,
    'managed container root filesystem is read-only',
  );
  assert(
    managedInspect.HostConfig.CapDrop.includes('ALL'),
    'managed container drops Linux capabilities',
  );
  assert(
    docker(['exec', names.managed, 'npm', '--version'], { allowFailure: true }).status !== 0,
    'managed runtime image excludes the unused npm toolchain',
  );
  const managedLogs = docker(['logs', names.managed]).stdout;
  assert(
    managedLogs.includes('"event":"http_request_completed"'),
    'structured access logs are emitted',
  );
  assert(!managedLogs.includes(adminKey), 'structured access logs do not contain API keys');
  assert(
    !managedLogs.includes(masterSecret),
    'structured access logs do not contain master secrets',
  );
  assert(
    !managedLogs.includes(metricsBearerToken),
    'structured access logs do not contain metrics bearer tokens',
  );
  assert(!managedLogs.includes(traceId), 'structured access logs hash W3C trace identifiers');
  const anchorLogs = docker(['logs', names.anchor]).stdout;
  assert(
    anchorLogs.includes('"service":"schema-guard-anchor-receiver"'),
    'anchor structured access logs are emitted',
  );
  assert(!anchorLogs.includes(tenantRef), 'anchor access-log routes redact tenant references');
  assert(!anchorLogs.includes(anchorReadToken), 'anchor access logs do not contain read tokens');
  assert(
    !anchorLogs.includes(anchorSigningSecret),
    'anchor access logs do not contain signing secrets',
  );
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
} finally {
  if (failure) {
    const managedState = docker(['inspect', '--format', '{{json .State}}', names.managed], {
      allowFailure: true,
    });
    if (managedState.stdout || managedState.stderr)
      process.stderr.write(
        `\n--- managed container state ---\n${managedState.stdout}${managedState.stderr}`,
      );
    for (const container of [names.managed, names.anchorProxy, names.anchor, names.postgres]) {
      const logs = docker(['logs', '--tail', '30', container], { allowFailure: true });
      if (logs.stdout || logs.stderr)
        process.stderr.write(`\n--- ${container} logs ---\n${logs.stdout}${logs.stderr}`);
    }
  }
  cleanup();
}

const report = {
  report_version: '1',
  executed_at: new Date(startedAt).toISOString(),
  passed: failure === undefined,
  duration_ms: Date.now() - startedAt,
  checks,
  ...(failure ? { failure: failure.message } : {}),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failure ? 1 : 0);
