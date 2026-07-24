import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('deployment image identities', () => {
  test('PostgreSQL declares the same non-root identity used by Compose', () => {
    const dockerfile = read('deploy/Dockerfile.postgres');
    const compose = read('deploy/docker-compose.postgres.yml');

    expect(dockerfile).toContain('USER 999:999');
    expect(compose).toContain("user: '999:999'");
  });

  test('the anchor backup reader is non-root and capability-free', () => {
    const dockerfile = read('deploy/Dockerfile.backup-utility');
    const script = read('deploy/host/digitalocean/akriven-backup-anchor.sh');

    expect(dockerfile).toContain('USER 65532:65532');
    expect(script).toContain('--user 65532:65532');
    expect(script).toContain('--cap-drop ALL');
    expect(script).not.toContain('--cap-add');
    expect(script).toContain(
      'install -m 0600 -o 65532 -g 65532 /dev/null "$bundle/anchor-data.tar"',
    );
    expect(script).toContain('-v "$bundle/anchor-data.tar:/destination/anchor-data.tar"');
  });
});
