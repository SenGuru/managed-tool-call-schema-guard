interface InventorySchema {
  tool_name_hash: string;
  adapter: string;
  version: string;
  schema_hash: string;
  created_at: string;
}

interface InventoryRelease {
  tool_name_hash: string;
  environment: string;
  schema_hash: string;
  adapter: string;
  version: string;
  compatibility: string;
  promoted_at: string;
  integrity_valid?: boolean;
}

interface InventoryEnvironment {
  name: string;
  schema_enforcement: string;
  updated_at: string;
}

interface InventoryDescriptor {
  tool_name_hash: string;
  environment: string;
  risk_level: string;
  side_effect: string;
  updated_at: string;
}

interface InventoryCompatibility {
  provider: string;
  framework: string;
  adapter: string;
  status: string;
  latest_provider_version: string;
  latest_framework_version: string;
  last_tested_at: string;
}

export interface ManagedInventoryInput {
  schemas: InventorySchema[];
  releases: InventoryRelease[];
  environments: InventoryEnvironment[];
  descriptors: InventoryDescriptor[];
  compatibility: InventoryCompatibility[];
}

const unique = (values: string[]): string[] => [...new Set(values)].sort();

export function managedInventory(input: ManagedInventoryInput): Record<string, unknown> {
  const toolHashes = unique([
    ...input.schemas.map((schema) => schema.tool_name_hash),
    ...input.releases.map((release) => release.tool_name_hash),
  ]);
  const tools = toolHashes.map((toolNameHash) => {
    const schemas = input.schemas.filter((schema) => schema.tool_name_hash === toolNameHash);
    const releases = input.releases.filter((release) => release.tool_name_hash === toolNameHash);
    return {
      tool_name_hash: toolNameHash,
      adapters: unique([
        ...schemas.map((schema) => schema.adapter),
        ...releases.map((release) => release.adapter),
      ]),
      versions: unique([
        ...schemas.map((schema) => schema.version),
        ...releases.map((release) => release.version),
      ]),
      schema_variants: schemas.map((schema) => ({
        adapter: schema.adapter,
        version: schema.version,
        schema_hash: schema.schema_hash,
        registered_at: schema.created_at,
      })),
      releases: releases.map((release) => ({
        environment: release.environment,
        adapter: release.adapter,
        version: release.version,
        schema_hash: release.schema_hash,
        compatibility: release.compatibility,
        promoted_at: release.promoted_at,
        integrity_valid: release.integrity_valid ?? true,
      })),
    };
  });
  const providers = unique(input.compatibility.map((cell) => cell.provider)).map((provider) => ({
    provider,
    versions: unique(
      input.compatibility
        .filter((cell) => cell.provider === provider)
        .map((cell) => cell.latest_provider_version),
    ),
    frameworks: unique(
      input.compatibility
        .filter((cell) => cell.provider === provider)
        .map((cell) => cell.framework),
    ),
    statuses: unique(
      input.compatibility.filter((cell) => cell.provider === provider).map((cell) => cell.status),
    ),
    last_tested_at:
      input.compatibility
        .filter((cell) => cell.provider === provider)
        .map((cell) => cell.last_tested_at)
        .sort()
        .at(-1) ?? null,
  }));
  const frameworks = unique(input.compatibility.map((cell) => cell.framework)).map((framework) => ({
    framework,
    versions: unique(
      input.compatibility
        .filter((cell) => cell.framework === framework)
        .map((cell) => cell.latest_framework_version),
    ),
    adapters: unique(
      input.compatibility
        .filter((cell) => cell.framework === framework)
        .map((cell) => cell.adapter),
    ),
  }));
  return {
    inventory_kind: 'registered_and_observed',
    generated_at: new Date().toISOString(),
    summary: {
      registered_tools: tools.length,
      schema_variants: input.schemas.length,
      promoted_releases: input.releases.length,
      environments: input.environments.length,
      action_profiles: input.descriptors.length,
      observed_providers: providers.length,
      observed_frameworks: frameworks.length,
    },
    environments: input.environments.map((environment) => ({
      name: environment.name,
      schema_enforcement: environment.schema_enforcement,
      updated_at: environment.updated_at,
    })),
    action_profiles: input.descriptors.map((descriptor) => ({
      tool_name_hash: descriptor.tool_name_hash,
      environment: descriptor.environment,
      risk_level: descriptor.risk_level,
      side_effect: descriptor.side_effect,
      updated_at: descriptor.updated_at,
      identity_domain: 'value_free_audit',
    })),
    tools,
    observed_runtime: {
      providers,
      frameworks,
      compatibility: input.compatibility,
    },
    discovery: {
      automatic: false,
      sources: [
        'schema_registry',
        'schema_releases',
        'environment_registry',
        'action_descriptors',
        'conformance_runs',
      ],
      limitations: [
        'Only explicitly registered or observed assets are included.',
        'This is not endpoint, cloud-account, shadow-agent, or shadow-MCP discovery.',
        'Tool names, prompts, raw arguments, and tenant identifiers are not returned.',
        'Schema-registry and action-policy tool fingerprints use separate privacy domains and are intentionally not correlated.',
      ],
    },
  };
}
