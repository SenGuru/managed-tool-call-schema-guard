#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { format } from 'prettier';
import { validateToolCall } from '../packages/core/dist/index.js';

const BENCHMARKS = [
  {
    id: 'toolbench',
    url: 'https://github.com/OpenBMB/ToolBench.git',
    sparse: ['toolbench/tooleval/results/default_evalset/gpt-3.5-turbo_CoT'],
    license: 'Apache-2.0',
  },
  {
    id: 'stabletoolbench',
    url: 'https://github.com/THUNLP-MT/StableToolBench.git',
    sparse: ['data_example', 'solvable_queries_example'],
    license: 'Apache-2.0',
  },
  {
    id: 'toolalpaca',
    url: 'https://github.com/tangqiaoyu/ToolAlpaca.git',
    sparse: ['data'],
    license: 'Apache-2.0',
  },
  {
    id: 'seal-tools',
    url: 'https://github.com/fairyshine/Seal-Tools.git',
    sparse: ['Seal-Tools_Dataset'],
    license: 'Apache-2.0',
  },
  {
    id: 'api-bank',
    url: 'https://github.com/AlibabaResearch/DAMO-ConvAI.git',
    sparse: ['api-bank'],
    license: 'MIT',
  },
];
const reportIndex = process.argv.indexOf('--report');
const reportPath = resolve(
  reportIndex >= 0 && process.argv[reportIndex + 1]
    ? process.argv[reportIndex + 1]
    : 'audit-results/multi-benchmark-replay.json',
);
const suppliedRoot = process.env.SCHEMA_GUARD_BENCHMARK_ROOT;
const root = suppliedRoot
  ? resolve(suppliedRoot)
  : mkdtempSync(join(tmpdir(), 'schema-guard-benchmarks.'));
const basicAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const basicValidatorCache = new WeakMap();

function command(name, args, cwd = process.cwd()) {
  const result = spawnSync(name, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${name} ${args.join(' ')} failed: ${result.stderr.slice(-4000)}`);
  return result.stdout.trim();
}

function checkout(benchmark) {
  const target = join(root, benchmark.id);
  if (!suppliedRoot) {
    command('git', [
      'clone',
      '--depth',
      '1',
      '--filter=blob:none',
      '--sparse',
      benchmark.url,
      target,
    ]);
    command('git', ['sparse-checkout', 'set', ...benchmark.sparse], target);
  }
  return target;
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function jsonLines(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function walk(path, predicate, output = []) {
  if (!existsSync(path)) return output;
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(child, predicate, output);
    else if (stat.isFile() && predicate(child)) output.push(child);
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function basicValidate(schema, rawArguments) {
  let argumentsObject;
  try {
    argumentsObject = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments;
  } catch {
    return { accepted: false, category: 'parse', issues: [] };
  }
  if (
    argumentsObject === null ||
    typeof argumentsObject !== 'object' ||
    Array.isArray(argumentsObject)
  )
    return { accepted: false, category: 'shape', issues: [] };
  try {
    let validate = basicValidatorCache.get(schema);
    if (!validate) {
      validate = basicAjv.compile(schema);
      basicValidatorCache.set(schema, validate);
    }
    const accepted = validate(argumentsObject);
    return {
      accepted,
      category: accepted ? 'accepted' : 'schema',
      issues: (validate.errors ?? []).map((error) => ({
        path: error.instancePath || '/',
        keyword: error.keyword,
        message: error.message ?? 'schema validation failed',
      })),
    };
  } catch {
    return { accepted: false, category: 'schema_compile', issues: [] };
  }
}

function recordDiagnosticProxy(target, guardDecision, basicDecision) {
  target.cases += 1;
  if (
    guardDecision.decision === 'rejected' &&
    guardDecision.reason_code &&
    guardDecision.repair_hint &&
    guardDecision.audit_id
  )
    target.guard_one_response_triage_ready += 1;
  if (!basicDecision.accepted && basicDecision.category && basicDecision.issues.length > 0)
    target.basic_has_machine_readable_field_issue += 1;
}

function standardize(value) {
  let output = value
    .replaceAll(/[^\u4e00-\u9fa5a-zA-Z0-9_]/gu, '_')
    .replaceAll(/_+/gu, '_')
    .toLowerCase()
    .replaceAll(/^_+|_+$/gu, '');
  if (/^\d/u.test(output)) output = `get_${output}`;
  if (['from', 'class', 'return', 'false', 'true', 'id', 'and'].includes(output))
    output = `is_${output}`;
  return output;
}

function primitiveType(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (['int', 'integer', 'long', 'number'].includes(normalized)) return 'integer';
  if (['float', 'double'].includes(normalized)) return 'number';
  if (['bool', 'boolean'].includes(normalized)) return 'boolean';
  if (['list', 'array', 'tuple'].includes(normalized)) return 'array';
  if (['dict', 'object'].includes(normalized)) return 'object';
  return 'string';
}

const PYTHON_STATIC_EXTRACTOR = String.raw`
import ast, json, os, sys
root, mode = sys.argv[1], sys.argv[2]
out = []
def ann_type(node):
    if node is None: return 'string'
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Subscript):
        return ann_type(node.value)
    if isinstance(node, ast.Attribute): return node.attr
    return 'string'
for base, _, files in os.walk(root):
  for filename in files:
    if not filename.endswith('.py'): continue
    path = os.path.join(base, filename)
    try:
      tree = ast.parse(open(path, encoding='utf-8').read())
    except Exception:
      continue
    if mode == 'functions':
      for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)): continue
        args = node.args.args
        defaults = [None] * (len(args) - len(node.args.defaults)) + list(node.args.defaults)
        props, required = {}, []
        for arg, default in zip(args, defaults):
          if arg.arg in ('self', 'cls', 'toolbench_rapidapi_key'): continue
          props[arg.arg] = {'type': ann_type(arg.annotation)}
          if default is None: required.append(arg.arg)
        out.append({'name': node.name, 'relative': os.path.relpath(path, root), 'properties': props, 'required': required})
    else:
      for node in tree.body:
        if not isinstance(node, ast.ClassDef): continue
        for child in node.body:
          if isinstance(child, (ast.Assign, ast.AnnAssign)):
            targets = child.targets if isinstance(child, ast.Assign) else [child.target]
            if any(isinstance(t, ast.Name) and t.id == 'input_parameters' for t in targets):
              try: value = ast.literal_eval(child.value)
              except Exception: continue
              out.append({'name': node.name, 'relative': os.path.relpath(path, root), 'parameters': value})
