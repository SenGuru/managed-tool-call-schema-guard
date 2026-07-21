import { readFileSync, statSync } from 'node:fs';

export function environmentValue(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const direct = environment[name];
  const file = environment[`${name}_FILE`];
  if (direct !== undefined && file !== undefined)
    throw new Error(`${name} and ${name}_FILE cannot both be configured`);
  if (file === undefined) return direct;
  const metadata = statSync(file);
  if (!metadata.isFile() || metadata.size > 65_536)
    throw new Error(`${name}_FILE must reference a regular file no larger than 65536 bytes`);
  const value = readFileSync(file, 'utf8').replace(/\r?\n$/u, '');
  if (value.includes('\0')) throw new Error(`${name}_FILE contains an invalid null byte`);
  return value;
}
