import { describe, expect, it } from 'vitest';

import { redactEvidence } from '../scripts/evidence-redaction.mjs';

describe('audit evidence redaction', () => {
  it('removes one-time API keys and bearer credentials from retained output', () => {
    const retained = redactEvidence(
      [
        '"api_key":"sg_live_bootstrapCredential123"',
        'Authorization: Bearer opaque-token-value',
        "authorization='Bearer another-token'",
      ].join('\n'),
    );

    expect(retained).not.toContain('bootstrapCredential123');
    expect(retained).not.toContain('opaque-token-value');
    expect(retained).not.toContain('another-token');
    expect(retained).toContain('"api_key":"[REDACTED]"');
    expect(retained.match(/\[REDACTED\]/gu)).toHaveLength(3);
  });
});
