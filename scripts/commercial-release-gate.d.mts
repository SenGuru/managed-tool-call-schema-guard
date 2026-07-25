export interface CommercialGateResult {
  gate_id: string;
  passed: boolean;
  status?: unknown;
  evidence_kind?: unknown;
  executed_at?: unknown;
  failures: string[];
}

export interface CommercialReleaseReport {
  report_version: '1';
  executed_at: string;
  target: 'private-beta' | 'public-production';
  source_revision: string;
  passed: boolean;
  verdict: 'no_go' | 'private_beta_ready' | 'public_production_ready';
  gate_results: CommercialGateResult[];
  failures: string[];
}

export interface CommercialReleaseOptions {
  target: 'private-beta' | 'public-production';
  evidenceDir: string;
  sourceRevision: string;
  maxAgeDays?: number;
  now?: number;
}

export interface CommercialEvidenceTemplateOptions {
  target: 'private-beta' | 'public-production';
  sourceRevision: string;
  executedAt?: string;
}

export interface CommercialEvidenceTemplateReport {
  report_version: '1';
  gate_id: string;
  source_revision: string;
  status: 'unproven';
  redacted: true;
  evidence_kind: 'manual_review';
  executed_at: string;
  checks: Record<string, false>;
  artifacts: [];
  variant?: 'manual' | 'stripe_test';
}

export function evaluateCommercialRelease(
  options: CommercialReleaseOptions,
): CommercialReleaseReport;

export function commercialEvidenceTemplate(
  options: CommercialEvidenceTemplateOptions,
): CommercialEvidenceTemplateReport[];
