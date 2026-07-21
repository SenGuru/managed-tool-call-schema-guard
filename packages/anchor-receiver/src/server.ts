import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AnchorConflict,
  AnchorStore,
  parseAnchorEvent,
  verifyTransportSignature,
} from './store.js';
import { environmentValue } from './environment.js';

export interface AnchorReceiverConfig {
  databasePath: string;
  signingSecret: string;
  readToken: string;
  chainSecret: string;
  host?: string;
  port?: number;
  accessLog?: boolean;
}

function logRoute(pathname: string): string {
  return pathname.startsWith('/v1/checkpoints/') ? '/v1/checkpoints/:tenant_ref' : pathname;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    length += bytes.length;
    if (length > 65_536) throw new RangeError('body_too_large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function secretEqual(left: string, right: string): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function createAnchorReceiver(config: AnchorReceiverConfig) {
  if (
    !config.databasePath ||
    config.signingSecret.length < 32 ||
    config.readToken.length < 32 ||
    config.chainSecret.length < 32
  )
    throw new TypeError('anchor receiver requires separate 32+ character secrets and a database');
  const store = new AnchorStore(config.databasePath, config.chainSecret);
  let ready = true;
  const server = createServer((request, response) => {
    const started = performance.now();
    const requestId = `req_${randomUUID()}`;
    response.setHeader('x-request-id', requestId);
    if (config.accessLog) {
      response.once('finish', () => {
        let route = '/invalid-url';
        try {
          route = logRoute(new URL(request.url ?? '/', 'http://local').pathname);
        } catch {
          // Keep the privacy-safe fallback route for malformed URLs.
        }
        process.stdout.write(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'schema-guard-anchor-receiver',
            event: 'http_request_completed',
            request_id: requestId,
            method: request.method ?? 'UNKNOWN',
            route,
            status: response.statusCode,
            duration_ms: Number((performance.now() - started).toFixed(3)),
          })}\n`,
        );
      });
    }
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://local');
        if (request.method === 'GET' && url.pathname === '/healthz')
          return json(response, 200, { status: 'ok' });
        if (request.method === 'GET' && url.pathname === '/readyz') {
          const available = ready && store.ready();
          return json(response, available ? 200 : 503, {
            status: available ? 'ready' : 'unavailable',
          });
        }
        if (request.method === 'POST' && url.pathname === '/v1/checkpoints') {
          const exact = await body(request);
          const timestamp =
            typeof request.headers['x-schema-guard-timestamp'] === 'string'
              ? request.headers['x-schema-guard-timestamp']
              : '';
          const signature =
            typeof request.headers['x-schema-guard-signature'] === 'string'
              ? request.headers['x-schema-guard-signature']
              : '';
          if (!verifyTransportSignature(config.signingSecret, timestamp, exact, signature))
            return json(response, 401, { error: 'invalid_signature' });
          const result = store.ingest(parseAnchorEvent(exact), exact);
          return json(
            response,
            result.status === 'stored' || result.status === 'advanced' ? 201 : 200,
            result,
          );
        }
        if (request.method === 'GET' && url.pathname.startsWith('/v1/checkpoints/')) {
          if (!secretEqual(request.headers.authorization ?? '', `Bearer ${config.readToken}`))
            return json(response, 401, { error: 'authentication_required' });
          const checkpoint = store.latest(
            decodeURIComponent(url.pathname.slice('/v1/checkpoints/'.length)),
          );
          return checkpoint
            ? json(response, 200, checkpoint)
            : json(response, 404, { error: 'checkpoint_not_found' });
        }
        return json(response, 404, { error: 'not_found' });
      } catch (error) {
        if (error instanceof AnchorConflict)
          return json(response, 409, { error: error.code, message: error.message });
        if (error instanceof RangeError) return json(response, 413, { error: 'body_too_large' });
        if (error instanceof TypeError)
          return json(response, 400, { error: 'invalid_request', message: error.message });
        return json(response, 500, { error: 'internal_error' });
      }
    })();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;
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

function environment(): AnchorReceiverConfig {
  const databasePath = process.env.SCHEMA_GUARD_ANCHOR_DATABASE;
  const signingSecret = environmentValue('SCHEMA_GUARD_ANCHOR_SIGNING_SECRET');
  const readToken = environmentValue('SCHEMA_GUARD_ANCHOR_READ_TOKEN');
  const chainSecret = environmentValue('SCHEMA_GUARD_ANCHOR_CHAIN_SECRET');
  if (!databasePath || !signingSecret || !readToken || !chainSecret)
    throw new Error('anchor receiver database and three secrets are required');
  return {
    databasePath,
    signingSecret,
    readToken,
    chainSecret,
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 8790),
    accessLog: process.env.SCHEMA_GUARD_ANCHOR_ACCESS_LOG !== 'false',
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const config = environment();
  const receiver = createAnchorReceiver(config);
  receiver.server.listen(config.port, config.host, () =>
    console.log(
      `Schema Guard checkpoint anchor receiver listening on http://${config.host}:${config.port}`,
    ),
  );
  const shutdown = (): void => void receiver.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
