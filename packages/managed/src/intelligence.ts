import type { AnySchema } from 'ajv';
import { sha256 } from '@schema-guard/core';
import type {
  AdapterName,
  DecisionStatus,
  DriftReport,
  ReasonCode,
  RepairRuleId,
  ValidationIssue,
} from '@schema-guard/core';

type SchemaObject = Record<string, unknown>;

export interface FailureObservation {
  adapter: AdapterName;
  provider: string;
  framework: string;
  decision: DecisionStatus;
  reason_code?: ReasonCode;
  repair_rule_ids?: RepairRuleId[];
  validation_issues?: ValidationIssue[];
}

export interface FailureSignature {
  /** Value-free, stable identifier suitable for cross-tenant aggregation. */
  id: string;
  category: 'repair' | 'rejection';
  adapter: AdapterName;
  provider: string;
  framework: string;
  reason_code?: ReasonCode;
  repair_rule_ids: RepairRuleId[];
  issue_shapes: string[];
}

export interface FailureCluster extends FailureSignature {
  event_count: number;
  first_seen_at: string;
  last_seen_at: string;
  affected_versions: string[];
}

export interface TimestampedFailureObservation {
  observed_at: string;
  provider_version?: string;
  observation: FailureObservation;
}

export type RecommendationCode =
  | 'DECLARE_REQUIRED_FIELDS'
  | 'CLOSE_OBJECT_SCHEMA'
  | 'ADD_PROPERTY_DESCRIPTION'
  | 'ADD_STRING_CONSTRAINT'
  | 'ADD_NUMERIC_CONSTRAINT'
  | 'ADD_ARRAY_BOUNDS'
  | 'REPLACE_AMBIGUOUS_UNION'
  | 'ADDRESS_BREAKING_DRIFT'
  | 'ALLOW_SAFE_TYPED_REPAIR'
  | 'FIX_CALLER_ARGUMENT_SHAPE';

export interface IntelligenceRecommendation {
  code: RecommendationCode;
  severity: 'info' | 'warning' | 'critical';
  path: string;
  message: string;
  evidence: string[];
}

export interface SchemaQualityFinding {
  code: Exclude<
    RecommendationCode,
    'ADDRESS_BREAKING_DRIFT' | 'ALLOW_SAFE_TYPED_REPAIR' | 'FIX_CALLER_ARGUMENT_SHAPE'
  >;
  severity: 'info' | 'warning';
  path: string;
  deduction: number;
  message: string;
}

export interface SchemaQualityReport {
  score: number;
  grade: 'excellent' | 'good' | 'needs_attention' | 'high_risk';
  schema_hash: string;
  findings: SchemaQualityFinding[];
  metrics: {
    object_count: number;
    property_count: number;
    described_property_count: number;
    constrained_leaf_count: number;
    leaf_count: number;
  };
}

export interface ConformanceRun {
  provider: string;
  provider_version: string;
  framework: string;
  framework_version: string;
  adapter: AdapterName;
  suite_version: string;
  executed_at: string;
  passed: number;
  failed: number;
  repaired: number;
  rejected: number;
  failure_signature_ids?: string[];
}

export interface CompatibilityMatrixCell {
  provider: string;
  framework: string;
  adapter: AdapterName;
  status: 'compatible' | 'degraded' | 'incompatible' | 'insufficient_data';
  pass_rate: number;
  total_cases: number;
  passed: number;
  failed: number;
  repaired: number;
  rejected: number;
  latest_provider_version: string;
  latest_framework_version: string;
  latest_suite_version: string;
  last_tested_at: string;
  failure_signature_ids: string[];
}

const isObject = (value: unknown): value is SchemaObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const pointerToken = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
const normalizedName = (value: string): string => value.trim().toLowerCase();
const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();

function normalizedPath(path: string): string {
  if (path === '') return '/';
  const prefixed = path.startsWith('/') ? path : `/${path}`;
  return prefixed
    .split('/')
    .map((part, index) => (index > 0 && /^\d+$/.test(part) ? '*' : part))
    .join('/');
}

/**
 * Extracts a value-free signature. It intentionally excludes argument values,
 * messages, tool names, tenant identifiers, schema hashes, and timestamps.
 */
