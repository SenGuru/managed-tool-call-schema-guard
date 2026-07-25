import { describe, expect, it } from 'vitest';
import { managedInventory } from '../packages/managed/src/inventory.js';

describe('managed registered and observed inventory', () => {
  it('keeps registry and action fingerprints in separate privacy domains', () => {
    const inventory = managedInventory({
      schemas: [
        {
          tool_name_hash: 'sha256:tool-a',
          adapter: 'mcp',
          version: '2',
          schema_hash: 'sha256:schema-a',
          created_at: '2026-07-25T00:00:00.000Z',
        },
      ],
      releases: [
        {
          tool_name_hash: 'sha256:tool-a',
          environment: 'production',
          schema_hash: 'sha256:schema-a',
          adapter: 'mcp',
          version: '2',
          compatibility: 'backward_compatible',
          promoted_at: '2026-07-25T00:10:00.000Z',
          integrity_valid: true,
        },
      ],
      environments: [
        {
          name: 'production',
          schema_enforcement: 'enforce',
          updated_at: '2026-07-25T00:11:00.000Z',
        },
      ],
      descriptors: [
        {
          tool_name_hash: 'hmac-sha256:action-tool-a',
          environment: 'production',
          risk_level: 'high',
          side_effect: 'irreversible',
          updated_at: '2026-07-25T00:12:00.000Z',
        },
      ],
      compatibility: [
        {
          provider: 'openai',
          framework: 'openai-agents',
          adapter: 'openai_agents',
          status: 'compatible',
          latest_provider_version: 'responses-2026-07',
          latest_framework_version: '1.4',
          last_tested_at: '2026-07-25T00:13:00.000Z',
        },
      ],
    });

    expect(inventory).toMatchObject({
      inventory_kind: 'registered_and_observed',
      summary: {
        registered_tools: 1,
        schema_variants: 1,
        promoted_releases: 1,
        environments: 1,
        action_profiles: 1,
        observed_providers: 1,
        observed_frameworks: 1,
      },
      tools: [
        {
          tool_name_hash: 'sha256:tool-a',
          adapters: ['mcp'],
          versions: ['2'],
          releases: [
            {
              environment: 'production',
              integrity_valid: true,
            },
          ],
        },
      ],
      action_profiles: [
        {
          tool_name_hash: 'hmac-sha256:action-tool-a',
          environment: 'production',
          risk_level: 'high',
          side_effect: 'irreversible',
          identity_domain: 'value_free_audit',
        },
      ],
      observed_runtime: {
        providers: [{ provider: 'openai', statuses: ['compatible'] }],
        frameworks: [{ framework: 'openai-agents', adapters: ['openai_agents'] }],
      },
      discovery: {
        automatic: false,
      },
    });
    expect(JSON.stringify(inventory)).not.toContain('raw_arguments');
    const discovery = inventory.discovery as { limitations: string[] };
    expect(discovery.limitations).toContain(
      'Schema-registry and action-policy tool fingerprints use separate privacy domains and are intentionally not correlated.',
    );
  });

  it('reports empty evidence honestly instead of implying automatic discovery', () => {
    const inventory = managedInventory({
      schemas: [],
      releases: [],
      environments: [],
      descriptors: [],
      compatibility: [],
    });
    expect(inventory).toMatchObject({
      summary: {
        registered_tools: 0,
        observed_providers: 0,
        observed_frameworks: 0,
      },
      tools: [],
      discovery: {
        automatic: false,
      },
    });
    const discovery = inventory.discovery as { limitations: string[] };
    expect(discovery.limitations).toContain(
      'This is not endpoint, cloud-account, shadow-agent, or shadow-MCP discovery.',
    );
  });
});
