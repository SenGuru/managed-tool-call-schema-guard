#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { normalizeTool, validateToolCall } from '../packages/core/dist/index.js';

const manifest = JSON.parse(readFileSync('real-repo-corpus/manifest.json', 'utf8'));
const root = mkdtempSync(join(tmpdir(), 'schema-guard-real-repos.'));
const signals = [
  'inputSchema',
  'input_schema',
  'tool_schema',
  'Tool',
  'FunctionTool',
  'function_tool',
  'parameters',
  'json_schema',
  'OBJECT',
  'INTEGER',
  'function_declaration',
  'parameters_json_schema',
];
const report = {
  version: 1,
  root,
  repos: [],
  extracted_fixtures: [],
};
const fixturesOutArg = process.argv.indexOf('--fixtures-out');
const fixturesOut =
  fixturesOutArg === -1 || process.argv[fixturesOutArg + 1] === undefined
    ? undefined
    : process.argv[fixturesOutArg + 1];

function run(command, args, cwd = process.cwd()) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    if (['.git', 'node_modules', '.venv', '__pycache__'].includes(entry)) continue;
    const path = join(directory, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) walk(path, out);
    else if (stats.isFile() && stats.size <= 512_000) out.push(path);
  }
  return out;
}

function balancedObjectAt(text, index) {
  const start = text.indexOf('{', index);
  if (start === -1) return undefined;
  let depth = 0;
  let quote;
  let escaped = false;
  for (let position = start; position < text.length; position += 1) {
    const char = text[position];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, position + 1);
    }
  }
  return undefined;
}

function pythonishToJson(value) {
  return value
    .replaceAll(/\bTrue\b/gu, 'true')
    .replaceAll(/\bFalse\b/gu, 'false')
    .replaceAll(/\bNone\b/gu, 'null')
    .replaceAll(/'/gu, '"')
    .replaceAll(/,\s*([}\]])/gu, '$1');
}

function tryParseObjectLiteral(raw) {
  const candidates = [raw, pythonishToJson(raw)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying safer static conversions.
    }
  }
  return undefined;
}

function adapterFor(repoId, object) {
  if (object.inputSchema && typeof object.name === 'string') return 'mcp';
  if (object.function_declaration) return 'google_adk';
  if (object.parameters_json_schema && typeof object.name === 'string') {
    return repoId.includes('google-adk') ? 'google_adk' : 'pydantic_ai';
  }
  if (
    object.type === 'function' &&
    object.function &&
    typeof object.function === 'object' &&
    typeof object.function.name === 'string'
  ) {
    return 'openai_agents';
  }
  if (object.parameters && typeof object.name === 'string') {
    return repoId.includes('google-adk') ? 'google_adk' : 'openai_agents';
  }
  return undefined;
}

function sampleArguments(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  const properties =
    schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required
    : Object.keys(properties).slice(0, 2);
  const args = {};
  for (const key of required) {
    const prop = properties[key];
    if (!prop || typeof prop !== 'object') {
      args[key] = 'sample';
      continue;
    }
    const type = Array.isArray(prop.type) ? prop.type.find((item) => item !== 'null') : prop.type;
    if (Array.isArray(prop.enum) && prop.enum.length > 0) args[key] = prop.enum[0];
    else if (type === 'integer') args[key] = 1;
    else if (type === 'number') args[key] = 1;
    else if (type === 'boolean') args[key] = true;
    else if (type === 'array') args[key] = [];
    else if (type === 'object') args[key] = {};
    else args[key] = 'sample';
  }
  return args;
}

