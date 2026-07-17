import { sha256 } from './hash.js';
import type { GuardPolicy, JsonObject, PolicyResult, RepairRecord } from './types.js';

const defaults = { max_repairs: 8, deny_argument_paths: [] as string[] };
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