export function extractFailureSignature(observation: FailureObservation): FailureSignature | null {
  if (observation.decision === 'valid') return null;
  const repairRuleIds = uniqueSorted(observation.repair_rule_ids ?? []) as RepairRuleId[];
  const issueShapes = uniqueSorted(
    (observation.validation_issues ?? []).map(
      (issue) => `${normalizedPath(issue.path)}|${issue.keyword}|${issue.expected ?? ''}`,
    ),
  );
  const base = {
    category:
      observation.decision === 'valid_with_repair' ? ('repair' as const) : ('rejection' as const),
    adapter: observation.adapter,
    provider: normalizedName(observation.provider),
    framework: normalizedName(observation.framework),
    ...(observation.reason_code === undefined ? {} : { reason_code: observation.reason_code }),
    repair_rule_ids: repairRuleIds,
    issue_shapes: issueShapes,
  };
  return { id: sha256(base), ...base };
}

export function clusterFailures(
  observations: readonly TimestampedFailureObservation[],
): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();
  for (const item of observations) {
    const signature = extractFailureSignature(item.observation);
    if (signature === null) continue;
    const timestamp = new Date(item.observed_at);
    if (Number.isNaN(timestamp.valueOf()))
      throw new TypeError('observed_at must be a valid timestamp');
    const observedAt = timestamp.toISOString();
    const existing = clusters.get(signature.id);
    if (existing === undefined) {
      clusters.set(signature.id, {
        ...signature,
        event_count: 1,
        first_seen_at: observedAt,
        last_seen_at: observedAt,
        affected_versions: item.provider_version === undefined ? [] : [item.provider_version],
      });
      continue;
    }
    existing.event_count += 1;
    if (observedAt < existing.first_seen_at) existing.first_seen_at = observedAt;
    if (observedAt > existing.last_seen_at) existing.last_seen_at = observedAt;
    if (item.provider_version !== undefined)
      existing.affected_versions = uniqueSorted([
        ...existing.affected_versions,
        item.provider_version,
      ]);
  }
  return [...clusters.values()].sort(
    (left, right) => right.event_count - left.event_count || left.id.localeCompare(right.id),
  );
}

function addFinding(
  findings: SchemaQualityFinding[],
  code: SchemaQualityFinding['code'],
  path: string,
  deduction: number,
  message: string,
  severity: SchemaQualityFinding['severity'] = 'warning',
): void {
  findings.push({ code, severity, path: path || '/', deduction, message });
}

export function scoreSchemaQuality(schema: AnySchema): SchemaQualityReport {
  const findings: SchemaQualityFinding[] = [];
  const metrics = {
    object_count: 0,
    property_count: 0,
    described_property_count: 0,
    constrained_leaf_count: 0,
    leaf_count: 0,
  };
  if (typeof schema === 'boolean') {
    if (schema)
      addFinding(
        findings,
        'CLOSE_OBJECT_SCHEMA',
        '/',
        35,
        'Boolean true accepts every argument shape.',
      );
    else
      addFinding(
        findings,
        'DECLARE_REQUIRED_FIELDS',
        '/',
        35,
        'Boolean false rejects every argument shape.',
      );
  } else visitSchema(schema, '', findings, metrics, new Set());
  const score = Math.max(
    0,
    100 - findings.reduce((total, finding) => total + finding.deduction, 0),
  );
  return {
    score,
    grade:
      score >= 90
        ? 'excellent'
        : score >= 75
          ? 'good'
          : score >= 50
            ? 'needs_attention'
            : 'high_risk',
    schema_hash: sha256(schema),
    findings: findings.sort(
      (left, right) => right.deduction - left.deduction || left.path.localeCompare(right.path),
    ),
    metrics,
  };
}

