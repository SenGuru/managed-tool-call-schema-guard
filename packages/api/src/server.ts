import { appendFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import {
  detectSchemaDrift,
  normalizeTool,
  validateToolCall,
  type AdapterName,
  type ValidateRequest,
} from '@schema-guard/core';

const maxBytes = 1_000_000;
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request body exceeds 1 MB');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${JSON.stringify(value)}\n`);
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function createSchemaGuardServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        send(response, 200, { status: 'ok' });
        return;
      }
      if (request.method !== 'POST') {
        send(response, 404, { error: 'not_found' });
        return;
      }
      const input = await body(request);
      if (!object(input)) {
        send(response, 400, { error: 'body_must_be_object' });
        return;
      }
      if (request.url === '/v1/validate') {
        const decision = validateToolCall(input as unknown as ValidateRequest);
        const auditPath = process.env.SCHEMA_GUARD_AUDIT_FILE;
        if (auditPath) {
          await mkdir(dirname(auditPath), { recursive: true, mode: 0o700 });
          await appendFile(auditPath, `${JSON.stringify(decision.audit)}\n`, { mode: 0o600 });
        }
        send(response, decision.decision === 'rejected' ? 422 : 200, decision);
        return;
      }
      if (request.url === '/v1/normalize') {
        send(response, 200, normalizeTool(input.adapter as AdapterName, input.tool));
        return;
      }
      if (request.url === '/v1/drift') {
        send(
          response,
          200,
          detectSchemaDrift(
            input.previous as ValidateRequest['tool_schema'],
            input.current as ValidateRequest['tool_schema'],
          ),
        );
        return;
      }
      send(response, 404, { error: 'not_found' });
    } catch (error) {
      send(response, error instanceof SyntaxError ? 400 : 422, {
        error: 'request_rejected',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  createSchemaGuardServer().listen(port, '127.0.0.1', () => {
    console.log(`Schema Guard listening on http://127.0.0.1:${port}`);
  });
}
