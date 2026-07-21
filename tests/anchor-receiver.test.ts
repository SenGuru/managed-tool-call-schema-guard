import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnchorReceiver } from '../packages/anchor-receiver/src/server.js';
import type { AnchorEvent } from '../packages/anchor-receiver/src/store.js';
import { signAlertWebhookPayload } from '../packages/managed/src/webhook.js';

const signingSecret = 'anchor-receiver-transport-secret-at-least-32-characters';
const readToken = 'anchor-receiver-read-token-at-least-32-characters';
const chainSecret = 'anchor-receiver-chain-secret-at-least-32-characters';
const tenantRef = `hmac-sha256:${'1'.repeat(64)}`;
const open: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const service of open.splice(0)) await service.close();
});

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-anchor-receiver-')), 'anchor.db');
}

function event(revision: number, eventDigit: string, checkpointDigit = eventDigit): AnchorEvent {
  return {
    schema_version: '2026-07-20',
    event_type: 'schema_guard.action_idempotency_checkpoint',
    event_id: `hmac-sha256:${eventDigit.repeat(64)}`,
    checkpoint: {
      checkpoint_version: '1',
      tenant_ref: tenantRef,
      revision,
      row_count: revision,
      accumulator: `xor256:${checkpointDigit.repeat(64)}`,
      updated_at: new Date(Date.now() + revision).toISOString(),
      checkpoint_hash: `hmac-sha256:${checkpointDigit.repeat(64)}`,
    },
  };
}

describe('independent checkpoint anchor receiver', () => {
  it('emits correlation IDs and privacy-normalized structured access logs', async () => {
    const output: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
    try {
      const service = createAnchorReceiver({
        databasePath: await database(),
        signingSecret,
        readToken,
        chainSecret,
        accessLog: true,
      });
      open.push(service);
      await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      const address = service.server.address();
      if (!address || typeof address === 'string') throw new Error('missing receiver address');
      const response = await fetch(
        `http://127.0.0.1:${address.port}/v1/checkpoints/${encodeURIComponent(tenantRef)}`,
        { headers: { authorization: `Bearer ${readToken}` } },
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('x-request-id')).toMatch(/^req_[0-9a-f-]{36}$/u);
      await new Promise((resolve) => setImmediate(resolve));
      const logs = output.join('');
      expect(logs).toContain('"event":"http_request_completed"');
      expect(logs).toContain('"route":"/v1/checkpoints/:tenant_ref"');
      expect(logs).not.toContain(tenantRef);
      expect(logs).not.toContain(readToken);
    } finally {
      write.mockRestore();
    }
  });

  it('authenticates exact bodies and enforces monotonic rollback/fork semantics', async () => {
    const databasePath = await database();
    const service = createAnchorReceiver({ databasePath, signingSecret, readToken, chainSecret });
    open.push(service);
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing receiver address');
    const base = `http://127.0.0.1:${address.port}`;
    const send = async (payload: AnchorEvent, timestamp = new Date().toISOString()) => {
      const exact = JSON.stringify(payload);
      return fetch(`${base}/v1/checkpoints`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-schema-guard-timestamp': timestamp,
          'x-schema-guard-signature': signAlertWebhookPayload(signingSecret, timestamp, exact),
        },
        body: exact,
      });
    };

    const first = event(1, '2');
    expect(await (await send(first)).json()).toMatchObject({ status: 'stored', revision: 1 });
    expect(await (await send(first)).json()).toMatchObject({ status: 'duplicate' });
    expect(await (await send(event(1, '3', '2'))).json()).toMatchObject({ status: 'replay' });
    expect(await (await send(event(2, '4'))).json()).toMatchObject({
      status: 'advanced',
      revision: 2,
    });

    const rollback = await send(event(1, '5'));
    expect(rollback.status).toBe(409);
    expect(await rollback.json()).toMatchObject({ error: 'rollback_detected' });
    const fork = await send(event(2, '6'));
    expect(fork.status).toBe(409);
    expect(await fork.json()).toMatchObject({ error: 'integrity_conflict' });
    const reused = structuredClone(first);
    reused.checkpoint.row_count = 999;
    const eventConflict = await send(reused);
    expect(eventConflict.status).toBe(409);
    expect(await eventConflict.json()).toMatchObject({ error: 'event_conflict' });

    const stale = await send(event(3, '7'), '2000-01-01T00:00:00.000Z');
    expect(stale.status).toBe(401);
    expect((await fetch(`${base}/v1/checkpoints/${encodeURIComponent(tenantRef)}`)).status).toBe(
      401,
    );
    const latest = await fetch(`${base}/v1/checkpoints/${encodeURIComponent(tenantRef)}`, {
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(latest.status).toBe(200);
    expect(await latest.json()).toMatchObject({
      revision: 2,
      checkpoint_hash: event(2, '4').checkpoint.checkpoint_hash,
    });
    expect(service.store.verify()).toEqual({ valid: true, checked: 2 });
    expect(
      JSON.stringify(service.store.db.prepare('SELECT * FROM latest_checkpoints').all()),
    ).not.toContain('customer');

    const external = new Database(databasePath);
    external.prepare("UPDATE anchor_events SET checkpoint_hash='forged' WHERE revision=2").run();
    external.close();
    expect(service.store.verify()).toMatchObject({ valid: false });
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
  });

  it('rejects malformed and unsigned payloads before state mutation', async () => {
    const service = createAnchorReceiver({
      databasePath: await database(),
      signingSecret,
      readToken,
      chainSecret,
    });
    open.push(service);
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing receiver address');
    const base = `http://127.0.0.1:${address.port}`;
    expect(
      (
        await fetch(`${base}/v1/checkpoints`, {
          method: 'POST',
          body: JSON.stringify(event(1, '2')),
        })
      ).status,
    ).toBe(401);
    const timestamp = new Date().toISOString();
    const malformed = '{}';
    const response = await fetch(`${base}/v1/checkpoints`, {
      method: 'POST',
      headers: {
        'x-schema-guard-timestamp': timestamp,
        'x-schema-guard-signature': signAlertWebhookPayload(signingSecret, timestamp, malformed),
      },
      body: malformed,
    });
    expect(response.status).toBe(400);
    expect(service.store.db.prepare('SELECT COUNT(*) count FROM anchor_events').get()).toEqual({
      count: 0,
    });
  });
});
