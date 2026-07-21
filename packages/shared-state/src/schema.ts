import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  assertJsonSafety,
  canonicalJson,
  detectSchemaDrift,
  policyValidationError,
  sha256,
  type DriftReport,
  type GuardPolicy,
} from '@schema-guard/core';
import { SharedStateIntegrityError } from './postgres.js';
import type { TransactionalAlertWriter } from './alerts.js';

export type SharedSchemaEnforcementMode = 'observe' | 'enforce';
export interface SharedEnvironment {
  id: string;
  name: string;
  policy: GuardPolicy;
  schema_enforcement: SharedSchemaEnforcementMode;
  created_at: string;
  updated_at: string;
}
export interface SharedSchemaRelease {
  release_id: string;
  tool_name_hash: string;
  environment: string;
  schema_hash: string;
  adapter: string;
  version: string;
  compatibility: 'initial' | 'identical' | 'backward_compatible' | 'breaking' | 'review';
  evidence_hash: string;
  promoted_by_hash: string;
  promoted_at: string;
  previous_hash: string;
  record_hash: string;
}
export interface SharedSchemaAdmissionResult {
  mode: SharedSchemaEnforcementMode;
  allowed: boolean;
  reason?: 'schema_not_promoted' | 'schema_release_mismatch' | 'schema_release_integrity_invalid';
  environment: string;
  tool_name_hash: string;
  submitted_schema_hash: string;
  promoted_schema_hash?: string;
  release_id?: string;
}
export interface SharedLatestSchema {
  tool_name_hash: string;
  adapter: string;
  version: string;
  schema_hash: string;
  schema: object | boolean;
  drift: DriftReport | null;
  created_at: string;
}
export interface SchemaState {
  readonly recordsSchemaAlerts?: boolean;
  migrate(): Promise<void>;
  ready(): Promise<boolean>;
  bootstrapTenant(tenantId: string): Promise<void>;
  listEnvironments(tenantId: string): Promise<SharedEnvironment[]>;
  createEnvironment(
    tenantId: string,
    name: string,
    policy: GuardPolicy,
  ): Promise<SharedEnvironment>;
  environmentPolicy(tenantId: string, name: string): Promise<GuardPolicy>;
  updateEnvironmentPolicy(
    tenantId: string,
    environmentId: string,
    policy: GuardPolicy,
  ): Promise<void>;
  updateEnvironmentSchemaEnforcement(
    tenantId: string,
    environmentId: string,
    mode: SharedSchemaEnforcementMode,
  ): Promise<void>;
  registerSchema(
    tenantId: string,
    input: { tool_name: string; adapter: string; version: string; schema: object | boolean },
  ): Promise<{ schema_hash: string; drift: DriftReport | null }>;
  promoteSchemaRelease(
    tenantId: string,
    promoterId: string,
    input: {
      tool_name: string;
      version: string;
      environment: string;
      expected_schema_hash: string;
      allow_breaking?: boolean;
      evidence_reference?: string;
    },
  ): Promise<SharedSchemaRelease & { drift: DriftReport | null }>;
  schemaAdmission(
    tenantId: string,
    environment: string,
    toolName: string,
    schema: object | boolean,
  ): Promise<SharedSchemaAdmissionResult>;
  listSchemaReleases(
    tenantId: string,
    environment: string | undefined,
    limit: number,
  ): Promise<Array<SharedSchemaRelease & { integrity_valid: boolean }>>;
  verifySchemaReleaseHistory(tenantId: string): Promise<{ valid: boolean; checked: number }>;
  listLatestSchemas(tenantId: string): Promise<SharedLatestSchema[]>;
  close(): Promise<void>;
}

type EnvironmentRow = {
  id: string;
  tenant_id: string;
  name: string;
  policy_json: string;
  schema_enforcement: SharedSchemaEnforcementMode;
  created_at: Date;
  updated_at: Date;
  control_hmac: string;
};
type SchemaRow = {
  id: string;
  tenant_id: string;
  tool_name_hash: string;
  adapter: string;
  version: string;
  schema_hash: string;
  schema_json: string;
  drift_json: string | null;
  created_at: Date;
  control_hmac: string;
};
type SchemaManifestRow = {
  tenant_id: string;
  revision: string;
  row_count: string;
  set_hash: string;
  updated_at: Date;
  control_hmac: string;
};
type ReleaseRow = {
  sequence: string;
  release_id: string;
  tenant_id: string;
  tool_name_hash: string;
  environment: string;
  schema_row_id: string;
  schema_hash: string;
  adapter: string;
  version: string;
  compatibility: SharedSchemaRelease['compatibility'];
  evidence_hash: string;
  promoted_by_hash: string;
  promoted_at: Date;
  previous_hash: string;
  record_hash: string;
};
type ManifestRow = {
  tenant_id: string;
  revision: string;
  row_count: string;
  tip_hash: string;
  updated_at: Date;
  control_hmac: string;
};
type ReleaseVerificationRow = ReleaseRow & {
  source_id: string | null;
  source_tenant_id: string | null;
  source_tool_name_hash: string | null;
  source_adapter: string | null;
  source_version: string | null;
  source_schema_hash: string | null;
  source_schema_json: string | null;
  source_drift_json: string | null;
  source_created_at: Date | null;
  source_control_hmac: string | null;
};

