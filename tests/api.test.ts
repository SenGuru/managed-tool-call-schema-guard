import { afterEach, describe, expect, it } from 'vitest';
import { createSchemaGuardServer } from '../packages/api/src/server.js';
import type { Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server: Server | undefined;
afterEach(() => server?.close());
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
    delete process.env.SCHEMA_GUARD_AUDIT_FILE;
  });
});
