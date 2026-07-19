import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  assertJsonSafety,
  JsonResourceLimitError,
  policyValidationError,
  validateToolCall,
  type GuardPolicy,
  type ValidateRequest,
} from '@schema-guard/core';
import { dashboardHtml } from './dashboard.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { ManagedError, ManagedStore } from './store.js';
import {
  ALL_SCOPES,
  type ManagedConfig,
  type PlanId,
  type Principal,
  type Scope,
  type SignedRuleSet,
} from './types.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  extra: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...extra,
  });
  response.end(`${JSON.stringify(value)}\n`);
}
async function readBody(request: IncomingMessage, max = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > max) throw new ManagedError(413, 'body_too_large', 'request body exceeds 1 MB');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ManagedError(400, 'invalid_json', 'request body must be valid JSON');
  }
}
function bearer(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length <= 7)
    throw new ManagedError(401, 'authentication_required', 'provide a bearer API key');
  return header.slice(7);
}
function authenticate(store: ManagedStore, request: IncomingMessage): Principal {
  const principal = store.authenticate(bearer(request));
  if (!principal) throw new ManagedError(401, 'invalid_api_key', 'API key is invalid or revoked');
  return principal;
}
function pathOf(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://local');
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!object(value))
    throw new ManagedError(400, 'object_required', 'request body must be an object');
  return value;
}
function enforceJsonSafety(value: unknown, label: string): void {
  try {
    assertJsonSafety(value, label);
  } catch (error) {
    if (error instanceof JsonResourceLimitError)
      throw new ManagedError(413, 'resource_limit_exceeded', error.message);
    throw new ManagedError(400, 'invalid_json_value', `${label} must contain only JSON values`);
  }
}
function mergePolicy(organization: GuardPolicy, caller: GuardPolicy | undefined): GuardPolicy {
  const merged: GuardPolicy = {};
  if (organization.allowed_repairs && caller?.allowed_repairs)
    merged.allowed_repairs = organization.allowed_repairs.filter((rule) =>
      caller.allowed_repairs!.includes(rule),
    );
  else if (organization.allowed_repairs ?? caller?.allowed_repairs)
    merged.allowed_repairs = [...(organization.allowed_repairs ?? caller!.allowed_repairs!)];
  const limits = [organization.max_repairs, caller?.max_repairs].filter(
    (value): value is number => value !== undefined,
  );
  if (limits.length) merged.max_repairs = Math.min(...limits);
  const denied = new Set([
    ...(organization.deny_argument_paths ?? []),
    ...(caller?.deny_argument_paths ?? []),
  ]);
  if (denied.size) merged.deny_argument_paths = [...denied];
  if (organization.require_closed_schema || caller?.require_closed_schema)
    merged.require_closed_schema = true;
  return merged;
}
function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]!);
  const cell = (value: unknown): string => {
    const rendered = value === null || value === undefined ? '' : (JSON.stringify(value) ?? '');
    return `"${rendered.replaceAll('"', '""')}"`;
  };
  return `${columns.map(cell).join(',')}\n${rows.map((row) => columns.map((column) => cell(row[column])).join(',')).join('\n')}\n`;
}

