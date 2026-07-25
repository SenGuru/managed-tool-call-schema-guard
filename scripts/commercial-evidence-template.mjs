#!/usr/bin/env node
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commercialEvidenceTemplate } from './commercial-release-gate.mjs';

function argumentsFrom(argv) {
  const options = { target: 'private-beta' };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--target') options.target = argv[++index];
    else if (item === '--source-revision') options.sourceRevision = argv[++index];
    else if (item === '--output-dir') options.outputDir = argv[++index];
    else throw new TypeError(`unknown argument: ${item}`);
  }
  if (!['private-beta', 'public-production'].includes(options.target))
    throw new TypeError('--target must be private-beta or public-production');
  if (typeof options.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/u.test(options.sourceRevision))
    throw new TypeError('--source-revision must be an exact lowercase 40-character Git SHA');
  if (typeof options.outputDir !== 'string' || options.outputDir.trim().length === 0)
    throw new TypeError('--output-dir is required');
  return options;
}

export function writeCommercialEvidenceTemplate({
  target,
  sourceRevision,
  outputDir,
  executedAt = new Date().toISOString(),
}) {
  const output = resolve(outputDir);
  if (existsSync(output)) throw new Error('output directory already exists');
  const parent = realpathSync(dirname(output));
  const parentMetadata = statSync(parent);
  if (!parentMetadata.isDirectory()) throw new Error('output parent must be a directory');
  if ((parentMetadata.mode & 0o077) !== 0) throw new Error('output parent must be owner-only');

  const reports = commercialEvidenceTemplate({ target, sourceRevision, executedAt });
  mkdirSync(output, { mode: 0o700 });
  for (const report of reports)
    writeFileSync(
      resolve(output, `${report.gate_id}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  return {
    report_version: '1',
    target,
    source_revision: sourceRevision,
    output_directory: basename(output),
    reports_created: reports.length,
    status: 'unproven',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = argumentsFrom(process.argv.slice(2));
    const summary = writeCommercialEvidenceTemplate({
      target: options.target,
      sourceRevision: options.sourceRevision,
      outputDir: options.outputDir,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        report_version: '1',
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}