const hmac = (secret: string, purpose: string, value: unknown): string =>
  `hmac-sha256:${createHmac('sha256', secret)
    .update(purpose)
    .update('\0')
    .update(canonicalJson(value))
    .digest('hex')}`;
const equal = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const parsePolicy = (value: string): GuardPolicy => {
  try {
    const policy = JSON.parse(value) as GuardPolicy;
    if (policyValidationError(policy)) throw new Error('invalid');
    return policy;
  } catch {
    throw new SharedStateIntegrityError('shared environment policy is invalid');
  }
};
const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS sg_schema_state_migrations (
    version INTEGER PRIMARY KEY,migration_name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_schema_environments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    schema_enforcement TEXT NOT NULL CHECK(schema_enforcement IN ('observe','enforce')),
    created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,control_hmac TEXT NOT NULL,
    UNIQUE(tenant_id,name)
  );
  CREATE TABLE IF NOT EXISTS sg_tool_schemas (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    tool_name_hash TEXT NOT NULL,adapter TEXT NOT NULL,version TEXT NOT NULL,
    schema_hash TEXT NOT NULL,schema_json TEXT NOT NULL,drift_json TEXT,created_at TIMESTAMPTZ NOT NULL,control_hmac TEXT NOT NULL,
    UNIQUE(tenant_id,tool_name_hash,version)
  );
  CREATE INDEX IF NOT EXISTS sg_tool_schemas_latest ON sg_tool_schemas(tenant_id,tool_name_hash,id DESC);
  CREATE TABLE IF NOT EXISTS sg_tool_schema_manifests (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK(revision>=0),row_count BIGINT NOT NULL CHECK(row_count>=0),
    set_hash TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL,control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_schema_release_manifests (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK(revision>=0),row_count BIGINT NOT NULL CHECK(row_count>=0),
    tip_hash TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL,control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_schema_releases (
    sequence BIGSERIAL PRIMARY KEY,release_id TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    tool_name_hash TEXT NOT NULL,environment TEXT NOT NULL,
    schema_row_id BIGINT NOT NULL REFERENCES sg_tool_schemas(id),schema_hash TEXT NOT NULL,
    adapter TEXT NOT NULL,version TEXT NOT NULL,
    compatibility TEXT NOT NULL CHECK(compatibility IN ('initial','identical','backward_compatible','breaking','review')),
    evidence_hash TEXT NOT NULL,promoted_by_hash TEXT NOT NULL,promoted_at TIMESTAMPTZ NOT NULL,
    previous_hash TEXT NOT NULL,record_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sg_schema_releases_current
    ON sg_schema_releases(tenant_id,environment,tool_name_hash,sequence DESC);
`;

export class PostgresSchemaState implements SchemaState {
  readonly pool: Pool;
  private readonly ownsPool: boolean;
  readonly recordsSchemaAlerts: boolean;
  constructor(
    databaseUrl: string,
    private readonly masterSecret: string,
    pool?: Pool,
    private readonly options: { alertWriter?: TransactionalAlertWriter } = {},
  ) {
    this.ownsPool = pool === undefined;
    this.pool = pool ?? new Pool({ connectionString: databaseUrl, max: 10 });
    this.recordsSchemaAlerts = options.alertWriter !== undefined;
  }
  private async transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await body(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  private async readSnapshot<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const value = await body(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  private toolHash(tenantId: string, toolName: string): string {
    return hmac(this.masterSecret, `tool-name:${tenantId}`, toolName);
  }
  private environmentHmac(row: Omit<EnvironmentRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-schema-environment-v1', {
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    });
  }
  private schemaHmac(row: Omit<SchemaRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-tool-schema-v1', {
      ...row,
      created_at: row.created_at.toISOString(),
    });
  }
  private schemaManifestHmac(row: Omit<SchemaManifestRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-tool-schema-manifest-v1', {
      ...row,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private assertSchemaManifest(row: SchemaManifestRow): void {
    const unsigned = {
      tenant_id: row.tenant_id,
      revision: row.revision,
      row_count: row.row_count,
      set_hash: row.set_hash,
      updated_at: row.updated_at,
    };
    if (!equal(row.control_hmac, this.schemaManifestHmac(unsigned)))
      throw new SharedStateIntegrityError('shared tool schema manifest integrity failed');
  }
  private schemaSetHash(rows: SchemaRow[]): string {
    return sha256(
      rows
        .map((row) => ({ id: row.id, control_hmac: row.control_hmac }))
        .sort((left, right) =>
          BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0,
        ),
    );
  }
  private manifestHmac(row: Omit<ManifestRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-schema-release-manifest-v1', {
      ...row,
      revision: row.revision,
      row_count: row.row_count,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private releaseHash(row: Omit<ReleaseRow, 'sequence' | 'record_hash'>): string {
    return hmac(this.masterSecret, 'shared-schema-release-record-v1', {
      ...row,
      schema_row_id: row.schema_row_id,
      promoted_at: row.promoted_at.toISOString(),
    });
  }
  private releaseUnsigned(row: ReleaseRow): Omit<ReleaseRow, 'sequence' | 'record_hash'> {
    return {
      release_id: row.release_id,
      tenant_id: row.tenant_id,
      tool_name_hash: row.tool_name_hash,
      environment: row.environment,
      schema_row_id: row.schema_row_id,
      schema_hash: row.schema_hash,
      adapter: row.adapter,
      version: row.version,
      compatibility: row.compatibility,
      evidence_hash: row.evidence_hash,
      promoted_by_hash: row.promoted_by_hash,
      promoted_at: row.promoted_at,
      previous_hash: row.previous_hash,
    };
  }
  private assertEnvironment(row: EnvironmentRow): void {
    const unsigned = {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      policy_json: row.policy_json,
      schema_enforcement: row.schema_enforcement,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (!equal(row.control_hmac, this.environmentHmac(unsigned)))
      throw new SharedStateIntegrityError('shared environment integrity failed');
    parsePolicy(row.policy_json);
  }
  private assertSchema(row: SchemaRow): void {
    const unsigned = {
      id: row.id,
      tenant_id: row.tenant_id,
      tool_name_hash: row.tool_name_hash,
      adapter: row.adapter,
      version: row.version,
      schema_hash: row.schema_hash,
      schema_json: row.schema_json,
      drift_json: row.drift_json,
      created_at: row.created_at,
    };
    if (!equal(row.control_hmac, this.schemaHmac(unsigned)))
      throw new SharedStateIntegrityError('shared tool schema integrity failed');
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.schema_json) as unknown;
    } catch {
      throw new SharedStateIntegrityError('shared tool schema JSON is invalid');
    }
    if (sha256(parsed) !== row.schema_hash)
      throw new SharedStateIntegrityError('shared tool schema hash is invalid');
    if (row.drift_json !== null) {
      try {
        const drift = JSON.parse(row.drift_json) as unknown;
        if (canonicalJson(drift) !== row.drift_json) throw new Error('non-canonical');
      } catch {
        throw new SharedStateIntegrityError('shared tool schema drift is invalid');
      }
    }
  }
  private assertManifest(row: ManifestRow): void {
    const unsigned = {
      tenant_id: row.tenant_id,
      revision: row.revision,
      row_count: row.row_count,
      tip_hash: row.tip_hash,
      updated_at: row.updated_at,
    };
    if (
      !/^\d+$/u.test(row.revision) ||
      !/^\d+$/u.test(row.row_count) ||
      !equal(row.control_hmac, this.manifestHmac(unsigned))
    )
      throw new SharedStateIntegrityError('shared schema release manifest integrity failed');
  }
  private assertReleaseSource(row: ReleaseVerificationRow): void {
    if (
      row.source_id === null ||
      row.source_tenant_id === null ||
      row.source_tool_name_hash === null ||
      row.source_adapter === null ||
      row.source_version === null ||
      row.source_schema_hash === null ||
      row.source_schema_json === null ||
      row.source_created_at === null ||
      row.source_control_hmac === null
    )
      throw new SharedStateIntegrityError('shared schema release source is missing');
    const source: SchemaRow = {
      id: row.source_id,
      tenant_id: row.source_tenant_id,
      tool_name_hash: row.source_tool_name_hash,
      adapter: row.source_adapter,
      version: row.source_version,
      schema_hash: row.source_schema_hash,
      schema_json: row.source_schema_json,
      drift_json: row.source_drift_json,
      created_at: row.source_created_at,
      control_hmac: row.source_control_hmac,
    };
    this.assertSchema(source);
    if (
      row.schema_row_id !== source.id ||
      row.tenant_id !== source.tenant_id ||
      row.tool_name_hash !== source.tool_name_hash ||
      row.adapter !== source.adapter ||
      row.version !== source.version ||
      row.schema_hash !== source.schema_hash
    )
      throw new SharedStateIntegrityError('shared schema release source does not match');
  }
  private releaseFrom(row: ReleaseRow): SharedSchemaRelease {
    return {
      release_id: row.release_id,
      tool_name_hash: row.tool_name_hash,
      environment: row.environment,
      schema_hash: row.schema_hash,
      adapter: row.adapter,
      version: row.version,
      compatibility: row.compatibility,
      evidence_hash: row.evidence_hash,
      promoted_by_hash: row.promoted_by_hash,
      promoted_at: row.promoted_at.toISOString(),
      previous_hash: row.previous_hash,
      record_hash: row.record_hash,
    };
  }
  private async verifyWith(
    client: PoolClient,
    tenantId: string,
    lock = false,
  ): Promise<{ valid: boolean; checked: number }> {
    const manifest = (
      await client.query<ManifestRow>(
        `SELECT * FROM sg_schema_release_manifests WHERE tenant_id=$1${lock ? ' FOR UPDATE' : ''}`,
        [tenantId],
      )
    ).rows[0];
    if (!manifest) return { valid: false, checked: 0 };
    try {
      this.assertManifest(manifest);
    } catch {
      return { valid: false, checked: 0 };
    }
    const rows = (
      await client.query<ReleaseVerificationRow>(
        `SELECT r.*,
          s.id source_id,s.tenant_id source_tenant_id,s.tool_name_hash source_tool_name_hash,
          s.adapter source_adapter,s.version source_version,s.schema_hash source_schema_hash,
          s.schema_json source_schema_json,s.drift_json source_drift_json,
          s.created_at source_created_at,s.control_hmac source_control_hmac
         FROM sg_schema_releases r JOIN sg_tool_schemas s ON s.id=r.schema_row_id
         WHERE r.tenant_id=$1 ORDER BY r.sequence ASC${lock ? ' FOR UPDATE OF r,s' : ''}`,
        [tenantId],
      )
    ).rows;
    if (BigInt(rows.length) !== BigInt(manifest.row_count)) return { valid: false, checked: 0 };
    let previous = 'GENESIS';
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      try {
        this.assertReleaseSource(row);
      } catch {
        return { valid: false, checked: index };
      }
      if (
        row.previous_hash !== previous ||
        row.record_hash !== this.releaseHash(this.releaseUnsigned(row))
      )
        return { valid: false, checked: index };
      previous = row.record_hash;
    }
    return { valid: manifest.tip_hash === previous, checked: rows.length };
  }
  private async verifySchemasWith(
    client: PoolClient,
    tenantId: string,
    lock = false,
  ): Promise<{ valid: boolean; checked: number; manifest?: SchemaManifestRow; rows: SchemaRow[] }> {
    const manifest = (
      await client.query<SchemaManifestRow>(
        `SELECT * FROM sg_tool_schema_manifests WHERE tenant_id=$1${lock ? ' FOR UPDATE' : ''}`,
        [tenantId],
      )
    ).rows[0];
    if (!manifest) return { valid: false, checked: 0, rows: [] };
    try {
      this.assertSchemaManifest(manifest);
    } catch {
      return { valid: false, checked: 0, rows: [] };
    }
    const rows = (
      await client.query<SchemaRow>(
        `SELECT * FROM sg_tool_schemas WHERE tenant_id=$1 ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
        [tenantId],
      )
    ).rows;
    if (BigInt(rows.length) !== BigInt(manifest.row_count))
      return { valid: false, checked: 0, manifest, rows };
    for (let index = 0; index < rows.length; index += 1) {
      try {
        this.assertSchema(rows[index]!);
      } catch {
        return { valid: false, checked: index, manifest, rows };
      }
    }
    return {
      valid: this.schemaSetHash(rows) === manifest.set_hash,
      checked: rows.length,
      manifest,
      rows,
    };
  }
  async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('schema-guard-schema-state-migrations-v1'))",
      );
      await client.query(SCHEMA_DDL);
      const checksum = sha256(SCHEMA_DDL);
      const rows = await client.query<{ version: number; checksum: string }>(
        'SELECT version,checksum FROM sg_schema_state_migrations ORDER BY version',
      );
      if (rows.rows.some((row) => row.version !== 1 || row.checksum !== checksum))
        throw new SharedStateIntegrityError('shared schema migration history is incompatible');
      if (!rows.rows.length)
        await client.query(
          "INSERT INTO sg_schema_state_migrations(version,migration_name,checksum,applied_at) VALUES(1,'initial_schema_state',$1,$2)",
          [checksum, new Date()],
        );
    });
    const tenants = await this.pool.query<{ id: string }>(
      'SELECT id FROM sg_control_tenants ORDER BY id',
    );
    for (const { id } of tenants.rows) await this.bootstrapTenant(id);
  }
  async ready(): Promise<boolean> {
    try {
      return await this.readSnapshot(async (client) => {
        const environments = await client.query<EnvironmentRow>(
          'SELECT * FROM sg_schema_environments',
        );
        for (const row of environments.rows) this.assertEnvironment(row);
        const schemas = await client.query<SchemaRow>('SELECT * FROM sg_tool_schemas');
        for (const row of schemas.rows) this.assertSchema(row);
        const tenants = await client.query<{ tenant_id: string }>(
          'SELECT tenant_id FROM sg_schema_release_manifests',
        );
        const missing = await client.query<{ count: string }>(
          `SELECT COUNT(*) count FROM sg_control_tenants t
           LEFT JOIN sg_schema_release_manifests m ON m.tenant_id=t.id
           WHERE m.tenant_id IS NULL`,
        );
        if (missing.rows[0]?.count !== '0') return false;
        const missingSchemaManifests = await client.query<{ count: string }>(
          `SELECT COUNT(*) count FROM sg_control_tenants t
           LEFT JOIN sg_tool_schema_manifests m ON m.tenant_id=t.id
           WHERE m.tenant_id IS NULL`,
        );
        if (missingSchemaManifests.rows[0]?.count !== '0') return false;
        for (const { tenant_id } of tenants.rows) {
          if (!(await this.verifySchemasWith(client, tenant_id)).valid) return false;
          if (!(await this.verifyWith(client, tenant_id)).valid) return false;
        }
        return true;
      });
    } catch {
      return false;
    }
  }
  async bootstrapTenant(tenantId: string): Promise<void> {
    await this.transaction(async (client) => {
      const tenant = (
        await client.query<{ id: string }>(
          'SELECT id FROM sg_control_tenants WHERE id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!tenant)
        throw new SharedStateIntegrityError('shared tenant is required before schema bootstrap');
      const manifest = (
        await client.query<ManifestRow>(
          'SELECT * FROM sg_schema_release_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!manifest) {
        const unsigned = {
          tenant_id: tenantId,
          revision: '0',
          row_count: '0',
          tip_hash: 'GENESIS',
          updated_at: new Date(),
        };
        await client.query(
          'INSERT INTO sg_schema_release_manifests(tenant_id,revision,row_count,tip_hash,updated_at,control_hmac) VALUES($1,$2,$3,$4,$5,$6)',
          [...Object.values(unsigned), this.manifestHmac(unsigned)],
        );
      } else this.assertManifest(manifest);
      const schemaManifest = (
        await client.query<SchemaManifestRow>(
          'SELECT * FROM sg_tool_schema_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!schemaManifest) {
        const unsigned = {
          tenant_id: tenantId,
          revision: '0',
          row_count: '0',
          set_hash: sha256([]),
          updated_at: new Date(),
        };
        await client.query(
          'INSERT INTO sg_tool_schema_manifests(tenant_id,revision,row_count,set_hash,updated_at,control_hmac) VALUES($1,$2,$3,$4,$5,$6)',
          [...Object.values(unsigned), this.schemaManifestHmac(unsigned)],
        );
      } else this.assertSchemaManifest(schemaManifest);
      for (const name of ['development', 'staging', 'production']) {
        const existing = (
          await client.query<EnvironmentRow>(
            'SELECT * FROM sg_schema_environments WHERE tenant_id=$1 AND name=$2 FOR UPDATE',
            [tenantId, name],
          )
        ).rows[0];
        if (existing) {
          this.assertEnvironment(existing);
          continue;
        }
        const timestamp = new Date();
        const unsigned = {
          id: `env_${sha256({ tenant: tenantId, name }).slice(-16)}`,
          tenant_id: tenantId,
          name,
          policy_json: '{}',
          schema_enforcement: 'observe' as const,
          created_at: timestamp,
          updated_at: timestamp,
        };
        await client.query(
          'INSERT INTO sg_schema_environments(id,tenant_id,name,policy_json,schema_enforcement,created_at,updated_at,control_hmac) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [...Object.values(unsigned), this.environmentHmac(unsigned)],
        );
      }
    });
  }
  private environmentFrom(row: EnvironmentRow): SharedEnvironment {
    this.assertEnvironment(row);
    return {
      id: row.id,
      name: row.name,
      policy: parsePolicy(row.policy_json),
      schema_enforcement: row.schema_enforcement,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
  async listEnvironments(tenantId: string): Promise<SharedEnvironment[]> {
    const rows = await this.pool.query<EnvironmentRow>(
      'SELECT * FROM sg_schema_environments WHERE tenant_id=$1 ORDER BY name',
      [tenantId],
    );
    return rows.rows.map((row) => this.environmentFrom(row));
  }
  async createEnvironment(
    tenantId: string,
    name: string,
    policy: GuardPolicy,
  ): Promise<SharedEnvironment> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(name) || policyValidationError(policy))
      throw new TypeError('shared environment is invalid');
    const timestamp = new Date();
    const unsigned = {
      id: `env_${sha256({ tenant: tenantId, name }).slice(-16)}`,
      tenant_id: tenantId,
      name,
      policy_json: canonicalJson(policy),
      schema_enforcement: 'observe' as const,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const inserted = await this.pool.query(
      'INSERT INTO sg_schema_environments(id,tenant_id,name,policy_json,schema_enforcement,created_at,updated_at,control_hmac) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,name) DO NOTHING RETURNING id',
      [...Object.values(unsigned), this.environmentHmac(unsigned)],
    );
    if (!inserted.rowCount) throw new TypeError('shared environment already exists');
    return this.environmentFrom({ ...unsigned, control_hmac: this.environmentHmac(unsigned) });
  }
  async environmentPolicy(tenantId: string, name: string): Promise<GuardPolicy> {
    const row = (
      await this.pool.query<EnvironmentRow>(
        'SELECT * FROM sg_schema_environments WHERE tenant_id=$1 AND name=$2',
        [tenantId, name],
      )
    ).rows[0];
    if (!row) throw new TypeError('shared environment does not exist');
    this.assertEnvironment(row);
    return parsePolicy(row.policy_json);
  }
  private async updateEnvironment(
    tenantId: string,
    id: string,
    change: (row: Omit<EnvironmentRow, 'control_hmac'>) => Omit<EnvironmentRow, 'control_hmac'>,
    after?: (
      client: PoolClient,
      previous: Omit<EnvironmentRow, 'control_hmac'>,
      updated: Omit<EnvironmentRow, 'control_hmac'>,
    ) => Promise<void>,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const row = (
        await client.query<EnvironmentRow>(
          'SELECT * FROM sg_schema_environments WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, id],
        )
      ).rows[0];
      if (!row) throw new TypeError('shared environment does not exist');
      this.assertEnvironment(row);
      const unsigned = {
        id: row.id,
        tenant_id: row.tenant_id,
        name: row.name,
        policy_json: row.policy_json,
        schema_enforcement: row.schema_enforcement,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      const updated = change(unsigned);
      await client.query(
        'UPDATE sg_schema_environments SET policy_json=$1,schema_enforcement=$2,updated_at=$3,control_hmac=$4 WHERE tenant_id=$5 AND id=$6',
        [
          updated.policy_json,
          updated.schema_enforcement,
          updated.updated_at,
          this.environmentHmac(updated),
          tenantId,
          id,
        ],
      );
      await after?.(client, unsigned, updated);
    });
  }
  updateEnvironmentPolicy(tenantId: string, id: string, policy: GuardPolicy): Promise<void> {
    if (policyValidationError(policy)) throw new TypeError('shared environment policy is invalid');
    return this.updateEnvironment(tenantId, id, (row) => ({
      ...row,
      policy_json: canonicalJson(policy),
      updated_at: new Date(),
    }));
  }
  updateEnvironmentSchemaEnforcement(
    tenantId: string,
    id: string,
    mode: SharedSchemaEnforcementMode,
  ): Promise<void> {
    if (mode !== 'observe' && mode !== 'enforce')
      throw new TypeError('shared schema enforcement mode is invalid');
    return this.updateEnvironment(
      tenantId,
      id,
      (row) => ({
        ...row,
        schema_enforcement: mode,
        updated_at: new Date(),
      }),
      async (client, previous, updated) => {
        if (previous.schema_enforcement === mode || !this.options.alertWriter) return;
        await this.options.alertWriter.recordAlertWithClient(
          client,
          tenantId,
          'schema_enforcement_changed',
          'critical',
          { environment: updated.name, mode },
          `schema-enforcement:${updated.id}:${mode}:${updated.updated_at.toISOString()}`,
        );
      },
    );
  }
  async registerSchema(
    tenantId: string,
    input: { tool_name: string; adapter: string; version: string; schema: object | boolean },
  ): Promise<{ schema_hash: string; drift: DriftReport | null }> {
    if (
      input.tool_name.length < 1 ||
      input.tool_name.length > 256 ||
      !['json_schema', 'mcp', 'openai_agents', 'pydantic_ai', 'google_adk'].includes(
        input.adapter,
      ) ||
      input.version.length < 1 ||
      input.version.length > 128 ||
      (typeof input.schema !== 'boolean' &&
        (input.schema === null || typeof input.schema !== 'object' || Array.isArray(input.schema)))
    )
      throw new TypeError('shared schema registration is invalid');
    assertJsonSafety(input.schema, 'shared registered schema');
    const toolHash = this.toolHash(tenantId, input.tool_name);
    const schemaJson = canonicalJson(input.schema);
    const schemaHash = sha256(input.schema);
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `schema-guard-register:${tenantId}:${toolHash}`,
      ]);
      const schemaVerification = await this.verifySchemasWith(client, tenantId, true);
      if (!schemaVerification.valid || !schemaVerification.manifest)
        throw new SharedStateIntegrityError('shared tool schema history is invalid');
      const existing = (
        await client.query<SchemaRow>(
          'SELECT * FROM sg_tool_schemas WHERE tenant_id=$1 AND tool_name_hash=$2 AND version=$3 FOR UPDATE',
          [tenantId, toolHash, input.version],
        )
      ).rows[0];
      if (existing) {
        this.assertSchema(existing);
        if (existing.schema_hash !== schemaHash || existing.adapter !== input.adapter)
          throw new TypeError('shared schema version conflicts');
        return {
          schema_hash: schemaHash,
          drift: existing.drift_json ? (JSON.parse(existing.drift_json) as DriftReport) : null,
        };
      }
      const prior = (
        await client.query<SchemaRow>(
          'SELECT * FROM sg_tool_schemas WHERE tenant_id=$1 AND tool_name_hash=$2 ORDER BY id DESC LIMIT 1 FOR UPDATE',
          [tenantId, toolHash],
        )
      ).rows[0];
      if (prior) this.assertSchema(prior);
      const drift = prior
        ? detectSchemaDrift(JSON.parse(prior.schema_json) as object | boolean, input.schema)
        : null;
      const timestamp = new Date();
      const provisional = {
        id: '0',
        tenant_id: tenantId,
        tool_name_hash: toolHash,
        adapter: input.adapter,
        version: input.version,
        schema_hash: schemaHash,
        schema_json: schemaJson,
        drift_json: drift ? canonicalJson(drift) : null,
        created_at: timestamp,
      };
      const inserted = (
        await client.query<{ id: string }>(
          'INSERT INTO sg_tool_schemas(tenant_id,tool_name_hash,adapter,version,schema_hash,schema_json,drift_json,created_at,control_hmac) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [
            tenantId,
            toolHash,
            input.adapter,
            input.version,
            schemaHash,
            schemaJson,
            provisional.drift_json,
            timestamp,
            'pending',
          ],
        )
      ).rows[0]!;
      const unsigned = { ...provisional, id: inserted.id };
      await client.query('UPDATE sg_tool_schemas SET control_hmac=$1 WHERE id=$2', [
        this.schemaHmac(unsigned),
        inserted.id,
      ]);
      const insertedRow: SchemaRow = {
        ...unsigned,
        control_hmac: this.schemaHmac(unsigned),
      };
      const schemaManifest = schemaVerification.manifest;
      const updatedSchemaManifest = {
        tenant_id: tenantId,
        revision: String(BigInt(schemaManifest.revision) + 1n),
        row_count: String(BigInt(schemaManifest.row_count) + 1n),
        set_hash: this.schemaSetHash([...schemaVerification.rows, insertedRow]),
        updated_at: timestamp,
      };
      await client.query(
        'UPDATE sg_tool_schema_manifests SET revision=$1,row_count=$2,set_hash=$3,updated_at=$4,control_hmac=$5 WHERE tenant_id=$6',
        [
          updatedSchemaManifest.revision,
          updatedSchemaManifest.row_count,
          updatedSchemaManifest.set_hash,
          updatedSchemaManifest.updated_at,
          this.schemaManifestHmac(updatedSchemaManifest),
          tenantId,
        ],
      );
      if (drift?.changed && drift.compatibility === 'breaking' && this.options.alertWriter)
        await this.options.alertWriter.recordAlertWithClient(
          client,
          tenantId,
          'breaking_schema_drift',
          'critical',
          {
            tool_name_hash: toolHash,
            changes: drift.changes.map((change) => change.kind),
          },
          `schema-drift:${toolHash}:${input.version}:${schemaHash}`,
        );
      return { schema_hash: schemaHash, drift };
    });
  }
  async promoteSchemaRelease(
    tenantId: string,
    promoterId: string,
    input: {
      tool_name: string;
      version: string;
      environment: string;
      expected_schema_hash: string;
      allow_breaking?: boolean;
      evidence_reference?: string;
    },
  ): Promise<SharedSchemaRelease & { drift: DriftReport | null }> {
    if (
      input.tool_name.length < 1 ||
      input.tool_name.length > 256 ||
      input.version.length < 1 ||
      input.version.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.environment) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.expected_schema_hash) ||
      promoterId.length < 1 ||
      promoterId.length > 256 ||
      (input.evidence_reference !== undefined &&
        (input.evidence_reference.length < 1 || input.evidence_reference.length > 512))
    )
      throw new TypeError('shared schema promotion is invalid');
    return this.transaction(async (client) => {
      if (!(await this.verifySchemasWith(client, tenantId, true)).valid)
        throw new SharedStateIntegrityError('shared tool schema history is invalid');
      const verified = await this.verifyWith(client, tenantId, true);
      if (!verified.valid)
        throw new SharedStateIntegrityError('shared schema release history is invalid');
      const environment = (
        await client.query<EnvironmentRow>(
          'SELECT * FROM sg_schema_environments WHERE tenant_id=$1 AND name=$2 FOR UPDATE',
          [tenantId, input.environment],
        )
      ).rows[0];
      if (!environment) throw new TypeError('shared environment does not exist');
      this.assertEnvironment(environment);
      const toolHash = this.toolHash(tenantId, input.tool_name);
      const candidate = (
        await client.query<SchemaRow>(
          'SELECT * FROM sg_tool_schemas WHERE tenant_id=$1 AND tool_name_hash=$2 AND version=$3 FOR UPDATE',
          [tenantId, toolHash, input.version],
        )
      ).rows[0];
      if (!candidate) throw new TypeError('shared registered schema does not exist');
      this.assertSchema(candidate);
      if (candidate.schema_hash !== input.expected_schema_hash)
        throw new TypeError('shared schema hash mismatch');
      const current = (
        await client.query<ReleaseRow & { schema_json: string }>(
          'SELECT r.*,s.schema_json FROM sg_schema_releases r JOIN sg_tool_schemas s ON s.id=r.schema_row_id WHERE r.tenant_id=$1 AND r.environment=$2 AND r.tool_name_hash=$3 ORDER BY r.sequence DESC LIMIT 1 FOR UPDATE',
          [tenantId, environment.name, toolHash],
        )
      ).rows[0];
      if (current && current.schema_row_id === candidate.id)
        return { ...this.releaseFrom(current), drift: null };
      const drift = current
        ? detectSchemaDrift(
            JSON.parse(current.schema_json) as object | boolean,
            JSON.parse(candidate.schema_json) as object | boolean,
          )
        : null;
      const compatibility: SharedSchemaRelease['compatibility'] = drift
        ? drift.compatibility
        : 'initial';
      if (compatibility === 'breaking' && (!input.allow_breaking || !input.evidence_reference))
        throw new TypeError('shared breaking schema promotion requires review evidence');
      const manifest = (
        await client.query<ManifestRow>(
          'SELECT * FROM sg_schema_release_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0]!;
      this.assertManifest(manifest);
      const promotedAt = new Date();
      const unsigned = {
        release_id: `release_${randomUUID()}`,
        tenant_id: tenantId,
        tool_name_hash: toolHash,
        environment: environment.name,
        schema_row_id: candidate.id,
        schema_hash: candidate.schema_hash,
        adapter: candidate.adapter,
        version: candidate.version,
        compatibility,
        evidence_hash: hmac(this.masterSecret, 'shared-schema-promotion-evidence-v1', {
          tenant_id: tenantId,
          evidence_reference: input.evidence_reference ?? 'none',
        }),
        promoted_by_hash: hmac(this.masterSecret, 'shared-schema-promoter-v1', {
          tenant_id: tenantId,
          key_id: promoterId,
        }),
        promoted_at: promotedAt,
        previous_hash: manifest.tip_hash,
      };
      const recordHash = this.releaseHash(unsigned);
      await client.query(
        'INSERT INTO sg_schema_releases(release_id,tenant_id,tool_name_hash,environment,schema_row_id,schema_hash,adapter,version,compatibility,evidence_hash,promoted_by_hash,promoted_at,previous_hash,record_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [...Object.values(unsigned), recordHash],
      );
      const updated = {
        tenant_id: tenantId,
        revision: String(BigInt(manifest.revision) + 1n),
        row_count: String(BigInt(manifest.row_count) + 1n),
        tip_hash: recordHash,
        updated_at: promotedAt,
      };
      await client.query(
        'UPDATE sg_schema_release_manifests SET revision=$1,row_count=$2,tip_hash=$3,updated_at=$4,control_hmac=$5 WHERE tenant_id=$6',
        [
          updated.revision,
          updated.row_count,
          updated.tip_hash,
          updated.updated_at,
          this.manifestHmac(updated),
          tenantId,
        ],
      );
      if (this.options.alertWriter)
        await this.options.alertWriter.recordAlertWithClient(
          client,
          tenantId,
          'schema_promoted',
          'critical',
          {
            release_id: unsigned.release_id,
            tool_name_hash: toolHash,
            environment: environment.name,
            schema_hash: candidate.schema_hash,
            compatibility,
          },
          `schema-release:${unsigned.release_id}`,
        );
      return {
        ...this.releaseFrom({ sequence: '0', ...unsigned, record_hash: recordHash }),
        drift,
      };
    });
  }
  async schemaAdmission(
    tenantId: string,
    environmentName: string,
    toolName: string,
    schema: object | boolean,
  ): Promise<SharedSchemaAdmissionResult> {
    assertJsonSafety(schema, 'shared admitted schema');
    return this.readSnapshot(async (client) => {
      if (!(await this.verifySchemasWith(client, tenantId)).valid)
        throw new SharedStateIntegrityError('shared tool schema history is invalid');
      const environment = (
        await client.query<EnvironmentRow>(
          'SELECT * FROM sg_schema_environments WHERE tenant_id=$1 AND name=$2',
          [tenantId, environmentName],
        )
      ).rows[0];
      if (!environment) throw new TypeError('shared environment does not exist');
      this.assertEnvironment(environment);
      const toolHash = this.toolHash(tenantId, toolName);
      const submitted = sha256(schema);
      const base = {
        mode: environment.schema_enforcement,
        environment: environment.name,
        tool_name_hash: toolHash,
        submitted_schema_hash: submitted,
      };
      if (environment.schema_enforcement === 'observe') return { ...base, allowed: true };
      if (!(await this.verifyWith(client, tenantId)).valid)
        return { ...base, allowed: false, reason: 'schema_release_integrity_invalid' };
      const release = (
        await client.query<ReleaseVerificationRow>(
          `SELECT r.*,
            s.id source_id,s.tenant_id source_tenant_id,s.tool_name_hash source_tool_name_hash,
            s.adapter source_adapter,s.version source_version,s.schema_hash source_schema_hash,
            s.schema_json source_schema_json,s.drift_json source_drift_json,
            s.created_at source_created_at,s.control_hmac source_control_hmac
           FROM sg_schema_releases r LEFT JOIN sg_tool_schemas s ON s.id=r.schema_row_id
           WHERE r.tenant_id=$1 AND r.environment=$2 AND r.tool_name_hash=$3
           ORDER BY r.sequence DESC LIMIT 1`,
          [tenantId, environment.name, toolHash],
        )
      ).rows[0];
      if (!release) return { ...base, allowed: false, reason: 'schema_not_promoted' };
      try {
        this.assertReleaseSource(release);
      } catch {
        return { ...base, allowed: false, reason: 'schema_release_integrity_invalid' };
      }
      if (release.schema_hash !== submitted)
        return {
          ...base,
          allowed: false,
          reason: 'schema_release_mismatch',
          promoted_schema_hash: release.schema_hash,
          release_id: release.release_id,
        };
      return {
        ...base,
        allowed: true,
        promoted_schema_hash: release.schema_hash,
        release_id: release.release_id,
      };
    });
  }
  async listSchemaReleases(
    tenantId: string,
    environment: string | undefined,
    limit: number,
  ): Promise<Array<SharedSchemaRelease & { integrity_valid: boolean }>> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    return this.readSnapshot(async (client) => {
      const releaseVerification = await this.verifyWith(client, tenantId);
      const schemaVerification = await this.verifySchemasWith(client, tenantId);
      const verified = releaseVerification.valid && schemaVerification.valid;
      const rows = environment
        ? await client.query<ReleaseRow>(
            'SELECT * FROM sg_schema_releases WHERE tenant_id=$1 AND environment=$2 ORDER BY sequence DESC LIMIT $3',
            [tenantId, environment, bounded],
          )
        : await client.query<ReleaseRow>(
            'SELECT * FROM sg_schema_releases WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT $2',
            [tenantId, bounded],
          );
      return rows.rows.map((row) => ({
        ...this.releaseFrom(row),
        integrity_valid: verified,
      }));
    });
  }
  async verifySchemaReleaseHistory(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return this.readSnapshot(async (client) => {
      const [releases, schemas] = await Promise.all([
        this.verifyWith(client, tenantId),
        this.verifySchemasWith(client, tenantId),
      ]);
      return {
        valid: releases.valid && schemas.valid,
        checked: releases.checked + schemas.checked,
      };
    });
  }
  async listLatestSchemas(tenantId: string): Promise<SharedLatestSchema[]> {
    return this.readSnapshot(async (client) => {
      if (!(await this.verifySchemasWith(client, tenantId)).valid)
        throw new SharedStateIntegrityError('shared tool schema history is invalid');
      const rows = (
        await client.query<SchemaRow>(
          `SELECT s.* FROM sg_tool_schemas s
           WHERE s.tenant_id=$1 AND NOT EXISTS (
             SELECT 1 FROM sg_tool_schemas newer
             WHERE newer.tenant_id=s.tenant_id AND newer.tool_name_hash=s.tool_name_hash AND newer.id>s.id
           ) ORDER BY s.created_at DESC,s.id DESC`,
          [tenantId],
        )
      ).rows;
      return rows.map((row) => {
        this.assertSchema(row);
        return {
          tool_name_hash: row.tool_name_hash,
          adapter: row.adapter,
          version: row.version,
          schema_hash: row.schema_hash,
          schema: JSON.parse(row.schema_json) as object | boolean,
          drift: row.drift_json === null ? null : (JSON.parse(row.drift_json) as DriftReport),
          created_at: row.created_at.toISOString(),
        };
      });
    });
  }
  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