print(json.dumps(out))
`;

function pythonSchemas(path, mode) {
  const extracted = JSON.parse(command('python3', ['-c', PYTHON_STATIC_EXTRACTOR, path, mode]));
  return extracted.map((entry) => {
    const raw = entry.parameters ?? entry.properties;
    const properties = Object.fromEntries(
      Object.entries(raw).map(([name, value]) => [
        standardize(name),
        {
          type: primitiveType(value.type),
          ...(value.description ? { description: value.description } : {}),
        },
      ]),
    );
    return {
      name: entry.name,
      relative: entry.relative,
      schema: {
        type: 'object',
        properties,
        required: (entry.required ?? Object.keys(raw)).map(standardize),
      },
    };
  });
}

function toolbenchSchema(api) {
  const properties = {};
  const required = [];
  for (const parameter of api.required_parameters ?? []) {
    const name = standardize(parameter.name);
    properties[name] = { type: primitiveType(parameter.type) };
    required.push(name);
  }
  for (const parameter of api.optional_parameters ?? [])
    properties[standardize(parameter.name)] = { type: primitiveType(parameter.type) };
  return { type: 'object', properties, required };
}

function extractFunctionCalls(value, output = []) {
  if (Array.isArray(value)) {
    for (const child of value) extractFunctionCalls(child, output);
  } else if (value && typeof value === 'object') {
    if (value.function_call?.name && value.function_call.name !== 'Finish')
      output.push({ name: value.function_call.name, arguments: value.function_call.arguments });
    for (const child of Object.values(value)) extractFunctionCalls(child, output);
  }
  return output;
}

function pythonQuotedField(message, field) {
  const marker = `'${field}': '`;
  const start = message.indexOf(marker);
  if (start < 0) return undefined;
  let escaped = false;
  let output = '';
  for (let index = start + marker.length; index < message.length; index += 1) {
    const character = message[index];
    if (escaped) {
      output +=
        character === 'n' ? '\n' : character === 'r' ? '\r' : character === 't' ? '\t' : character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === "'") {
      return output;
    } else {
      output += character;
    }
  }
  return undefined;
}

function extractToolBenchResultCalls(value, schemas, output = []) {
  if (Array.isArray(value)) {
    for (const child of value) extractToolBenchResultCalls(child, schemas, output);
  } else if (value && typeof value === 'object') {
    if (value.role === 'tool' && typeof value.message === 'string') {
      const name = pythonQuotedField(value.message, 'name');
      const args = pythonQuotedField(value.message, 'arguments');
      const schema = schemas.get(name);
      if (name && name !== 'Finish' && args !== undefined && schema)
        output.push({ tool: name, schema, arguments: args });
    }
    for (const child of Object.values(value)) extractToolBenchResultCalls(child, schemas, output);
  }
  return output;
}

