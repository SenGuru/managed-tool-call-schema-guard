#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = required('SCHEMA_GUARD_PUBLIC_E2E_BASE_URL').replace(/\/+$/u, '');
const keyFile = required('SCHEMA_GUARD_PUBLIC_E2E_API_KEY_FILE');
const tenantId = required('SCHEMA_GUARD_PUBLIC_E2E_TENANT_ID');
if (!baseUrl.startsWith('https://')) throw new Error('public E2E base URL must use HTTPS');
if (!/^audit-[A-Za-z0-9_-]{1,58}$/u.test(tenantId))
  throw new Error('public E2E tenant ID must be a dedicated audit-* tenant');
const metadata = statSync(keyFile);
if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
  throw new Error('public E2E API-key file must be a regular owner-only file');
let apiKey = readFileSync(keyFile, 'utf8').trim();
if (apiKey.length < 20) throw new Error('public E2E API-key file is invalid');

const startedAt = Date.now();
const observations = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, expectedStatus, options = {}) {
  const headers = { accept: 'application/json' };
  const requestKey = options.unauthenticated ? undefined : (options.key ?? apiKey);
  if (requestKey) headers.authorization = `Bearer ${requestKey}`;
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
  observations.push(`${options.method ?? 'GET'} ${path} ${expectedStatus}`);
  return { body, headers: Object.fromEntries(response.headers) };
}

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

