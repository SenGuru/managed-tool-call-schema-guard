import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateCommercialRelease } from '../scripts/commercial-release-gate.mjs';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const SOURCE_REVISION = '1234567890abcdef1234567890abcdef12345678';

const requirements = {
  internal: [
    'full_regression',
    'postgres',
    'container_e2e',
    'sdk_cli',
    'security_scans',
    'migration_rollback',
  ],
  website: ['private_hosted', 'route_inventory', 'onboarding_handoff'],
  staging: ['tls_edge', 'separate_anchor', 'outage_recovery', 'backup_restore'],
  identity: ['callback_session', 'mfa', 'logout_revoke', 'recovery', 'tenant_isolation'],
  human_email: ['mailbox_ready', 'inbound', 'outbound', 'recovery'],
  transactional_email: ['domain_auth', 'delivery', 'bounce', 'retry_dead_letter', 'privacy'],
  operations: [
    'monitoring',
    'paging_delivery',
    'restore_drill',
    'runbooks',
    'support_owner',
    'incident_owner',
  ],
  security: [
    'dependency_scan',
    'secret_scan',
    'image_scan',
    'auth_abuse',
    'tenant_isolation',
    'secret_custody',
  ],
  model_providers: ['openai_live', 'anthropic_live', 'gemini_live'],
  billing: [
    'manual_invoice_policy',
    'operator_entitlement',
    'cancellation_policy',
    'no_automated_charge',
  ],
};

function digest(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function evidenceDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'akriven-commercial-gate.'));
}

function writeGate(
  directory: string,
  gateId:
    | keyof typeof requirements
    | 'legal'
    | 'independent_review'
    | 'customer_integration'
    | 'market_validation',
  checks: string[],
  overrides: Record<string, unknown> = {},
): void {
  const artifactName = `${gateId}.artifact.json`;
  const artifactPath = join(directory, artifactName);
  writeFileSync(artifactPath, '{"redacted":true}\n', { mode: 0o600 });
  const report = {
    report_version: '1',
    gate_id: gateId,
    source_revision: SOURCE_REVISION,
    status: 'proven',
    redacted: true,
    evidence_kind: 'external_provider',
    executed_at: new Date(NOW - 60_000).toISOString(),
    checks: Object.fromEntries(checks.map((check) => [check, true])),
    artifacts: [{ path: artifactName, sha256: digest(artifactPath) }],
    ...(gateId === 'billing' ? { variant: 'manual' } : {}),
    ...overrides,
  };
  writeFileSync(join(directory, `${gateId}.json`), `${JSON.stringify(report)}\n`, {
    mode: 0o600,
  });
}

function completePrivateEvidence(directory: string): void {
  for (const [gateId, checks] of Object.entries(requirements))
    writeGate(directory, gateId as keyof typeof requirements, checks);
}

