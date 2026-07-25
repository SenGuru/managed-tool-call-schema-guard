export interface WriteCommercialEvidenceTemplateOptions {
  target: 'private-beta' | 'public-production';
  sourceRevision: string;
  outputDir: string;
  executedAt?: string;
}

export interface CommercialEvidenceTemplateSummary {
  report_version: '1';
  target: 'private-beta' | 'public-production';
  source_revision: string;
  output_directory: string;
  reports_created: number;
  status: 'unproven';
}

export function writeCommercialEvidenceTemplate(
  options: WriteCommercialEvidenceTemplateOptions,
): CommercialEvidenceTemplateSummary;