const health = await request('/healthz', 200, { unauthenticated: true });
assert(health.body.status === 'ok', 'liveness payload is invalid');
assert(/^req_[0-9a-f-]{36}$/u.test(health.headers['x-request-id']), 'request ID is missing');
let ready;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const response = await fetch(`${baseUrl}/readyz`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(3_000),
  });
  if (response.status === 200) {
    ready = await response.json();
    observations.push('GET /readyz 200');
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
assert(ready?.status === 'ready', 'readiness did not recover within 30 seconds');
await request('/v1/usage', 401, { unauthenticated: true });

const lifecycle = await request('/v1/admin/tenant/lifecycle', 200);
assert(lifecycle.body.lifecycle.status === 'active', 'audit tenant is not active');
const initialExport = await request('/v1/admin/tenant/export', 200);
const initialExportText = JSON.stringify(initialExport.body);
assert(initialExport.body.tenant_id === tenantId, 'tenant export identity mismatch');
assert(
  /^sha256:[0-9a-f]{64}$/u.test(initialExport.body.content_sha256),
  'tenant export hash is invalid',
);
for (const forbidden of ['control_hmac', 'key_hash', 'sealed_endpoint', 'sealed_signing_secret'])
  assert(!initialExportText.includes(forbidden), `tenant export exposed ${forbidden}`);

const registered = await request('/v1/schemas', 201, {
  method: 'POST',
  body: { tool_name: 'search', adapter: 'json_schema', version: '1', schema: v1 },
});
assert(typeof registered.body.schema_hash === 'string', 'schema hash is missing');
const environments = await request('/v1/environments', 200);
const production = environments.body.environments.find(({ name }) => name === 'production');
assert(Boolean(production?.id), 'production environment is missing');
await request('/v1/schema-releases', 201, {
  method: 'POST',
  body: {
    tool_name: 'search',
    version: '1',
    environment: 'production',
    expected_schema_hash: registered.body.schema_hash,
  },
});
await request(
  `/v1/admin/environments/${encodeURIComponent(production.id)}/schema-enforcement`,
  200,
  { method: 'PUT', body: { mode: 'enforce' } },
);
const releases = await request('/v1/schema-releases?environment=production', 200);
assert(releases.body.releases.length === 1, 'schema release list is invalid');
const releaseVerification = await request('/v1/schema-releases/verify', 200);
assert(releaseVerification.body.valid === true, 'schema release history is invalid');

const valid = await request('/v1/validate', 200, {
  method: 'POST',
  body: {
    tool_name: 'search',
    tool_schema: v1,
    raw_arguments: { query: 'safe' },
    context: { environment: 'production', adapter: 'json_schema' },
  },
});
assert(valid.body.decision === 'valid', 'valid decision mismatch');
const drift = await request('/v1/validate', 422, {
  method: 'POST',
  body: {
    tool_name: 'search',
    tool_schema: v2,
    raw_arguments: { query: 'safe', limit: 2 },
    context: { environment: 'production', adapter: 'json_schema' },
  },
});
assert(drift.body.decision === 'rejected', 'unpromoted drift did not reject');
const repaired = await request('/v1/validate', 200, {
  method: 'POST',
  body: {
    tool_name: 'counter',
    tool_schema: counterSchema,
    raw_arguments: { count: '2' },
    context: { environment: 'development', adapter: 'mcp' },
  },
});
assert(repaired.body.decision === 'valid_with_repair', 'allowlisted repair mismatch');
const rejected = await request('/v1/validate', 422, {
  method: 'POST',
  body: {
    tool_name: 'counter',
    tool_schema: counterSchema,
    raw_arguments: { count: '02' },
    context: { environment: 'development', adapter: 'mcp' },
  },
});
assert(rejected.body.decision === 'rejected', 'ambiguous input did not reject');
const compiled = await request('/v1/contracts/compile', 200, {
  method: 'POST',
  body: { target: 'mcp', tool_name: 'counter', tool_schema: counterSchema },
});
assert(compiled.body.status === 'runtime_unverified', 'compiler evidence boundary mismatch');

const audits = await request('/v1/audits?limit=100', 200);
assert(audits.body.audits.length >= 4, 'audit history is incomplete');
const auditVerification = await request('/v1/audits/verify', 200);
assert(auditVerification.body.valid === true, 'audit chain is invalid');

const nonce = `${Date.now()}`;
const conformance = {
  provider: 'anthropic',
  provider_version: `public-e2e-${nonce}`,
  framework: 'mcp',
  framework_version: '1',
  adapter: 'mcp',
  suite_version: `public-e2e-${nonce}`,
  executed_at: new Date().toISOString(),
  passed: 20,
  failed: 0,
  repaired: 2,
  rejected: 0,
  failure_signature_ids: [],
};
await request('/v1/conformance-runs', 201, { method: 'POST', body: conformance });
const duplicateConformance = await request('/v1/conformance-runs', 200, {
  method: 'POST',
  body: conformance,
});
assert(duplicateConformance.body.recorded === false, 'conformance retry was not idempotent');
await request('/v1/intelligence', 200);
const usage = await request('/v1/usage', 200);
assert(usage.body.usage.validation_count >= 4, 'validation usage was not metered');
const billing = await request('/v1/billing/statement', 200);
assert(
  billing.body.payment_processing === 'integration_required',
  'billing integration boundary is not explicit',
);
const checkout = await request('/v1/billing/checkout-session', 501, { method: 'POST' });
assert(
  checkout.body.error === 'billing_integration_required',
  'unconfigured public checkout did not fail closed',
);
const portal = await request('/v1/billing/portal-session', 501, { method: 'POST' });
assert(
  portal.body.error === 'billing_integration_required',
  'unconfigured public billing portal did not fail closed',
);
const stripeWebhook = await request('/v1/billing/stripe/webhook', 501, {
  method: 'POST',
  unauthenticated: true,
  body: {},
});
assert(
  stripeWebhook.body.error === 'billing_integration_required',
  'unconfigured public Stripe webhook did not fail closed',
);
await request('/v1/alerts', 200);

const rulesetVersion = `public-e2e-${nonce}`;
await request('/v1/admin/rulesets', 201, {
  method: 'POST',
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
const ruleset = await request('/v1/rulesets/latest', 200);
assert(ruleset.body.version === rulesetVersion, 'signed ruleset round-trip failed');

const issuedKey = await request('/v1/admin/api-keys', 201, {
  method: 'POST',
  body: { scopes: ['validate'] },
});
let validationKey = issuedKey.body.api_key;
assert(typeof validationKey === 'string', 'issued validation key is missing');
await request('/v1/usage', 403, { key: validationKey });
await request('/v1/validate', 200, {
  method: 'POST',
  key: validationKey,
  body: { tool_name: 'counter', tool_schema: counterSchema, raw_arguments: { count: 3 } },
});
await request(`/v1/admin/api-keys/${encodeURIComponent(issuedKey.body.key_id)}`, 200, {
  method: 'DELETE',
});
await request('/v1/validate', 401, {
  method: 'POST',
  key: validationKey,
  body: { tool_name: 'counter', tool_schema: counterSchema, raw_arguments: { count: 3 } },
});
validationKey = undefined;

await request('/v1/admin/policy', 200, {
  method: 'PUT',
  body: { max_repairs: 4, require_closed_schema: false },
});
const planChange = await request('/v1/admin/plan', 501, {
  method: 'PUT',
  body: { plan: 'team' },
});
assert(
  planChange.body.error === 'billing_integration_required',
  'public plan changes did not fail closed on missing billing authority',
);
const locked = await request('/v1/admin/environments', 201, {
  method: 'POST',
  body: { name: `locked-${nonce}`, policy: { allowed_repairs: [] } },
});
await request(`/v1/admin/environments/${encodeURIComponent(locked.body.id)}/policy`, 200, {
  method: 'PUT',
  body: { allowed_repairs: [] },
});
await request('/v1/validate', 422, {
  method: 'POST',
  body: {
    tool_name: 'counter',
    tool_schema: counterSchema,
    raw_arguments: { count: '2' },
    context: { environment: locked.body.name },
  },
});

await request('/v1/admin/actions/descriptors', 200, {
  method: 'PUT',
  body: {
    tool_name: 'transfer',
    environment: 'production',
    risk_level: 'high',
    side_effect: 'irreversible',
  },
});
const transferDecision = await request('/v1/validate', 200, {
  method: 'POST',
  body: {
    tool_name: 'transfer',
    tool_schema: counterSchema,
    raw_arguments: { count: 5 },
    context: { environment: 'development' },
  },
});
const canceledChallenge = await request('/v1/actions/challenges', 201, {
  method: 'POST',
  body: {
    decision: transferDecision.body,
    tool_name: 'transfer',
    environment: 'production',
    expires_in_seconds: 300,
  },
});
await request(
  `/v1/actions/challenges/${encodeURIComponent(canceledChallenge.body.challenge_id)}`,
  200,
  { method: 'DELETE' },
);
const challenge = await request('/v1/actions/challenges', 201, {
  method: 'POST',
  body: {
    decision: transferDecision.body,
    tool_name: 'transfer',
    environment: 'production',
    expires_in_seconds: 300,
  },
});
const approval = await request(
  `/v1/actions/challenges/${encodeURIComponent(challenge.body.challenge_id)}/approve`,
  200,
  { method: 'POST' },
);
const idempotencyKey = `public-e2e-action-${nonce}`;
const evaluation = {
  decision: transferDecision.body,
  tool_name: 'transfer',
  environment: 'production',
  approval: approval.body,
  idempotency_key: idempotencyKey,
};
const gate = await request('/v1/actions/evaluate', 200, {
  method: 'POST',
  body: evaluation,
});
assert(gate.body.status === 'allowed', `action admission returned ${gate.body.status}`);
const checkpoint = await request('/v1/actions/idempotency/checkpoint', 200);
const comparison = await request('/v1/actions/idempotency/checkpoint/compare', 200, {
  method: 'POST',
  body: { checkpoint: checkpoint.body },
});
assert(['same', 'advanced'].includes(comparison.body.status), 'checkpoint comparison is invalid');
await request('/v1/actions/idempotency/complete', 200, {
  method: 'POST',
  body: {
    idempotency_key: idempotencyKey,
    execution_fingerprint: gate.body.execution_fingerprint,
  },
});
const duplicate = await request('/v1/actions/evaluate', 200, {
  method: 'POST',
  body: evaluation,
});
assert(duplicate.body.status === 'duplicate_blocked', 'duplicate action was not blocked');
await request('/v1/actions/idempotency/anchors/deliveries?limit=100', 200);
await request('/v1/actions/reconciliation/pending', 200);
await request('/v1/actions/reconciliation/history', 200);
const reconciliation = await request('/v1/actions/reconciliation/verify', 200);
assert(reconciliation.body.valid === true, 'reconciliation history is invalid');

await request('/v1/alert-webhooks', 400, {
  method: 'POST',
  body: { label: 'private-target', endpoint: 'http://127.0.0.1:9999/hook' },
});
await request('/v1/alert-webhooks', 200);
await request('/v1/alert-webhooks/deliveries?limit=100', 200);
const integrity = await request('/v1/admin/control-plane-integrity', 200);
assert(integrity.body.valid === true, 'control-plane integrity is invalid');
await request('/v1/admin/retention/purge', 200, { method: 'POST' });

await request('/v1/admin/tenant/deletion-request', 400, {
  method: 'POST',
  body: { confirm_tenant_id: 'wrong-tenant' },
});
const deletion = await request('/v1/admin/tenant/deletion-request', 202, {
  method: 'POST',
  body: { confirm_tenant_id: tenantId },
});
assert(deletion.body.lifecycle.status === 'deletion_pending', 'deletion lock was not applied');
await request('/v1/usage', 423);
await request('/v1/admin/tenant/lifecycle', 200);
await request('/v1/admin/tenant/export', 200);

apiKey = undefined;
console.log(
  JSON.stringify({
    passed: true,
    base_url: baseUrl,
    tenant_id: tenantId,
    duration_ms: Date.now() - startedAt,
    request_count: observations.length,
    decisions: {
      valid: valid.body.decision,
      drift: drift.body.decision,
      repaired: repaired.body.decision,
      rejected: rejected.body.decision,
    },
    action: { first: gate.body.status, duplicate: duplicate.body.status },
    integrity: {
      audit: auditVerification.body.valid,
      releases: releaseVerification.body.valid,
      reconciliation: reconciliation.body.valid,
      control: integrity.body.valid,
    },
    lifecycle: deletion.body.lifecycle.status,
  }),
);
