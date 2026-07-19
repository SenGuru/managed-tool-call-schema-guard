import { afterEach, describe, expect, it } from 'vitest';
import { createSchemaGuardServer } from '../packages/api/src/server.js';
import type { Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server: Server | undefined;
afterEach(() => {
  server?.close();
  delete process.env.SCHEMA_GUARD_AUDIT_FILE;
});
describe('HTTP API', () => {
  it('serves validation decisions without payload reflection in audit', async () => {
    server = createSchemaGuardServer();
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool_name: 'counter',
        tool_schema: {
          type: 'object',
          required: ['count'],
          properties: { count: { type: 'integer' } },
        },
        raw_arguments: { count: '3' },
      }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { decision: string; audit: unknown };
    expect(result.decision).toBe('valid_with_repair');
    expect(JSON.stringify(result.audit)).not.toContain('counter');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
  it('creates a configured audit directory and persists only the envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-guard-'));
    const auditPath = join(root, 'nested', 'audit.jsonl');
    process.env.SCHEMA_GUARD_AUDIT_FILE = auditPath;
    server = createSchemaGuardServer();
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    await fetch(`http://127.0.0.1:${address.port}/v1/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool_name: 'private_tool',
        tool_schema: { type: 'object' },
        raw_arguments: { token: 'never-log-me' },
      }),
    });
    const persisted = await readFile(auditPath, 'utf8');
    expect(persisted).not.toContain('never-log-me');
    expect(persisted).not.toContain('private_tool');
  });
  it('returns explicit client errors for invalid normalization and drift requests', async () => {
    server = createSchemaGuardServer();
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { 'content-type': 'application/json' };
    const normalization = await fetch(`${base}/v1/normalize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ adapter: 'unknown', tool: {} }),
    });
    expect(normalization.status).toBe(400);
    expect((await normalization.json()) as unknown).toMatchObject({
      error: 'invalid_normalization_request',
    });
    const drift = await fetch(`${base}/v1/drift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ previous: null, current: {} }),
    });
    expect(drift.status).toBe(400);
    expect((await drift.json()) as unknown).toMatchObject({ error: 'invalid_drift_request' });
  });
});
