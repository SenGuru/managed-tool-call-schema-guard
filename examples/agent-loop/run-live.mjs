import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const server = join(root, 'examples/agent-loop/mcp-guard-server.mjs');
const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-');
const codexLog = join(root, `work/codex-agent-live-${stamp}.jsonl`);
const claudeLog = join(root, `work/claude-agent-live-${stamp}.jsonl`);
const codexSummary = join(root, `work/codex-agent-live-${stamp}.txt`);
mkdirSync(dirname(codexLog), { recursive: true, mode: 0o700 });

function guardArgs(base, round) {
  const recipient = `acct_${round}_${base}`;
  const amount = round + 10;
  switch (base) {
    case 'valid_call':
      return { recipient, amount, confirmed: true };
    case 'repairable_strings':
      return { recipient, amount: String(amount), confirmed: 'false' };
    case 'missing_required':
      return { amount, confirmed: true };
    case 'ambiguous_numeric':
      return { recipient, amount: `${amount} dollars`, confirmed: true };
    case 'unsafe_precision':
      return { recipient, amount: '9007199254740993', confirmed: true };
    case 'secret_extra_field':
      return {
        recipient,
        amount,
        confirmed: true,
        api_key: 'DEMO_SECRET_MUST_NOT_APPEAR',
      };
    case 'allowlisted_singleton':
      return { recipient, amount, confirmed: true, tags: 'priority' };
    case 'organization_policy_denial':
      return { recipient, amount, confirmed: true };
    default:
      throw new Error(`unknown case base ${base}`);
  }
}

function buildPrompt() {
  const baseCases = [
    'valid_call',
    'repairable_strings',
    'missing_required',
    'ambiguous_numeric',
    'unsafe_precision',
    'secret_extra_field',
    'allowlisted_singleton',
    'organization_policy_denial',
  ];
  const lines = [
    '# Live agent-in-the-loop 100+ case mutation prompt',
    '',
    'This is an authorized local tool-call mutation test. Use the three available MCP mutation-test tools exactly once for each case below, in order. Pass every listed object literally: do not normalize, repair, omit, or rename anything. A rejected tool result is expected; do not retry it.',
    '',
    'Use `submit_guard_test_case` for cases 1-104, passing `case_id` and `raw_arguments`:',
    '',
  ];
  let index = 1;
  for (let round = 1; round <= 13; round += 1) {
    const suffix = String(round).padStart(3, '0');
    for (const base of baseCases) {
      lines.push(`${index}. \`${base}_${suffix}\`: ${JSON.stringify(guardArgs(base, round))}`);
      index += 1;
    }
  }
  lines.push(
    '',
    'Use `submit_drift_test_case` for cases 105-106, passing the object as `current_schema`:',
    '',
    `${index}. \`minimum_tightened\`: ${JSON.stringify({ type: 'integer', minimum: 10 })}`,
  );
  index += 1;
  lines.push(
    `${index}. \`combinator_changed\`: ${JSON.stringify({ oneOf: [{ type: 'string' }, { type: 'boolean' }] })}`,
    '',
    'Use `submit_adapter_test_case` for cases 107-108, passing the listed declaration and raw arguments:',
    '',
  );
  index += 1;
  lines.push(
    `${index}. \`google_nested_union\`: declaration ${JSON.stringify({ name: 'nested', parameters: { type: 'OBJECT', additionalProperties: false, required: ['value'], properties: { value: { anyOf: [{ type: 'INTEGER' }, { type: 'NULL' }] } } } })}; raw arguments ${JSON.stringify({ value: 7 })}`,
  );
  index += 1;
  lines.push(
    `${index}. \`mcp_repairable\`: declaration ${JSON.stringify({ name: 'counter', inputSchema: { type: 'object', additionalProperties: false, required: ['count'], properties: { count: { type: 'integer' } } } })}; raw arguments ${JSON.stringify({ count: '3' })}`,
    '',
    'The MCP wrapper intentionally accepts generic raw objects. The Schema Guard server applies the actual closed schema and policy before a fake downstream tool can execute. After all 108 cases, summarize the observed decisions.',
  );
  return `${lines.join('\n')}\n`;
}

const prompt = buildPrompt();

function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)),
    );
    child.stdin.end(prompt);
  });
}

const toolNames = ['submit_guard_test_case', 'submit_drift_test_case', 'submit_adapter_test_case'];
const codexArgs = JSON.stringify([server, 'codex-medium', codexLog]);
const claudeConfig = JSON.stringify({
  mcpServers: {
    schema_guard_test: {
      type: 'stdio',
      command: 'node',
      args: [server, 'claude-medium', claudeLog],
    },
  },
});

await Promise.all([
  execute('codex', [
    'exec',
    '--ephemeral',
    '-s',
    'workspace-write',
    '-C',
    root,
    '-c',
    'model_reasoning_effort="medium"',
    '-c',
    'mcp_servers.schema_guard_test.command="node"',
    '-c',
    `mcp_servers.schema_guard_test.args=${codexArgs}`,
    '-c',
    `mcp_servers.schema_guard_test.enabled_tools=${JSON.stringify(toolNames)}`,
    '-c',
    'mcp_servers.schema_guard_test.default_tools_approval_mode="approve"',
    '-o',
    codexSummary,
    '-',
  ]),
  execute('claude', [
    '-p',
    '--effort',
    'medium',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--mcp-config',
    claudeConfig,
    '--allowedTools',
    toolNames.map((name) => `mcp__schema_guard_test__${name}`).join(','),
    '--output-format',
    'text',
  ]),
]);

await execute('node', [join(root, 'examples/agent-loop/verify-results.mjs'), codexLog, claudeLog]);
console.log(`Machine logs: ${codexLog} ${claudeLog}`);
