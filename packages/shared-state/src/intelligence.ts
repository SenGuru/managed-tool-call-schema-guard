import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  canonicalJson,
  sha256,
  type AdapterName,
  type GuardDecision,
  type ReasonCode,
  type RepairRuleId,
} from '@schema-guard/core';
import { SharedStateIntegrityError } from './postgres.js';

export interface SharedObservationContext {
  adapter?: AdapterName;
  provider?: string;
  provider_version?: string;
  framework?: string;
  framework_version?: string;
}

export interface SharedFailureCluster {
  id: string;
  category: 'repair' | 'rejection';
  adapter: AdapterName;
  provider: string;
  framework: string;
  reason_code?: ReasonCode;
  repair_rule_ids: RepairRuleId[];
  issue_shapes: string[];
  event_count: number;
  first_seen_at: string;
  last_seen_at: string;
  affected_versions: string[];
}

export interface SharedConformanceRun {
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

export interface SharedCompatibilityMatrixCell {
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

export interface SharedSignedRuleSet {
  version: string;
  issued_at: string;
  expires_at: string;
  rules: { id: string; enabled_by_default: boolean; description: string }[];
  key_id: string;
  public_key: string;
  signature: string;
}

export interface TransactionalIntelligenceWriter {
  recordObservationWithClient(
    client: PoolClient,
    tenantId: string,
    decision: GuardDecision,
    context?: SharedObservationContext,
  ): Promise<void>;
}

export interface IntelligenceState {
  migrate(): Promise<void>;
  ready(): Promise<boolean>;
  bootstrapTenant(tenantId: string): Promise<void>;
  recordObservation(
    tenantId: string,
    decision: GuardDecision,
    context?: SharedObservationContext,
  ): Promise<void>;
  tenantFailureClusters(tenantId: string): Promise<SharedFailureCluster[]>;
  networkFailureClusters(
    threshold: number,
  ): Promise<Array<SharedFailureCluster & { tenant_count: number }>>;
  recordConformanceRun(
    tenantId: string,
    run: SharedConformanceRun,
  ): Promise<{ recorded: boolean; report_hash: string }>;
  compatibilityMatrix(tenantId: string): Promise<SharedCompatibilityMatrixCell[]>;
  publishRuleset(
    tenantId: string,
    input: Omit<SharedSignedRuleSet, 'key_id' | 'public_key' | 'signature'>,
  ): Promise<SharedSignedRuleSet>;
  latestRuleset(tenantId: string): Promise<SharedSignedRuleSet | undefined>;
  verifyRuleset(ruleset: SharedSignedRuleSet): Promise<boolean>;
  verifyTenantHistory(tenantId: string): Promise<{ valid: boolean; checked: number }>;
  close(): Promise<void>;
}

type ManifestRow = {
  tenant_id: string;
  revision: string;
  observation_count: string;
  conformance_count: string;
  ruleset_count: string;
  observation_tip_hash: string;
  conformance_tip_hash: string;
  ruleset_tip_hash: string;
  updated_at: Date;
  control_hmac: string;
};
type ObservationRow = {
  sequence: string;
  tenant_id: string;
  audit_id: string;
  observed_at: Date;
  provider_version: string | null;
  signature: string;
  category: 'repair' | 'rejection';
  adapter: AdapterName;
  provider: string;
  framework: string;
  reason_code: ReasonCode | null;
  repair_rules_json: string;
  issue_shapes_json: string;
  previous_hash: string;
  record_hash: string;
};
type ConformanceRow = {
  sequence: string;
  tenant_id: string;
  provider: string;
  provider_version: string;
  framework: string;
  framework_version: string;
  adapter: AdapterName;
  suite_version: string;
  executed_at: Date;
  passed: number;
  failed: number;
  repaired: number;
  rejected: number;
  failure_signature_ids_json: string;
  report_hash: string;
  created_at: Date;
  previous_hash: string;
  record_hash: string;
};
type RulesetRow = {
  sequence: string;
  tenant_id: string;
  version: string;
  body_json: string;
  issued_at: Date;
  expires_at: Date;
  key_id: string;
  previous_hash: string;
  record_hash: string;
};
type SigningKeyRow = {
  id: string;
  public_key_pem: string;
  encrypted_private_key: string;
  created_at: Date;
  trust_hmac: string;
};

const ADAPTERS: readonly AdapterName[] = [
  'json_schema',
  'mcp',
  'openai_agents',
  'pydantic_ai',
  'google_adk',
];
const REPAIR_RULES = new Set<RepairRuleId>([
  'coerce.string_to_number',
  'coerce.string_to_integer',
  'coerce.string_to_boolean',
  'coerce.singleton_to_array',
]);
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const hmac = (secret: string, purpose: string, value: unknown): string =>
  `hmac-sha256:${createHmac('sha256', secret)
    .update(purpose)
    .update('\0')
    .update(canonicalJson(value))
    .digest('hex')}`;
const equal = (left: string, right: string): boolean => {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
};
const uniqueSorted = <T extends string>(items: readonly T[]): T[] => [...new Set(items)].sort();
const normalizedPath = (value: string): string => {
  const path = value === '' ? '/' : value.startsWith('/') ? value : `/${value}`;
  return path
    .split('/')
    .map((part, index) => (index > 0 && /^\d+$/u.test(part) ? '*' : part))
    .join('/');
};
const normalizedIdentifier = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !identifier.test(value))
    throw new TypeError(`${label} must be a conventional 1-128 character identifier`);
  return value.toLowerCase();
};
const canonicalTimestamp = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new TypeError(`${label} must be a valid timestamp`);
  return new Date(value).toISOString();
};

