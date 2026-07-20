#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { format } from 'prettier';
import { validateToolCall } from '../packages/core/dist/index.js';

const reportIndex = process.argv.indexOf('--report');
const reportPath = resolve(
  reportIndex >= 0 && process.argv[reportIndex + 1]
    ? process.argv[reportIndex + 1]
    : 'audit-results/five-repo-native-fixtures.json',
);
const suppliedRoot = process.env.SCHEMA_GUARD_FIVE_REPO_ROOT;
const root = suppliedRoot
  ? resolve(suppliedRoot)
  : mkdtempSync(join(tmpdir(), 'schema-guard-five-repo-native.'));

const repositories = [
  {
    id: 'mcp-python-sdk',
    url: 'https://github.com/modelcontextprotocol/python-sdk.git',
    sparse: ['tests'],
    evidence: [
      {
        file: 'tests/interaction/lowlevel/test_tools.py',
        anchors: [
          'test_tools_list_preserves_arbitrary_input_schema_keywords',
          'called = await client.call_tool("typed", {"count": 3, "options": {"verbose": True}})',
        ],
      },
    ],
    fixtures: [
      {
        id: 'rich-draft-2020-call',
        tool: 'typed',
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          $defs: { positive: { type: 'integer', exclusiveMinimum: 0 } },
          properties: {
            count: { $ref: '#/$defs/positive' },
            options: {
              type: 'object',
              properties: { verbose: { type: 'boolean' } },
              additionalProperties: false,
            },
          },
          required: ['count'],
          additionalProperties: false,
        },
        calls: [
          { arguments: { count: 3, options: { verbose: true } }, expected: 'valid' },
          {
            arguments: { count: '3', options: { verbose: 'true' } },
            expected: 'valid_with_repair',
          },
          { arguments: { count: 0 }, expected: 'rejected' },
        ],
      },
    ],
  },
  {
    id: 'openai-agents-python',
    url: 'https://github.com/openai/openai-agents-python.git',
    sparse: ['tests'],
    evidence: [
      {
        file: 'tests/test_function_schema.py',
        anchors: [
          'valid_input = {"a": 3}',
          'valid_input2 = {"a": 3, "b": 10}',
          'valid_input = {"my_number": 50}',
          'func_schema.params_pydantic_model(**{"a": "not an integer"})',
        ],
      },
    ],
    fixtures: [
      {
        id: 'typed-defaulted-function',
        tool: 'simple_function',
        schema: {
          type: 'object',
          properties: { a: { type: 'integer' }, b: { type: 'integer', default: 5 } },
          required: ['a'],
          additionalProperties: false,
        },
        calls: [
          { arguments: { a: 3 }, expected: 'valid' },
          { arguments: { a: 3, b: 10 }, expected: 'valid' },
          { arguments: { a: 'not an integer' }, expected: 'rejected' },
        ],
      },
      {
        id: 'field-constraints',
        tool: 'func_with_field_constraints',
        schema: {
          type: 'object',
          properties: { my_number: { type: 'integer', exclusiveMinimum: 10, maximum: 100 } },
          required: ['my_number'],
          additionalProperties: false,
        },
        calls: [
          { arguments: { my_number: 50 }, expected: 'valid' },
          { arguments: { my_number: 5 }, expected: 'rejected' },
          { arguments: { my_number: 150 }, expected: 'rejected' },
        ],
      },
    ],
  },
  {
    id: 'pydantic-ai',
    url: 'https://github.com/pydantic/pydantic-ai.git',
    sparse: ['tests'],
    evidence: [
      {
        file: 'tests/test_tools.py',
        anchors: [
          "ToolCallPart(tool.name, {'x': 42, 'y': 'a'})",
          'def foobar(ctx: RunContext[int], x: int, y: str) -> str:',
          "ToolCallPart(tool_name='my_tool', args={'a': 13})",
          'def my_tool(ctx: RunContext, a: int, b: int = 2) -> int:',
        ],
      },
    ],
    fixtures: [
      {
        id: 'dynamic-tool-call',
        tool: 'foobar',
        schema: {
          type: 'object',
          properties: { x: { type: 'integer' }, y: { type: 'string' } },
          required: ['x', 'y'],
          additionalProperties: false,
        },
        calls: [
          { arguments: { x: 42, y: 'a' }, expected: 'valid' },
          { arguments: { x: '42', y: 'a' }, expected: 'valid_with_repair' },
          { arguments: { x: 'not-an-int', y: 'a' }, expected: 'rejected' },
        ],
      },
      {
        id: 'optional-default-call',
        tool: 'my_tool',
        schema: {
          type: 'object',
          properties: { a: { type: 'integer' }, b: { type: 'integer', default: 2 } },
          required: ['a'],
          additionalProperties: false,
        },
        calls: [
          { arguments: { a: 13 }, expected: 'valid' },
          { arguments: { a: 13, b: 4 }, expected: 'valid' },
        ],
      },
    ],
  },
  {
    id: 'google-adk-python',
    url: 'https://github.com/google/adk-python.git',
    sparse: ['tests'],
    evidence: [
      {
        file: 'tests/integration/fixture/home_automation_agent/test_files/dependent_tool_calls.test.json',
        anchors: ['"name": "set_device_info"', '"device_id": "device_2"', '"status": "OFF"'],
      },
      {
        file: 'tests/integration/fixture/home_automation_agent/agent.py',
        anchors: [
          'def set_device_info(',
          'device_id: str, status: str = "", location: str = ""',
          'def get_device_info(device_id: str) -> dict:',
        ],
      },
    ],
    fixtures: [
      {
        id: 'recorded-home-automation-call',
        tool: 'set_device_info',
        schema: {
          type: 'object',
          properties: {
            device_id: { type: 'string' },
            status: { type: 'string' },
            location: { type: 'string' },
          },
          required: ['device_id'],
          additionalProperties: false,
        },
        calls: [
          {
            arguments: { location: 'Bedroom', status: 'OFF', device_id: 'device_2' },
            expected: 'valid',
          },
          { arguments: { status: 'OFF' }, expected: 'rejected' },
        ],
      },
      {
        id: 'recorded-device-query',
        tool: 'get_device_info',
        schema: {
          type: 'object',
          properties: { device_id: { type: 'string' } },
          required: ['device_id'],
          additionalProperties: false,
        },
        calls: [{ arguments: { device_id: 'device_2' }, expected: 'valid' }],
      },
    ],
  },
  {
    id: 'openai-agents-js',
    url: 'https://github.com/openai/openai-agents-js.git',
    sparse: ['packages'],
    evidence: [
      {
        file: 'packages/agents-core/test/toolCustomData.test.ts',
        anchors: [
          "name: 'get_data'",
          'arguments: \'{"key":"alpha"}\'',
          'parameters: z.object({ key: z.string() })',
          "name: 'bad_data'",
          'parameters: z.object({})',
        ],
      },
    ],
    fixtures: [
      {
        id: 'recording-model-tool-call',
        tool: 'get_data',
        schema: {
          type: 'object',
          properties: { key: { type: 'string' } },
          required: ['key'],
          additionalProperties: false,
        },
        calls: [
          { arguments: '{"key":"alpha"}', expected: 'valid' },
          { arguments: '{}', expected: 'rejected' },
        ],
      },
      {
        id: 'empty-parameter-tool',
        tool: 'bad_data',
        schema: { type: 'object', properties: {}, additionalProperties: false },
        calls: [{ arguments: '{}', expected: 'valid' }],
      },
    ],
  },
];

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.slice(-4000)}`);
  return result.stdout.trim();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ensureCheckout(repository) {
  const target = join(root, repository.id);
  if (!suppliedRoot) {
    run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', repository.url, target]);
    run('git', ['sparse-checkout', 'set', ...repository.sparse], target);
  }
  return target;
}

function derivedCases(fixture) {
  const firstValid = fixture.calls.find(({ expected }) => expected === 'valid');
  if (!firstValid) return [];
  const parsed =
    typeof firstValid.arguments === 'string'
      ? JSON.parse(firstValid.arguments)
      : firstValid.arguments;
  const cases = [
    { id: 'json-encoding-equivalence', arguments: JSON.stringify(parsed), expected: 'valid' },
    { id: 'malformed-json', arguments: '{"broken":', expected: 'rejected' },
    {
      id: 'unexpected-secret-field',
      arguments: { ...parsed, __schema_guard_secret: 'FIVE_REPO_SECRET_SENTINEL' },
      expected: 'rejected',
    },
  ];
  const required = fixture.schema.required?.find((key) => Object.hasOwn(parsed, key));
  if (required) {
    const missing = structuredClone(parsed);
    delete missing[required];
    cases.push({ id: 'missing-required', arguments: missing, expected: 'rejected' });
  }
  return cases;
}

const report = {
  version: 1,
  generated_at: new Date().toISOString(),
  policy:
    'shallow clone and static source reading only; repository code and dependencies were not executed',
  repositories: [],
  totals: { repositories: 0, fixtures: 0, source_calls: 0, derived_calls: 0, passed: 0, failed: 0 },
  failures: [],
};

for (const repository of repositories) {
  const target = ensureCheckout(repository);
  const repoResult = {
    id: repository.id,
    url: repository.url,
    commit: run('git', ['rev-parse', 'HEAD'], target),
    evidence: [],
    fixtures: 0,
    source_calls: 0,
    derived_calls: 0,
    passed: 0,
    failed: 0,
  };
  for (const evidence of repository.evidence) {
    const path = join(target, evidence.file);
    const source = readFileSync(path, 'utf8');
    const missingAnchors = evidence.anchors.filter((anchor) => !source.includes(anchor));
    if (missingAnchors.length > 0)
      throw new Error(
        `${repository.id}:${evidence.file} lost ${missingAnchors.length} evidence anchors`,
      );
    repoResult.evidence.push({
      file: evidence.file,
      source_sha256: digest(source),
      anchors_verified: evidence.anchors.length,
    });
  }
  for (const fixture of repository.fixtures) {
    repoResult.fixtures += 1;
    report.totals.fixtures += 1;
    const allCalls = [
      ...fixture.calls.map((call) => ({ ...call, origin: 'source' })),
      ...derivedCases(fixture).map((call) => ({ ...call, origin: 'derived' })),
    ];
    for (const [index, call] of allCalls.entries()) {
      const decision = validateToolCall({
        tool_name: fixture.tool,
        tool_schema: fixture.schema,
        raw_arguments: call.arguments,
      });
      const matched = decision.decision === call.expected;
      const counter = call.origin === 'source' ? 'source_calls' : 'derived_calls';
      repoResult[counter] += 1;
      report.totals[counter] += 1;
      repoResult[matched ? 'passed' : 'failed'] += 1;
      report.totals[matched ? 'passed' : 'failed'] += 1;
      if (!matched)
        report.failures.push({
          repository: repository.id,
          fixture: fixture.id,
          case: call.id ?? `${call.origin}-${index}`,
          expected: call.expected,
          actual: decision.decision,
          reason_code: decision.decision === 'rejected' ? decision.reason_code : undefined,
        });
    }
  }
  report.repositories.push(repoResult);
}

report.totals.repositories = report.repositories.length;
report.passed =
  report.totals.repositories >= 5 &&
  report.repositories.every(
    (repository) =>
      repository.source_calls > 0 && repository.derived_calls > 0 && repository.failed === 0,
  );
const serialized = await format(JSON.stringify(report), { parser: 'json' });
if (serialized.includes('FIVE_REPO_SECRET_SENTINEL'))
  throw new Error('privacy failure: secret sentinel reached the persisted report');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, serialized, { mode: 0o600 });
console.log(
  JSON.stringify({ report: reportPath, ...report.totals, passed: report.passed }, null, 2),
);
if (!report.passed) process.exitCode = 1;
