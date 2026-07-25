#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPORT_VERSION = '1';
const DEFAULT_MAX_AGE_DAYS = 30;
const ALLOWED_EVIDENCE_KINDS = new Set([
  'deterministic_local',
  'production_like_network',
  'external_provider',
  'manual_review',
]);
const FORBIDDEN_KEY =
  /(?:^|[_-])(?:secret|password|token|api[_-]?key|authorization|cookie)(?:[_-]|$)/iu;
const SAFE_SECURITY_EVIDENCE_KEYS = new Set(['secret_scan', 'security_scans']);

const PRIVATE_BETA_GATES = [
  {
    id: 'internal',
    checks: ['full_regression', 'postgres', 'container_e2e', 'sdk_cli', 'security_scans'],
  },
  {
    id: 'website',
    checks: ['private_hosted', 'route_inventory', 'onboarding_handoff'],
  },
  {
    id: 'staging',
    checks: ['tls_edge', 'separate_anchor', 'outage_recovery', 'backup_restore'],
  },
  {
    id: 'identity',
    checks: ['callback_session', 'mfa', 'logout_revoke', 'recovery', 'tenant_isolation'],
  },
  {
    id: 'human_email',
    checks: ['mailbox_ready', 'inbound', 'outbound', 'recovery'],
  },
  {
    id: 'transactional_email',
    checks: ['domain_auth', 'delivery', 'bounce', 'retry_dead_letter', 'privacy'],
  },
  {
    id: 'operations',
    checks: ['monitoring', 'paging_delivery', 'restore_drill', 'runbooks'],
  },
  {
    id: 'security',
    checks: ['dependency_scan', 'secret_scan', 'image_scan', 'auth_abuse', 'tenant_isolation'],
  },
  {
    id: 'model_providers',
    checks: ['openai_live', 'anthropic_live', 'gemini_live'],
  },
  { id: 'billing', checks: [] },
];

const PUBLIC_PRODUCTION_ADDITIONS = new Map([
  ['website', ['public_domain_tls']],
  ['identity', ['invitation', 'revocation', 'cross_organization_isolation']],
  ['human_email', ['independent_recipient']],
  ['transactional_email', ['dmarc_observation', 'provider_outage_recovery']],
  ['operations', ['second_responder', 'sustained_soak', 'incident_drill']],
]);

const PUBLIC_ONLY_GATES = [
  {
    id: 'legal',
    checks: ['terms', 'privacy', 'dpa', 'retention', 'refund_tax'],
  },
  {
    id: 'independent_review',
    checks: ['penetration_test', 'findings_disposition', 'remediation_retest'],
  },
];

const BILLING_CHECKS = {
  manual: [
    'manual_invoice_policy',
    'operator_entitlement',
    'cancellation_policy',
    'no_automated_charge',
  ],
  stripe_test: [
    'checkout',
    'portal',
    'signed_webhook',
    'replay_reordering',
    'failed_payment_recovery',
    'cancellation',
    'entitlement_reconciliation',
    'test_clock',
  ],
};

function argumentsFrom(argv) {
  const options = {
    target: 'private-beta',
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--target') options.target = argv[++index];
    else if (item === '--evidence-dir') options.evidenceDir = argv[++index];
    else if (item === '--max-age-days') options.maxAgeDays = Number(argv[++index]);
    else if (item === '--output') options.output = argv[++index];
    else throw new TypeError(`unknown argument: ${item}`);
  }
  if (!['private-beta', 'public-production'].includes(options.target))
    throw new TypeError('--target must be private-beta or public-production');
  if (typeof options.evidenceDir !== 'string' || options.evidenceDir.trim().length === 0)
    throw new TypeError('--evidence-dir is required');
  if (!Number.isInteger(options.maxAgeDays) || options.maxAgeDays < 1 || options.maxAgeDays > 365)
    throw new TypeError('--max-age-days must be an integer from 1 through 365');
  if (options.output !== undefined && String(options.output).trim().length === 0)
    throw new TypeError('--output requires a path');
  return options;
}

function requirementsFor(target) {
  const requirements = PRIVATE_BETA_GATES.map(({ id, checks }) => ({
    id,
    checks: [
      ...checks,
      ...(target === 'public-production' ? (PUBLIC_PRODUCTION_ADDITIONS.get(id) ?? []) : []),
    ],
  }));
  if (target === 'public-production')
    requirements.push(...PUBLIC_ONLY_GATES.map(({ id, checks }) => ({ id, checks: [...checks] })));
  return requirements;
}

function hasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => {
    const normalizedKey = key.replace(/([a-z\d])([A-Z])/gu, '$1_$2').toLowerCase();
    return (
      (!SAFE_SECURITY_EVIDENCE_KEYS.has(normalizedKey) && FORBIDDEN_KEY.test(normalizedKey)) ||
      hasForbiddenKey(item)
    );
  });
}

function sha256(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function safeEvidencePath(root, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || isAbsolute(candidate))
    throw new Error('artifact path must be a non-empty relative path');
  const resolved = resolve(root, candidate);
  const relativePath = relative(root, resolved);
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new Error('artifact path escapes the evidence directory');
  const metadata = lstatSync(resolved);
  if (metadata.isSymbolicLink()) throw new Error('must not be a symbolic link');
  const canonical = realpathSync(resolved);
  const canonicalRelativePath = relative(root, canonical);
  if (canonicalRelativePath.startsWith('..') || isAbsolute(canonicalRelativePath))
    throw new Error('resolves outside the evidence directory');
  return canonical;
}