const INTELLIGENCE_DDL = `
  CREATE TABLE IF NOT EXISTS sg_intelligence_migrations (
    version INTEGER PRIMARY KEY,migration_name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_intelligence_manifests (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK(revision>=0),
    observation_count BIGINT NOT NULL CHECK(observation_count>=0),
    conformance_count BIGINT NOT NULL CHECK(conformance_count>=0),
    ruleset_count BIGINT NOT NULL CHECK(ruleset_count>=0),
    observation_tip_hash TEXT NOT NULL,conformance_tip_hash TEXT NOT NULL,ruleset_tip_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_failure_observations (
    sequence BIGSERIAL PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    audit_id TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL,provider_version TEXT,
    signature TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('repair','rejection')),
    adapter TEXT NOT NULL,provider TEXT NOT NULL,framework TEXT NOT NULL,reason_code TEXT,
    repair_rules_json TEXT NOT NULL,issue_shapes_json TEXT NOT NULL,
    previous_hash TEXT NOT NULL,record_hash TEXT NOT NULL,UNIQUE(tenant_id,audit_id)
  );
  CREATE INDEX IF NOT EXISTS sg_failure_observations_tenant_sequence ON sg_failure_observations(tenant_id,sequence);
  CREATE INDEX IF NOT EXISTS sg_failure_observations_signature ON sg_failure_observations(signature,tenant_id);
  CREATE TABLE IF NOT EXISTS sg_conformance_runs (
    sequence BIGSERIAL PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,provider_version TEXT NOT NULL,framework TEXT NOT NULL,framework_version TEXT NOT NULL,
    adapter TEXT NOT NULL,suite_version TEXT NOT NULL,executed_at TIMESTAMPTZ NOT NULL,
    passed INTEGER NOT NULL CHECK(passed>=0),failed INTEGER NOT NULL CHECK(failed>=0),
    repaired INTEGER NOT NULL CHECK(repaired>=0),rejected INTEGER NOT NULL CHECK(rejected>=0),
    failure_signature_ids_json TEXT NOT NULL,report_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,
    previous_hash TEXT NOT NULL,record_hash TEXT NOT NULL,UNIQUE(tenant_id,report_hash)
  );
  CREATE INDEX IF NOT EXISTS sg_conformance_runs_tenant_sequence ON sg_conformance_runs(tenant_id,sequence);
  CREATE TABLE IF NOT EXISTS sg_ruleset_signing_keys (
    id TEXT PRIMARY KEY,public_key_pem TEXT NOT NULL,encrypted_private_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,trust_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_tenant_rulesets (
    sequence BIGSERIAL PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    version TEXT NOT NULL,body_json TEXT NOT NULL,issued_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
    key_id TEXT NOT NULL REFERENCES sg_ruleset_signing_keys(id),previous_hash TEXT NOT NULL,record_hash TEXT NOT NULL,
    UNIQUE(tenant_id,version)
  );
  CREATE INDEX IF NOT EXISTS sg_tenant_rulesets_latest ON sg_tenant_rulesets(tenant_id,issued_at DESC,sequence DESC);
`;

