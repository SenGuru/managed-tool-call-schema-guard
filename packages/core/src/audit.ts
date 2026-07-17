import { randomUUID } from 'node:crypto';
import { sha256 } from './hash.js';
import {
  ENGINE_VERSION,
  PROTOCOL_VERSION,
  RULESET_VERSION,
  type AuditEnvelope,
  type DecisionStatus,
  type JsonObject,
  type ReasonCode,
  type RepairRecord,
} from './types.js';

function shape(value: JsonObject): string[] {
  const paths: string[] = [];
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      paths.push(`${path}[]`);
      return;
    }
    if (current !== null && typeof current === 'object')
      for (const [key, child] of Object.entries(current)) {
        const next = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
        paths.push(next);
        visit(child, next);
      }
  };
  visit(value, '');
  return paths.sort();
}
export function createAuditEnvelope(input: {
  toolName: string;
  schema: unknown;
  arguments: JsonObject;
  decision: DecisionStatus;
  repairs: RepairRecord[];
  policyHash: string;
  reasonCode?: ReasonCode;
  now?: Date;
  auditId?: string;
}): AuditEnvelope {
  const result: AuditEnvelope = {
    audit_id: input.auditId ?? `aud_${randomUUID()}`,
    timestamp: (input.now ?? new Date()).toISOString(),
    protocol_version: PROTOCOL_VERSION,
    engine_version: ENGINE_VERSION,
    ruleset_version: RULESET_VERSION,
    tool_name_hash: sha256(input.toolName),
    schema_hash: sha256(input.schema),
    arguments_hash: sha256(input.arguments),
    argument_shape: shape(input.arguments),
    decision: input.decision,
    repair_rule_ids: input.repairs.map((r) => r.rule_id),
    policy_hash: input.policyHash,
  };
  if (input.reasonCode) result.reason_code = input.reasonCode;
  return result;
}
