#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { format } from 'prettier';
import { detectSchemaDrift, sha256, validateToolCall } from '../packages/core/dist/index.js';

const SOURCE_URL = 'https://github.com/ShishirPatil/gorilla.git';
const SOURCE_SUBDIRECTORY = 'berkeley-function-call-leaderboard/bfcl_eval/data';
const CATEGORIES = [
  'BFCL_v4_live_simple',
  'BFCL_v4_live_multiple',
  'BFCL_v4_live_parallel',
  'BFCL_v4_live_parallel_multiple',
  'BFCL_v4_simple_python',
  'BFCL_v4_multiple',
  'BFCL_v4_parallel',
  'BFCL_v4_parallel_multiple',
  'BFCL_v4_simple_java',
  'BFCL_v4_simple_javascript',
];
const TYPE_MAP = new Map([
  ['dict', 'object'],
  ['float', 'number'],
  ['double', 'number'],
  ['String', 'string'],
  ['char', 'string'],
  ['Boolean', 'boolean'],
  ['long', 'integer'],
  ['Array', 'array'],
  ['ArrayList', 'array'],
  ['tuple', 'array'],
  ['HashMap', 'object'],
]);
const OMITTED_SCHEMA_KEYS = new Set(['optional', 'format']);
const OMIT_ARGUMENT = Symbol('omit optional BFCL argument');
const reportArg = process.argv.indexOf('--report');
const requestedReport =
  reportArg === -1 || process.argv[reportArg + 1] === undefined
    ? undefined
    : resolve(process.argv[reportArg + 1]);
const suppliedRoot = process.env.SCHEMA_GUARD_BFCL_ROOT;
const workspace = mkdtempSync(join(tmpdir(), 'schema-guard-bfcl-replay.'));
const checkout = suppliedRoot ? resolve(suppliedRoot) : join(workspace, 'gorilla');

