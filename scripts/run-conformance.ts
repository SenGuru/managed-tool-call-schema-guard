import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AnySchema } from 'ajv';
import {
  ENGINE_VERSION,
  PROTOCOL_VERSION,
  RULESET_VERSION,
  canonicalJson,
  normalizeTool,
  sha256,
  validateToolCall,
  type AdapterName,
  type DecisionStatus,
  type JsonObject,
  type ReasonCode,
  type RepairRuleId,
} from '../packages/core/src/index.js';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTERS = ['mcp', 'openai_agents', 'pydantic_ai', 'google_adk'] as const;

interface CorpusFixture {
  id: string;
  schema: AnySchema;
  arguments: JsonObject;
  decision: DecisionStatus;
}

interface CaseResult {
  id: string;
  expected_decision: DecisionStatus;
  actual_decision: DecisionStatus;
  passed: boolean;
  reason_code?: ReasonCode;
  repair_rule_ids: RepairRuleId[];
}

interface AdapterProbe {
  name: string;
  expected_decision: DecisionStatus;
  actual_decision: DecisionStatus;
  passed: boolean;
  reason_code?: ReasonCode;
}

interface AdapterResult {
  adapter: AdapterName;
  normalized: boolean;
  tool_name?: string;
  source_fingerprint?: string;
  schema_hash?: string;
  warnings: string[];
  probes: AdapterProbe[];
  error?: string;
}

export interface ConformanceReport {
  report_version: '1';
  protocol_version: typeof PROTOCOL_VERSION;
  engine_version: typeof ENGINE_VERSION;
  ruleset_version: typeof RULESET_VERSION;
  corpus_hash: string;
  passed: boolean;
  summary: {
    corpus_cases: number;
    corpus_passed: number;
    adapters: number;
    adapters_normalized: number;
    adapter_probes: number;
    adapter_probes_passed: number;
  };
  corpus: CaseResult[];
  compatibility: AdapterResult[];
}

export interface ReportDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function corpusFixtures(root: string): CorpusFixture[] {
  const value = readJson(resolve(root, 'conformance/cases.json'));
  if (!Array.isArray(value)) throw new TypeError('conformance/cases.json must be an array');
  return value as CorpusFixture[];
}

function decisionDetails(decision: ReturnType<typeof validateToolCall>): {
  actual_decision: DecisionStatus;
  reason_code?: ReasonCode;
  repair_rule_ids: RepairRuleId[];
} {
  return {
    actual_decision: decision.decision,
    ...(decision.decision === 'rejected' ? { reason_code: decision.reason_code } : {}),
    repair_rule_ids: decision.repaired_fields.map((repair) => repair.rule_id),
  };
}

function runAdapter(adapter: (typeof ADAPTERS)[number], root: string): AdapterResult {
  try {
    const source = readJson(resolve(root, `conformance/adapters/${adapter}.json`));
    const normalized = normalizeTool(adapter, source);
    const inputs: { name: string; arguments: JsonObject; expected: DecisionStatus }[] = [
      { name: 'valid_arguments', arguments: { city: 'Chennai' }, expected: 'valid' },
      { name: 'missing_required_argument', arguments: {}, expected: 'rejected' },
    ];
    const probes = inputs.map((probe): AdapterProbe => {
      const result = decisionDetails(
        validateToolCall({
          tool_name: normalized.tool_name,
          tool_schema: normalized.tool_schema,
          raw_arguments: probe.arguments,
          context: { adapter },
        }),
      );
      return {
        name: probe.name,
        expected_decision: probe.expected,
        ...result,
        passed: result.actual_decision === probe.expected,
      };
    });
    return {
      adapter,
      normalized: true,
      tool_name: normalized.tool_name,
      source_fingerprint: normalized.source_fingerprint,
      schema_hash: sha256(normalized.tool_schema),
      warnings: normalized.warnings,
      probes,
    };
  } catch (error) {
    return {
      adapter,
      normalized: false,
      warnings: [],
      probes: [],
      error: error instanceof Error ? error.message : 'unknown adapter error',
    };
  }
}

