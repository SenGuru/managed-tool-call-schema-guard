import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('host monitor bounded execution', () => {
  it('bounds HTTP, TLS, and systemd execution time', async () => {
    const [script, unit] = await Promise.all([
      readFile('deploy/host/common/akriven-monitor.sh', 'utf8'),
      readFile('deploy/host/common/akriven-monitor.service', 'utf8'),
    ]);

    expect(script).toContain('curl --fail --silent --show-error --max-time 10');
    expect(script).toContain('TLS_CONNECT_TIMEOUT=${AKRIVEN_TLS_CONNECT_TIMEOUT_SECONDS:-10}');
    expect(script).toContain('timeout --signal=TERM --kill-after=2s "${TLS_CONNECT_TIMEOUT}s"');
    expect(script).toContain('"$TLS_CONNECT_TIMEOUT" -gt 60');
    expect(unit).toContain('TimeoutStartSec=120');
  });
});