function normalizeToolBenchSchema(schema) {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([name, property]) => [
        name,
        {
          type: property.type,
          ...(property.description ? { description: property.description } : {}),
          ...(property.enum ? { enum: property.enum } : {}),
        },
      ]),
    ),
    required: schema.required ?? [],
  };
}

function parseToolBench(target) {
  const resultRoot = join(
    target,
    'toolbench',
    'tooleval',
    'results',
    'default_evalset',
    'gpt-3.5-turbo_CoT',
  );
  const calls = [];
  for (const path of walk(resultRoot, (file) => file.endsWith('.json'))) {
    const document = json(path);
    const rows = Array.isArray(document) ? document : Object.values(document);
    for (const row of rows) {
      const schemas = new Map(
        (row.available_tools ?? [])
          .filter((tool) => tool.name && tool.name !== 'Finish' && tool.parameters)
          .map((tool) => [tool.name, normalizeToolBenchSchema(tool.parameters)]),
      );
      extractToolBenchResultCalls(row.answer?.answer_details, schemas, calls);
    }
  }
  return calls;
}

function parseStableToolBench(target) {
  const instructionPaths = walk(
    join(target, 'solvable_queries_example', 'test_instruction'),
    (file) => file.endsWith('.json'),
  );
  const entries = instructionPaths.flatMap(json);
  const queryMap = new Map(entries.map((entry) => [entry.query, entry]));
  const calls = [];
  for (const path of walk(join(target, 'data_example', 'answer'), (file) =>
    file.endsWith('.json'),
  )) {
    const answer = json(path);
    const query = answer.answer_generation?.query;
    const entry = queryMap.get(query);
    if (!entry) continue;
    const schemas = new Map(
      entry.api_list.map((api) => {
        const name = `${standardize(api.api_name)}_for_${standardize(api.tool_name)}`.slice(-64);
        return [name, toolbenchSchema(api)];
      }),
    );
    for (const call of extractFunctionCalls(answer)) {
      const schema = schemas.get(call.name);
      if (schema) calls.push({ tool: call.name, schema, arguments: call.arguments });
    }
  }
  return calls;
}

function resolveRef(document, value) {
  if (!value?.$ref?.startsWith('#/')) return value;
  let current = document;
  for (const part of value.$ref.slice(2).split('/')) current = current?.[part];
  return current ?? value;
}

function openApiOperations(document) {
  const operations = new Map();
  for (const pathItem of Object.values(document.paths ?? {}))
    for (const operation of Object.values(pathItem ?? {})) {
      if (!operation?.operationId) continue;
      const properties = {};
      const required = [];
      for (const rawParameter of operation.parameters ?? []) {
        const parameter = resolveRef(document, rawParameter);
        if (!parameter?.name) continue;
        properties[parameter.name] = resolveRef(document, parameter.schema ?? { type: 'string' });
        if (parameter.required) required.push(parameter.name);
      }
      const content = operation.requestBody?.content ?? {};
      const bodySchema = resolveRef(
        document,
        content['application/json']?.schema ?? content['application/x-www-form-urlencoded']?.schema,
      );
      if (bodySchema?.properties)
        for (const [name, schema] of Object.entries(bodySchema.properties))
          properties[name] = resolveRef(document, schema);
      if (Array.isArray(bodySchema?.required)) required.push(...bodySchema.required);
      operations.set(operation.operationId, {
        type: 'object',
        properties,
        required: [...new Set(required)],
      });
    }
  return operations;
}

function parseToolAlpaca(target) {
  const calls = [];
  for (const filename of ['eval_simulated.json', 'eval_real.json'])
    for (const item of json(join(target, 'data', filename))) {
      const operations = openApiOperations(JSON.parse(item.Documentation));
      for (const sequence of item.Golden_Answers ?? [])
        for (const call of sequence) {
          const schema = operations.get(call.Action);
          if (schema) calls.push({ tool: call.Action, schema, arguments: call.Action_Input });
        }
    }
  return calls;
}

