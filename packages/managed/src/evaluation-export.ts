import { sha256 } from '@schema-guard/core';

type Row = Record<string, unknown>;

const record = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(record) : []);

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function compact(value: Row): Row {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  );
}

export interface EvaluationExport {
  export_version: 1;
  format: 'akriven_value_free_evaluation';
  generated_at: string;
  content_sha256: string;
  privacy: {
    value_free: true;
    tenant_identifiers_included: false;
    tool_names_included: false;
    prompts_included: false;
    raw_arguments_included: false;
    privacy_threshold: number;
  };
  summary: {
    failure_clusters: number;
    schema_quality_records: number;
    compatibility_records: number;
    recommendations: number;
  };
  records: Row[];
}

export function valueFreeEvaluationExport(
  intelligence: Row,
  generatedAt = new Date().toISOString(),
): EvaluationExport {
  const failureClusters = rows(intelligence.failure_clusters);
  const schemaQuality = rows(intelligence.schema_quality);
  const compatibility = rows(intelligence.compatibility_matrix);
  const recommendations = rows(intelligence.recommendations);
  const privacyThreshold = optionalNumber(intelligence.privacy_threshold) ?? 3;
  const records: Row[] = [
    ...failureClusters.map((item) =>
      compact({
        record_type: 'failure_cluster',
        signature_id: optionalText(item.id) ?? optionalText(item.signature),
        category: optionalText(item.category),
        adapter: optionalText(item.adapter),
        provider: optionalText(item.provider),
        framework: optionalText(item.framework),
        reason_code: optionalText(item.reason_code),
        repair_rule_ids: stringList(item.repair_rule_ids),
        issue_shapes: stringList(item.issue_shapes),
        event_count: optionalNumber(item.event_count),
        first_seen_at: optionalText(item.first_seen_at),
        last_seen_at: optionalText(item.last_seen_at),
        affected_versions: stringList(item.affected_versions),
      }),
    ),
    ...schemaQuality.map((item) => {
      const quality = record(item.quality);
      const drift = record(item.drift);
      return compact({
        record_type: 'schema_quality',
        tool_name_hash: optionalText(item.tool_name_hash),
        schema_hash: optionalText(item.schema_hash),
        adapter: optionalText(item.adapter),
        version: optionalText(item.version),
        registered_at: optionalText(item.created_at),
        quality_score:
          optionalNumber(quality.score) ??
          optionalNumber(quality.quality_score) ??
          optionalNumber(item.quality_score),
        quality_issue_codes: rows(quality.issues)
          .map((issue) => optionalText(issue.code))
          .filter((code): code is string => code !== undefined),
        drift_classification:
          optionalText(drift.classification) ??
          optionalText(drift.status) ??
          optionalText(item.drift_status),
      });
    }),
    ...compatibility.map((item) =>
      compact({
        record_type: 'compatibility',
        provider: optionalText(item.provider),
        provider_version:
          optionalText(item.provider_version) ?? optionalText(item.latest_provider_version),
        framework: optionalText(item.framework),
        framework_version:
          optionalText(item.framework_version) ?? optionalText(item.latest_framework_version),
        adapter: optionalText(item.adapter),
        suite_version: optionalText(item.suite_version),
        status: optionalText(item.status),
        passed: optionalNumber(item.passed),
        failed: optionalNumber(item.failed),
        repaired: optionalNumber(item.repaired),
        rejected: optionalNumber(item.rejected),
        executed_at: optionalText(item.executed_at) ?? optionalText(item.last_tested_at),
      }),
    ),
    ...recommendations.map((item) =>
      compact({
        record_type: 'recommendation',
        code: optionalText(item.code),
        severity: optionalText(item.severity),
        path: optionalText(item.path),
        message: optionalText(item.message),
        source: optionalText(item.source),
        tool_name_hash: optionalText(item.tool_name_hash),
        schema_hash: optionalText(item.schema_hash),
      }),
    ),
  ];
  const content = {
    export_version: 1 as const,
    format: 'akriven_value_free_evaluation' as const,
    privacy: {
      value_free: true as const,
      tenant_identifiers_included: false as const,
      tool_names_included: false as const,
      prompts_included: false as const,
      raw_arguments_included: false as const,
      privacy_threshold: privacyThreshold,
    },
    summary: {
      failure_clusters: failureClusters.length,
      schema_quality_records: schemaQuality.length,
      compatibility_records: compatibility.length,
      recommendations: recommendations.length,
    },
    records,
  };
  return {
    ...content,
    generated_at: generatedAt,
    content_sha256: sha256(content),
  };
}