export function buildConformanceReport(root = REPOSITORY_ROOT): ConformanceReport {
  const fixtures = corpusFixtures(root);
  const corpus = fixtures.map((fixture): CaseResult => {
    const result = decisionDetails(
      validateToolCall({
        tool_name: fixture.id,
        tool_schema: fixture.schema,
        raw_arguments: fixture.arguments,
      }),
    );
    return {
      id: fixture.id,
      expected_decision: fixture.decision,
      ...result,
      passed: result.actual_decision === fixture.decision,
    };
  });
  const compatibility = ADAPTERS.map((adapter) => runAdapter(adapter, root));
  const adapterProbes = compatibility.flatMap((adapter) => adapter.probes);
  const report: ConformanceReport = {
    report_version: '1',
    protocol_version: PROTOCOL_VERSION,
    engine_version: ENGINE_VERSION,
    ruleset_version: RULESET_VERSION,
    corpus_hash: sha256({
      cases: fixtures,
      adapters: Object.fromEntries(
        ADAPTERS.map((adapter) => [
          adapter,
          readJson(resolve(root, `conformance/adapters/${adapter}.json`)),
        ]),
      ),
    }),
    passed:
      corpus.every((fixture) => fixture.passed) &&
      compatibility.every(
        (adapter) => adapter.normalized && adapter.probes.every((probe) => probe.passed),
      ),
    summary: {
      corpus_cases: corpus.length,
      corpus_passed: corpus.filter((fixture) => fixture.passed).length,
      adapters: compatibility.length,
      adapters_normalized: compatibility.filter((adapter) => adapter.normalized).length,
      adapter_probes: adapterProbes.length,
      adapter_probes_passed: adapterProbes.filter((probe) => probe.passed).length,
    },
    corpus,
    compatibility,
  };
  return report;
}

export function compareReports(expected: unknown, actual: unknown): ReportDifference[] {
  const differences: ReportDifference[] = [];
  function visit(left: unknown, right: unknown, path: string): void {
    if (canonicalJson(left) === canonicalJson(right)) return;
    if (
      left !== null &&
      right !== null &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      const keys = new Set([
        ...Object.keys(left as Record<string, unknown>),
        ...Object.keys(right as Record<string, unknown>),
      ]);
      for (const key of [...keys].sort())
        visit(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          `${path}/${key}`,
        );
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1)
        visit(left[index], right[index], `${path}/${index}`);
      return;
    }
    differences.push({ path, expected: left, actual: right });
  }
  visit(expected, actual, '');
  return differences;
}

interface Options {
  output?: string;
  baseline?: string;
  updateBaseline?: string;
}

function options(args: string[]): Options {
  const result: Options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--output', '--baseline', '--update-baseline'].includes(flag) || !value)
      throw new Error(
        `usage: run-conformance [--output path] [--baseline path] [--update-baseline path]`,
      );
    if (flag === '--output') result.output = value;
    if (flag === '--baseline') result.baseline = value;
    if (flag === '--update-baseline') result.updateBaseline = value;
    index += 1;
  }
  if (result.baseline && result.updateBaseline)
    throw new Error('--baseline and --update-baseline are mutually exclusive');
  return result;
}

export function runConformanceCli(args: string[]): number {
  const selected = options(args);
  const report = buildConformanceReport();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (selected.output) writeFileSync(resolve(selected.output), serialized);
  else process.stdout.write(serialized);
  if (selected.updateBaseline) writeFileSync(resolve(selected.updateBaseline), serialized);
  if (!report.passed) return 1;
  if (selected.baseline) {
    const differences = compareReports(readJson(resolve(selected.baseline)), report);
    if (differences.length > 0) {
      process.stderr.write(
        `${JSON.stringify({ error: 'CONFORMANCE_REGRESSION', differences }, null, 2)}\n`,
      );
      return 1;
    }
  }
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    process.exitCode = runConformanceCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        error: 'CONFORMANCE_RUNNER_ERROR',
        message: error instanceof Error ? error.message : 'unknown error',
      })}\n`,
    );
    process.exitCode = 2;
  }
}
