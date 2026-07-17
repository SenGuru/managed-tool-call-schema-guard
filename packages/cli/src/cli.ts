#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises';
import {
  detectSchemaDrift,
  normalizeTool,
  validateToolCall,
  type AdapterName,
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
  throw new Error(
    'usage: schemaguard validate --schema FILE --args FILE [--tool NAME] [--policy FILE] [--audit FILE]\n       schemaguard normalize --adapter NAME --input FILE\n       schemaguard drift --before FILE --after FILE',
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
