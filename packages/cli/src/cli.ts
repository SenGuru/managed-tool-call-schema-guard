#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import {
  compileToolContract,
  createReplayFixture,
  detectSchemaDrift,
  normalizeTool,
  replaySuite,
  validateToolCall,
  type AdapterName,
  type ContractTarget,
  type ReplayFixture,
  type ValidateRequest,
} from '@schema-guard/core';

function options(args: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith('--') || value === undefined)
      throw new Error(`invalid option near ${key ?? '<end>'}`);
    found.set(key.slice(2), value);
  }
  return found;
}
async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
function required(found: Map<string, string>, key: string): string {
  const value = found.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const found = options(rest);
  if (command === 'validate') {
    const schema = await jsonFile(required(found, 'schema'));
    const args = await jsonFile(required(found, 'args'));
    const request: ValidateRequest = {
      tool_name: found.get('tool') ?? 'unnamed_tool',
      tool_schema: schema as ValidateRequest['tool_schema'],
      raw_arguments: args as ValidateRequest['raw_arguments'],
    };
    if (found.has('policy'))
      request.policy = (await jsonFile(required(found, 'policy'))) as NonNullable<
        ValidateRequest['policy']
      >;
    const decision = validateToolCall(request);
    if (found.has('audit'))
      await appendFile(required(found, 'audit'), `${JSON.stringify(decision.audit)}\n`, {
        mode: 0o600,
      });
    console.log(JSON.stringify(decision, null, 2));
    process.exitCode = decision.decision === 'rejected' ? 1 : 0;
    return;
  }
  if (command === 'normalize') {
    console.log(
      JSON.stringify(
        normalizeTool(
          required(found, 'adapter') as AdapterName,
          await jsonFile(required(found, 'input')),
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'drift') {
    console.log(
      JSON.stringify(
        detectSchemaDrift(
          (await jsonFile(required(found, 'before'))) as ValidateRequest['tool_schema'],
          (await jsonFile(required(found, 'after'))) as ValidateRequest['tool_schema'],
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'compile') {
    const target = required(found, 'target');
    if (!['openai', 'anthropic', 'google_gemini', 'mcp'].includes(target))
      throw new Error('--target must be openai, anthropic, google_gemini, or mcp');
    const strictPolicy = found.get('openai-strict-policy');
    if (strictPolicy !== undefined && strictPolicy !== 'reject' && strictPolicy !== 'normalize')
      throw new Error('--openai-strict-policy must be reject or normalize');
    const result = compileToolContract({
      target: target as ContractTarget,
      tool_name: found.get('tool') ?? 'unnamed_tool',
      tool_schema: (await jsonFile(required(found, 'schema'))) as ValidateRequest['tool_schema'],
      ...(found.has('description') ? { description: required(found, 'description') } : {}),
      ...(found.has('target-version') ? { target_version: required(found, 'target-version') } : {}),
      ...(strictPolicy ? { openai_strict_policy: strictPolicy } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'unsupported' || result.declaration === null ? 1 : 0;
    return;
  }
  if (command === 'fixture') {
    const request: ValidateRequest = {
      tool_name: found.get('tool') ?? 'unnamed_tool',
      tool_schema: (await jsonFile(required(found, 'schema'))) as ValidateRequest['tool_schema'],
      raw_arguments: (await jsonFile(required(found, 'args'))) as ValidateRequest['raw_arguments'],
    };
    if (found.has('policy'))
      request.policy = (await jsonFile(required(found, 'policy'))) as NonNullable<
        ValidateRequest['policy']
      >;
    const fixture = createReplayFixture(request);
    await writeFile(required(found, 'out'), `${JSON.stringify(fixture, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      JSON.stringify(
        {
          written: required(found, 'out'),
          fixture_id: fixture.fixture_id,
          expected_decision: fixture.expected.decision,
          privacy: fixture.privacy,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'replay') {
    const input = await jsonFile(required(found, 'fixture'));
    const fixtures = (Array.isArray(input) ? input : [input]) as ReplayFixture[];
    const report = replaySuite(fixtures);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  throw new Error(
    'usage: schemaguard validate --schema FILE --args FILE [--tool NAME] [--policy FILE] [--audit FILE]\n       schemaguard normalize --adapter NAME --input FILE\n       schemaguard drift --before FILE --after FILE\n       schemaguard compile --target openai|anthropic|google_gemini|mcp --schema FILE [--tool NAME] [--description TEXT] [--openai-strict-policy reject|normalize]\n       schemaguard fixture --schema FILE --args FILE --out FILE [--tool NAME] [--policy FILE]\n       schemaguard replay --fixture FILE',
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
