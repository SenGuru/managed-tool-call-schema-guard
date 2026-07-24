import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'packages/cli/src/cli.ts', ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('managed CLI workflow', () => {
  it('reads a scoped resource using an owner-only API-key file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-cli-managed-'));
    temporaryDirectories.push(directory);
    const keyFile = join(directory, 'api-key');
    await writeFile(keyFile, 'test-api-key\n', { mode: 0o600 });
    let observedAuthorization: string | undefined;
    const server = createServer((request, response) => {
      observedAuthorization = request.headers.authorization;
      expect(request.url).toBe('/v1/usage');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          plan: 'team',
          monthly_limit: 250_000,
          usage: { validation_count: 4 },
          payment_processing: 'not_configured_local_mode',
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing CLI test address');
      const result = await runCli([
        'managed',
        '--base-url',
        `http://127.0.0.1:${address.port}`,
        '--api-key-file',
        keyFile,
        '--resource',
        'usage',
      ]);
      expect(result).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(result.stdout)).toMatchObject({ plan: 'team' });
      expect(observedAuthorization).toBe('Bearer test-api-key');
      expect(result.stdout).not.toContain('test-api-key');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects API-key files readable by other users before making a request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-cli-managed-'));
    temporaryDirectories.push(directory);
    const keyFile = join(directory, 'api-key');
    await writeFile(keyFile, 'test-api-key\n', { mode: 0o600 });
    await chmod(keyFile, 0o644);
    const result = await runCli([
      'managed',
      '--base-url',
      'https://api.example.test',
      '--api-key-file',
      keyFile,
      '--resource',
      'usage',
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('must not be accessible by group or other users');
    expect(result.stderr).not.toContain('test-api-key');
  });

  it('reads plans and API-key inventory and acknowledges an alert without exposing the key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-cli-managed-'));
    temporaryDirectories.push(directory);
    const keyFile = join(directory, 'api-key');
    await writeFile(keyFile, 'alert-admin-key\n', { mode: 0o600 });
    const observed: Array<{ method: string; path: string }> = [];
    const server = createServer((request, response) => {
      observed.push({ method: request.method ?? '', path: request.url ?? '' });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        request.url === '/v1/plans'
          ? JSON.stringify({ plans: [{ id: 'team', display_name: 'Private-beta design partner' }] })
          : request.url === '/v1/admin/api-keys'
            ? JSON.stringify({
                api_keys: [{ key_id: 'key_1', prefix: 'sg_live_1234', current: false }],
              })
            : request.url?.startsWith('/v1/actions/challenges')
              ? JSON.stringify({
                  challenges: [{ challenge_id: 'challenge_1', status: 'pending' }],
                })
              : JSON.stringify({ acknowledged: true, alert_id: 7 }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing CLI test address');
      const base = `http://127.0.0.1:${address.port}`;
      const plans = await runCli([
        'managed',
        '--base-url',
        base,
        '--api-key-file',
        keyFile,
        '--resource',
        'plans',
      ]);
      const acknowledged = await runCli([
        'managed-acknowledge-alert',
        '--base-url',
        base,
        '--api-key-file',
        keyFile,
        '--alert-id',
        '7',
      ]);
      const apiKeys = await runCli([
        'managed',
        '--base-url',
        base,
        '--api-key-file',
        keyFile,
        '--resource',
        'api-keys',
      ]);
      const challenges = await runCli([
        'managed',
        '--base-url',
        base,
        '--api-key-file',
        keyFile,
        '--resource',
        'action-challenges',
        '--status',
        'pending',
        '--limit',
        '25',
      ]);
      expect(plans).toMatchObject({ code: 0, stderr: '' });
      expect(apiKeys).toMatchObject({ code: 0, stderr: '' });
      expect(challenges).toMatchObject({ code: 0, stderr: '' });
      expect(acknowledged).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(apiKeys.stdout)).toMatchObject({
        api_keys: [{ key_id: 'key_1', current: false }],
      });
      expect(JSON.parse(challenges.stdout)).toMatchObject({
        challenges: [{ challenge_id: 'challenge_1', status: 'pending' }],
      });
      expect(JSON.parse(acknowledged.stdout)).toEqual({ acknowledged: true, alert_id: 7 });
      expect(observed).toEqual([
        { method: 'GET', path: '/v1/plans' },
        { method: 'POST', path: '/v1/alerts/7/acknowledge' },
        { method: 'GET', path: '/v1/admin/api-keys' },
        { method: 'GET', path: '/v1/actions/challenges?status=pending&limit=25' },
      ]);
      expect(
        `${plans.stdout}${apiKeys.stdout}${challenges.stdout}${acknowledged.stdout}`,
      ).not.toContain('alert-admin-key');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('reads lifecycle and export resources and submits an exact deletion request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-cli-managed-'));
    temporaryDirectories.push(directory);
    const keyFile = join(directory, 'api-key');
    await writeFile(keyFile, 'admin-api-key\n', { mode: 0o600 });
    const observed: Array<{ method: string; path: string; body: unknown }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = chunks.length
          ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
          : undefined;
        observed.push({
          method: request.method ?? '',
          path: request.url ?? '',
          body,
        });
        response.writeHead(request.url?.endsWith('deletion-request') ? 202 : 200, {
          'content-type': 'application/json',
        });
        if (request.url?.endsWith('/lifecycle'))
          response.end(
            JSON.stringify({
              lifecycle: {
                status: 'active',
                reason_code: null,
                deletion_requested_at: null,
                updated_at: '2026-07-23T00:00:00.000Z',
              },
            }),
          );
        else if (request.url?.endsWith('/export'))
          response.end(
            JSON.stringify({
              export_version: 1,
              tenant_id: 'tenant-a',
              content_sha256: `sha256:${'a'.repeat(64)}`,
              tenant: {},
              tables: {},
            }),
          );
        else
          response.end(
            JSON.stringify({
              lifecycle: {
                status: 'deletion_pending',
                reason_code: 'customer_requested',
                deletion_requested_at: '2026-07-23T00:00:00.000Z',
                updated_at: '2026-07-23T00:00:00.000Z',
              },
            }),
          );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing CLI test address');
      const base = `http://127.0.0.1:${address.port}`;
      for (const resource of ['tenant-lifecycle', 'tenant-export']) {
        const result = await runCli([
          'managed',
          '--base-url',
          base,
          '--api-key-file',
          keyFile,
          '--resource',
          resource,
        ]);
        expect(result).toMatchObject({ code: 0, stderr: '' });
      }
      const deletion = await runCli([
        'managed-request-deletion',
        '--base-url',
        base,
        '--api-key-file',
        keyFile,
        '--confirm-tenant-id',
        'tenant-a',
      ]);
      expect(deletion).toMatchObject({ code: 0, stderr: '' });
      expect(observed).toEqual([
        { method: 'GET', path: '/v1/admin/tenant/lifecycle', body: undefined },
        { method: 'GET', path: '/v1/admin/tenant/export', body: undefined },
        {
          method: 'POST',
          path: '/v1/admin/tenant/deletion-request',
          body: { confirm_tenant_id: 'tenant-a' },
        },
      ]);
      expect(deletion.stdout).not.toContain('admin-api-key');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15_000);

  it('writes checkout and portal session URLs only to new owner-only files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-cli-billing-'));
    temporaryDirectories.push(directory);
    const keyFile = join(directory, 'api-key');
    await writeFile(keyFile, 'billing-api-key\n', { mode: 0o600 });
    const server = createServer((request, response) => {
      response.writeHead(201, { 'content-type': 'application/json' });
      if (request.url?.endsWith('/checkout-session'))
        response.end(
          JSON.stringify({
            session_id: 'cs_test_cli',
            url: 'https://checkout.stripe.com/c/pay/cli-sensitive',
            expires_at: '2030-01-01T00:00:00.000Z',
          }),
        );
      else
        response.end(
          JSON.stringify({
            url: 'https://billing.stripe.com/p/session/cli-sensitive',
          }),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing CLI test address');
      const base = `http://127.0.0.1:${address.port}`;
      for (const [command, filename, expected] of [
        [
          'managed-billing-checkout',
          'checkout.json',
          'https://checkout.stripe.com/c/pay/cli-sensitive',
        ],
        [
          'managed-billing-portal',
          'portal.json',
          'https://billing.stripe.com/p/session/cli-sensitive',
        ],
      ] as const) {
        const output = join(directory, filename);
        const result = await runCli([
          command,
          '--base-url',
          base,
          '--api-key-file',
          keyFile,
          '--out',
          output,
        ]);
        expect(result).toMatchObject({ code: 0, stderr: '' });
        expect(result.stdout).not.toContain(expected);
        expect((await stat(output)).mode & 0o777).toBe(0o600);
        expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ url: expected });
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15_000);
});
