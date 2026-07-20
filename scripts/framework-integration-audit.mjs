#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'schema-guard-framework-integrations.'));
const python = process.env.SCHEMA_GUARD_INTEGRATION_PYTHON ?? 'python3';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
  return result;
}

const version = run(python, ['--version']);
const versionText = `${version.stdout}${version.stderr}`.trim();
const match = /Python (\d+)\.(\d+)/u.exec(versionText);
if (!match || Number(match[1]) < 3 || (Number(match[1]) === 3 && Number(match[2]) < 10)) {
  throw new Error(
    `framework integration audit requires Python 3.10+; received ${versionText || 'unknown'}`,
  );
}

const typescript = run('npx', ['vitest', 'run', 'tests/runtime-integrations.test.ts']);
const venv = join(root, 'venv');
run(python, ['-m', 'venv', venv]);
const venvPython = join(venv, 'bin', 'python');
run(venvPython, [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '--no-input',
  '--only-binary=:all:',
  'pydantic-ai-slim==2.13.0',
  'google-adk==2.5.0',
]);
const pythonRun = run(venvPython, ['integration-tests/python_framework_runtime.py'], {
  env: { ...process.env, PYTHONPATH: 'python' },
});
const pythonReport = JSON.parse(pythonRun.stdout);
const report = {
  version: 1,
  passed: pythonReport.passed === true,
  safety: {
    external_repository_code_executed: false,
    model_api_called: false,
    package_install_build_scripts_allowed: false,
  },
  runtimes: {
    node: process.version,
    python: versionText,
    '@modelcontextprotocol/sdk': '1.29.0',
    '@openai/agents': '0.13.5',
    ...pythonReport.versions,
  },
  assertions: {
    typescript_runtime_test_passed: /Tests\s+3 passed/u.test(typescript.stdout),
    python: pythonReport.results,
  },
};
const reportPath = join(root, 'framework-integration-audit.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report_path: reportPath, ...report }, null, 2));
