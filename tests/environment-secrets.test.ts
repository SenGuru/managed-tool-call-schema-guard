import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { environmentValue as managedEnvironmentValue } from '../packages/managed/src/environment.js';
import { environmentValue as anchorEnvironmentValue } from '../packages/anchor-receiver/src/environment.js';

describe.each([
  ['managed', managedEnvironmentValue],
  ['anchor receiver', anchorEnvironmentValue],
])('%s secret-file environment loading', (_name, environmentValue) => {
  it('loads an injected secret file without retaining its trailing newline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-secret-file-'));
    const path = join(directory, 'secret');
    await writeFile(path, 'secret-value\n', { mode: 0o400 });
    expect(environmentValue('SERVICE_SECRET', { SERVICE_SECRET_FILE: path })).toBe('secret-value');
  });

  it('rejects ambiguous and oversized secret configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'schema-guard-secret-file-'));
    const path = join(directory, 'secret');
    await writeFile(path, 'file-value');
    expect(() =>
      environmentValue('SERVICE_SECRET', {
        SERVICE_SECRET: 'direct-value',
        SERVICE_SECRET_FILE: path,
      }),
    ).toThrow(/cannot both/u);
    const oversized = join(directory, 'oversized');
    await writeFile(oversized, 'x'.repeat(65_537));
    expect(() => environmentValue('SERVICE_SECRET', { SERVICE_SECRET_FILE: oversized })).toThrow(
      /no larger/u,
    );
  });
});