function command(name, args, cwd = process.cwd()) {
  const result = spawnSync(name, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${name} ${args.join(' ')} failed: ${result.stderr.slice(-4000)}`);
  return result.stdout.trim();
}

if (!suppliedRoot) {
  command('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', SOURCE_URL, checkout]);
  command('git', ['sparse-checkout', 'set', 'berkeley-function-call-leaderboard'], checkout);
}

const dataRoot = join(checkout, SOURCE_SUBDIRECTORY);
const commit = command('git', ['rev-parse', 'HEAD'], checkout);
const license = readFileSync(join(checkout, 'LICENSE'), 'utf8');
if (!license.includes('Apache License') || !license.includes('Version 2.0'))
  throw new Error('BFCL source checkout did not contain the expected Apache-2.0 license');

function readJsonLines(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonicalizeSchema(value, stats) {
  if (Array.isArray(value)) return value.map((item) => canonicalizeSchema(item, stats));
  if (value === null || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (OMITTED_SCHEMA_KEYS.has(key)) {
      stats.omitted_keywords[key] = (stats.omitted_keywords[key] ?? 0) + 1;
      continue;
    }
    if (key === 'type' && typeof child === 'string') {
      if (child === 'any' || child === '') {
        stats.unconstrained_types[child || '<empty>'] =
          (stats.unconstrained_types[child || '<empty>'] ?? 0) + 1;
        continue;
      }
      const normalized = TYPE_MAP.get(child) ?? child;
      if (normalized !== child)
        stats.normalized_types[`${child}->${normalized}`] =
          (stats.normalized_types[`${child}->${normalized}`] ?? 0) + 1;
      output[key] = normalized;
      continue;
    }
    output[key] = canonicalizeSchema(child, stats);
  }
  return output;
}

function schemaType(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  return schema.type;
}

function cap(values, limit = 64) {
  return values.slice(0, limit);
}

// BFCL encodes acceptable scalar values as arrays. For array-typed arguments,
// the outer array is the acceptable-value set and each inner array is one value.
function materialize(value, schema) {
  const type = schemaType(schema);
  if (type === 'object' || (schema?.properties && !type)) {
    const choices = Array.isArray(value) ? value : [value];
    const outputs = [];
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) continue;
      let partials = [{}];
      for (const [key, encoded] of Object.entries(choice)) {
        const childSchema = schema.properties?.[key] ?? {};
        const childValues = materialize(encoded, childSchema);
        const required = Array.isArray(schema.required) && schema.required.includes(key);
        if (
          !required &&
          Array.isArray(encoded) &&
          encoded.some((item) => item === '' || item === null)
        )
          childValues.unshift(OMIT_ARGUMENT);
        partials = cap(
          partials.flatMap((partial) =>
            childValues.map((child) =>
              child === OMIT_ARGUMENT ? partial : { ...partial, [key]: child },
            ),
          ),
        );
      }
      outputs.push(...partials);
    }
    return cap(outputs);
  }
  if (type === 'array') {
    if (Array.isArray(value) && value.length === 0) return [[]];
    const choices = Array.isArray(value) ? value : [value];
    const outputs = [];
    for (const choice of choices) {
      if (!Array.isArray(choice)) continue;
      let partials = [[]];
      for (const encoded of choice) {
        const itemValues = materializeActual(encoded, schema.items ?? {});
        partials = cap(partials.flatMap((partial) => itemValues.map((item) => [...partial, item])));
      }
      outputs.push(...partials);
    }
    return cap(outputs);
  }
  return cap(Array.isArray(value) ? value : [value]);
}

function materializeActual(value, schema) {
  const type = schemaType(schema);
  if (type === 'object' || (schema?.properties && !type)) return materialize(value, schema);
  if (type === 'array') return materialize([value], schema);
  return [value];
}

function findTool(tools, name) {
  return tools.find((tool) => tool.name === name);
}

function baselineFor(tool, encodedArguments, stats) {
  const schema = canonicalizeSchema(tool.parameters, stats);
  const candidates = materialize(encodedArguments, schema);
  for (const argumentsObject of candidates) {
    const decision = validateToolCall({
      tool_name: tool.name,
      tool_schema: schema,
      raw_arguments: argumentsObject,
    });
    if (decision.decision !== 'rejected') return { schema, argumentsObject, decision };
  }
  const firstArguments = candidates[0] ?? {};
  return {
    schema,
    argumentsObject: firstArguments,
    decision: validateToolCall({
      tool_name: tool.name,
      tool_schema: schema,
      raw_arguments: firstArguments,
    }),
  };
}

function scalarLeaves(value, schema, path = []) {
  if (value === null || typeof value !== 'object') return [{ path, value, schema }];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      scalarLeaves(item, schema?.items ?? {}, [...path, index]),
    );
  return Object.entries(value).flatMap(([key, child]) =>
    scalarLeaves(child, schema?.properties?.[key] ?? {}, [...path, key]),
  );
}

function replaceAt(value, path, replacement) {
  const copy = structuredClone(value);
  let cursor = copy;
  for (const part of path.slice(0, -1)) cursor = cursor[part];
  cursor[path.at(-1)] = replacement;
  return copy;
}

function removeAt(value, path) {
  const copy = structuredClone(value);
  let cursor = copy;
  for (const part of path.slice(0, -1)) cursor = cursor[part];
  if (Array.isArray(cursor)) cursor.splice(path.at(-1), 1);
  else delete cursor[path.at(-1)];
  return copy;
}

function mutationCases(schema, argumentsObject) {
  const cases = [];
  const leaves = scalarLeaves(argumentsObject, schema);
  const repairable = leaves.find(
    ({ value, schema: leafSchema }) =>
      (leafSchema?.type === 'integer' && Number.isSafeInteger(value)) ||
      (leafSchema?.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (leafSchema?.type === 'boolean' && typeof value === 'boolean'),
  );
  if (repairable)
    cases.push({
      kind: 'repairable_scalar_stringification',
      arguments: replaceAt(argumentsObject, repairable.path, String(repairable.value)),
      expected: 'valid_with_repair',
    });
  const integer = leaves.find(({ schema: leafSchema }) => leafSchema?.type === 'integer');
  if (integer)
    cases.push({
      kind: 'ambiguous_leading_zero_integer',
      arguments: replaceAt(argumentsObject, integer.path, '01'),
      expected: 'rejected',
    });
  const required = Array.isArray(schema.required)
    ? schema.required.find((key) => Object.hasOwn(argumentsObject, key))
    : undefined;
  if (required)
    cases.push({
      kind: 'missing_required_argument',
      arguments: removeAt(argumentsObject, [required]),
      expected: 'rejected',
    });
  cases.push({ kind: 'malformed_json', arguments: '{"unterminated":', expected: 'rejected' });
  cases.push({ kind: 'non_object_arguments', arguments: '[]', expected: 'rejected' });
  cases.push({
    kind: 'closed_schema_secret_injection',
    schema: { ...schema, additionalProperties: false },
    arguments: {
      ...argumentsObject,
      __schema_guard_unexpected_secret: 'REAL_DATA_SECRET_SENTINEL',
    },
    expected: 'rejected',
  });
  return cases;
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
}

function acceptedSignature(decision) {
  return sha256({
    decision: decision.decision,
    valid_arguments: decision.decision === 'rejected' ? undefined : decision.valid_arguments,
    repairs: decision.repaired_fields.map(({ path, rule_id }) => ({ path, rule_id })),
  });
}

const DIALECTS = [
  'http://json-schema.org/draft-07/schema#',
  'https://json-schema.org/draft/2019-09/schema',
  'https://json-schema.org/draft/2020-12/schema',
];

function driftCases(schema) {
  const cases = [];
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    if (schema.additionalProperties !== false)
      cases.push({
        kind: 'close_root_object',
        current: { ...schema, additionalProperties: false },
        expected: 'breaking',
      });
    if (Array.isArray(schema.required) && schema.required.length > 0)
      cases.push({
        kind: 'remove_required_argument',
        current: { ...schema, required: schema.required.slice(1) },
        expected: 'backward_compatible',
      });
    const typedProperty = Object.entries(schema.properties ?? {}).find(
      ([, property]) =>
        property &&
        typeof property === 'object' &&
        !Array.isArray(property) &&
        ['string', 'number', 'integer', 'boolean'].includes(property.type),
    );
    if (typedProperty) {
      const [name, property] = typedProperty;
      const changedType = property.type === 'string' ? 'integer' : 'string';
      cases.push({
        kind: 'change_property_type',
        current: {
          ...schema,
          properties: {
            ...schema.properties,
            [name]: { ...property, type: changedType },
          },
        },
        expected: 'breaking',
      });
    }
  }
  return cases;
}

const stats = {
  normalized_types: {},
  unconstrained_types: {},
  omitted_keywords: {},
};
const report = {
  version: 1,
  created_at: new Date().toISOString(),
  source: {
    name: 'Berkeley Function Calling Leaderboard V4',
    repository: SOURCE_URL,
    commit,
    license: 'Apache-2.0',
    categories: CATEGORIES,
    execution_policy: 'data files parsed only; downloaded code and dependencies were not executed',
  },
  privacy: {
    raw_questions_persisted: false,
    raw_arguments_persisted: false,
    tool_names_persisted: false,
    secret_sentinel_persisted: false,
  },
  normalization: stats,
  totals: {
    dataset_rows: 0,
    expected_calls: 0,
    baseline_passed: 0,
    baseline_schema_conflicts: 0,
    missing_tool_declarations: 0,
    mutations_run: 0,
    mutations_matched: 0,
    mutations_mismatched: 0,
  },
  suites: {
    authentic_contract_replay: { run: 0, matched: 0, mismatched: 0 },
    adversarial_repair_and_rejection: { run: 0, matched: 0, mismatched: 0 },
    schema_dialect_differential: { run: 0, matched: 0, mismatched: 0 },
    metamorphic_encoding_and_order: { run: 0, matched: 0, mismatched: 0 },
    real_schema_drift_classification: { run: 0, matched: 0, mismatched: 0 },
    deterministic_privacy_envelope: { run: 0, matched: 0, mismatched: 0 },
  },
  by_category: {},
  schema_conflicts: [],
  mutation_failures: [],
  sampled_evidence: [],
};

for (const category of CATEGORIES) {
  const inputs = readJsonLines(join(dataRoot, `${category}.json`));
  const answers = readJsonLines(join(dataRoot, 'possible_answer', `${category}.json`));
  const answersById = new Map(answers.map((entry) => [entry.id, entry.ground_truth]));
  const categoryResult = {
    dataset_rows: inputs.length,
    expected_calls: 0,
    baseline_passed: 0,
    baseline_schema_conflicts: 0,
    missing_tool_declarations: 0,
    mutations_run: 0,
    mutations_matched: 0,
  };
  report.totals.dataset_rows += inputs.length;
  for (const input of inputs) {
    const expectedCalls = answersById.get(input.id) ?? [];
    for (const call of expectedCalls) {
      for (const [toolName, encodedArguments] of Object.entries(call)) {
        categoryResult.expected_calls += 1;
        report.totals.expected_calls += 1;
        const tool = findTool(input.function, toolName);
        if (!tool) {
          categoryResult.missing_tool_declarations += 1;
          report.totals.missing_tool_declarations += 1;
          continue;
        }
        const baseline = baselineFor(tool, encodedArguments, stats);
        report.suites.authentic_contract_replay.run += 1;
        if (baseline.decision.decision === 'rejected') {
          categoryResult.baseline_schema_conflicts += 1;
          report.totals.baseline_schema_conflicts += 1;
          report.suites.authentic_contract_replay.matched += 1;
          if (report.schema_conflicts.length < 100)
            report.schema_conflicts.push({
              case_hash: hash([category, input.id, toolName]),
              category,
              classification: 'ground_truth_not_conformant_to_declared_schema',
              reason_code: baseline.decision.reason_code,
              validation_keywords: (baseline.decision.validation_errors ?? []).map(
                (error) => error.keyword,
              ),
            });
          continue;
        }
        categoryResult.baseline_passed += 1;
        report.totals.baseline_passed += 1;
        report.suites.authentic_contract_replay.matched += 1;
        if (report.sampled_evidence.length < 25)
          report.sampled_evidence.push({
            case_hash: hash([category, input.id, toolName]),
            category,
            schema_hash: baseline.decision.audit.schema_hash,
            arguments_hash: baseline.decision.audit.arguments_hash,
            baseline_decision: baseline.decision.decision,
          });
        for (const mutation of mutationCases(baseline.schema, baseline.argumentsObject)) {
          const decision = validateToolCall({
            tool_name: toolName,
            tool_schema: mutation.schema ?? baseline.schema,
            raw_arguments: mutation.arguments,
          });
          const matched = decision.decision === mutation.expected;
          report.suites.adversarial_repair_and_rejection.run += 1;
          categoryResult.mutations_run += 1;
          report.totals.mutations_run += 1;
          if (matched) {
            categoryResult.mutations_matched += 1;
            report.totals.mutations_matched += 1;
            report.suites.adversarial_repair_and_rejection.matched += 1;
          } else {
            report.totals.mutations_mismatched += 1;
            report.suites.adversarial_repair_and_rejection.mismatched += 1;
            if (report.mutation_failures.length < 100)
              report.mutation_failures.push({
                case_hash: hash([category, input.id, toolName, mutation.kind]),
                category,
                mutation: mutation.kind,
                expected: mutation.expected,
                actual: decision.decision,
                reason_code: decision.decision === 'rejected' ? decision.reason_code : undefined,
              });
          }
        }

        const baselineSignature = acceptedSignature(baseline.decision);
        for (const dialect of DIALECTS) {
          const decision = validateToolCall({
            tool_name: toolName,
            tool_schema: { ...baseline.schema, $schema: dialect },
            raw_arguments: baseline.argumentsObject,
          });
          const matched = acceptedSignature(decision) === baselineSignature;
          report.suites.schema_dialect_differential.run += 1;
          report.suites.schema_dialect_differential[matched ? 'matched' : 'mismatched'] += 1;
        }

        for (const transformedArguments of [
          JSON.stringify(baseline.argumentsObject),
          reverseObjectKeys(baseline.argumentsObject),
        ]) {
          const decision = validateToolCall({
            tool_name: toolName,
            tool_schema: baseline.schema,
            raw_arguments: transformedArguments,
          });
          const matched =
            acceptedSignature(decision) === baselineSignature &&
            decision.audit.arguments_hash === baseline.decision.audit.arguments_hash;
          report.suites.metamorphic_encoding_and_order.run += 1;
          report.suites.metamorphic_encoding_and_order[matched ? 'matched' : 'mismatched'] += 1;
        }

        for (const driftCase of driftCases(baseline.schema)) {
          const drift = detectSchemaDrift(baseline.schema, driftCase.current);
          const matched = drift.changed && drift.compatibility === driftCase.expected;
          report.suites.real_schema_drift_classification.run += 1;
          report.suites.real_schema_drift_classification[matched ? 'matched' : 'mismatched'] += 1;
        }

        const repeated = validateToolCall({
          tool_name: toolName,
          tool_schema: baseline.schema,
          raw_arguments: structuredClone(baseline.argumentsObject),
        });
        const auditKeys = Object.keys(repeated.audit);
        const allowedAuditKeys = [
          'argument_shape',
          'arguments_hash',
          'audit_id',
          'decision',
          'engine_version',
          'policy_hash',
          'protocol_version',
          'repair_rule_ids',
          'ruleset_version',
          'schema_hash',
          'timestamp',
          'tool_name_hash',
        ];
        const deterministicPrivacyMatched =
          acceptedSignature(repeated) === baselineSignature &&
          repeated.audit.arguments_hash === baseline.decision.audit.arguments_hash &&
          repeated.audit.schema_hash === baseline.decision.audit.schema_hash &&
          repeated.audit.tool_name_hash === baseline.decision.audit.tool_name_hash &&
          auditKeys.every((key) => allowedAuditKeys.includes(key));
        report.suites.deterministic_privacy_envelope.run += 1;
        report.suites.deterministic_privacy_envelope[
          deterministicPrivacyMatched ? 'matched' : 'mismatched'
        ] += 1;
      }
    }
  }
  report.by_category[category] = categoryResult;
}

report.baseline_acceptance_rate = report.totals.baseline_passed / report.totals.expected_calls;
report.quality_gates = {
  minimum_independent_test_families: 5,
  minimum_expected_calls: 3000,
  minimum_baseline_acceptance_rate: 0.95,
  minimum_mutations: 15000,
  require_all_mutations_to_match: true,
  require_all_ground_truth_tools_to_be_declared: true,
  require_every_test_family_to_run: true,
  require_zero_test_family_mismatches: true,
};
report.test_family_count = Object.keys(report.suites).length;
report.passed =
  report.test_family_count >= report.quality_gates.minimum_independent_test_families &&
  report.totals.expected_calls >= report.quality_gates.minimum_expected_calls &&
  report.baseline_acceptance_rate >= report.quality_gates.minimum_baseline_acceptance_rate &&
  report.totals.mutations_run >= report.quality_gates.minimum_mutations &&
  report.totals.missing_tool_declarations === 0 &&
  report.totals.mutations_mismatched === 0 &&
  Object.values(report.suites).every((suite) => suite.run > 0 && suite.mismatched === 0);
const serialized = await format(JSON.stringify(report), { parser: 'json' });
if (serialized.includes('REAL_DATA_SECRET_SENTINEL'))
  throw new Error('privacy failure: raw secret sentinel reached persisted report');
const reportPath = requestedReport ?? join(workspace, 'real-data-replay-audit.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, serialized, { mode: 0o600 });
console.log(
  JSON.stringify({ report: reportPath, ...report.totals, passed: report.passed }, null, 2),
);
if (!report.passed) process.exitCode = 1;