export class PostgresIntelligenceState
  implements IntelligenceState, TransactionalIntelligenceWriter
{
  readonly pool: Pool;
  constructor(
    databaseUrl: string,
    private readonly masterSecret: string,
    pool?: Pool,
  ) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl, max: 10 });
  }
  private async transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  private async snapshot<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return body(client);
    });
  }
  private manifestHmac(row: Omit<ManifestRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-intelligence-manifest-v1', {
      ...row,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private assertManifest(row: ManifestRow): void {
    const unsigned = {
      tenant_id: row.tenant_id,
      revision: row.revision,
      observation_count: row.observation_count,
      conformance_count: row.conformance_count,
      ruleset_count: row.ruleset_count,
      observation_tip_hash: row.observation_tip_hash,
      conformance_tip_hash: row.conformance_tip_hash,
      ruleset_tip_hash: row.ruleset_tip_hash,
      updated_at: row.updated_at,
    };
    if (!equal(row.control_hmac, this.manifestHmac(unsigned)))
      throw new SharedStateIntegrityError('shared intelligence manifest integrity failed');
  }
  private observationHash(row: Omit<ObservationRow, 'sequence' | 'record_hash'>): string {
    return hmac(this.masterSecret, 'shared-failure-observation-v1', {
      ...row,
      observed_at: row.observed_at.toISOString(),
    });
  }
  private conformanceHash(row: Omit<ConformanceRow, 'sequence' | 'record_hash'>): string {
    return hmac(this.masterSecret, 'shared-conformance-run-v1', {
      ...row,
      executed_at: row.executed_at.toISOString(),
      created_at: row.created_at.toISOString(),
    });
  }
  private rulesetHash(row: Omit<RulesetRow, 'sequence' | 'record_hash'>): string {
    return hmac(this.masterSecret, 'shared-tenant-ruleset-v1', {
      ...row,
      issued_at: row.issued_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
    });
  }
  private keyTrust(
    row: Omit<SigningKeyRow, 'encrypted_private_key' | 'created_at' | 'trust_hmac'>,
  ): string {
    return hmac(this.masterSecret, 'shared-ruleset-signing-key-trust-v1', row);
  }
  private encryptionKey(): Buffer {
    return createHash('sha256')
      .update('schema-guard-shared-signing-key-v1\0')
      .update(this.masterSecret)
      .digest();
  }
  private createSigningKey(): Omit<SigningKeyRow, 'created_at' | 'trust_hmac'> {
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    return {
      id: `ed25519_${createHash('sha256').update(publicKey).digest('hex').slice(0, 16)}`,
      public_key_pem: publicKey,
      encrypted_private_key: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
        'base64url',
      ),
    };
  }
  private sign(key: SigningKeyRow, value: unknown): string {
    const packed = Buffer.from(key.encrypted_private_key, 'base64url');
    if (packed.length < 29) throw new SharedStateIntegrityError('shared signing key is malformed');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const pem = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString(
      'utf8',
    );
    return `ed25519:${sign(null, Buffer.from(canonicalJson(value)), createPrivateKey(pem)).toString('base64url')}`;
  }
  private verifySignature(publicKey: string, value: unknown, signature: string): boolean {
    if (!signature.startsWith('ed25519:')) return false;
    try {
      return verify(
        null,
        Buffer.from(canonicalJson(value)),
        createPublicKey(publicKey),
        Buffer.from(signature.slice(8), 'base64url'),
      );
    } catch {
      return false;
    }
  }
  private async manifest(client: PoolClient, tenantId: string, lock = false): Promise<ManifestRow> {
    const row = (
      await client.query<ManifestRow>(
        `SELECT * FROM sg_intelligence_manifests WHERE tenant_id=$1${lock ? ' FOR UPDATE' : ''}`,
        [tenantId],
      )
    ).rows[0];
    if (!row) throw new SharedStateIntegrityError('shared intelligence manifest is missing');
    this.assertManifest(row);
    return row;
  }
  private async updateManifest(
    client: PoolClient,
    current: ManifestRow,
    kind: 'observation' | 'conformance' | 'ruleset',
    tipHash: string,
    timestamp: Date,
  ): Promise<void> {
    const updated = {
      tenant_id: current.tenant_id,
      revision: String(BigInt(current.revision) + 1n),
      observation_count: String(
        BigInt(current.observation_count) + (kind === 'observation' ? 1n : 0n),
      ),
      conformance_count: String(
        BigInt(current.conformance_count) + (kind === 'conformance' ? 1n : 0n),
      ),
      ruleset_count: String(BigInt(current.ruleset_count) + (kind === 'ruleset' ? 1n : 0n)),
      observation_tip_hash: kind === 'observation' ? tipHash : current.observation_tip_hash,
      conformance_tip_hash: kind === 'conformance' ? tipHash : current.conformance_tip_hash,
      ruleset_tip_hash: kind === 'ruleset' ? tipHash : current.ruleset_tip_hash,
      updated_at: timestamp,
    };
    await client.query(
      `UPDATE sg_intelligence_manifests SET revision=$1,observation_count=$2,conformance_count=$3,
       ruleset_count=$4,observation_tip_hash=$5,conformance_tip_hash=$6,ruleset_tip_hash=$7,
       updated_at=$8,control_hmac=$9 WHERE tenant_id=$10`,
      [
        updated.revision,
        updated.observation_count,
        updated.conformance_count,
        updated.ruleset_count,
        updated.observation_tip_hash,
        updated.conformance_tip_hash,
        updated.ruleset_tip_hash,
        updated.updated_at,
        this.manifestHmac(updated),
        updated.tenant_id,
      ],
    );
  }
  async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('schema-guard-intelligence-migrations-v1'))",
      );
      await client.query(INTELLIGENCE_DDL);
      const checksum = sha256(INTELLIGENCE_DDL);
      const rows = await client.query<{ version: number; checksum: string }>(
        'SELECT version,checksum FROM sg_intelligence_migrations ORDER BY version',
      );
      if (rows.rows.some((row) => row.version !== 1 || row.checksum !== checksum))
        throw new SharedStateIntegrityError(
          'shared intelligence migration history is incompatible',
        );
      if (!rows.rows.length)
        await client.query(
          "INSERT INTO sg_intelligence_migrations(version,migration_name,checksum,applied_at) VALUES(1,'initial_intelligence_state',$1,$2)",
          [checksum, new Date()],
        );
      const keys = await client.query<SigningKeyRow>(
        'SELECT * FROM sg_ruleset_signing_keys ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      );
      if (!keys.rows.length) {
        const generated = this.createSigningKey();
        const createdAt = new Date();
        const trustHmac = this.keyTrust({
          id: generated.id,
          public_key_pem: generated.public_key_pem,
        });
        await client.query(
          'INSERT INTO sg_ruleset_signing_keys(id,public_key_pem,encrypted_private_key,created_at,trust_hmac) VALUES($1,$2,$3,$4,$5)',
          [
            generated.id,
            generated.public_key_pem,
            generated.encrypted_private_key,
            createdAt,
            trustHmac,
          ],
        );
      } else if (
        !equal(
          keys.rows[0]!.trust_hmac,
          this.keyTrust({
            id: keys.rows[0]!.id,
            public_key_pem: keys.rows[0]!.public_key_pem,
          }),
        )
      )
        throw new SharedStateIntegrityError('shared ruleset signing key trust failed');
    });
    const tenants = await this.pool.query<{ id: string }>('SELECT id FROM sg_control_tenants');
    for (const tenant of tenants.rows) await this.bootstrapTenant(tenant.id);
  }
  async bootstrapTenant(tenantId: string): Promise<void> {
    await this.transaction(async (client) => {
      const tenant = await client.query(
        'SELECT id FROM sg_control_tenants WHERE id=$1 FOR UPDATE',
        [tenantId],
      );
      if (!tenant.rowCount)
        throw new SharedStateIntegrityError(
          'shared tenant must exist before intelligence bootstrap',
        );
      const existing = (
        await client.query<ManifestRow>(
          'SELECT * FROM sg_intelligence_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (existing) {
        this.assertManifest(existing);
        return;
      }
      const unsigned = {
        tenant_id: tenantId,
        revision: '0',
        observation_count: '0',
        conformance_count: '0',
        ruleset_count: '0',
        observation_tip_hash: 'GENESIS',
        conformance_tip_hash: 'GENESIS',
        ruleset_tip_hash: 'GENESIS',
        updated_at: new Date(),
      };
      await client.query(
        `INSERT INTO sg_intelligence_manifests(tenant_id,revision,observation_count,conformance_count,
         ruleset_count,observation_tip_hash,conformance_tip_hash,ruleset_tip_hash,updated_at,control_hmac)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [...Object.values(unsigned), this.manifestHmac(unsigned)],
      );
    });
  }
  private observationFrom(
    tenantId: string,
    decision: GuardDecision,
    context: SharedObservationContext,
    previousHash: string,
  ): Omit<ObservationRow, 'sequence' | 'record_hash'> | undefined {
    if (decision.decision === 'valid') return undefined;
    const adapter = context.adapter ?? 'json_schema';
    if (!ADAPTERS.includes(adapter)) throw new TypeError('observation adapter is invalid');
    const provider = normalizedIdentifier(context.provider ?? 'unspecified', 'provider');
    const framework = normalizedIdentifier(context.framework ?? adapter, 'framework');
    const providerVersion =
      context.provider_version === undefined
        ? null
        : normalizedIdentifier(context.provider_version, 'provider_version');
    const repairRules = uniqueSorted(
      decision.repaired_fields.map((repair) => repair.rule_id),
    ) as RepairRuleId[];
    if (repairRules.some((rule) => !REPAIR_RULES.has(rule)))
      throw new SharedStateIntegrityError('observation repair rule is invalid');
    const issueShapes = uniqueSorted(
      decision.decision === 'rejected'
        ? (decision.validation_errors ?? []).map(
            (issue) => `${normalizedPath(issue.path)}|${issue.keyword.slice(0, 64)}`,
          )
        : [],
    );
    if (issueShapes.some((shape) => shape.length > 576))
      throw new TypeError('observation issue shape is too long');
    const signatureBody = {
      category:
        decision.decision === 'valid_with_repair' ? ('repair' as const) : ('rejection' as const),
      adapter,
      provider,
      framework,
      ...(decision.decision === 'rejected' ? { reason_code: decision.reason_code } : {}),
      repair_rule_ids: repairRules,
      issue_shapes: issueShapes,
    };
    return {
      tenant_id: tenantId,
      audit_id: decision.audit_id,
      observed_at: new Date(decision.audit.timestamp),
      provider_version: providerVersion,
      signature: sha256(signatureBody),
      category: signatureBody.category,
      adapter,
      provider,
      framework,
      reason_code: decision.decision === 'rejected' ? decision.reason_code : null,
      repair_rules_json: canonicalJson(repairRules),
      issue_shapes_json: canonicalJson(issueShapes),
      previous_hash: previousHash,
    };
  }
  async recordObservationWithClient(
    client: PoolClient,
    tenantId: string,
    decision: GuardDecision,
    context: SharedObservationContext = {},
  ): Promise<void> {
    if (decision.decision === 'valid') return;
    const manifest = await this.manifest(client, tenantId, true);
    if (!(await this.verifyWith(client, tenantId)).valid)
      throw new SharedStateIntegrityError('shared intelligence history integrity failed');
    const unsigned = this.observationFrom(
      tenantId,
      decision,
      context,
      manifest.observation_tip_hash,
    )!;
    const existing = (
      await client.query<ObservationRow>(
        'SELECT * FROM sg_failure_observations WHERE tenant_id=$1 AND audit_id=$2 FOR UPDATE',
        [tenantId, decision.audit_id],
      )
    ).rows[0];
    if (existing) {
      const stored = {
        tenant_id: existing.tenant_id,
        audit_id: existing.audit_id,
        observed_at: existing.observed_at,
        provider_version: existing.provider_version,
        signature: existing.signature,
        category: existing.category,
        adapter: existing.adapter,
        provider: existing.provider,
        framework: existing.framework,
        reason_code: existing.reason_code,
        repair_rules_json: existing.repair_rules_json,
        issue_shapes_json: existing.issue_shapes_json,
        previous_hash: existing.previous_hash,
      };
      const expected = { ...unsigned, previous_hash: existing.previous_hash };
      if (
        existing.record_hash !== this.observationHash(stored) ||
        existing.record_hash !== this.observationHash(expected)
      )
        throw new SharedStateIntegrityError('shared observation audit ID conflicts');
      return;
    }
    const recordHash = this.observationHash(unsigned);
    await client.query(
      `INSERT INTO sg_failure_observations(tenant_id,audit_id,observed_at,provider_version,signature,
       category,adapter,provider,framework,reason_code,repair_rules_json,issue_shapes_json,previous_hash,record_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [...Object.values(unsigned), recordHash],
    );
    await this.updateManifest(client, manifest, 'observation', recordHash, new Date());
  }
  recordObservation(
    tenantId: string,
    decision: GuardDecision,
    context: SharedObservationContext = {},
  ): Promise<void> {
    return this.transaction((client) =>
      this.recordObservationWithClient(client, tenantId, decision, context),
    );
  }
  private normalizeRun(run: SharedConformanceRun): SharedConformanceRun {
    const normalized = {
      provider: normalizedIdentifier(run.provider, 'provider'),
      provider_version: normalizedIdentifier(run.provider_version, 'provider_version'),
      framework: normalizedIdentifier(run.framework, 'framework'),
      framework_version: normalizedIdentifier(run.framework_version, 'framework_version'),
      adapter: run.adapter,
      suite_version: normalizedIdentifier(run.suite_version, 'suite_version'),
      executed_at: canonicalTimestamp(run.executed_at, 'executed_at'),
      passed: run.passed,
      failed: run.failed,
      repaired: run.repaired,
      rejected: run.rejected,
      failure_signature_ids: uniqueSorted(run.failure_signature_ids ?? []),
    };
    if (!ADAPTERS.includes(normalized.adapter))
      throw new TypeError('conformance adapter is invalid');
    for (const count of [
      normalized.passed,
      normalized.failed,
      normalized.repaired,
      normalized.rejected,
    ])
      if (!Number.isSafeInteger(count) || count < 0)
        throw new TypeError('conformance counts must be non-negative integers');
    if (normalized.passed + normalized.failed === 0)
      throw new TypeError('a conformance run must contain at least one case');
    if (normalized.repaired + normalized.rejected > normalized.passed + normalized.failed)
      throw new TypeError('repair and rejection counts cannot exceed total cases');
    if (
      normalized.failure_signature_ids.length > 1_000 ||
      normalized.failure_signature_ids.some((id) => !/^sha256:[a-f0-9]{64}$/u.test(id))
    )
      throw new TypeError('conformance failure signatures are invalid');
    return normalized;
  }
  async recordConformanceRun(
    tenantId: string,
    run: SharedConformanceRun,
  ): Promise<{ recorded: boolean; report_hash: string }> {
    const normalized = this.normalizeRun(run);
    const reportHash = sha256(normalized);
    return this.transaction(async (client) => {
      const manifest = await this.manifest(client, tenantId, true);
      if (!(await this.verifyWith(client, tenantId)).valid)
        throw new SharedStateIntegrityError('shared intelligence history integrity failed');
      const existing = (
        await client.query<ConformanceRow>(
          'SELECT * FROM sg_conformance_runs WHERE tenant_id=$1 AND report_hash=$2 FOR UPDATE',
          [tenantId, reportHash],
        )
      ).rows[0];
      if (existing) {
        const unsigned = { ...existing };
        delete (unsigned as Partial<ConformanceRow>).sequence;
        delete (unsigned as Partial<ConformanceRow>).record_hash;
        if (
          existing.record_hash !==
          this.conformanceHash(unsigned as Omit<ConformanceRow, 'sequence' | 'record_hash'>)
        )
          throw new SharedStateIntegrityError('shared conformance run integrity failed');
        return { recorded: false, report_hash: reportHash };
      }
      const timestamp = new Date();
      const unsigned: Omit<ConformanceRow, 'sequence' | 'record_hash'> = {
        tenant_id: tenantId,
        provider: normalized.provider,
        provider_version: normalized.provider_version,
        framework: normalized.framework,
        framework_version: normalized.framework_version,
        adapter: normalized.adapter,
        suite_version: normalized.suite_version,
        executed_at: new Date(normalized.executed_at),
        passed: normalized.passed,
        failed: normalized.failed,
        repaired: normalized.repaired,
        rejected: normalized.rejected,
        failure_signature_ids_json: canonicalJson(normalized.failure_signature_ids),
        report_hash: reportHash,
        created_at: timestamp,
        previous_hash: manifest.conformance_tip_hash,
      };
      const recordHash = this.conformanceHash(unsigned);
      await client.query(
        `INSERT INTO sg_conformance_runs(tenant_id,provider,provider_version,framework,framework_version,
         adapter,suite_version,executed_at,passed,failed,repaired,rejected,failure_signature_ids_json,
         report_hash,created_at,previous_hash,record_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [...Object.values(unsigned), recordHash],
      );
      await this.updateManifest(client, manifest, 'conformance', recordHash, timestamp);
      return { recorded: true, report_hash: reportHash };
    });
  }
  private runFrom(row: ConformanceRow): SharedConformanceRun {
    return {
      provider: row.provider,
      provider_version: row.provider_version,
      framework: row.framework,
      framework_version: row.framework_version,
      adapter: row.adapter,
      suite_version: row.suite_version,
      executed_at: row.executed_at.toISOString(),
      passed: row.passed,
      failed: row.failed,
      repaired: row.repaired,
      rejected: row.rejected,
      failure_signature_ids: JSON.parse(row.failure_signature_ids_json) as string[],
    };
  }
  private aggregateCompatibility(runs: SharedConformanceRun[]): SharedCompatibilityMatrixCell[] {
    const groups = new Map<string, SharedConformanceRun[]>();
    for (const run of runs) {
      const key = `${run.provider}\0${run.framework}\0${run.adapter}`;
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    return [...groups.values()]
      .map((group) => {
        const latest = [...group].sort((a, b) => b.executed_at.localeCompare(a.executed_at))[0]!;
        const passed = group.reduce((sum, item) => sum + item.passed, 0);
        const failed = group.reduce((sum, item) => sum + item.failed, 0);
        const repaired = group.reduce((sum, item) => sum + item.repaired, 0);
        const rejected = group.reduce((sum, item) => sum + item.rejected, 0);
        const total = passed + failed;
        const passRate = Number((passed / total).toFixed(4));
        return {
          provider: latest.provider,
          framework: latest.framework,
          adapter: latest.adapter,
          status:
            total < 10
              ? ('insufficient_data' as const)
              : failed === 0
                ? ('compatible' as const)
                : passRate >= 0.9
                  ? ('degraded' as const)
                  : ('incompatible' as const),
          pass_rate: passRate,
          total_cases: total,
          passed,
          failed,
          repaired,
          rejected,
          latest_provider_version: latest.provider_version,
          latest_framework_version: latest.framework_version,
          latest_suite_version: latest.suite_version,
          last_tested_at: latest.executed_at,
          failure_signature_ids: uniqueSorted(
            group.flatMap((item) => item.failure_signature_ids ?? []),
          ),
        };
      })
      .sort(
        (a, b) =>
          a.provider.localeCompare(b.provider) ||
          a.framework.localeCompare(b.framework) ||
          a.adapter.localeCompare(b.adapter),
      );
  }
  async compatibilityMatrix(tenantId: string): Promise<SharedCompatibilityMatrixCell[]> {
    return this.snapshot(async (client) => {
      const verification = await this.verifyWith(client, tenantId);
      if (!verification.valid)
        throw new SharedStateIntegrityError('shared intelligence history integrity failed');
      const rows = await client.query<ConformanceRow>(
        'SELECT * FROM sg_conformance_runs WHERE tenant_id=$1 ORDER BY sequence',
        [tenantId],
      );
      return this.aggregateCompatibility(rows.rows.map((row) => this.runFrom(row)));
    });
  }
  private clusters(
    rows: ObservationRow[],
    includeTenantCount: boolean,
  ): Array<SharedFailureCluster & { tenant_count?: number }> {
    const clusters = new Map<string, SharedFailureCluster & { tenants: Set<string> }>();
    for (const row of rows) {
      const current = clusters.get(row.signature);
      const version = row.provider_version ? [row.provider_version] : [];
      if (!current) {
        clusters.set(row.signature, {
          id: row.signature,
          category: row.category,
          adapter: row.adapter,
          provider: row.provider,
          framework: row.framework,
          ...(row.reason_code ? { reason_code: row.reason_code } : {}),
          repair_rule_ids: JSON.parse(row.repair_rules_json) as RepairRuleId[],
          issue_shapes: JSON.parse(row.issue_shapes_json) as string[],
          event_count: 1,
          first_seen_at: row.observed_at.toISOString(),
          last_seen_at: row.observed_at.toISOString(),
          affected_versions: version,
          tenants: new Set([row.tenant_id]),
        });
        continue;
      }
      current.event_count += 1;
      current.tenants.add(row.tenant_id);
      const at = row.observed_at.toISOString();
      if (at < current.first_seen_at) current.first_seen_at = at;
      if (at > current.last_seen_at) current.last_seen_at = at;
      current.affected_versions = uniqueSorted([...current.affected_versions, ...version]);
    }
    return [...clusters.values()]
      .map(({ tenants, ...cluster }) => ({
        ...cluster,
        ...(includeTenantCount ? { tenant_count: tenants.size } : {}),
      }))
      .sort((a, b) => b.event_count - a.event_count || a.id.localeCompare(b.id));
  }
  async tenantFailureClusters(tenantId: string): Promise<SharedFailureCluster[]> {
    return this.snapshot(async (client) => {
      const verification = await this.verifyWith(client, tenantId);
      if (!verification.valid)
        throw new SharedStateIntegrityError('shared intelligence history integrity failed');
      const rows = await client.query<ObservationRow>(
        'SELECT * FROM sg_failure_observations WHERE tenant_id=$1 ORDER BY sequence',
        [tenantId],
      );
      return this.clusters(rows.rows, false) as SharedFailureCluster[];
    });
  }
  async networkFailureClusters(
    threshold: number,
  ): Promise<Array<SharedFailureCluster & { tenant_count: number }>> {
    if (!Number.isSafeInteger(threshold) || threshold < 2 || threshold > 1_000_000)
      throw new TypeError('privacy threshold must be an integer between 2 and 1000000');
    return this.snapshot(async (client) => {
      const missing = await client.query<{ count: string }>(
        `SELECT COUNT(*) count FROM sg_control_tenants t
         LEFT JOIN sg_intelligence_manifests m ON m.tenant_id=t.id
         WHERE m.tenant_id IS NULL`,
      );
      if (missing.rows[0]?.count !== '0')
        throw new SharedStateIntegrityError('shared intelligence manifest is missing');
      const manifests = await client.query<ManifestRow>('SELECT * FROM sg_intelligence_manifests');
      for (const manifest of manifests.rows) {
        this.assertManifest(manifest);
        if (!(await this.verifyWith(client, manifest.tenant_id)).valid)
          throw new SharedStateIntegrityError('shared intelligence history integrity failed');
      }
      const rows = await client.query<ObservationRow>(
        `SELECT o.* FROM sg_failure_observations o
         WHERE o.signature IN (
           SELECT signature FROM sg_failure_observations GROUP BY signature
           HAVING COUNT(DISTINCT tenant_id)>=$1
         ) ORDER BY o.sequence`,
        [threshold],
      );
      const versionTenants = new Map<string, Set<string>>();
      for (const row of rows.rows) {
        if (!row.provider_version) continue;
        const key = `${row.signature}\0${row.provider_version}`;
        const tenants = versionTenants.get(key) ?? new Set<string>();
        tenants.add(row.tenant_id);
        versionTenants.set(key, tenants);
      }
      return (
        this.clusters(rows.rows, true) as Array<SharedFailureCluster & { tenant_count: number }>
      ).map((cluster) => ({
        ...cluster,
        affected_versions: cluster.affected_versions.filter(
          (version) => (versionTenants.get(`${cluster.id}\0${version}`)?.size ?? 0) >= threshold,
        ),
      }));
    });
  }
  private assertRulesetInput(
    input: Omit<SharedSignedRuleSet, 'key_id' | 'public_key' | 'signature'>,
  ): void {
    const issued = Date.parse(input.issued_at);
    const expires = Date.parse(input.expires_at);
    if (
      !identifier.test(input.version) ||
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > Date.now() + 300_000 ||
      expires <= issued ||
      expires <= Date.now() ||
      !Array.isArray(input.rules) ||
      input.rules.length < 1 ||
      input.rules.length > REPAIR_RULES.size ||
      input.rules.some(
        (rule) =>
          !REPAIR_RULES.has(rule.id as RepairRuleId) ||
          typeof rule.enabled_by_default !== 'boolean' ||
          typeof rule.description !== 'string' ||
          rule.description.length < 1 ||
          rule.description.length > 500,
      ) ||
      new Set(input.rules.map((rule) => rule.id)).size !== input.rules.length
    )
      throw new TypeError('shared ruleset is invalid');
  }
  async publishRuleset(
    tenantId: string,
    input: Omit<SharedSignedRuleSet, 'key_id' | 'public_key' | 'signature'>,
  ): Promise<SharedSignedRuleSet> {
    this.assertRulesetInput(input);
    const normalized = {
      ...input,
      issued_at: new Date(input.issued_at).toISOString(),
      expires_at: new Date(input.expires_at).toISOString(),
    };
    return this.transaction(async (client) => {
      const manifest = await this.manifest(client, tenantId, true);
      if (!(await this.verifyWith(client, tenantId)).valid)
        throw new SharedStateIntegrityError('shared intelligence history integrity failed');
      const key = (
        await client.query<SigningKeyRow>(
          'SELECT * FROM sg_ruleset_signing_keys ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
        )
      ).rows[0];
      if (
        !key ||
        !equal(key.trust_hmac, this.keyTrust({ id: key.id, public_key_pem: key.public_key_pem }))
      )
        throw new SharedStateIntegrityError('shared ruleset signing key trust failed');
      const body = { ...normalized, key_id: key.id, public_key: key.public_key_pem };
      const signed: SharedSignedRuleSet = { ...body, signature: this.sign(key, body) };
      if (!this.verifySignature(signed.public_key, body, signed.signature))
        throw new SharedStateIntegrityError('shared ruleset signing key material is invalid');
      const existing = (
        await client.query<RulesetRow>(
          'SELECT * FROM sg_tenant_rulesets WHERE tenant_id=$1 AND version=$2 FOR UPDATE',
          [tenantId, normalized.version],
        )
      ).rows[0];
      if (existing) {
        if (existing.body_json !== canonicalJson(signed))
          throw new TypeError('shared ruleset version conflicts');
        return signed;
      }
      const unsigned: Omit<RulesetRow, 'sequence' | 'record_hash'> = {
        tenant_id: tenantId,
        version: signed.version,
        body_json: canonicalJson(signed),
        issued_at: new Date(signed.issued_at),
        expires_at: new Date(signed.expires_at),
        key_id: signed.key_id,
        previous_hash: manifest.ruleset_tip_hash,
      };
      const recordHash = this.rulesetHash(unsigned);
      await client.query(
        `INSERT INTO sg_tenant_rulesets(tenant_id,version,body_json,issued_at,expires_at,key_id,previous_hash,record_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [...Object.values(unsigned), recordHash],
      );
      await this.updateManifest(client, manifest, 'ruleset', recordHash, new Date());
      return signed;
    });
  }
  async latestRuleset(tenantId: string): Promise<SharedSignedRuleSet | undefined> {
    return this.snapshot(async (client) => {
      const verification = await this.verifyWith(client, tenantId);
      if (!verification.valid)
        throw new SharedStateIntegrityError('shared intelligence history integrity failed');
      const row = (
        await client.query<RulesetRow>(
          `SELECT * FROM sg_tenant_rulesets WHERE tenant_id=$1 AND issued_at<=NOW() AND expires_at>NOW()
           ORDER BY issued_at DESC,sequence DESC LIMIT 1`,
          [tenantId],
        )
      ).rows[0];
      return row ? (JSON.parse(row.body_json) as SharedSignedRuleSet) : undefined;
    });
  }
  async verifyRuleset(ruleset: SharedSignedRuleSet): Promise<boolean> {
    if (
      !Number.isFinite(Date.parse(ruleset.expires_at)) ||
      Date.parse(ruleset.expires_at) <= Date.now()
    )
      return false;
    const key = (
      await this.pool.query<SigningKeyRow>('SELECT * FROM sg_ruleset_signing_keys WHERE id=$1', [
        ruleset.key_id,
      ])
    ).rows[0];
    if (
      !key ||
      key.public_key_pem !== ruleset.public_key ||
      !equal(key.trust_hmac, this.keyTrust({ id: key.id, public_key_pem: key.public_key_pem }))
    )
      return false;
    const { signature, ...body } = ruleset;
    return this.verifySignature(ruleset.public_key, body, signature);
  }
  private async verifyWith(
    client: PoolClient,
    tenantId: string,
  ): Promise<{ valid: boolean; checked: number }> {
    let manifest: ManifestRow;
    try {
      manifest = await this.manifest(client, tenantId);
    } catch {
      return { valid: false, checked: 0 };
    }
    const observations = (
      await client.query<ObservationRow>(
        'SELECT * FROM sg_failure_observations WHERE tenant_id=$1 ORDER BY sequence',
        [tenantId],
      )
    ).rows;
    const conformance = (
      await client.query<ConformanceRow>(
        'SELECT * FROM sg_conformance_runs WHERE tenant_id=$1 ORDER BY sequence',
        [tenantId],
      )
    ).rows;
    const rulesets = (
      await client.query<RulesetRow>(
        'SELECT * FROM sg_tenant_rulesets WHERE tenant_id=$1 ORDER BY sequence',
        [tenantId],
      )
    ).rows;
    const signingKeys = await client.query<SigningKeyRow>('SELECT * FROM sg_ruleset_signing_keys');
    const trustedKeys = new Map(
      signingKeys.rows
        .filter((key) =>
          equal(key.trust_hmac, this.keyTrust({ id: key.id, public_key_pem: key.public_key_pem })),
        )
        .map((key) => [key.id, key] as const),
    );
    if (
      BigInt(observations.length) !== BigInt(manifest.observation_count) ||
      BigInt(conformance.length) !== BigInt(manifest.conformance_count) ||
      BigInt(rulesets.length) !== BigInt(manifest.ruleset_count)
    )
      return { valid: false, checked: 0 };
    let checked = 0;
    let previous = 'GENESIS';
    for (const row of observations) {
      const unsigned = { ...row };
      delete (unsigned as Partial<ObservationRow>).sequence;
      delete (unsigned as Partial<ObservationRow>).record_hash;
      if (
        row.previous_hash !== previous ||
        row.record_hash !==
          this.observationHash(unsigned as Omit<ObservationRow, 'sequence' | 'record_hash'>)
      )
        return { valid: false, checked };
      previous = row.record_hash;
      checked += 1;
    }
    if (previous !== manifest.observation_tip_hash) return { valid: false, checked };
    previous = 'GENESIS';
    for (const row of conformance) {
      const unsigned = { ...row };
      delete (unsigned as Partial<ConformanceRow>).sequence;
      delete (unsigned as Partial<ConformanceRow>).record_hash;
      if (
        row.previous_hash !== previous ||
        row.record_hash !==
          this.conformanceHash(unsigned as Omit<ConformanceRow, 'sequence' | 'record_hash'>) ||
        sha256(this.runFrom(row)) !== row.report_hash
      )
        return { valid: false, checked };
      previous = row.record_hash;
      checked += 1;
    }
    if (previous !== manifest.conformance_tip_hash) return { valid: false, checked };
    previous = 'GENESIS';
    for (const row of rulesets) {
      const unsigned = { ...row };
      delete (unsigned as Partial<RulesetRow>).sequence;
      delete (unsigned as Partial<RulesetRow>).record_hash;
      const parsed = JSON.parse(row.body_json) as SharedSignedRuleSet;
      const key = trustedKeys.get(parsed.key_id);
      const { signature, ...body } = parsed;
      if (
        row.previous_hash !== previous ||
        row.record_hash !==
          this.rulesetHash(unsigned as Omit<RulesetRow, 'sequence' | 'record_hash'>) ||
        parsed.version !== row.version ||
        parsed.key_id !== row.key_id ||
        !key ||
        key.public_key_pem !== parsed.public_key ||
        !this.verifySignature(parsed.public_key, body, signature)
      )
        return { valid: false, checked };
      previous = row.record_hash;
      checked += 1;
    }
    if (previous !== manifest.ruleset_tip_hash) return { valid: false, checked };
    return { valid: true, checked };
  }
  verifyTenantHistory(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return this.snapshot((client) => this.verifyWith(client, tenantId));
  }
  async ready(): Promise<boolean> {
    try {
      const missing = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*) count FROM sg_control_tenants t
         LEFT JOIN sg_intelligence_manifests m ON m.tenant_id=t.id
         WHERE m.tenant_id IS NULL`,
      );
      if (missing.rows[0]?.count !== '0') return false;
      const tenants = await this.pool.query<{ id: string }>('SELECT id FROM sg_control_tenants');
      for (const tenant of tenants.rows)
        if (!(await this.verifyTenantHistory(tenant.id)).valid) return false;
      const key = (
        await this.pool.query<SigningKeyRow>(
          'SELECT * FROM sg_ruleset_signing_keys ORDER BY created_at DESC LIMIT 1',
        )
      ).rows[0];
      return Boolean(
        key &&
        equal(key.trust_hmac, this.keyTrust({ id: key.id, public_key_pem: key.public_key_pem })),
      );
    } catch {
      return false;
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