function readOwnerOnlyJson(path, label) {
  const linkMetadata = lstatSync(path);
  if (linkMetadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  const metadata = statSync(path);
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
  if ((metadata.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${label} must contain a JSON object`);
  return parsed;
}

function validateGateReport({ evidenceRoot, gate, target, maxAgeMs, now }) {
  const reportPath = resolve(evidenceRoot, `${gate.id}.json`);
  let report;
  try {
    report = readOwnerOnlyJson(reportPath, `${gate.id} report`);
  } catch (error) {
    return {
      gate_id: gate.id,
      passed: false,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }

  const failures = [];
  if (report.report_version !== REPORT_VERSION) failures.push('report_version must be 1');
  if (report.gate_id !== gate.id) failures.push('gate_id mismatch');
  if (report.status !== 'proven') failures.push('status must be proven');
  if (report.redacted !== true) failures.push('redacted must be true');
  if (!ALLOWED_EVIDENCE_KINDS.has(report.evidence_kind)) failures.push('evidence_kind is invalid');
  if (hasForbiddenKey(report)) failures.push('report contains a forbidden secret-bearing key');

  const executedAt = Date.parse(report.executed_at);
  if (!Number.isFinite(executedAt)) failures.push('executed_at is invalid');
  else {
    if (executedAt > now + 5 * 60_000) failures.push('executed_at is in the future');
    if (now - executedAt > maxAgeMs) failures.push('evidence is stale');
  }

  let requiredChecks = [...gate.checks];
  if (gate.id === 'billing') {
    const variant = report.variant;
    if (!(variant in BILLING_CHECKS)) failures.push('billing variant is invalid');
    else if (target === 'public-production' && variant !== 'stripe_test')
      failures.push('public production requires stripe_test billing evidence');
    else requiredChecks = BILLING_CHECKS[variant];
  }

  if (!report.checks || typeof report.checks !== 'object' || Array.isArray(report.checks))
    failures.push('checks must be an object');
  else
    for (const check of requiredChecks)
      if (report.checks[check] !== true) failures.push(`required check is not proven: ${check}`);

  if (!Array.isArray(report.artifacts) || report.artifacts.length === 0)
    failures.push('at least one hashed artifact is required');
  else
    for (const [index, artifact] of report.artifacts.entries()) {
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
        failures.push(`artifact ${index} is invalid`);
        continue;
      }
      try {
        const artifactPath = safeEvidencePath(evidenceRoot, artifact.path);
        const artifactMetadata = statSync(artifactPath);
        if (!artifactMetadata.isFile()) throw new Error('is not a regular file');
        if ((artifactMetadata.mode & 0o077) !== 0) throw new Error('must be owner-only');
        if (!/^sha256:[0-9a-f]{64}$/u.test(artifact.sha256))
          throw new Error('has an invalid sha256');
        if (sha256(artifactPath) !== artifact.sha256) throw new Error('sha256 mismatch');
      } catch (error) {
        failures.push(
          `artifact ${index} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

  return {
    gate_id: gate.id,
    passed: failures.length === 0,
    status: report.status,
    evidence_kind: report.evidence_kind,
    executed_at: report.executed_at,
    failures,
  };
}

export function evaluateCommercialRelease({
  target,
  evidenceDir,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  now = Date.now(),
}) {
  if (!['private-beta', 'public-production'].includes(target))
    throw new TypeError('target must be private-beta or public-production');
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 365)
    throw new TypeError('maxAgeDays must be an integer from 1 through 365');

  const evidenceRoot = realpathSync(resolve(evidenceDir));
  const evidenceRootMetadata = statSync(evidenceRoot);
  if (!evidenceRootMetadata.isDirectory()) throw new Error('evidenceDir must be a directory');
  if ((evidenceRootMetadata.mode & 0o077) !== 0) throw new Error('evidenceDir must be owner-only');
  const gateResults = requirementsFor(target).map((gate) =>
    validateGateReport({
      evidenceRoot,
      gate,
      target,
      maxAgeMs: maxAgeDays * 86_400_000,
      now,
    }),
  );
  const passed = gateResults.every((gate) => gate.passed);
  return {
    report_version: REPORT_VERSION,
    executed_at: new Date(now).toISOString(),
    target,
    passed,
    verdict: passed
      ? target === 'public-production'
        ? 'public_production_ready'
        : 'private_beta_ready'
      : 'no_go',
    gate_results: gateResults,
    failures: gateResults
      .filter((gate) => !gate.passed)
      .map((gate) => `${gate.gate_id}: ${gate.failures.join('; ')}`),
  };
}

function writeReport(output, report) {
  if (!output) return;
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error('output must not be a symbolic link');
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = argumentsFrom(process.argv.slice(2));
    const report = evaluateCommercialRelease({
      target: options.target,
      evidenceDir: options.evidenceDir,
      maxAgeDays: options.maxAgeDays,
    });
    writeReport(options.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        report_version: REPORT_VERSION,
        passed: false,
        verdict: 'no_go',
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}
