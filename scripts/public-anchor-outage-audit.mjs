#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseUrl = required('SCHEMA_GUARD_PUBLIC_E2E_BASE_URL').replace(/\/+$/u, '');
const keyFile = required('SCHEMA_GUARD_PUBLIC_E2E_API_KEY_FILE');
const tenantId = required('SCHEMA_GUARD_PUBLIC_E2E_TENANT_ID');
const sshTarget = required('SCHEMA_GUARD_ANCHOR_SSH_TARGET');
const anchorEdgeContainer = required('SCHEMA_GUARD_ANCHOR_EDGE_CONTAINER');
const deployedRevision = required('SCHEMA_GUARD_DEPLOYED_REVISION');

if (!baseUrl.startsWith('https://')) throw new Error('public outage audit must use HTTPS');
if (!/^audit-[A-Za-z0-9_-]{1,58}$/u.test(tenantId))
  throw new Error('public outage audit requires a dedicated audit-* tenant');
if (!/^[A-Za-z0-9_.@-]+$/u.test(sshTarget)) throw new Error('anchor SSH target is invalid');
if (!/^[A-Za-z0-9_.-]+$/u.test(anchorEdgeContainer))
  throw new Error('anchor edge container name is invalid');
if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(deployedRevision))
  throw new Error('deployed revision label is invalid');

const keyMetadata = statSync(keyFile);
if (!keyMetadata.isFile() || (keyMetadata.mode & 0o077) !== 0)
  throw new Error('public outage audit API-key file must be a regular owner-only file');
let apiKey = readFileSync(keyFile, 'utf8').trim();
if (apiKey.length < 20) throw new Error('public outage audit API-key file is invalid');

function sshDocker(action, ...arguments_) {
  const allowed = new Set(['inspect', 'start', 'stop']);
  if (!allowed.has(action)) throw new Error(`unsupported Docker action: ${action}`);
  const result = spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      sshTarget,
      'sudo',
      '-n',
      'docker',
      action,
      ...arguments_,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (result.status !== 0)
    throw new Error(`anchor Docker ${action} failed with status ${result.status ?? 'unknown'}`);
  return result.stdout.trim();
}

async function request(path, expectedStatus, options = {}) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (response.status !== expectedStatus)
    throw new Error(
      `${options.method ?? 'GET'} ${path}: expected ${expectedStatus}, received ${response.status}`,
    );
  return body;
}

const startedAt = Date.now();
const nonce = `${Date.now()}-${process.pid}`;
const counterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { count: { type: 'integer' } },
  required: ['count'],
};

await request('/v1/admin/actions/descriptors', 200, {
  method: 'PUT',
  body: {
    tool_name: 'transfer',
    environment: 'production',
    risk_level: 'high',
    side_effect: 'irreversible',
  },
});
const decision = await request('/v1/validate', 200, {
  method: 'POST',
  body: {
    tool_name: 'transfer',
    tool_schema: counterSchema,
    raw_arguments: { count: 7 },
    context: { environment: 'development' },
  },
});
assert(decision.decision === 'valid', 'action fixture was not valid');
const challenge = await request('/v1/actions/challenges', 201, {
  method: 'POST',
  body: {
    decision,
    tool_name: 'transfer',
    environment: 'production',
    expires_in_seconds: 300,
  },
});
const approval = await request(
  `/v1/actions/challenges/${encodeURIComponent(challenge.challenge_id)}/approve`,
  200,
  { method: 'POST' },
);
const idempotencyKey = `public-anchor-outage-${nonce}`;
const evaluation = {
  decision,
  tool_name: 'transfer',
  environment: 'production',
  approval,
  idempotency_key: idempotencyKey,
};

const initialState = sshDocker('inspect', '--format', '{{.State.Running}}', anchorEdgeContainer);
assert(initialState === 'true', 'anchor edge was not running before the drill');

let anchorStopped = false;
let outageError;
let recoveryMs;
let recoveredGate;
try {
  sshDocker('stop', '--time', '10', anchorEdgeContainer);
  anchorStopped = true;
  const blocked = await request('/v1/actions/evaluate', 503, {
    method: 'POST',
    body: evaluation,
  });
  assert(
    typeof blocked.error === 'string' && blocked.error.startsWith('checkpoint_anchor_'),
    'action did not fail closed with an anchor acknowledgement error',
  );
  outageError = blocked.error;

  const recoveryStartedAt = Date.now();
  sshDocker('start', anchorEdgeContainer);
  anchorStopped = false;

  let deliveryRecovered = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await request('/v1/actions/idempotency/anchors/deliveries?limit=100', 200);
    if (
      Array.isArray(result.deliveries) &&
      result.deliveries.length > 0 &&
      result.deliveries.every(({ status }) => status === 'delivered')
    ) {
      deliveryRecovered = true;
      recoveryMs = Date.now() - recoveryStartedAt;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(deliveryRecovered, 'anchor outbox did not fully recover within 30 seconds');

  recoveredGate = await request('/v1/actions/evaluate', 200, {
    method: 'POST',
    body: evaluation,
  });
  assert(
    recoveredGate.status === 'duplicate_blocked',
    'outage reservation was not duplicate-blocked after recovery',
  );
  await request('/v1/actions/idempotency/release', 200, {
    method: 'POST',
    body: {
      idempotency_key: idempotencyKey,
      execution_fingerprint: recoveredGate.execution_fingerprint,
    },
  });
  const reconciliation = await request('/v1/actions/reconciliation/verify', 200);
  assert(reconciliation.valid === true, 'reconciliation history did not verify after recovery');
  const integrity = await request('/v1/admin/control-plane-integrity', 200);
  assert(integrity.valid === true, 'control-plane integrity did not verify after recovery');
} finally {
  if (anchorStopped) sshDocker('start', anchorEdgeContainer);
}

apiKey = undefined;
console.log(
  JSON.stringify({
    passed: true,
    base_url: baseUrl,
    tenant_id: tenantId,
    deployed_revision: deployedRevision,
    outage_error: outageError,
    post_recovery_status: recoveredGate.status,
    anchor_recovery_ms: recoveryMs,
    duration_ms: Date.now() - startedAt,
  }),
);