function visitSchema(
  schema: SchemaObject,
  path: string,
  findings: SchemaQualityFinding[],
  metrics: SchemaQualityReport['metrics'],
  ancestors: Set<SchemaObject>,
): void {
  if (ancestors.has(schema)) return;
  const nextAncestors = new Set(ancestors).add(schema);
  const types: string[] =
    typeof schema.type === 'string'
      ? [schema.type]
      : Array.isArray(schema.type)
        ? schema.type.filter((type): type is string => typeof type === 'string')
        : [];
  const properties = isObject(schema.properties) ? schema.properties : {};
  const objectLike = types.includes('object') || Object.keys(properties).length > 0;
  if (objectLike) {
    metrics.object_count += 1;
    if (schema.additionalProperties !== false)
      addFinding(findings, 'CLOSE_OBJECT_SCHEMA', path, 8, 'Object permits undeclared properties.');
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((item): item is string => typeof item === 'string')
        : [],
    );
    if (Object.keys(properties).length > 0 && required.size === 0)
      addFinding(
        findings,
        'DECLARE_REQUIRED_FIELDS',
        path,
        6,
        'Object declares properties but none are required.',
      );
    for (const [name, child] of Object.entries(properties)) {
      metrics.property_count += 1;
      const childPath = `${path}/properties/${pointerToken(name)}`;
      if (isObject(child)) {
        if (typeof child.description === 'string' && child.description.trim().length > 0)
          metrics.described_property_count += 1;
        else
          addFinding(
            findings,
            'ADD_PROPERTY_DESCRIPTION',
            childPath,
            2,
            'Property has no description.',
            'info',
          );
        visitSchema(child, childPath, findings, metrics, nextAncestors);
      }
    }
  }
  const unionCount = ['oneOf', 'anyOf'].reduce(
    (total, keyword) => total + (Array.isArray(schema[keyword]) ? 1 : 0),
    0,
  );
  if (unionCount > 0)
    addFinding(
      findings,
      'REPLACE_AMBIGUOUS_UNION',
      path,
      7,
      'Union schemas can produce ambiguous tool arguments.',
    );
  const leafType = types.find((type) => ['string', 'number', 'integer', 'array'].includes(type));
  if (leafType !== undefined) {
    metrics.leaf_count += 1;
    if (leafType === 'string') {
      const constrained = ['enum', 'const', 'format', 'pattern', 'minLength', 'maxLength'].some(
        (key) => schema[key] !== undefined,
      );
      if (constrained) metrics.constrained_leaf_count += 1;
      else
        addFinding(
          findings,
          'ADD_STRING_CONSTRAINT',
          path,
          3,
          'String has no format, pattern, enum, or length constraint.',
          'info',
        );
    } else if (leafType === 'number' || leafType === 'integer') {
      const constrained = [
        'enum',
        'const',
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'multipleOf',
      ].some((key) => schema[key] !== undefined);
      if (constrained) metrics.constrained_leaf_count += 1;
      else
        addFinding(
          findings,
          'ADD_NUMERIC_CONSTRAINT',
          path,
          3,
          'Number has no range, enum, or multipleOf constraint.',
          'info',
        );
    } else {
      const constrained = schema.minItems !== undefined || schema.maxItems !== undefined;
      if (constrained) metrics.constrained_leaf_count += 1;
      else addFinding(findings, 'ADD_ARRAY_BOUNDS', path, 3, 'Array has no size bound.', 'info');
    }
  }
  const nested = ['items', 'contains', 'additionalProperties', 'not', 'if', 'then', 'else'];
  for (const keyword of nested) {
    const child = schema[keyword];
    if (isObject(child)) visitSchema(child, `${path}/${keyword}`, findings, metrics, nextAncestors);
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    const children = schema[keyword];
    if (Array.isArray(children))
      children.forEach((child, index) => {
        if (isObject(child))
          visitSchema(child, `${path}/${keyword}/${index}`, findings, metrics, nextAncestors);
      });
  }
}

