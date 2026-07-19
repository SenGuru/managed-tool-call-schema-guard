import { execFileSync } from 'node:child_process';

type PackReport = { files: { path: string }[] };

function isPackFile(value: unknown): value is { path: string } {
  return (
    value !== null && typeof value === 'object' && 'path' in value && typeof value.path === 'string'
  );
}

function packReport(value: unknown, workspace: string): PackReport {
  if (!Array.isArray(value) || value.length !== 1)
    throw new Error(`${workspace} report is invalid`);
  const report: unknown = value[0];
  if (
    report === null ||
    typeof report !== 'object' ||
    !('files' in report) ||
    !Array.isArray(report.files) ||
    !report.files.every(isPackFile)
  )
    throw new Error(`${workspace} did not produce an npm package report`);
  return report as PackReport;
}

const expectations = new Map([
  ['@schema-guard/core', ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'package.json']],
  ['@schema-guard/sdk', ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'package.json']],
  ['@schema-guard/cli', ['dist/cli.js', 'LICENSE', 'package.json']],
]);

for (const [workspace, required] of expectations) {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--workspace', workspace], {
    encoding: 'utf8',
  });
  const report = packReport(JSON.parse(output) as unknown, workspace);
  const paths = new Set(report.files.map((file) => file.path));
  for (const path of required)
    if (!paths.has(path)) throw new Error(`${workspace} package is missing ${path}`);
}

console.log('Package contents are complete for core, SDK, and CLI.');
