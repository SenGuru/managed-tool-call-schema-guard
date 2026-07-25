import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function environmentKeys(path: string): Set<string> {
  return new Set(
    read(path)
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
      .map((line) => line.slice(0, line.indexOf('='))),
  );
}

function interpolatedVariables(paths: string[]): Set<string> {
  return new Set(
    paths.flatMap((path) =>
      Array.from(read(path).matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/gu), (match) => match[1]),
    ),
  );
}

describe('deployment image identities', () => {
  test('the Node build reuses only npm cache while preserving npm ci integrity', () => {
    const dockerfile = read('Dockerfile');

    expect(dockerfile).toContain('--mount=type=cache,target=/root/.npm,sharing=locked');
    expect(dockerfile).toContain('npm ci ');
  });

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

  test('production services allow an exact reviewed image without changing the fallback', () => {
    expect(read('deploy/docker-compose.production.yml')).toContain(
      '${SCHEMA_GUARD_MANAGED_IMAGE:-schema-guard-managed:0.2.0}',
    );
    expect(read('deploy/docker-compose.anchor-receiver.yml')).toContain(
      '${SCHEMA_GUARD_ANCHOR_IMAGE:-schema-guard-anchor-receiver:0.2.0}',
    );
  });
});

describe('deployment environment templates', () => {
  test('the main-host template declares every Compose interpolation', () => {
    const required = interpolatedVariables([
      'deploy/docker-compose.production.yml',
      'deploy/docker-compose.postgres.yml',
      'deploy/docker-compose.edge.yml',
      'deploy/docker-compose.postmark-staging.yml',
    ]);
    const declared = environmentKeys('deploy/env.production.example');

    expect([...required].filter((key) => !declared.has(key))).toEqual([]);
  });

  test('the anchor-host template declares every Compose interpolation', () => {
    const required = interpolatedVariables([
      'deploy/docker-compose.anchor-receiver.yml',
      'deploy/docker-compose.anchor-edge.yml',
    ]);
    const declared = environmentKeys('deploy/env.anchor-receiver.example');

    expect([...required].filter((key) => !declared.has(key))).toEqual([]);
  });

  test.each([
    'deploy/host/dreamhost/backup.env.example',
    'deploy/host/digitalocean/backup.env.example',
  ])('%s declares the required encrypted backup locations', (path) => {
    const declared = environmentKeys(path);

    for (const key of [
      'AKRIVEN_BACKUP_REMOTE_HOST',
      'AKRIVEN_BACKUP_REMOTE_USER',
      'AKRIVEN_BACKUP_SSH_KEY',
      'AKRIVEN_BACKUP_RECIPIENT_FILE',
      'AKRIVEN_BACKUP_KNOWN_HOSTS',
      'AKRIVEN_BACKUP_REMOTE_DIRECTORY',
      'AKRIVEN_BACKUP_LOCAL_DIRECTORY',
      'AKRIVEN_BACKUP_STATUS_FILE',
      'AKRIVEN_BACKUP_HEARTBEAT_URL_FILE',
    ])
      expect(declared.has(key), key).toBe(true);
    expect(read(path)).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
  });

  test.each([
    'deploy/host/dreamhost/akriven-backup-main.sh',
    'deploy/host/digitalocean/akriven-backup-anchor.sh',
  ])('%s submits successful backup heartbeats from a secret file', (path) => {
    const script = read(path);

    expect(script).toContain('AKRIVEN_BACKUP_HEARTBEAT_URL_FILE');
    expect(script).toContain('grep -Eq');
    expect(script).toContain('curl --fail --silent --show-error --max-time 10');
    expect(script).not.toMatch(/uptime\.betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9]+/u);
  });

  test.each([
    'deploy/host/common/monitor.main.env.example',
    'deploy/host/common/monitor.anchor.env.example',
  ])('%s declares every local monitoring input without a webhook secret', (path) => {
    const declared = environmentKeys(path);

    for (const key of [
      'AKRIVEN_MONITOR_NAME',
      'AKRIVEN_MONITOR_URLS',
      'AKRIVEN_MONITOR_CONTAINERS',
      'AKRIVEN_TLS_HOSTS',
      'AKRIVEN_BACKUP_STATUS_FILE',
      'AKRIVEN_MONITOR_WEBHOOK_FILE',
    ])
      expect(declared.has(key), key).toBe(true);
    expect(declared.has('AKRIVEN_MONITOR_WEBHOOK_URL')).toBe(false);
  });
});

describe('public edge headers', () => {
  test.each(['deploy/Caddyfile.main', 'deploy/Caddyfile.anchor'])(
    '%s sets the baseline HTTPS response protections',
    (path) => {
      const caddyfile = read(path);

      expect(caddyfile).toContain('Strict-Transport-Security "max-age=31536000"');
      expect(caddyfile).toContain('Referrer-Policy "no-referrer"');
      expect(caddyfile).toContain('X-Content-Type-Options "nosniff"');
      expect(caddyfile).toContain('Permissions-Policy "camera=(), geolocation=(), microphone=()"');
    },
  );
});

describe('release audit resilience', () => {
  test('container scanning reports the original missing-output failure', () => {
    const audit = read('scripts/container-vulnerability-audit.mjs');

    expect(audit).toContain('existsSync(output)');
    expect(audit).toContain('Trivy did not produce a report');
  });

  test('framework integration discovers an installed Python 3.10+ runtime', () => {
    const audit = read('scripts/framework-integration-audit.mjs');

    expect(audit).toContain("'python3.13'");
    expect(audit).toContain("'python3.10'");
    expect(audit).toContain('.find(supportedPython)');
  });

  test('commercial certification is exact-revision, approval-scoped, and fail-closed', () => {
    const workflow = read('.github/workflows/commercial-release.yml');
    const internalWorkflow = read('.github/workflows/release-candidate.yml');

    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('environment:');
    expect(workflow).toContain('name: commercial-${{ inputs.target }}');
    expect(workflow).toContain('deployment: false');
    expect(workflow).toContain(
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    );
    expect(workflow).toContain('digest-mismatch: error');
    expect(workflow).toContain('chmod -R go-rwx commercial-evidence');
    expect(workflow).toContain('--source-revision "${GITHUB_SHA}"');
    expect(workflow).toContain('npm run audit:commercial-release');
    expect(workflow).toContain('if: always()');
    expect(internalWorkflow).toContain('not commercial approval');
  });
});