function parseSealTools(target) {
  const tools = new Map(
    jsonLines(join(target, 'Seal-Tools_Dataset', 'tool.jsonl')).map((tool) => [
      tool.api_name,
      {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([name, value]) => [
            name,
            { type: primitiveType(value.type) },
          ]),
        ),
        required: tool.required,
      },
    ]),
  );
  const calls = [];
  for (const filename of ['dev.jsonl', 'test_in_domain.jsonl', 'test_out_domain.jsonl'])
    for (const row of jsonLines(join(target, 'Seal-Tools_Dataset', filename)))
      for (const call of row.calling ?? []) {
        const schema = tools.get(call.api);
        if (schema) calls.push({ tool: call.api, schema, arguments: call.parameters });
      }
  return calls;
}

function parseApiBank(target) {
  const apiRoot = join(target, 'api-bank');
  const schemas = new Map(
    pythonSchemas(join(apiRoot, 'apis'), 'classes').map((x) => [x.name, x.schema]),
  );
  const calls = [];
  for (const path of walk(join(apiRoot, 'lv1-lv2-samples'), (file) => file.endsWith('.jsonl')))
    for (const row of jsonLines(path))
      if (row.role === 'API' && schemas.has(row.api_name))
        calls.push({
          tool: row.api_name,
          schema: schemas.get(row.api_name),
          arguments: row.param_dict,
        });
  return calls;
}

const parsers = {
  toolbench: parseToolBench,
  stabletoolbench: parseStableToolBench,
  toolalpaca: parseToolAlpaca,
  'seal-tools': parseSealTools,
  'api-bank': parseApiBank,
};

function mutationCases(call, validArguments) {
  const cases = [
    {
      kind: 'json_encoding',
      schema: call.schema,
      arguments: JSON.stringify(validArguments),
      expected: 'valid',
    },
    { kind: 'malformed_json', schema: call.schema, arguments: '{"broken":', expected: 'rejected' },
    {
      kind: 'closed_schema_injection',
      schema: { ...call.schema, additionalProperties: false },
      arguments: { ...validArguments, __schema_guard_secret: 'MULTI_BENCHMARK_SECRET_SENTINEL' },
      expected: 'rejected',
    },
  ];
  const required = call.schema.required?.find((key) => Object.hasOwn(validArguments, key));
  if (required) {
    const missing = structuredClone(validArguments);
    delete missing[required];
    cases.push({
      kind: 'missing_required',
      schema: call.schema,
      arguments: missing,
      expected: 'rejected',
    });
  }
  const repairable = Object.entries(validArguments).find(([name, value]) => {
    const type = call.schema.properties?.[name]?.type;
    return (
      (type === 'integer' || type === 'number' || type === 'boolean') &&
      (typeof value === 'number' || typeof value === 'boolean')
    );
  });
  if (repairable) {
    const [name, value] = repairable;
    cases.push({
      kind: 'safe_scalar_stringification',
      schema: call.schema,
      arguments: { ...validArguments, [name]: String(value) },
      expected: 'valid_with_repair',
    });
  }
  return cases;
}

const report = {
  version: 1,
  generated_at: new Date().toISOString(),
  policy:
    'benchmark data and license files only; downloaded benchmark code and dependencies were not executed',
  benchmarks: [],
  totals: {
    repositories: 0,
    recorded_calls: 0,
    conforming_calls: 0,
    schema_conflicts: 0,
    mutations: 0,
    mutations_matched: 0,
    mutations_mismatched: 0,
  },
  value_tests: {
    observed_failure_interception: {
      recorded_calls: 0,
      intercepted_source_contract_failures: 0,
      plain_validator_agreement: 0,
      rejection_reasons: {},
    },
    repair_advantage: {
      safe_scalar_stringification_cases: 0,
      plain_validator_rejected_guard_repaired: 0,
      repair_rules: {},
    },
    diagnostic_workflow_proxy: {
      cases: 0,
      guard_one_response_triage_ready: 0,
      basic_has_machine_readable_field_issue: 0,
      required_guard_fields: ['reason_code', 'repair_hint', 'audit_id'],
      limitation:
        'This measures structured diagnostic completeness, not elapsed human debugging time.',
    },
  },
  failures: [],
};

