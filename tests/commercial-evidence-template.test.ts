import { chmodSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCommercialEvidenceTemplate } from '../scripts/commercial-evidence-template.mjs';
import { evaluateCommercialRelease } from '../scripts/commercial-release-gate.mjs';

const SOURCE_REVISION = '1234567890abcdef1234567890abcdef12345678';
const EXECUTED_AT = '2026-07-26T12:00:00.000Z';

function ownerOnlyParent(): string {
  return mkdtempSync(join(tmpdir(), 'akriven-commercial-template.'));
}

describe('commercial evidence template', () => {
  it('creates only owner-only, unproven private-beta reports', () => {
    const parent = ownerOnlyParent();
    const output = join(parent, 'evidence');
    const summary = writeCommercialEvidenceTemplate({
      target: 'private-beta',
      sourceRevision: SOURCE_REVISION,
      outputDir: output,
      executedAt: EXECUTED_AT,
    });

    expect(summary).toMatchObject({
      reports_created: 10,
      status: 'unproven',
      source_revision: SOURCE_REVISION,
    });
    expect(statSync(output).mode & 0o777).toBe(0o700);
    const identityPath = join(output, 'identity.json');
    expect(statSync(identityPath).mode & 0o777).toBe(0o600);
    const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as {
      status: string;
      source_revision: string;
      checks: Record<string, boolean>;
      artifacts: unknown[];
    };
    expect(identity).toMatchObject({
      status: 'unproven',
      source_revision: SOURCE_REVISION,
      artifacts: [],
    });
    expect(Object.values(identity.checks).every((value) => !value)).toBe(true);

    const billing = JSON.parse(readFileSync(join(output, 'billing.json'), 'utf8')) as {
      variant: string;
    };
    expect(billing.variant).toBe('manual');

    const verdict = evaluateCommercialRelease({
      target: 'private-beta',
      evidenceDir: output,
      sourceRevision: SOURCE_REVISION,
      now: Date.parse(EXECUTED_AT),
    });
    expect(verdict).toMatchObject({ passed: false, verdict: 'no_go' });
    expect(verdict.failures).toHaveLength(10);
  });

  it('uses the stronger public-production gates and Stripe variant', () => {
    const parent = ownerOnlyParent();
    const output = join(parent, 'evidence');
    const summary = writeCommercialEvidenceTemplate({
      target: 'public-production',
      sourceRevision: SOURCE_REVISION,
      outputDir: output,
      executedAt: EXECUTED_AT,
    });

    expect(summary.reports_created).toBe(14);
    const billing = JSON.parse(readFileSync(join(output, 'billing.json'), 'utf8')) as {
      variant: string;
      checks: Record<string, boolean>;
    };
    expect(billing.variant).toBe('stripe_test');
    expect(billing.checks.test_clock).toBe(false);
    expect(statSync(join(output, 'market_validation.json')).mode & 0o777).toBe(0o600);
  });

  it('refuses overwrite and a group-readable parent', () => {
    const parent = ownerOnlyParent();
    const output = join(parent, 'evidence');
    const options = {
      target: 'private-beta' as const,
      sourceRevision: SOURCE_REVISION,
      outputDir: output,
      executedAt: EXECUTED_AT,
    };
    writeCommercialEvidenceTemplate(options);
    expect(() => writeCommercialEvidenceTemplate(options)).toThrow(
      'output directory already exists',
    );

    const unsafeParent = ownerOnlyParent();
    chmodSync(unsafeParent, 0o755);
    expect(() =>
      writeCommercialEvidenceTemplate({
        ...options,
        outputDir: join(unsafeParent, 'evidence'),
      }),
    ).toThrow('output parent must be owner-only');
  });
});