export function recommendFixes(input: {
  quality?: SchemaQualityReport;
  clusters?: readonly FailureCluster[];
  drift?: DriftReport;
}): IntelligenceRecommendation[] {
  const recommendations = new Map<string, IntelligenceRecommendation>();
  for (const finding of input.quality?.findings ?? []) {
    const key = `${finding.code}|${finding.path}`;
    recommendations.set(key, {
      code: finding.code,
      severity: finding.severity,
      path: finding.path,
      message: finding.message,
      evidence: [`schema-quality:${finding.deduction}`],
    });
  }
  for (const cluster of input.clusters ?? []) {
    if (cluster.category === 'repair') {
      const code = 'ALLOW_SAFE_TYPED_REPAIR' as const;
      const key = `${code}|/`;
      const current = recommendations.get(key);
      const evidence = `failure-signature:${cluster.id}:${cluster.event_count}`;
      recommendations.set(key, {
        code,
        severity: 'info',
        path: '/',
        message: `Review an explicit allowlist for observed safe repairs: ${cluster.repair_rule_ids.join(', ')}.`,
        evidence: uniqueSorted([...(current?.evidence ?? []), evidence]),
      });
    } else {
      const code = 'FIX_CALLER_ARGUMENT_SHAPE' as const;
      for (const shape of cluster.issue_shapes.length === 0
        ? ['/|unknown|']
        : cluster.issue_shapes) {
        const path = shape.split('|')[0] ?? '/';
        const key = `${code}|${path}`;
        const current = recommendations.get(key);
        recommendations.set(key, {
          code,
          severity: cluster.event_count >= 10 ? 'critical' : 'warning',
          path,
          message: 'Update the caller or adapter to emit arguments matching the registered schema.',
          evidence: uniqueSorted([
            ...(current?.evidence ?? []),
            `failure-signature:${cluster.id}:${cluster.event_count}`,
          ]),
        });
      }
    }
  }
  for (const change of input.drift?.changes ?? []) {
    if (change.compatibility !== 'breaking') continue;
    const code = 'ADDRESS_BREAKING_DRIFT' as const;
    const key = `${code}|${change.path}`;
    const current = recommendations.get(key);
    recommendations.set(key, {
      code,
      severity: 'critical',
      path: change.path,
      message: `Resolve breaking schema drift before rollout: ${change.detail}`,
      evidence: uniqueSorted([...(current?.evidence ?? []), `drift:${change.kind}`]),
    });
  }
  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  return [...recommendations.values()].sort(
    (left, right) =>
      severityRank[left.severity] - severityRank[right.severity] ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}

export function aggregateCompatibilityMatrix(
  runs: readonly ConformanceRun[],
): CompatibilityMatrixCell[] {
  const groups = new Map<string, ConformanceRun[]>();
  for (const run of runs) {
    for (const count of [run.passed, run.failed, run.repaired, run.rejected])
      if (!Number.isSafeInteger(count) || count < 0)
        throw new TypeError('conformance counts must be non-negative integers');
    if (run.passed + run.failed === 0)
      throw new TypeError('a conformance run must contain at least one case');
    if (run.repaired + run.rejected > run.passed + run.failed)
      throw new TypeError('repair and rejection counts cannot exceed total cases');
    const date = new Date(run.executed_at);
    if (Number.isNaN(date.valueOf())) throw new TypeError('executed_at must be a valid timestamp');
    const key = `${normalizedName(run.provider)}\u0000${normalizedName(run.framework)}\u0000${run.adapter}`;
    const group = groups.get(key) ?? [];
    group.push({ ...run, executed_at: date.toISOString() });
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const latest = [...group].sort((left, right) =>
        right.executed_at.localeCompare(left.executed_at),
      )[0]!;
      const passed = group.reduce((total, run) => total + run.passed, 0);
      const failed = group.reduce((total, run) => total + run.failed, 0);
      const repaired = group.reduce((total, run) => total + run.repaired, 0);
      const rejected = group.reduce((total, run) => total + run.rejected, 0);
      const totalCases = passed + failed;
      const passRate = Number((passed / totalCases).toFixed(4));
      const status =
        totalCases < 10
          ? ('insufficient_data' as const)
          : failed === 0 && rejected === 0
            ? ('compatible' as const)
            : passRate >= 0.9
              ? ('degraded' as const)
              : ('incompatible' as const);
      return {
        provider: normalizedName(latest.provider),
        framework: normalizedName(latest.framework),
        adapter: latest.adapter,
        status,
        pass_rate: passRate,
        total_cases: totalCases,
        passed,
        failed,
        repaired,
        rejected,
        latest_provider_version: latest.provider_version,
        latest_framework_version: latest.framework_version,
        latest_suite_version: latest.suite_version,
        last_tested_at: latest.executed_at,
        failure_signature_ids: uniqueSorted(
          group.flatMap((run) => run.failure_signature_ids ?? []),
        ),
      };
    })
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.framework.localeCompare(right.framework) ||
        left.adapter.localeCompare(right.adapter),
    );
}