for (const benchmark of BENCHMARKS) {
  const target = checkout(benchmark);
  const licenseText = readFileSync(join(target, 'LICENSE'), 'utf8');
  const calls = parsers[benchmark.id](target);
  const result = {
    id: benchmark.id,
    repository: benchmark.url,
    commit: command('git', ['rev-parse', 'HEAD'], target),
    license: benchmark.license,
    license_sha256: sha256(licenseText),
    recorded_calls: calls.length,
    conforming_calls: 0,
    schema_conflicts: 0,
    mutations: 0,
    mutations_matched: 0,
    mutations_mismatched: 0,
  };
  for (const call of calls) {
    report.value_tests.observed_failure_interception.recorded_calls += 1;
    const decision = validateToolCall({
      tool_name: call.tool,
      tool_schema: call.schema,
      raw_arguments: call.arguments,
    });
    if (decision.decision === 'rejected') {
      result.schema_conflicts += 1;
      const basic = basicValidate(call.schema, call.arguments);
      report.value_tests.observed_failure_interception.intercepted_source_contract_failures += 1;
      if (!basic.accepted)
        report.value_tests.observed_failure_interception.plain_validator_agreement += 1;
      const reasons = report.value_tests.observed_failure_interception.rejection_reasons;
      reasons[decision.reason_code] = (reasons[decision.reason_code] ?? 0) + 1;
      recordDiagnosticProxy(report.value_tests.diagnostic_workflow_proxy, decision, basic);
      continue;
    }
    result.conforming_calls += 1;
    for (const mutation of mutationCases(call, decision.valid_arguments)) {
      const basic = basicValidate(mutation.schema, mutation.arguments);
      const mutated = validateToolCall({
        tool_name: call.tool,
        tool_schema: mutation.schema,
        raw_arguments: mutation.arguments,
      });
      const matched = mutated.decision === mutation.expected;
      result.mutations += 1;
      result[matched ? 'mutations_matched' : 'mutations_mismatched'] += 1;
      if (mutation.kind === 'safe_scalar_stringification') {
        const advantage = report.value_tests.repair_advantage;
        advantage.safe_scalar_stringification_cases += 1;
        if (!basic.accepted && mutated.decision === 'valid_with_repair') {
          advantage.plain_validator_rejected_guard_repaired += 1;
          for (const repair of mutated.repaired_fields)
            advantage.repair_rules[repair.rule_id] =
              (advantage.repair_rules[repair.rule_id] ?? 0) + 1;
        }
      }
      if (mutated.decision === 'rejected')
        recordDiagnosticProxy(report.value_tests.diagnostic_workflow_proxy, mutated, basic);
      if (!matched && report.failures.length < 100)
        report.failures.push({
          benchmark: benchmark.id,
          case_hash: sha256(`${call.tool}:${mutation.kind}`),
          mutation: mutation.kind,
          expected: mutation.expected,
          actual: mutated.decision,
          reason_code: mutated.decision === 'rejected' ? mutated.reason_code : undefined,
        });
    }
  }
  report.benchmarks.push(result);
  report.totals.repositories += 1;
  for (const key of [
    'recorded_calls',
    'conforming_calls',
    'schema_conflicts',
    'mutations',
    'mutations_matched',
    'mutations_mismatched',
  ])
    report.totals[key] += result[key];
}

const interception = report.value_tests.observed_failure_interception;
interception.interception_rate =
  interception.recorded_calls === 0
    ? 0
    : interception.intercepted_source_contract_failures / interception.recorded_calls;
const repairAdvantage = report.value_tests.repair_advantage;
repairAdvantage.recovery_rate =
  repairAdvantage.safe_scalar_stringification_cases === 0
    ? 0
    : repairAdvantage.plain_validator_rejected_guard_repaired /
      repairAdvantage.safe_scalar_stringification_cases;
const diagnosticProxy = report.value_tests.diagnostic_workflow_proxy;
diagnosticProxy.guard_triage_ready_rate =
  diagnosticProxy.cases === 0
    ? 0
    : diagnosticProxy.guard_one_response_triage_ready / diagnosticProxy.cases;
diagnosticProxy.basic_field_issue_rate =
  diagnosticProxy.cases === 0
    ? 0
    : diagnosticProxy.basic_has_machine_readable_field_issue / diagnosticProxy.cases;

report.passed =
  report.totals.repositories >= 5 &&
  report.benchmarks.every(
    (benchmark) =>
      benchmark.recorded_calls > 0 &&
      benchmark.conforming_calls > 0 &&
      benchmark.mutations > 0 &&
      benchmark.mutations_mismatched === 0,
  );
const serialized = await format(JSON.stringify(report), { parser: 'json' });
if (serialized.includes('MULTI_BENCHMARK_SECRET_SENTINEL'))
  throw new Error('privacy failure: secret sentinel reached the report');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, serialized, { mode: 0o600 });
console.log(
  JSON.stringify({ report: reportPath, ...report.totals, passed: report.passed }, null, 2),
);
if (!report.passed) process.exitCode = 1;
