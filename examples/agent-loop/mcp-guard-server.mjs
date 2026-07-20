import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import {
  detectSchemaDrift,
  normalizeTool,
  sha256,
  validateToolCall,
} from '../../packages/core/dist/index.js';

const agent = process.argv[2] ?? 'unknown-agent';
const logPath = process.argv[3];
if (!logPath) throw new Error('usage: mcp-guard-server.mjs <agent> <log-path>');
mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });

const toolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recipient', 'amount', 'confirmed'],
  properties: {
    recipient: { type: 'string', minLength: 1 },
    amount: { type: 'integer', minimum: 1, maximum: 10_000 },
    confirmed: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
};

const baseCases = {
  valid_call: { expected: 'valid', execute: true },
  repairable_strings: { expected: 'valid_with_repair', execute: true },
  missing_required: { expected: 'rejected', execute: false },
  ambiguous_numeric: { expected: 'rejected', execute: false },
  unsafe_precision: { expected: 'rejected', execute: false },
  secret_extra_field: { expected: 'rejected', execute: false },
  allowlisted_singleton: {
    expected: 'valid_with_repair',
    execute: true,
    policy: { allowed_repairs: ['coerce.singleton_to_array'] },
  },
  organization_policy_denial: {
    expected: 'rejected',
    execute: false,
    policy: { deny_argument_paths: ['/recipient'] },
  },
};
const generatedRounds = 13;
const cases = {};
for (let round = 1; round <= generatedRounds; round += 1) {
  const suffix = String(round).padStart(3, '0');
  for (const [name, definition] of Object.entries(baseCases))
    cases[`${name}_${suffix}`] = definition;
}
const driftCases = {
  minimum_tightened: {
    previous: { type: 'integer', minimum: 0 },
    expected: 'breaking',
  },
  combinator_changed: {
    previous: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
    expected: 'review',
  },
};
const adapterCases = {
  google_nested_union: { adapter: 'google_adk', expected: 'valid' },
  mcp_repairable: { adapter: 'mcp', expected: 'valid_with_repair' },
};

