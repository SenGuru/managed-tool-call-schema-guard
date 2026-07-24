import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedStore } from '../packages/managed/src/store.js';

const secret = 'tenant-lifecycle-test-secret-at-least-32-characters';
const execFileAsync = promisify(execFile);
const open: Array<{ close(): Promise<void> | void }> = [];

async function database(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'schema-guard-lifecycle-')), 'managed.db');
}

async function expectCommandFailure(
  command: ReturnType<typeof execFileAsync>,
  message: string,
): Promise<void> {
  try {
    await command;
    throw new Error('command unexpectedly succeeded');
  } catch (error) {
    expect((error as { stderr?: string }).stderr).toContain(message);
  }
}

afterEach(async () => {
  for (const service of open.splice(0)) await service.close();
});

describe('tenant lifecycle', () => {
  it('refuses public/shared bootstrap without an explicit stopped-service assertion', async () => {
    const path = await database();
    const executable = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    try {
      await execFileAsync(
        executable,
        [
          'packages/managed/src/bootstrap.ts',
          '--database',
          path,
          '--tenant-id',
          'unsafe-online-bootstrap',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            SCHEMA_GUARD_MASTER_SECRET: secret,
            SCHEMA_GUARD_PUBLIC_MODE: 'true',
          },
        },
      );
      throw new Error('public bootstrap unexpectedly succeeded');
    } catch (error) {
      expect((error as { stderr?: string }).stderr).toContain('--service-state stopped');
    }
  });

  it('writes a generated public bootstrap key to an owner-only file without printing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-bootstrap-key-'));
    const path = join(directory, 'managed.db');
    const keyPath = join(directory, 'bootstrap.key');
    const executable = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(
      executable,
      [
        'packages/managed/src/bootstrap.ts',
        '--database',
        path,
        '--tenant-id',
        'secure-bootstrap',
        '--api-key-output-file',
        keyPath,
        '--service-state',
        'stopped',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SCHEMA_GUARD_MASTER_SECRET: secret,
          SCHEMA_GUARD_PUBLIC_MODE: 'true',
        },
      },
    );
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result).toMatchObject({
      tenant_id: 'secure-bootstrap',
      api_key_file: keyPath,
    });
    expect(result).not.toHaveProperty('api_key');
    expect(stdout).not.toContain('sg_live_');
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    const key = (await readFile(keyPath, 'utf8')).trim();
    expect(key).toMatch(/^sg_live_[A-Za-z0-9_-]+$/u);
    const store = new ManagedStore({ databasePath: path, masterSecret: secret });
    open.push(store);
    expect(store.authenticate(key)).toMatchObject({ tenantId: 'secure-bootstrap' });
  });

  it('rejects public bootstrap keys in observable arguments or writable files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-bootstrap-key-'));
    const executable = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const environment = {
      ...process.env,
      SCHEMA_GUARD_MASTER_SECRET: secret,
      SCHEMA_GUARD_PUBLIC_MODE: 'true',
    };
    await expectCommandFailure(
      execFileAsync(
        executable,
        [
          'packages/managed/src/bootstrap.ts',
          '--database',
          join(directory, 'argument.db'),
          '--tenant-id',
          'argument-bootstrap',
          '--api-key',
          'observable-bootstrap-key-at-least-32-characters',
          '--service-state',
          'stopped',
        ],
        { cwd: process.cwd(), env: environment },
      ),
      '--api-key is forbidden for public/shared bootstrap',
    );

    const writableKeyPath = join(directory, 'writable.key');
    await writeFile(writableKeyPath, 'file-bootstrap-key-at-least-32-characters\n');
    await chmod(writableKeyPath, 0o666);
    await expectCommandFailure(
      execFileAsync(
        executable,
        [
          'packages/managed/src/bootstrap.ts',
          '--database',
          join(directory, 'file.db'),
          '--tenant-id',
          'file-bootstrap',
          '--api-key-file',
          writableKeyPath,
          '--service-state',
          'stopped',
        ],
        { cwd: process.cwd(), env: environment },
      ),
      'must not be writable by group or other users',
    );
  });

  it('backfills an active lifecycle when upgrading an existing version-14 database', async () => {
    const path = await database();
    const original = new ManagedStore({ databasePath: path, masterSecret: secret });
    original.bootstrapTenant({
      id: 'upgrade',
      name: 'Upgrade',
      plan: 'trial',
      apiKey: 'upgrade-key',
    });
    original.db.exec(
      'DROP TABLE tenant_lifecycle; DROP TABLE tenant_deletion_receipts; PRAGMA user_version=14',
    );
    original.close();

    const upgraded = new ManagedStore({ databasePath: path, masterSecret: secret });
    open.push(upgraded);
    const principal = upgraded.authenticate('upgrade-key');
    expect(principal).toMatchObject({ tenantId: 'upgrade', lifecycleStatus: 'active' });
    expect(upgraded.tenantLifecycle(principal!)).toMatchObject({
      status: 'active',
      reason_code: null,
      deletion_requested_at: null,
    });
    expect(upgraded.readinessCheck()).toBe(true);
  });

  it('fails closed for suspended, canceled, and deletion-pending tenants while preserving lifecycle access', async () => {
    const service = createManagedServer({ databasePath: await database(), masterSecret: secret });
    open.push(service);
    service.store.bootstrapTenant({
      id: 'tenant-a',
      name: 'Tenant A',
      plan: 'trial',
      apiKey: 'admin-a',
    });
    const admin = service.store.authenticate('admin-a')!;
    const validateOnly = service.store.issueApiKey(admin, ['validate']);
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: 'Bearer admin-a',
      'content-type': 'application/json',
    };

    const lifecycle = await fetch(`${base}/v1/admin/tenant/lifecycle`, { headers });
    expect(lifecycle.status).toBe(200);
    expect(await lifecycle.json()).toMatchObject({ lifecycle: { status: 'active' } });
    expect(
      (
        await fetch(`${base}/v1/admin/tenant/lifecycle`, {
          headers: { authorization: `Bearer ${validateOnly.api_key}` },
        })
      ).status,
    ).toBe(403);
    const exportedResponse = await fetch(`${base}/v1/admin/tenant/export`, { headers });
    expect(exportedResponse.status).toBe(200);
    expect(exportedResponse.headers.get('content-disposition')).toContain(
      'akriven-tenant-export-tenant-a.json',
    );
    const exported = (await exportedResponse.json()) as {
      content_sha256: string;
      tenant: Record<string, unknown>;
      tables: Record<string, Array<Record<string, unknown>>>;
    };
    expect(exported.content_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(exported.tenant).not.toHaveProperty('control_hmac');
    expect(exported.tables.api_keys?.[0]).toMatchObject({
      tenant_id: 'tenant-a',
      prefix: 'admin-a',
    });
    expect(exported.tables.api_keys?.[0]).not.toHaveProperty('key_hash');
    expect(exported.tables.api_keys?.[0]).not.toHaveProperty('control_hmac');
    expect(JSON.stringify(exported)).not.toContain(secret);

    const unconfirmed = await fetch(`${base}/v1/admin/tenant/deletion-request`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirm_tenant_id: 'other-tenant' }),
    });
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json()).toMatchObject({
      error: 'tenant_confirmation_required',
    });

    const requested = await fetch(`${base}/v1/admin/tenant/deletion-request`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirm_tenant_id: 'tenant-a' }),
    });
    expect(requested.status).toBe(202);
    expect(await requested.json()).toMatchObject({
      lifecycle: {
        status: 'deletion_pending',
        reason_code: 'customer_requested',
      },
      execution: 'operator_confirmation_required',
    });
    const repeated = await fetch(`${base}/v1/admin/tenant/deletion-request`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirm_tenant_id: 'tenant-a' }),
    });
    expect(repeated.status).toBe(202);

    const blocked = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool_name: 'counter',
        tool_schema: {
          type: 'object',
          properties: { count: { type: 'integer' } },
        },
        raw_arguments: { count: 1 },
      }),
    });
    expect(blocked.status).toBe(423);
    expect(await blocked.json()).toMatchObject({ error: 'tenant_deletion_pending' });
    expect(
      (
        await fetch(`${base}/v1/admin/tenant/lifecycle`, {
          headers: { authorization: 'Bearer admin-a' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/v1/admin/tenant/export`, {
          headers: { authorization: 'Bearer admin-a' },
        })
      ).status,
    ).toBe(200);

    service.store.updateTenantLifecycle(admin, 'active', 'operator_restored');
    expect(
      (
        await fetch(`${base}/v1/validate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tool_name: 'counter',
            tool_schema: {
              type: 'object',
              properties: { count: { type: 'integer' } },
            },
            raw_arguments: { count: 1 },
          }),
        })
      ).status,
    ).toBe(200);

    for (const status of ['suspended', 'canceled'] as const) {
      service.store.updateTenantLifecycle(admin, status, `operator_${status}`);
      const response = await fetch(`${base}/v1/usage`, {
        headers: { authorization: 'Bearer admin-a' },
      });
      expect(response.status).toBe(423);
      expect(await response.json()).toMatchObject({ error: `tenant_${status}` });
      service.store.updateTenantLifecycle(admin, 'active', 'operator_restored');
    }
  });

  it('detects lifecycle substitution and refuses readiness and authentication', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    open.push(store);
    store.bootstrapTenant({
      id: 'tamper',
      name: 'Tamper',
      plan: 'trial',
      apiKey: 'tamper-key',
    });
    store.db
      .prepare(
        "UPDATE tenant_lifecycle SET status='suspended',reason_code='forged' WHERE tenant_id='tamper'",
      )
      .run();
    expect(store.readinessCheck()).toBe(false);
    expect(store.authenticate('tamper-key')).toBeUndefined();
  });

  it('requires a reviewed current export before deleting a pending tenant and retains only a signed receipt', async () => {
    const store = new ManagedStore({ databasePath: await database(), masterSecret: secret });
    open.push(store);
    store.bootstrapTenant({
      id: 'delete-me',
      name: 'Delete Me',
      plan: 'team',
      apiKey: 'delete-key',
    });
    expect(() => store.operatorDeleteTenant('delete-me', `sha256:${'0'.repeat(64)}`)).toThrow(
      /must be deletion_pending/u,
    );
    store.operatorUpdateTenantLifecycle('delete-me', 'deletion_pending', 'customer_requested');
    const exported = store.operatorExportTenantData('delete-me');
    expect(() => store.operatorDeleteTenant('delete-me', `sha256:${'0'.repeat(64)}`)).toThrow(
      /data changed after export/u,
    );
    const receipt = store.operatorDeleteTenant('delete-me', String(exported.content_sha256));
    expect(receipt).toMatchObject({
      export_sha256: exported.content_sha256,
    });
    expect(receipt.tenant_ref).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    expect(receipt.receipt_hmac).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    expect(store.authenticate('delete-key')).toBeUndefined();
    expect(
      (
        store.db.prepare('SELECT COUNT(*) count FROM tenants WHERE id=?').get('delete-me') as {
          count: number;
        }
      ).count,
    ).toBe(0);
    expect(
      (
        store.db.prepare('SELECT COUNT(*) count FROM tenant_deletion_receipts').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    expect(store.readinessCheck()).toBe(true);
    store.db.prepare("UPDATE tenant_deletion_receipts SET export_sha256='sha256:forged'").run();
    expect(store.readinessCheck()).toBe(false);
  });

  it('executes the offline operator inspect, transition, export, and deletion workflow', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-operator-'));
    const path = join(directory, 'managed.db');
    const exportPath = join(directory, 'tenant-export.json');
    const confirmationPath = join(directory, 'delete-confirmation.json');
    const setup = new ManagedStore({ databasePath: path, masterSecret: secret });
    setup.bootstrapTenant({
      id: 'operator-flow',
      name: 'Operator Flow',
      plan: 'trial',
      apiKey: 'operator-flow-key',
    });
    setup.close();
    const executable = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const environment = {
      ...process.env,
      SCHEMA_GUARD_MASTER_SECRET: secret,
    };
    const common = ['--database', path, '--tenant-id', 'operator-flow'];
    const inspect = await execFileAsync(
      executable,
      ['packages/managed/src/tenant-operator.ts', 'inspect', ...common],
      { cwd: process.cwd(), env: environment },
    );
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      tenant_id: 'operator-flow',
      local: { status: 'active' },
    });
    await execFileAsync(
      executable,
      [
        'packages/managed/src/tenant-operator.ts',
        'transition',
        ...common,
        '--service-state',
        'stopped',
        '--status',
        'deletion_pending',
        '--reason-code',
        'customer_requested',
      ],
      { cwd: process.cwd(), env: environment },
    );
    const exported = await execFileAsync(
      executable,
      [
        'packages/managed/src/tenant-operator.ts',
        'export',
        ...common,
        '--service-state',
        'stopped',
        '--output',
        exportPath,
      ],
      { cwd: process.cwd(), env: environment },
    );
    const summary = JSON.parse(exported.stdout) as {
      local_export_sha256: string;
    };
    expect(summary.local_export_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect((await stat(exportPath)).mode & 0o077).toBe(0);
    const bundle = JSON.parse(await readFile(exportPath, 'utf8')) as {
      tenant_id: string;
      local: { tables: Record<string, unknown[]> };
    };
    expect(bundle.tenant_id).toBe('operator-flow');
    expect(bundle.local.tables.api_keys).toHaveLength(1);
    await writeFile(
      confirmationPath,
      `${JSON.stringify({
        tenant_id: 'operator-flow',
        confirm: 'delete tenant operator-flow',
        local_export_sha256: summary.local_export_sha256,
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(confirmationPath, 0o600);
    const deleted = await execFileAsync(
      executable,
      [
        'packages/managed/src/tenant-operator.ts',
        'delete',
        ...common,
        '--service-state',
        'stopped',
        '--confirmation-file',
        confirmationPath,
      ],
      { cwd: process.cwd(), env: environment },
    );
    expect(JSON.parse(deleted.stdout)).toMatchObject({
      tenant_id: 'operator-flow',
      deleted: true,
    });
    const verified = new ManagedStore({ databasePath: path, masterSecret: secret });
    open.push(verified);
    expect(verified.authenticate('operator-flow-key')).toBeUndefined();
    expect(verified.readinessCheck()).toBe(true);
  }, 20_000);
});
