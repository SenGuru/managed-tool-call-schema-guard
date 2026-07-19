import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const server = join(root, 'examples/agent-loop/mcp-guard-server.mjs');
const prompt = readFileSync(join(root, 'examples/agent-loop/PROMPT.md'), 'utf8');
const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-');
const codexLog = join(root, `work/codex-agent-live-${stamp}.jsonl`);
const claudeLog = join(root, `work/claude-agent-live-${stamp}.jsonl`);
const codexSummary = join(root, `work/codex-agent-live-${stamp}.txt`);
mkdirSync(dirname(codexLog), { recursive: true, mode: 0o700 });

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
