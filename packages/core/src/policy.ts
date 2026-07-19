import { sha256 } from './hash.js';
import type { GuardPolicy, JsonObject, PolicyResult, RepairRecord } from './types.js';

const defaults = { max_repairs: 8, deny_argument_paths: [] as string[] };
const repairRules = new Set([
  'coerce.string_to_number',
  'coerce.string_to_integer',
  'coerce.string_to_boolean',
  'coerce.singleton_to_array',
]);

export function policyValidationError(policy: unknown): string | undefined {
  if (policy === undefined) return undefined;
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy))
    return 'policy must be an object';
  const value = policy as Record<string, unknown>;
  const known = new Set([
    'allowed_repairs',
    'max_repairs',
    'deny_argument_paths',
    'require_closed_schema',
  ]);
  if (Object.keys(value).some((key) => !known.has(key))) return 'policy contains unknown fields';
  if (
    value.allowed_repairs !== undefined &&
    (!Array.isArray(value.allowed_repairs) ||
      !value.allowed_repairs.every((rule) => typeof rule === 'string' && repairRules.has(rule)) ||
      new Set(value.allowed_repairs).size !== value.allowed_repairs.length)
  )
    return 'allowed_repairs contains an unknown repair rule';
  if (
    value.max_repairs !== undefined &&
    (!Number.isInteger(value.max_repairs) ||
      Number(value.max_repairs) < 0 ||
      Number(value.max_repairs) > 100)
  )
    return 'max_repairs must be an integer from 0 through 100';
  if (
    value.deny_argument_paths !== undefined &&
    (!Array.isArray(value.deny_argument_paths) ||
      !value.deny_argument_paths.every(
        (path) =>
          typeof path === 'string' &&
          /^(?:\/(?:[^~/]|~[01])*)+$/u.test(path) &&
          path.length <= 1024,
      ) ||
      new Set(value.deny_argument_paths).size !== value.deny_argument_paths.length)
  )
    return 'deny_argument_paths must contain JSON Pointers';
  if (value.require_closed_schema !== undefined && typeof value.require_closed_schema !== 'boolean')
    return 'require_closed_schema must be boolean';
  return undefined;
}
function hasPath(root: JsonObject, pointer: string): boolean {
  const parts = pointer
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return parts.length > 0;
}
export function evaluatePolicy(
  policy: GuardPolicy | undefined,
  args: JsonObject,
  repairs: RepairRecord[],
): PolicyResult {
  const resolved = { ...defaults, ...policy };
  const reasons: string[] = [];
  if (repairs.length > resolved.max_repairs)
    reasons.push(`repair count exceeds maximum ${resolved.max_repairs}`);
  for (const path of resolved.deny_argument_paths)
    if (hasPath(args, path)) reasons.push(`argument path ${path} is denied by policy`);
  return {
    outcome: reasons.length ? 'denied' : 'allowed',
    applied_policy_hash: sha256(resolved),
    reasons,
  };
}
