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

export function evaluateCommercialRelease(
  options: CommercialReleaseOptions,
): CommercialReleaseReport;