describe('commercial release gate', () => {
  it('fails closed when evidence reports are absent', () => {
    const directory = evidenceDirectory();
    const report = evaluateCommercialRelease({
      target: 'private-beta',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    expect(report).toMatchObject({ passed: false, verdict: 'no_go' });
    expect(report.failures).toHaveLength(10);
  });

  it('rejects configured-only, stale, incomplete, and secret-bearing reports', () => {
    const directory = evidenceDirectory();
    completePrivateEvidence(directory);
    const identityPath = join(directory, 'identity.json');
    const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as {
      status: string;
      executed_at: string;
      checks: Record<string, boolean>;
      api_key?: string;
    };
    identity.status = 'configured_only';
    identity.executed_at = '2025-01-01T00:00:00.000Z';
    identity.checks.mfa = false;
    identity.api_key = 'must-never-appear';
    writeFileSync(identityPath, `${JSON.stringify(identity)}\n`, { mode: 0o600 });

    const report = evaluateCommercialRelease({
      target: 'private-beta',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    const gate = report.gate_results.find((item) => item.gate_id === 'identity');
    expect(gate?.failures).toEqual(
      expect.arrayContaining([
        'status must be proven',
        'report contains a forbidden secret-bearing key',
        'evidence is stale',
        'required check is not proven: mfa',
      ]),
    );
  });

  it('rejects evidence bound to a different source revision', () => {
    const directory = evidenceDirectory();
    completePrivateEvidence(directory);
    const identityPath = join(directory, 'identity.json');
    const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as {
      source_revision: string;
    };
    identity.source_revision = 'abcdef1234567890abcdef1234567890abcdef12';
    writeFileSync(identityPath, `${JSON.stringify(identity)}\n`, { mode: 0o600 });

    const report = evaluateCommercialRelease({
      target: 'private-beta',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    expect(report.failures.join('\n')).toContain(
      'identity: source_revision does not match the certified revision',
    );
  });

  it('rejects group-readable reports and altered artifacts', () => {
    const directory = evidenceDirectory();
    completePrivateEvidence(directory);
    chmodSync(join(directory, 'website.json'), 0o644);
    writeFileSync(join(directory, 'staging.artifact.json'), '{"altered":true}\n', {
      mode: 0o600,
    });

    const report = evaluateCommercialRelease({
      target: 'private-beta',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    expect(report.failures.join('\n')).toContain('website report must be owner-only');
    expect(report.failures.join('\n')).toContain('staging: artifact 0 sha256 mismatch');
  });

  it('rejects a group-readable evidence directory', () => {
    const directory = evidenceDirectory();
    completePrivateEvidence(directory);
    chmodSync(directory, 0o755);
    expect(() =>
      evaluateCommercialRelease({
        target: 'private-beta',
        evidenceDir: directory,
        sourceRevision: SOURCE_REVISION,
        now: NOW,
      }),
    ).toThrow('evidenceDir must be owner-only');
  });

  it('rejects report and artifact symlinks', () => {
    const directory = evidenceDirectory();
    completePrivateEvidence(directory);
    const reportTarget = join(directory, 'website-report-target.json');
    writeFileSync(reportTarget, readFileSync(join(directory, 'website.json')), { mode: 0o600 });
    unlinkSync(join(directory, 'website.json'));
    symlinkSync(reportTarget, join(directory, 'website.json'));
    const artifactTarget = join(directory, 'staging-target.json');
    writeFileSync(artifactTarget, '{"redacted":true}\n', { mode: 0o600 });
    const artifactLink = join(directory, 'staging-link.json');
    symlinkSync(artifactTarget, artifactLink);
    const stagingPath = join(directory, 'staging.json');
    const staging = JSON.parse(readFileSync(stagingPath, 'utf8')) as {
      artifacts: Array<{ path: string; sha256: string }>;
    };
    staging.artifacts = [{ path: 'staging-link.json', sha256: digest(artifactTarget) }];
    writeFileSync(stagingPath, `${JSON.stringify(staging)}\n`, { mode: 0o600 });

    const report = evaluateCommercialRelease({
      target: 'private-beta',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    expect(report.failures.join('\n')).toContain('website report must not be a symbolic link');
    expect(report.failures.join('\n')).toContain('staging: artifact 0 must not be a symbolic link');
  });

  it('accepts complete current private-beta evidence with manual billing', () => {
    const directory = evidenceDirectory();
    completePrivateEvidence(directory);
    const report = evaluateCommercialRelease({
      target: 'private-beta',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    expect(report).toMatchObject({
      passed: true,
      verdict: 'private_beta_ready',
    });
  });

  it('requires stronger operational, customer, market, review, and Stripe evidence publicly', () => {
    const directory = evidenceDirectory();
    completePrivateEvidence(directory);
    const privateReport = evaluateCommercialRelease({
      target: 'public-production',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    expect(privateReport).toMatchObject({ passed: false, verdict: 'no_go' });
    expect(privateReport.failures.join('\n')).toContain(
      'public production requires stripe_test billing evidence',
    );
    expect(privateReport.failures.join('\n')).toContain('legal:');
    expect(privateReport.failures.join('\n')).toContain('independent_review:');
    expect(privateReport.failures.join('\n')).toContain('customer_integration:');
    expect(privateReport.failures.join('\n')).toContain('market_validation:');

    const publicAdditions = {
      internal: ['sbom', 'provenance', 'consumer_install'],
      website: ['public_domain_tls'],
      staging: ['database_failover', 'rolling_release', 'multi_instance'],
      identity: ['invitation', 'revocation', 'cross_organization_isolation'],
      human_email: ['independent_recipient'],
      transactional_email: ['dmarc_observation', 'provider_outage_recovery'],
      operations: ['second_responder', 'sustained_soak', 'incident_drill', 'status_page'],
      security: ['key_rotation_drill', 'recovery_escrow'],
    };
    for (const [gateId, extraChecks] of Object.entries(publicAdditions))
      writeGate(directory, gateId as keyof typeof requirements, [
        ...requirements[gateId as keyof typeof requirements],
        ...extraChecks,
      ]);
    writeGate(
      directory,
      'billing',
      [
        'checkout',
        'portal',
        'signed_webhook',
        'replay_reordering',
        'failed_payment_recovery',
        'cancellation',
        'entitlement_reconciliation',
        'test_clock',
      ],
      { variant: 'stripe_test' },
    );
    writeGate(directory, 'legal', ['terms', 'privacy', 'dpa', 'retention', 'refund_tax']);
    writeGate(directory, 'independent_review', [
      'penetration_test',
      'findings_disposition',
      'remediation_retest',
    ]);
    writeGate(directory, 'customer_integration', [
      'owned_webhook',
      'downstream_ledger',
      'outage_reconciliation',
    ]);
    writeGate(directory, 'market_validation', [
      'design_partner',
      'real_workflow',
      'willingness_to_pay',
      'retention_signal',
    ]);

    const report = evaluateCommercialRelease({
      target: 'public-production',
      evidenceDir: directory,
      sourceRevision: SOURCE_REVISION,
      now: NOW,
    });
    expect(report).toMatchObject({
      passed: true,
      verdict: 'public_production_ready',
    });
  });
});
