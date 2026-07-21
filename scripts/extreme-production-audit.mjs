#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const started = Date.now();
const failures = [];
const evidence = {};

function run(name, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  evidence[name] = {
    status: result.status,
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
  };
  if (result.status !== 0) failures.push(`${name} exited ${result.status}`);
  return result;
}

async function waitFor(url, headers = {}) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return;
    } catch {
      // Service may still be compiling or binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: Object.fromEntries(response.headers) };
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  return {
    child,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
    output: () => output,
    name,
  };
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

run('check', 'npm', ['run', 'check']);
run('audit_high', 'npm', ['audit', '--audit-level=high']);
run('conformance', 'npm', ['run', 'conformance']);
run('benchmark', 'npm', ['run', 'benchmark']);
run('recovery_drill', 'npm', ['run', 'audit:recovery']);
run('managed_load', 'npm', ['run', 'audit:managed-load']);

const temp = mkdtempSync(join(tmpdir(), 'schema-guard-extreme.'));
const openAuditFile = join(temp, 'open-api', 'audit.jsonl');
const openApi = start('open_api', 'npm', ['run', 'api'], {
  SCHEMA_GUARD_AUDIT_FILE: openAuditFile,
  PORT: '8797',
});

try {
  await waitFor('http://127.0.0.1:8797/healthz');
  const schema = {
    type: 'object',
    required: ['count'],
    properties: { count: { type: 'integer' } },
    additionalProperties: false,
  };
  const repairPayload = {
    tool_name: 'counter',
    tool_schema: schema,
    raw_arguments: { count: '2' },
  };
  const requests = [];
  for (let index = 0; index < 1000; index += 1) {
    requests.push(
      jsonRequest('http://127.0.0.1:8797/v1/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(repairPayload),
      }),
    );
  }
  const results = await Promise.all(requests);
  assert(
    results.every((item) => item.status === 200),
    'open API 1000 repair burst must all return 200',
  );
  assert(
    results.every((item) => item.body.decision === 'valid_with_repair'),
    'open API 1000 repair burst must all repair',
  );
  const auditIds = new Set(results.map((item) => item.body.audit_id));
  assert(auditIds.size === 1000, 'open API 1000 repair burst must produce unique audit IDs');
  const auditText = readFileSync(openAuditFile, 'utf8');
  assert(
    auditText.trim().split('\n').length === 1000,
    'open API audit file must contain 1000 rows',
  );
  assert(!auditText.includes('"2"'), 'open API audit file must not contain raw argument values');
  assert((statSync(openAuditFile).mode & 0o077) === 0, 'open API audit file must be owner-only');
} finally {
  await openApi.stop();
  evidence.open_api_output = openApi.output().slice(-4000);
}

const managedDb = join(temp, 'managed.db');
const managedSecret = 'production-audit-secret-0123456789-production-audit-secret-0123456789';
const bootstrap = run(
  'managed_bootstrap',
  'npm',
  [
    'run',
    'managed:bootstrap',
    '--',
    '--tenant-id',
    'audit-team',
    '--tenant-name',
    'Audit Team',
    '--plan',
    'team',
  ],
  {
    env: {
      ...process.env,
      SCHEMA_GUARD_DATABASE: managedDb,
      SCHEMA_GUARD_MASTER_SECRET: managedSecret,
    },
  },
);
const apiKey = JSON.parse(bootstrap.stdout.slice(bootstrap.stdout.indexOf('{'))).api_key;
const managed = start('managed', 'npm', ['run', 'managed'], {
  SCHEMA_GUARD_DATABASE: managedDb,
  SCHEMA_GUARD_MASTER_SECRET: managedSecret,
  SCHEMA_GUARD_PUBLIC_MODE: 'true',
  SCHEMA_GUARD_EXTERNAL_URL: 'https://app.invokeguard.example',
  SCHEMA_GUARD_TRUST_PROXY: 'true',
  SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_URL: 'https://anchor.invokeguard.example/checkpoints',
  SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_SIGNING_SECRET:
    'extreme-audit-anchor-signing-secret-that-is-at-least-32-characters',
  SCHEMA_GUARD_RATE_LIMIT_PER_MINUTE: '600',
  SCHEMA_GUARD_REQUEST_TIMEOUT_MS: '5000',
  SCHEMA_GUARD_ACTION_CHECKPOINT_ANCHOR_REQUEST_TIMEOUT_MS: '3000',
  HOST: '127.0.0.1',
  PORT: '8798',
});