function extractFixtures(repoId, target) {
  const fixtures = [];
  for (const path of walk(target)) {
    if (!['.json', '.md', '.mdx', '.py', '.ts', '.tsx'].includes(extname(path))) continue;
    const text = readFileSync(path, 'utf8');
    const needles = [
      'inputSchema',
      'parameters_json_schema',
      'function_declaration',
      '"type": "function"',
      'parameters',
    ];
    for (const needle of needles) {
      let index = text.indexOf(needle);
      while (index !== -1 && fixtures.length < 25) {
        const raw = balancedObjectAt(text, Math.max(0, index - 240));
        const object = raw ? tryParseObjectLiteral(raw) : undefined;
        const adapter =
          object && typeof object === 'object' ? adapterFor(repoId, object) : undefined;
        if (adapter) {
          try {
            const normalized = normalizeTool(adapter, object);
            const decision = validateToolCall({
              tool_name: normalized.tool_name,
              tool_schema: normalized.tool_schema,
              raw_arguments: sampleArguments(normalized.tool_schema),
              context: { adapter },
            });
            fixtures.push({
              id: `${repoId}:${fixtures.length + 1}`,
              repo_id: repoId,
              source_file: path.slice(target.length + 1),
              adapter,
              tool_name: normalized.tool_name,
              source_fingerprint: normalized.source_fingerprint,
              schema_hash: decision.audit.schema_hash,
              probe_decision: decision.decision,
              warnings: normalized.warnings,
            });
          } catch {
            // Static extraction is best-effort; malformed or partial snippets are ignored.
          }
        }
        index = text.indexOf(needle, index + needle.length);
      }
    }
  }
  return fixtures;
}

for (const repo of manifest.repos) {
  const target = join(root, repo.id);
  const clone = run('git', [
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--sparse',
    repo.url,
    target,
  ]);
  if (clone.status !== 0) {
    report.repos.push({
      id: repo.id,
      url: repo.url,
      cloned: false,
      error: clone.stderr.slice(-2000),
    });
    continue;
  }
  const sparse = run(
    'git',
    [
      'sparse-checkout',
      'set',
      'examples',
      'docs',
      'src',
      'samples',
      'tests',
      'packages',
      'servers',
      'tools',
      'sdk',
      'integration_tests',
    ],
    target,
  );
  const grep = run(
    'rg',
    ['-n', '--glob', '!*.lock', '--glob', '!*.png', '--glob', '!*.jpg', signals.join('|'), '.'],
    target,
  );
  const matches = grep.stdout
    .split('\n')
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => {
      const [file, lineNumber, ...rest] = line.split(':');
      return {
        file,
        line: Number(lineNumber),
        text: rest.join(':').slice(0, 240),
      };
    });
  report.repos.push({
    id: repo.id,
    url: repo.url,
    cloned: true,
    head: run('git', ['rev-parse', 'HEAD'], target).stdout.trim(),
    sparse_status: sparse.status,
    signal_count_sampled: matches.length,
    top_files: [...new Set(matches.map((match) => match.file))]
      .filter((file) => file && file !== '.')
      .slice(0, 25)
      .map((file) => basename(file)),
    matches,
  });
  report.extracted_fixtures.push(...extractFixtures(repo.id, target));
}

const out = join(root, 'real-repo-corpus-audit.json');
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
if (fixturesOut) {
  writeFileSync(
    fixturesOut,
    `${JSON.stringify(
      {
        version: 1,
        generated_by: 'scripts/real-repo-corpus-audit.mjs',
        generated_at: new Date().toISOString(),
        repos: report.repos.map(({ id, url, head, signal_count_sampled }) => ({
          id,
          url,
          head,
          signal_count_sampled,
        })),
        fixtures: report.extracted_fixtures,
      },
      null,
      2,
    )}\n`,
  );
}
console.log(
  JSON.stringify(
    {
      report_path: out,
      fixtures_out: fixturesOut,
      extracted_fixtures: report.extracted_fixtures.length,
      repos: report.repos.map(({ id, cloned, signal_count_sampled }) => ({
        id,
        cloned,
        signal_count_sampled,
      })),
    },
    null,
    2,
  ),
);
if (report.repos.some((repo) => !repo.cloned)) process.exitCode = 1;