const seen = new Set();
function record(event) {
  appendFileSync(logPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
}
function fakeTransfer(arguments_) {
  if (
    typeof arguments_.recipient !== 'string' ||
    !Number.isSafeInteger(arguments_.amount) ||
    typeof arguments_.confirmed !== 'boolean' ||
    (arguments_.tags !== undefined &&
      (!Array.isArray(arguments_.tags) || !arguments_.tags.every((tag) => typeof tag === 'string')))
  )
    throw new Error('guard allowed invalid arguments into the fake tool');
  return {
    status: 'executed',
    receipt: sha256({
      tool: 'fake_transfer',
      amount_type: typeof arguments_.amount,
      confirmed_type: typeof arguments_.confirmed,
      tags_type: arguments_.tags === undefined ? 'absent' : 'array',
    }),
  };
}
function publicResult(decision, executed, output) {
  return {
    decision: decision.decision,
    reason_code: decision.decision === 'rejected' ? decision.reason_code : undefined,
    repaired_rule_ids: decision.repaired_fields.map((repair) => repair.rule_id),
    audit_id: decision.audit_id,
    argument_shape: decision.audit.argument_shape,
    executed,
    fake_tool_output: output,
  };
}
function runCase(input) {
  const caseId = typeof input.case_id === 'string' ? input.case_id : '<invalid>';
  const definition = cases[caseId];
  if (!definition) return { isError: true, result: { error: 'unknown_case_id', executed: false } };
  if (seen.has(caseId)) {
    record({ agent, case_id: caseId, duplicate: true, executed: false });
    return { isError: true, result: { error: 'duplicate_case_id', executed: false } };
  }
  seen.add(caseId);
  const decision = validateToolCall({
    tool_name: 'fake_transfer',
    tool_schema: toolSchema,
    raw_arguments: input.raw_arguments,
    ...(definition.policy ? { policy: definition.policy } : {}),
  });
  let output;
  let executed = false;
  if (decision.decision !== 'rejected') {
    output = fakeTransfer(decision.valid_arguments);
    executed = true;
  }
  const result = publicResult(decision, executed, output);
  record({
    agent,
    case_id: caseId,
    expected_decision: definition.expected,
    guard_decision: decision.decision,
    reason_code: result.reason_code,
    repaired_rule_ids: result.repaired_rule_ids,
    audit_id: result.audit_id,
    argument_shape: result.argument_shape,
    expected_execution: definition.execute,
    executed,
    expectation_met: decision.decision === definition.expected && executed === definition.execute,
  });
  return { isError: decision.decision === 'rejected', result };
}
function runDriftCase(input) {
  const caseId = typeof input.case_id === 'string' ? input.case_id : '<invalid>';
  const definition = driftCases[caseId];
  const seenKey = `drift:${caseId}`;
  if (!definition)
    return { isError: true, result: { error: 'unknown_drift_case_id', executed: false } };
  if (seen.has(seenKey)) {
    record({ agent, case_id: caseId, category: 'drift', duplicate: true, executed: false });
    return { isError: true, result: { error: 'duplicate_case_id', executed: false } };
  }
  seen.add(seenKey);
  const report = detectSchemaDrift(definition.previous, input.current_schema);
  const expectationMet = report.changed && report.compatibility === definition.expected;
  record({
    agent,
    case_id: caseId,
    category: 'drift',
    expected_decision: definition.expected,
    guard_decision: report.compatibility,
    change_kinds: report.changes.map((change) => change.kind),
    executed: false,
    expectation_met: expectationMet,
  });
  return {
    isError: !expectationMet,
    result: {
      changed: report.changed,
      compatibility: report.compatibility,
      change_kinds: report.changes.map((change) => change.kind),
      executed: false,
    },
  };
}
function runAdapterCase(input) {
  const caseId = typeof input.case_id === 'string' ? input.case_id : '<invalid>';
  const definition = adapterCases[caseId];
  const seenKey = `adapter:${caseId}`;
  if (!definition)
    return { isError: true, result: { error: 'unknown_adapter_case_id', executed: false } };
  if (seen.has(seenKey)) {
    record({ agent, case_id: caseId, category: 'adapter', duplicate: true, executed: false });
    return { isError: true, result: { error: 'duplicate_case_id', executed: false } };
  }
  seen.add(seenKey);
  const normalized = normalizeTool(definition.adapter, input.declaration);
  const decision = validateToolCall({
    tool_name: normalized.tool_name,
    tool_schema: normalized.tool_schema,
    raw_arguments: input.raw_arguments,
  });
  const executed = decision.decision !== 'rejected';
  const expectationMet = decision.decision === definition.expected && executed;
  record({
    agent,
    case_id: caseId,
    category: 'adapter',
    adapter: definition.adapter,
    expected_decision: definition.expected,
    guard_decision: decision.decision,
    repaired_rule_ids: decision.repaired_fields.map((repair) => repair.rule_id),
    normalized_schema_hash: decision.audit.schema_hash,
    executed,
    expectation_met: expectationMet,
  });
  return {
    isError: !expectationMet,
    result: {
      adapter: definition.adapter,
      decision: decision.decision,
      repaired_rule_ids: decision.repaired_fields.map((repair) => repair.rule_id),
      executed,
    },
  };
}

const tools = [
  {
    name: 'submit_guard_test_case',
    description:
      'Submits raw downstream tool arguments to Schema Guard. This mutation-test tool deliberately accepts an unconstrained raw object; Schema Guard enforces the real fake_transfer schema before execution.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['case_id', 'raw_arguments'],
      properties: {
        case_id: { type: 'string', enum: Object.keys(cases) },
        raw_arguments: { type: 'object' },
      },
    },
  },
  {
    name: 'submit_drift_test_case',
    description:
      'Submits a candidate schema revision to deterministic Schema Guard drift classification.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['case_id', 'current_schema'],
      properties: {
        case_id: { type: 'string', enum: Object.keys(driftCases) },
        current_schema: { type: 'object' },
      },
    },
  },
  {
    name: 'submit_adapter_test_case',
    description:
      'Normalizes a provider/framework declaration, guards raw arguments, and records whether the fake downstream adapter tool executes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['case_id', 'declaration', 'raw_arguments'],
      properties: {
        case_id: { type: 'string', enum: Object.keys(adapterCases) },
        declaration: { type: 'object' },
        raw_arguments: { type: 'object' },
      },
    },
  },
];

function send(id, result, error) {
  const response = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === 'initialize') {
    send(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'schema-guard-agent-loop-test', version: '0.1.0' },
    });
  } else if (message.method === 'tools/list') send(message.id, { tools });
  else if (message.method === 'tools/call') {
    if (!tools.some((tool) => tool.name === message.params?.name)) {
      send(message.id, undefined, { code: -32601, message: 'unknown tool' });
      return;
    }
    try {
      const outcome =
        message.params.name === 'submit_guard_test_case'
          ? runCase(message.params.arguments ?? {})
          : message.params.name === 'submit_drift_test_case'
            ? runDriftCase(message.params.arguments ?? {})
            : runAdapterCase(message.params.arguments ?? {});
      send(message.id, {
        content: [{ type: 'text', text: JSON.stringify(outcome.result) }],
        isError: outcome.isError,
      });
    } catch (error) {
      record({
        agent,
        harness_error: error instanceof Error ? error.message : 'unknown',
        executed: false,
      });
      send(message.id, {
        content: [{ type: 'text', text: 'guard harness failed closed' }],
        isError: true,
      });
    }
  } else if (message.id !== undefined && !message.method?.startsWith('notifications/'))
    send(message.id, undefined, { code: -32601, message: 'method not found' });
});
