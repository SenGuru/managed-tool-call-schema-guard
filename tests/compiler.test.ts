import { describe, expect, it } from 'vitest';
import { compileToolContract } from '../packages/core/src/index.js';

const strictSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    mode: { const: 'safe' },
    email: { type: 'string', format: 'email' },
  },
  required: ['mode', 'email'],
  additionalProperties: false,
};

describe('canonical tool contract compiler', () => {
  it('emits a deterministic OpenAI strict declaration with lossless transformations', () => {
    const first = compileToolContract({
      target: 'openai',
      tool_name: 'send_email',
      tool_schema: strictSchema,
      runtime_verified: true,
    });
    const second = compileToolContract({
      target: 'openai',
      tool_name: 'send_email',
      tool_schema: strictSchema,
      runtime_verified: true,
    });
    expect(first.status).toBe('lossless_transform');
    expect(first.declaration).toMatchObject({
      name: 'send_email',
      strict: true,
      parameters: {
        properties: { mode: { enum: ['safe'] } },
      },
    });
    expect(first.transformations.map((item) => item.transform_id)).toEqual([
      'const_to_singleton_enum',
      'drop_dialect_annotation',
    ]);
    expect(first.compiled_declaration_hash).toBe(second.compiled_declaration_hash);
  });

  it('refuses to silently change optional OpenAI fields or object openness', () => {
    const result = compileToolContract({
      target: 'openai',
      tool_name: 'lookup',
      tool_schema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer' } },
        required: ['query'],
      },
    });
    expect(result.status).toBe('policy_required');
    expect(result.declaration).toBeNull();
    expect(result.issues.map((item) => item.code)).toContain('OPENAI_STRICT_POLICY_REQUIRED');
  });

  it('compiles optional OpenAI fields only under an explicit semantic policy', () => {
    const result = compileToolContract({
      target: 'openai',
      tool_name: 'lookup',
      tool_schema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer' } },
        required: ['query'],
      },
      openai_strict_policy: 'normalize',
    });
    expect(result.status).toBe('policy_required');
    expect(result.declaration).toMatchObject({
      parameters: {
        required: ['query', 'limit'],
        additionalProperties: false,
        properties: { limit: { type: ['integer', 'null'] } },
      },
    });
    expect(result.transformations.some((item) => item.semantics === 'policy_authorized')).toBe(
      true,
    );
  });

  it('performs documented Google nullable and reference syntax transformations', () => {
    const result = compileToolContract({
      target: 'google_gemini',
      tool_name: 'lookup',
      tool_schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        $defs: { value: { type: ['string', 'null'] } },
        properties: { value: { $ref: '#/$defs/value' } },
      },
      runtime_verified: true,
    });
    expect(result.status).toBe('lossless_transform');
    expect(result.declaration).toMatchObject({
      parameters: {
        defs: { value: { type: 'string', nullable: true } },
        properties: { value: { ref: '#/defs/value' } },
      },
    });
  });

  it('reports provider-unsupported semantics instead of deleting constraints', () => {
    const result = compileToolContract({
      target: 'google_gemini',
      tool_name: 'lookup',
      tool_schema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 3 } },
        additionalProperties: false,
      },
    });
    expect(result.status).toBe('unsupported');
    expect(result.declaration).toBeNull();
    expect(result.issues.map((item) => item.path)).toEqual(
      expect.arrayContaining(['/additionalProperties', '/properties/query/minLength']),
    );
  });

  it('does not claim native support without a runtime verification signal', () => {
    const unverified = compileToolContract({
      target: 'anthropic',
      tool_name: 'lookup',
      tool_schema: { type: 'object', properties: {} },
    });
    const verified = compileToolContract({
      target: 'anthropic',
      tool_name: 'lookup',
      tool_schema: { type: 'object', properties: {} },
      runtime_verified: true,
    });
    expect(unverified.status).toBe('runtime_unverified');
    expect(verified.status).toBe('native');
  });

  it('fails closed on unresolved references and unknown canonical keywords', () => {
    for (const tool_schema of [
      { type: 'object', properties: { value: { $ref: '#/$defs/missing' } } },
      { type: 'object', inventedConstraint: true },
    ]) {
      const result = compileToolContract({
        target: 'mcp',
        tool_name: 'lookup',
        tool_schema,
      });
      expect(result.status).toBe('unsupported');
      expect(result.declaration).toBeNull();
      expect(result.issues.map((item) => item.code)).toContain('CANONICAL_SCHEMA_COMPILE_FAILED');
    }
  });
});