export function createManagedServer(config: ManagedConfig) {
  const store = new ManagedStore(config);
  const limiter = new FixedWindowRateLimiter(config.rateLimitPerMinute ?? 120);
  let ready = true;
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!response.headersSent)
        json(response, 503, {
          error: 'request_timeout',
          message: 'request exceeded the local service deadline',
        });
      else response.destroy();
      if (!request.destroyed) request.destroy();
    }, config.requestTimeoutMs ?? 10_000);
    const guardedBody = async (): Promise<unknown> => {
      const value = await readBody(request);
      if (timedOut)
        throw new ManagedError(
          503,
          'request_timeout',
          'request exceeded the local service deadline',
        );
      return value;
    };
    try {
      const url = pathOf(request);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        json(response, 200, { status: 'ok' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/readyz') {
        json(response, ready ? 200 : 503, { status: ready ? 'ready' : 'draining' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/dashboard') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
        });
        response.end(dashboardHtml);
        return;
      }
      const principal = authenticate(store, request);
      limiter.consume(principal);
      if (request.method === 'POST' && url.pathname === '/v1/validate') {
        store.requireScope(principal, 'validate');
        const input = asRecord(await guardedBody());
        const validationRequest = input as unknown as ValidateRequest;
        const callerPolicyError = policyValidationError(validationRequest.policy);
        if (callerPolicyError) throw new ManagedError(400, 'invalid_policy', callerPolicyError);
        validationRequest.policy = mergePolicy(principal.policy, validationRequest.policy);
        const decision = validateToolCall(validationRequest);
        store.recordValidation(principal, decision);
        json(response, decision.decision === 'rejected' ? 422 : 200, decision);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/schemas') {
        store.requireScope(principal, 'write:schema');
        const input = asRecord(await guardedBody());
        if (
          typeof input.tool_name !== 'string' ||
          input.tool_name.length === 0 ||
          input.tool_name.length > 256 ||
          typeof input.adapter !== 'string' ||
          !['json_schema', 'mcp', 'openai_agents', 'pydantic_ai', 'google_adk'].includes(
            input.adapter,
          ) ||
          typeof input.version !== 'string' ||
          input.version.length === 0 ||
          input.version.length > 128 ||
          (!object(input.schema) && typeof input.schema !== 'boolean')
        )
          throw new ManagedError(
            400,
            'invalid_schema_registration',
            'tool_name, adapter, version, and schema are required',
          );
        enforceJsonSafety(input.schema, 'registered schema');
        json(
          response,
          201,
          store.registerSchema(principal, {
            tool_name: input.tool_name,
            adapter: input.adapter,
            version: input.version,
            schema: input.schema,
          }),
        );
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/audits') {
        store.requireScope(principal, 'read:audit');
        const rows = store.listAudits(principal, Number(url.searchParams.get('limit') ?? 100));
        if (url.searchParams.get('format') === 'csv') {
          response.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="schema-guard-audits.csv"',
            'cache-control': 'no-store',
          });
          response.end(csv(rows));
        } else json(response, 200, { audits: rows });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/audits/verify') {
        store.requireScope(principal, 'read:audit');
        json(response, 200, store.verifyAuditChain(principal));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/intelligence') {
        store.requireScope(principal, 'read:intelligence');
        json(response, 200, {
          privacy_threshold: config.aggregateTenantThreshold ?? 3,
          signatures: store.aggregateIntelligence(),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        json(response, 200, {
          plan: principal.plan,
          monthly_limit: principal.monthlyLimit,
          usage: store.usage(principal),
          payment_processing: 'not_configured_local_mode',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/billing/statement') {
        const usage = store.usage(principal);
        json(response, 200, {
          period: usage.month,
          plan: principal.plan,
          included_validations: principal.monthlyLimit,
          usage,
          amount_due: null,
          currency: null,
          payment_processing: 'integration_required',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/alerts') {
        json(response, 200, { alerts: store.alerts(principal) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/rulesets/latest') {
        const ruleset = store.latestRuleset(principal);
        if (!ruleset)
          throw new ManagedError(404, 'ruleset_not_found', 'no ruleset has been published');
        if (!store.verifyRuleset(ruleset))
          throw new ManagedError(
            500,
            'ruleset_signature_invalid',
            'stored ruleset signature did not verify',
          );
        json(response, 200, ruleset);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/rulesets') {
        store.requireScope(principal, 'admin');
        const input = asRecord(await guardedBody()) as unknown as Omit<
          SignedRuleSet,
          'key_id' | 'public_key' | 'signature'
        >;
        if (
          typeof input.version !== 'string' ||
          !Array.isArray(input.rules) ||
          typeof input.issued_at !== 'string' ||
          typeof input.expires_at !== 'string'
        )
          throw new ManagedError(
            400,
            'invalid_ruleset',
            'version, issued_at, expires_at, and rules are required',
          );
        json(response, 201, store.publishRuleset(principal, input));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/api-keys') {
        store.requireScope(principal, 'admin');
        const input = asRecord(await guardedBody());
        if (
          !Array.isArray(input.scopes) ||
          !input.scopes.every(
            (scope) => typeof scope === 'string' && ALL_SCOPES.includes(scope as Scope),
          )
        )
          throw new ManagedError(400, 'invalid_scopes', 'scopes must be an array of scope names');
        json(response, 201, store.issueApiKey(principal, input.scopes as Scope[]));
        return;
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/v1/admin/api-keys/')) {
        const keyId = decodeURIComponent(url.pathname.slice('/v1/admin/api-keys/'.length));
        json(response, 200, { revoked: store.revokeApiKey(principal, keyId) });
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/v1/admin/policy') {
        const input = asRecord(await guardedBody()) as GuardPolicy;
        const policyError = policyValidationError(input);
        if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
        store.updateTenantPolicy(principal, input);
        json(response, 200, { updated: true, applies_on_next_request: true });
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/v1/admin/plan') {
        const input = asRecord(await guardedBody());
        if (input.plan !== 'trial' && input.plan !== 'team')
          throw new ManagedError(400, 'invalid_plan', 'plan must be trial or team');
        store.updatePlan(principal, input.plan as PlanId);
        json(response, 200, {
          updated: true,
          plan: input.plan,
          applies_on_next_request: true,
          payment_processing: 'integration_required',
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/retention/purge') {
        store.requireScope(principal, 'admin');
        json(response, 200, { deleted: store.purgeExpired(principal) });
        return;
      }
      json(response, 404, { error: 'not_found', message: 'route not found' });
    } catch (error) {
      if (timedOut || response.writableEnded || response.destroyed) return;
      const managed =
        error instanceof ManagedError
          ? error
          : new ManagedError(500, 'internal_error', 'managed service failed closed');
      json(response, managed.status, { error: managed.code, message: managed.message });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    server,
    store,
    async close(): Promise<void> {
      ready = false;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
    },
  };
}

function configFromEnvironment(): ManagedConfig {
  const databasePath = process.env.SCHEMA_GUARD_DATABASE;
  const masterSecret = process.env.SCHEMA_GUARD_MASTER_SECRET;
  if (!databasePath || !masterSecret || masterSecret.length < 32)
    throw new Error(
      'SCHEMA_GUARD_DATABASE and a 32+ character SCHEMA_GUARD_MASTER_SECRET are required',
    );
  return {
    databasePath,
    masterSecret,
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 8788),
    ...(process.env.SCHEMA_GUARD_ALERT_FILE
      ? { alertFile: process.env.SCHEMA_GUARD_ALERT_FILE }
      : {}),
  };
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const config = configFromEnvironment();
  const managed = createManagedServer(config);
  managed.server.listen(config.port, config.host, () => {
    console.log(`Schema Guard managed local listening on http://${config.host}:${config.port}`);
  });
  const shutdown = (): void => {
    void managed.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