try {
  await waitFor('http://127.0.0.1:8798/readyz');
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const dashboard = await fetch('http://127.0.0.1:8798/dashboard');
  assert(dashboard.status === 200, 'managed dashboard must load');
  assert(
    dashboard.headers.get('strict-transport-security')?.includes('max-age=31536000'),
    'public mode dashboard must emit HSTS',
  );
  const unauth = await jsonRequest('http://127.0.0.1:8798/v1/usage');
  assert(unauth.status === 401, 'managed API must reject unauthenticated usage');
  assert(
    unauth.headers['strict-transport-security']?.includes('max-age=31536000'),
    'public mode JSON responses must emit HSTS',
  );
  const schema = {
    type: 'object',
    required: ['count'],
    properties: { count: { type: 'integer' } },
    additionalProperties: false,
  };
  const burst = [];
  for (let index = 0; index < 250; index += 1) {
    burst.push(
      jsonRequest('http://127.0.0.1:8798/v1/validate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool_name: 'counter',
          tool_schema: schema,
          raw_arguments: { count: `${index}` },
          context: {
            adapter: 'json_schema',
            provider: 'openai',
            provider_version: 'responses-2026-07',
            framework: 'custom',
            framework_version: '0.1.0',
            environment: 'production',
          },
        }),
      }),
    );
  }
  const managedResults = await Promise.all(burst);
  assert(
    managedResults.every((item) => item.status === 200),
    'managed 250 repair burst must all return 200',
  );
  assert(
    managedResults.every((item) => item.body.decision === 'valid_with_repair'),
    'managed 250 repair burst must all repair',
  );
  assert(
    new Set(managedResults.map((item) => item.body.audit_id)).size === 250,
    'managed audit IDs must be unique',
  );
  const rejected = await jsonRequest('http://127.0.0.1:8798/v1/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tool_name: 'counter',
      tool_schema: schema,
      raw_arguments: { count: '9007199254740993', secret: 'EXTREME_SECRET_SENTINEL' },
      context: { adapter: 'json_schema', provider: 'openai', framework: 'custom' },
    }),
  });
  assert(
    rejected.status === 422 && rejected.body.decision === 'rejected',
    'managed unsafe secret request must reject',
  );
  const verify = await jsonRequest('http://127.0.0.1:8798/v1/audits/verify', { headers });
  assert(verify.status === 200 && verify.body.valid === true, 'managed audit chain must verify');
  const audits = await jsonRequest('http://127.0.0.1:8798/v1/audits?limit=300', { headers });
  assert(
    audits.status === 200 && audits.body.audits.length >= 251,
    'managed audit list must contain burst and rejection',
  );
  const billing = await jsonRequest('http://127.0.0.1:8798/v1/billing/statement', { headers });
  assert(
    billing.status === 200 && billing.body.payment_processing === 'integration_required',
    'managed billing statement must expose integration boundary',
  );
  const dbText = readFileSync(managedDb);
  assert(
    !dbText.includes('EXTREME_SECRET_SENTINEL'),
    'managed database must not contain secret sentinel',
  );
  assert((statSync(managedDb).mode & 0o077) === 0, 'managed database must be owner-only');
} finally {
  await managed.stop();
  evidence.managed_output = managed.output().slice(-4000);
}

const report = {
  passed: failures.length === 0,
  failures,
  duration_ms: Date.now() - started,
  evidence,
};
writeFileSync(join(temp, 'extreme-production-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({ ...report, report_path: join(temp, 'extreme-production-audit.json') }, null, 2),
);
process.exit(failures.length ? 1 : 0);
