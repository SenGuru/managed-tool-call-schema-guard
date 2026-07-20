#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createManagedServer } from '../packages/managed/dist/server.js';

const sentinel = 'SCHEMA_GUARD_LOAD_PRIVATE_SENTINEL_7d90f4';

function argumentsFrom(argv) {
  const options = { requests: 2_000, concurrency: 32, maxP95Ms: 250, minRps: 100 };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--requests') options.requests = Number(argv[++index]);
    else if (item === '--concurrency') options.concurrency = Number(argv[++index]);
    else if (item === '--max-p95-ms') options.maxP95Ms = Number(argv[++index]);
    else if (item === '--min-rps') options.minRps = Number(argv[++index]);
    else if (item === '--output') options.output = argv[++index];
    else throw new TypeError(`unknown argument: ${item}`);
  }
  for (const [name, value, minimum, maximum] of [
    ['requests', options.requests, 1, 100_000],
    ['concurrency', options.concurrency, 1, 512],
    ['max-p95-ms', options.maxP95Ms, 1, 60_000],
    ['min-rps', options.minRps, 1, 100_000],
  ])
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum)
      throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  return options;
}

function percentile(sorted, proportion) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * proportion))] ?? 0;
}

async function waitForReady(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The in-process server may not have bound yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error('managed load-audit server did not become ready');
}

export async function runManagedLoadAudit(argv = process.argv.slice(2)) {
  const options = argumentsFrom(argv);
  const directory = await mkdtemp(join(tmpdir(), 'schema-guard-managed-load.'));
  const databasePath = join(directory, 'managed.db');
  const masterSecret = 'managed-load-audit-master-secret-0123456789-0123456789';
  const service = createManagedServer({
    databasePath,
    masterSecret,
    host: '127.0.0.1',
    rateLimitPerMinute: 600,
    requestTimeoutMs: 5_000,
  });
  service.store.bootstrapTenant({
    id: 'load-audit',
    name: 'Load Audit',
    plan: 'team',
    apiKey: 'load-audit-admin-key',
  });
  const admin = service.store.authenticate('load-audit-admin-key');
  if (!admin) throw new Error('load audit bootstrap authentication failed');
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      count: { type: 'integer' },
      private_token: { type: 'string' },
    },
    required: ['count', 'private_token'],
  };
  const registered = service.store.registerSchema(admin, {
    tool_name: 'load_mutation_probe',
    adapter: 'json_schema',
    version: 'load-audit-v1',
    schema,
  });
  service.store.promoteSchemaRelease(admin, {
    tool_name: 'load_mutation_probe',
    version: 'load-audit-v1',
    environment: 'staging',
    expected_schema_hash: registered.schema_hash,
  });
  const staging = service.store
    .listEnvironments(admin)
    .find((environment) => environment.name === 'staging');
  if (!staging) throw new Error('load audit staging environment missing');
  service.store.updateEnvironmentSchemaEnforcement(admin, String(staging.id), 'enforce');
  const keyCount = Math.max(4, Math.ceil(options.requests / 500));
  const keys = Array.from(
    { length: keyCount },
    () => service.store.issueApiKey(admin, ['validate']).api_key,
  );
  await new Promise((resolvePromise) => service.server.listen(0, '127.0.0.1', resolvePromise));
  const address = service.server.address();
  if (!address || typeof address === 'string') throw new Error('load audit server address missing');
  const base = `http://127.0.0.1:${address.port}`;
  await waitForReady(`${base}/readyz`);
  const latencies = [];
  const statuses = new Map();
  const decisions = new Map();
  const auditIds = new Set();
  let next = 0;
  const started = performance.now();

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= options.requests) return;
      const requestStarted = performance.now();
      const response = await fetch(`${base}/v1/validate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${keys[index % keys.length]}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tool_name: 'load_mutation_probe',
          tool_schema: schema,
          raw_arguments: { count: '7', private_token: sentinel },
          context: {
            adapter: 'json_schema',
            provider: 'load-audit',
            framework: 'managed-http',
            environment: 'staging',
          },
        }),
      });
      latencies.push(performance.now() - requestStarted);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      const body = await response.json();
      if (body && typeof body === 'object') {
        decisions.set(body.decision, (decisions.get(body.decision) ?? 0) + 1);
        if (typeof body.audit_id === 'string') auditIds.add(body.audit_id);
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
  const durationMs = performance.now() - started;
  const auditChain = service.store.verifyAuditChain(admin);
  const schemaReleaseChain = service.store.verifySchemaReleaseHistory(admin);
  const usage = service.store.usage(admin);
  service.store.db.pragma('wal_checkpoint(TRUNCATE)');
  await service.close();

  const sorted = [...latencies].sort((left, right) => left - right);
  const databaseContainsSentinel = readFileSync(databasePath).includes(Buffer.from(sentinel));
  const p95 = percentile(sorted, 0.95);
  const throughput = options.requests / (durationMs / 1_000);
  const correct =
    statuses.get(200) === options.requests &&
    decisions.get('valid_with_repair') === options.requests &&
    auditIds.size === options.requests &&
    Number(usage.validation_count) === options.requests &&
    auditChain.valid &&
    auditChain.checked === options.requests &&
    schemaReleaseChain.valid &&
    schemaReleaseChain.checked === 1 &&
    !databaseContainsSentinel;
  const report = {
    report_version: '1',
    executed_at: new Date().toISOString(),
    profile: 'single_node_managed_http',
    requests: options.requests,
    concurrency: options.concurrency,
    api_keys: keyCount,
    duration_ms: Math.round(durationMs),
    throughput_requests_per_second: Number(throughput.toFixed(2)),
    latency_ms: {
      p50: Number(percentile(sorted, 0.5).toFixed(2)),
      p95: Number(p95.toFixed(2)),
      p99: Number(percentile(sorted, 0.99).toFixed(2)),
      max: Number((sorted.at(-1) ?? 0).toFixed(2)),
    },
    http_status_counts: Object.fromEntries(statuses),
    decision_counts: Object.fromEntries(decisions),
    unique_audit_ids: auditIds.size,
    usage_validation_count: Number(usage.validation_count),
    audit_chain: auditChain,
    schema_admission: {
      mode: 'enforce',
      release_chain: schemaReleaseChain,
    },
    database_contains_private_sentinel: databaseContainsSentinel,
    thresholds: {
      maximum_p95_ms: options.maxP95Ms,
      minimum_requests_per_second: options.minRps,
    },
    passed: correct && p95 <= options.maxP95Ms && throughput >= options.minRps,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(output, serialized, { mode: 0o600 });
  }
  process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runManagedLoadAudit().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ passed: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  });
