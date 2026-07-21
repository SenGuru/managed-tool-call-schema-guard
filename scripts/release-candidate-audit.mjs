#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const started = Date.now();
const executedAt = new Date(started).toISOString();
const evidence = {};
const failures = [];

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--output') options.output = argv[++index];
    else throw new TypeError(`unknown argument: ${item}`);
  }
  if (options.output === undefined) return options;
  if (typeof options.output !== 'string' || options.output.length === 0)
    throw new TypeError('--output requires a path');
  return options;
}

function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  evidence[name] = {
    status: result.status,
    stdout_tail: (result.stdout ?? '').slice(-4000),
    stderr_tail: (result.stderr ?? '').slice(-4000),
  };
  if (result.error) failures.push(`${name} could not start: ${result.error.message}`);
  else if (result.status !== 0) failures.push(`${name} exited ${String(result.status)}`);
  return result;
}

function writeReport(output, report) {
  if (!output) return;
  const path = resolve(root, output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

const options = argumentsFrom(process.argv.slice(2));
const requiredEnvironment = [
  'SCHEMA_GUARD_TEST_POSTGRES_URL',
  'OPENAI_API_KEY',
  'SCHEMA_GUARD_OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'SCHEMA_GUARD_ANTHROPIC_MODEL',
  'GEMINI_API_KEY',
  'SCHEMA_GUARD_GEMINI_MODEL',
];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length)
  failures.push(`missing required environment: ${missingEnvironment.join(', ')}`);

const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  cwd: root,
  encoding: 'utf8',
});
evidence.docker_preflight = {
  status: docker.status,
  server_version: docker.status === 0 ? docker.stdout.trim() : undefined,
  error: docker.error?.message ?? (docker.status === 0 ? undefined : docker.stderr.trim()),
};
if (docker.status !== 0) failures.push('a reachable Docker engine is required');

if (failures.length) {
  const report = {
    report_version: '1',
    executed_at: executedAt,
    passed: false,
    phase: 'preflight',
    failures,
    duration_ms: Date.now() - started,
    evidence,
  };
  writeReport(options.output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
}

const temp = mkdtempSync(join(tmpdir(), 'schema-guard-release-candidate.'));
const liveProviderReport = join(temp, 'live-provider-report.json');

run('extreme_audit', 'npm', ['run', 'audit:extreme']);
run('postgres_coverage', 'npm', ['run', 'test:coverage']);
run('framework_integrations', 'npm', ['run', 'audit:framework-integrations']);
run('live_provider_probes', 'npm', [
  'run',
  'probe:live',
  '--',
  '--provider',
  'all',
  '--trials',
  '5',
  '--output',
  liveProviderReport,
]);

if (!failures.length) {
  const providerReport = JSON.parse(readFileSync(liveProviderReport, 'utf8'));
  const verified =
    providerReport.passed === true &&
    providerReport.dry_run === false &&
    Array.isArray(providerReport.results) &&
    providerReport.results.length === 3 &&
    providerReport.results.every(
      (result) =>
        result.status === 'verified' && result.trials_requested === 5 && result.trials_passed === 5,
    );
  evidence.live_provider_report = providerReport;
  if (!verified) failures.push('live provider report did not verify all configured providers');
}

run('container_end_to_end', 'npm', ['run', 'audit:container-e2e']);
run('container_vulnerability_audit', 'npm', ['run', 'audit:images']);

const report = {
  report_version: '1',
  executed_at: executedAt,
  passed: failures.length === 0,
  phase: 'complete',
  failures,
  duration_ms: Date.now() - started,
  evidence,
};
writeReport(options.output, report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failures.length ? 1 : 0);
