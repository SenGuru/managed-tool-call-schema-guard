import Database from 'better-sqlite3';
import { chmodSync, existsSync } from 'node:fs';
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  detectSchemaDrift,
  policyValidationError,
  sha256,
  type AdapterName,
  type AuditEnvelope,
  type DriftReport,
  type GuardDecision,
  type GuardPolicy,
} from '@schema-guard/core';
import {
  constantTimeEqual,
  createEncryptedSigningKey,
  generateApiKey,
  hashApiKey,
  hmac,
  signRuleset,
  verifyRulesetSignature,
} from './crypto.js';
import { migrations } from './migrations.js';
import {
  aggregateCompatibilityMatrix,
  extractFailureSignature,
  recommendFixes,
  scoreSchemaQuality,
  type ConformanceRun,
  type FailureCluster,
} from './intelligence.js';
import {
  ALL_SCOPES,
  type ManagedConfig,
  type PlanId,
  type Principal,
  type Scope,
  type SignedRuleSet,
} from './types.js';

type Row = Record<string, unknown>;
const now = (): string => new Date().toISOString();
const month = (): string => new Date().toISOString().slice(0, 7);
const parse = (value: unknown): unknown => JSON.parse(typeof value === 'string' ? value : 'null');
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export interface ObservationContext {
  adapter?: AdapterName;
  provider?: string;
  provider_version?: string;
  framework?: string;
  framework_version?: string;
}

export class ManagedStore {
  readonly db: Database.Database;
  constructor(private readonly config: ManagedConfig) {
    if (!config.databasePath || config.masterSecret.length < 32)
      throw new TypeError('databasePath and a 32+ character masterSecret are required');
    if (
      config.aggregateTenantThreshold !== undefined &&
      (!Number.isInteger(config.aggregateTenantThreshold) || config.aggregateTenantThreshold < 2)
    )
      throw new TypeError('aggregateTenantThreshold must be an integer of at least 2');
    this.db = new Database(config.databasePath);
    this.secureDatabaseFiles();
    this.db.pragma('journal_mode = WAL');
    this.secureDatabaseFiles();
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    this.ensureSigningKey();
    this.ensureAuditAnchorsTrusted();
  }

  close(): void {
    this.db.close();
  }
  integrityCheck(): boolean {
    const rows = this.db.pragma('integrity_check') as { integrity_check: string }[];
    return rows.length === 1 && rows[0]?.integrity_check === 'ok';
  }
  async backup(destination: string): Promise<void> {
    await this.db.backup(destination);
    chmodSync(destination, 0o600);
  }
  private secureDatabaseFiles(): void {
    if (this.config.databasePath === ':memory:') return;
    for (const path of [
      this.config.databasePath,
      `${this.config.databasePath}-wal`,
      `${this.config.databasePath}-shm`,
    ])
      if (existsSync(path)) chmodSync(path, 0o600);
  }
  private migrate(): void {
    let current = Number(this.db.pragma('user_version', { simple: true }));
    for (const migration of migrations)
      if (migration.version > current) {
        this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db.pragma(`user_version = ${migration.version}`);
        })();
        current = migration.version;
      }
  }
  private ensureSigningKey(): void {
    const existing = this.db
      .prepare('SELECT id,public_key_pem,trust_hmac FROM signing_keys LIMIT 1')
      .get() as Row | undefined;
    if (existing) {
      if (!existing.trust_hmac)
        this.db.prepare('UPDATE signing_keys SET trust_hmac=? WHERE id=?').run(
          hmac(this.config.masterSecret, 'signing-key-trust-v1', {
            id: existing.id,
            public_key: existing.public_key_pem,
          }),
          existing.id,
        );
      return;
    }
    const key = createEncryptedSigningKey(this.config.masterSecret);
    this.db
      .prepare(
        'INSERT INTO signing_keys(id,public_key_pem,encrypted_private_key,created_at,trust_hmac) VALUES(?,?,?,?,?)',
      )
      .run(
        key.keyId,
        key.publicKey,
        key.encryptedPrivateKey,
        now(),
        hmac(this.config.masterSecret, 'signing-key-trust-v1', {
          id: key.keyId,
          public_key: key.publicKey,
        }),
      );
  }
  private auditAnchorSignature(
    tenantId: string,
    lastDeletedHash: string,
    sequence: number,
  ): string {
    return hmac(this.config.masterSecret, 'audit-chain-anchor-v1', {
      tenant_id: tenantId,
      last_deleted_hash: lastDeletedHash,
      deleted_through_sequence: sequence,
    });
  }
  private ensureAuditAnchorsTrusted(): void {
    const rows = this.db
      .prepare(
        'SELECT tenant_id,last_deleted_hash,deleted_through_sequence FROM audit_chain_anchors WHERE signature IS NULL',
      )
      .all() as Row[];
    const update = this.db.prepare(
      'UPDATE audit_chain_anchors SET signature=? WHERE tenant_id=? AND signature IS NULL',
    );
    this.db.transaction(() => {
      for (const row of rows)
        update.run(
          this.auditAnchorSignature(
            text(row.tenant_id),
            text(row.last_deleted_hash),
            Number(row.deleted_through_sequence),
          ),
          row.tenant_id,
        );
    })();
  }

  bootstrapTenant(input: {
    id: string;
    name: string;
    plan: PlanId;
    apiKey: string;
    scopes?: Scope[];
    retentionDays?: number;
    policy?: GuardPolicy;
  }): void {
    const limits: Record<PlanId, number> = { trial: 1_000, team: 100_000 };
    if (
      !/^[A-Za-z0-9_-]{1,64}$/u.test(input.id) ||
      input.name.length === 0 ||
      input.name.length > 256 ||
      input.apiKey.length === 0 ||
      input.apiKey.length > 4096 ||
      (input.retentionDays !== undefined &&
        (!Number.isInteger(input.retentionDays) ||
          input.retentionDays < 0 ||
          input.retentionDays > 3650))
    )
      throw new ManagedError(400, 'invalid_tenant', 'tenant bootstrap fields are invalid');
    const scopes = input.scopes ?? [
      'validate',
      'read:audit',
      'write:schema',
      'read:intelligence',
      'admin',
    ];
    this.assertScopes(scopes);
    const policyError = policyValidationError(input.policy);
    if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO tenants(id,name,plan,monthly_limit,retention_days,created_at) VALUES(?,?,?,?,?,?)',
        )
        .run(
          input.id,
          input.name,
          input.plan,
          limits[input.plan],
          input.retentionDays ?? 30,
          now(),
        );
      const insertEnvironment = this.db.prepare(
        'INSERT OR IGNORE INTO environments(id,tenant_id,name,policy_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      );
      for (const name of ['development', 'staging', 'production']) {
        const timestamp = now();
        insertEnvironment.run(
          `env_${sha256({ tenant: input.id, name }).slice(-16)}`,
          input.id,
          name,
          '{}',
          timestamp,
          timestamp,
        );
      }
      if (input.policy)
        this.db
          .prepare('UPDATE tenants SET policy_json=? WHERE id=?')
          .run(JSON.stringify(input.policy), input.id);
      this.db
        .prepare(
          'INSERT OR IGNORE INTO api_keys(id,tenant_id,key_hash,prefix,scopes_json,created_at) VALUES(?,?,?,?,?,?)',
        )
        .run(
          `key_${sha256(input.id + input.apiKey).slice(-16)}`,
          input.id,
          hashApiKey(this.config.masterSecret, input.apiKey),
          input.apiKey.slice(0, 12),
          JSON.stringify(scopes),
          now(),
        );
    })();
  }

  authenticate(apiKey: string): Principal | undefined {
    const keyHash = hashApiKey(this.config.masterSecret, apiKey);
    const row = this.db
      .prepare(
        `SELECT k.id key_id,k.scopes_json,t.id tenant_id,t.name tenant_name,t.plan,t.monthly_limit,t.retention_days,t.policy_json FROM api_keys k JOIN tenants t ON t.id=k.tenant_id WHERE k.key_hash=? AND k.revoked_at IS NULL`,
      )
      .get(keyHash) as Row | undefined;
    if (!row) return undefined;
    return {
      tenantId: String(row.tenant_id),
      tenantName: String(row.tenant_name),
      keyId: String(row.key_id),
      scopes: parse(row.scopes_json) as Scope[],
      plan: String(row.plan) as PlanId,
      monthlyLimit: Number(row.monthly_limit),
      retentionDays: Number(row.retention_days),
      policy: parse(row.policy_json) as GuardPolicy,
    };
  }

  issueApiKey(
    principal: Principal,
    scopes: Scope[],
  ): { key_id: string; api_key: string; scopes: Scope[] } {
    this.requireScope(principal, 'admin');
    this.assertScopes(scopes);
    const apiKey = generateApiKey();
    const keyId = `key_${sha256(principal.tenantId + apiKey).slice(-16)}`;
    this.db
      .prepare(
        'INSERT INTO api_keys(id,tenant_id,key_hash,prefix,scopes_json,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(
        keyId,
        principal.tenantId,
        hashApiKey(this.config.masterSecret, apiKey),
        apiKey.slice(0, 12),
        JSON.stringify(scopes),
        now(),
      );
    return { key_id: keyId, api_key: apiKey, scopes };
  }
  revokeApiKey(principal: Principal, keyId: string): boolean {
    this.requireScope(principal, 'admin');
    if (keyId === principal.keyId)
      throw new ManagedError(
        409,
        'cannot_revoke_current_key',
        'use another admin key to revoke the current key',
      );
    return (
      this.db
        .prepare(
          'UPDATE api_keys SET revoked_at=? WHERE tenant_id=? AND id=? AND revoked_at IS NULL',
        )
        .run(now(), principal.tenantId, keyId).changes === 1
    );
  }
  updateTenantPolicy(principal: Principal, policy: GuardPolicy): void {
    this.requireScope(principal, 'admin');
    const error = policyValidationError(policy);
    if (error) throw new ManagedError(400, 'invalid_policy', error);
    this.db
      .prepare('UPDATE tenants SET policy_json=? WHERE id=?')
      .run(JSON.stringify(policy), principal.tenantId);
  }
  updatePlan(principal: Principal, plan: PlanId): void {
    this.requireScope(principal, 'admin');
    const limits: Record<PlanId, number> = { trial: 1_000, team: 100_000 };
    this.db
      .prepare('UPDATE tenants SET plan=?,monthly_limit=? WHERE id=?')
      .run(plan, limits[plan], principal.tenantId);
  }

  listEnvironments(principal: Principal): Row[] {
    const rows = this.db
      .prepare(
        'SELECT id,name,policy_json,created_at,updated_at FROM environments WHERE tenant_id=? ORDER BY name ASC',
      )
      .all(principal.tenantId) as Row[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      policy: parse(row.policy_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  createEnvironment(principal: Principal, name: string, policy: GuardPolicy = {}): Row {
    this.requireScope(principal, 'admin');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(name))
      throw new ManagedError(
        400,
        'invalid_environment',
        'environment name must be 1-64 letters, digits, underscores, or hyphens',
      );
    const policyError = policyValidationError(policy);
    if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
    const id = `env_${sha256({ tenant: principal.tenantId, name }).slice(-16)}`;
    const timestamp = now();
    try {
      this.db
        .prepare(
          'INSERT INTO environments(id,tenant_id,name,policy_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        )
        .run(id, principal.tenantId, name, JSON.stringify(policy), timestamp, timestamp);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
        throw new ManagedError(409, 'environment_exists', 'environment name already exists');
      throw error;
    }
    return { id, name, policy, created_at: timestamp, updated_at: timestamp };
  }

  updateEnvironmentPolicy(principal: Principal, environmentId: string, policy: GuardPolicy): void {
    this.requireScope(principal, 'admin');
    const policyError = policyValidationError(policy);
    if (policyError) throw new ManagedError(400, 'invalid_policy', policyError);
    const result = this.db
      .prepare('UPDATE environments SET policy_json=?,updated_at=? WHERE tenant_id=? AND id=?')
      .run(JSON.stringify(policy), now(), principal.tenantId, environmentId);
    if (result.changes !== 1)
      throw new ManagedError(404, 'environment_not_found', 'environment does not exist');
  }

  environmentPolicy(principal: Principal, idOrName: string): GuardPolicy {
    const row = this.db
      .prepare(
        'SELECT policy_json FROM environments WHERE tenant_id=? AND (id=? OR name=?) LIMIT 1',
      )
      .get(principal.tenantId, idOrName, idOrName) as Row | undefined;
    if (!row) throw new ManagedError(404, 'environment_not_found', 'environment does not exist');
    return parse(row.policy_json) as GuardPolicy;
  }

  requireScope(principal: Principal, scope: Scope): void {
    if (!principal.scopes.includes(scope) && !principal.scopes.includes('admin'))
      throw new ManagedError(403, 'scope_denied', `scope ${scope} is required`);
  }
  private assertScopes(scopes: Scope[]): void {
    if (
      !scopes.length ||
      scopes.some((scope) => !ALL_SCOPES.includes(scope)) ||
      new Set(scopes).size !== scopes.length
    )
      throw new ManagedError(400, 'invalid_scopes', 'scopes contain an unknown or empty value');
  }

  consumeValidation(principal: Principal): void {
    const transaction = this.db.transaction(() => {
      const current = this.db
        .prepare('SELECT validation_count FROM usage_monthly WHERE tenant_id=? AND month=?')
        .get(principal.tenantId, month()) as Row | undefined;
      if (Number(current?.validation_count ?? 0) >= principal.monthlyLimit)
        throw new ManagedError(429, 'monthly_quota_exceeded', 'monthly validation quota exceeded');
      this.db
        .prepare(
          `INSERT INTO usage_monthly(tenant_id,month,validation_count) VALUES(?,?,1) ON CONFLICT(tenant_id,month) DO UPDATE SET validation_count=validation_count+1`,
        )
        .run(principal.tenantId, month());
    });
    transaction();
  }

  recordDecision(principal: Principal, decision: GuardDecision): void {
    const envelope = decision.audit;
    this.db.transaction(() => {
      const previous = this.db
        .prepare(
          'SELECT event_hash FROM audit_events WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1',
        )
        .get(principal.tenantId) as Row | undefined;
      const anchor = this.db
        .prepare('SELECT last_deleted_hash FROM audit_chain_anchors WHERE tenant_id=?')
        .get(principal.tenantId) as Row | undefined;
      const previousHash = text(previous?.event_hash, text(anchor?.last_deleted_hash, 'GENESIS'));
      const eventBody = {
        tenant_id: principal.tenantId,
        audit: envelope,
        previous_hash: previousHash,
      };
      const eventHash = hmac(this.config.masterSecret, 'audit-event-hash-v1', eventBody);
      const signature = hmac(this.config.masterSecret, 'audit-event-signature-v1', {
        event_hash: eventHash,
        previous_hash: previousHash,
      });
      this.db
        .prepare(
          `INSERT INTO audit_events(tenant_id,audit_id,occurred_at,decision,reason_code,repair_rules_json,envelope_json,previous_hash,event_hash,signature) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          principal.tenantId,
          envelope.audit_id,
          envelope.timestamp,
          decision.decision,
          decision.decision === 'rejected' ? decision.reason_code : null,
          JSON.stringify(envelope.repair_rule_ids),
          JSON.stringify(envelope),
          previousHash,
          eventHash,
          signature,
        );
      const repaired = decision.decision === 'valid_with_repair' ? 1 : 0;
      const rejected = decision.decision === 'rejected' ? 1 : 0;
      this.db
        .prepare(
          `UPDATE usage_monthly SET repair_count=repair_count+?, rejection_count=rejection_count+? WHERE tenant_id=? AND month=?`,
        )
        .run(repaired, rejected, principal.tenantId, month());
      const category =
        decision.decision === 'valid_with_repair'
          ? `repair:${envelope.repair_rule_ids.join('+')}`
          : decision.decision === 'rejected'
            ? `reject:${decision.reason_code}`
            : 'valid';
      const signatureKey = sha256({ category, rules: envelope.repair_rule_ids });
      this.db
        .prepare(
          `INSERT INTO compatibility_signatures(tenant_id,signature,category,count,last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,signature) DO UPDATE SET count=count+1,last_seen_at=excluded.last_seen_at`,
        )
        .run(principal.tenantId, signatureKey, category, 1, now());
      if (decision.decision === 'rejected')
        this.insertAlert(principal.tenantId, 'validation_rejected', 'warning', {
          audit_id: decision.audit_id,
          reason_code: decision.reason_code,
        });
    })();
  }
  recordValidation(
    principal: Principal,
    decision: GuardDecision,
    context: ObservationContext = {},
  ): void {
    this.db.transaction(() => {
      this.consumeValidation(principal);
      this.recordDecision(principal, decision);
      this.recordFailureCluster(principal, decision, context);
    })();
  }

  private recordFailureCluster(
    principal: Principal,
    decision: GuardDecision,
    context: ObservationContext,
  ): void {
    const adapter = context.adapter ?? 'json_schema';
    const provider = context.provider ?? 'unspecified';
    const framework = context.framework ?? adapter;
    const signature = extractFailureSignature({
      adapter,
      provider,
      framework,
      decision: decision.decision,
      ...(decision.decision === 'rejected'
        ? {
            reason_code: decision.reason_code,
            validation_issues: decision.validation_errors,
          }
        : {}),
      repair_rule_ids: decision.repaired_fields.map((repair) => repair.rule_id),
    });
    if (!signature) return;
    const existing = this.db
      .prepare(
        'SELECT affected_versions_json FROM failure_clusters WHERE tenant_id=? AND signature=?',
      )
      .get(principal.tenantId, signature.id) as Row | undefined;
    const versions = new Set<string>(
      Array.isArray(parse(existing?.affected_versions_json))
        ? (parse(existing?.affected_versions_json) as string[])
        : [],
    );
    if (context.provider_version) versions.add(context.provider_version);
    const observedAt = now();
    this.db
      .prepare(
        `INSERT INTO failure_clusters(tenant_id,signature,category,adapter,provider,framework,reason_code,repair_rules_json,issue_shapes_json,event_count,first_seen_at,last_seen_at,affected_versions_json)
         VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)
         ON CONFLICT(tenant_id,signature) DO UPDATE SET
           event_count=event_count+1,
           last_seen_at=excluded.last_seen_at,
           affected_versions_json=excluded.affected_versions_json`,
      )
      .run(
        principal.tenantId,
        signature.id,
        signature.category,
        signature.adapter,
        signature.provider,
        signature.framework,
        signature.reason_code ?? null,
        JSON.stringify(signature.repair_rule_ids),
        JSON.stringify(signature.issue_shapes),
        observedAt,
        observedAt,
        JSON.stringify([...versions].sort()),
      );
  }

  listAudits(principal: Principal, limit = 100): Row[] {
    const rows = this.db
      .prepare(
        `SELECT sequence,audit_id,occurred_at,decision,reason_code,repair_rules_json,envelope_json,event_hash,previous_hash,signature FROM audit_events WHERE tenant_id=? ORDER BY sequence DESC LIMIT ?`,
      )
      .all(principal.tenantId, Math.min(Math.max(limit, 1), 1000)) as Row[];
    return rows.map((row) => {
      const envelope = parse(row.envelope_json) as AuditEnvelope;
      return {
        sequence: row.sequence,
        audit_id: envelope.audit_id,
        occurred_at: envelope.timestamp,
        decision: envelope.decision,
        reason_code: envelope.reason_code ?? null,
        repair_rules: envelope.repair_rule_ids,
        envelope,
        event_hash: row.event_hash,
        previous_hash: row.previous_hash,
        signature: row.signature,
      };
    });
  }
  verifyAuditChain(principal: Principal): {
    valid: boolean;
    checked: number;
    first_invalid_sequence?: number;
    anchor_invalid?: boolean;
  } {
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY sequence ASC')
      .all(principal.tenantId) as Row[];
    const anchor = this.db
      .prepare(
        'SELECT last_deleted_hash,deleted_through_sequence,signature FROM audit_chain_anchors WHERE tenant_id=?',
      )
      .get(principal.tenantId) as Row | undefined;
    if (anchor) {
      const expectedAnchorSignature = this.auditAnchorSignature(
        principal.tenantId,
        text(anchor.last_deleted_hash),
        Number(anchor.deleted_through_sequence),
      );
      if (!constantTimeEqual(text(anchor.signature), expectedAnchorSignature))
        return { valid: false, checked: 0, anchor_invalid: true };
    }
    let previousHash = text(anchor?.last_deleted_hash, 'GENESIS');
    for (const row of rows) {
      let envelope: AuditEnvelope;
      try {
        envelope = parse(row.envelope_json) as AuditEnvelope;
      } catch {
        return {
          valid: false,
          checked: rows.indexOf(row),
          first_invalid_sequence: Number(row.sequence),
        };
      }
      const body = { tenant_id: principal.tenantId, audit: envelope, previous_hash: previousHash };
      const expectedHash = hmac(this.config.masterSecret, 'audit-event-hash-v1', body);
      const expectedSignature = hmac(this.config.masterSecret, 'audit-event-signature-v1', {
        event_hash: expectedHash,
        previous_hash: previousHash,
      });
      if (
        !constantTimeEqual(expectedHash, String(row.event_hash)) ||
        !constantTimeEqual(expectedSignature, String(row.signature)) ||
        text(row.previous_hash) !== previousHash ||
        text(row.audit_id) !== envelope.audit_id ||
        text(row.occurred_at) !== envelope.timestamp ||
        text(row.decision) !== envelope.decision ||
        (row.reason_code === null ? undefined : text(row.reason_code)) !== envelope.reason_code ||
        !sameStringArray(parse(row.repair_rules_json), envelope.repair_rule_ids)
      )
        return {
          valid: false,
          checked: rows.indexOf(row),
          first_invalid_sequence: Number(row.sequence),
        };
      previousHash = text(row.event_hash);
    }
    return { valid: true, checked: rows.length };
  }

  registerSchema(
    principal: Principal,
    input: { tool_name: string; adapter: string; version: string; schema: object | boolean },
  ): { schema_hash: string; drift: unknown } {
    const toolHash = hmac(
      this.config.masterSecret,
      `tool-name:${principal.tenantId}`,
      input.tool_name,
    );
    const prior = this.db
      .prepare(
        'SELECT schema_json FROM tool_schemas WHERE tenant_id=? AND tool_name_hash=? ORDER BY id DESC LIMIT 1',
      )
      .get(principal.tenantId, toolHash) as Row | undefined;
    const drift = prior
      ? detectSchemaDrift(parse(prior.schema_json) as object | boolean, input.schema)
      : null;
    const schemaHash = sha256(input.schema);
    this.db
      .prepare(
        'INSERT INTO tool_schemas(tenant_id,tool_name_hash,adapter,version,schema_hash,schema_json,drift_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        principal.tenantId,
        toolHash,
        input.adapter,
        input.version,
        schemaHash,
        JSON.stringify(input.schema),
        drift ? JSON.stringify(drift) : null,
        now(),
      );
    if (drift?.changed) {
      this.db
        .prepare(
          `INSERT INTO usage_monthly(tenant_id,month,drift_count) VALUES(?,?,1) ON CONFLICT(tenant_id,month) DO UPDATE SET drift_count=drift_count+1`,
        )
        .run(principal.tenantId, month());
      const category = `drift:${drift.changes
        .map((change) => change.kind)
        .sort()
        .join('+')}`;
      const signature = sha256({ adapter: input.adapter, category });
      this.db
        .prepare(
          `INSERT INTO compatibility_signatures(tenant_id,signature,category,count,last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,signature) DO UPDATE SET count=count+1,last_seen_at=excluded.last_seen_at`,
        )
        .run(principal.tenantId, signature, category, 1, now());
      if (drift.compatibility === 'breaking')
        this.insertAlert(principal.tenantId, 'breaking_schema_drift', 'critical', {
          tool_name_hash: toolHash,
          version: input.version,
          changes: drift.changes.map((change) => change.kind),
        });
    }
    return { schema_hash: schemaHash, drift };
  }

  aggregateIntelligence(): Row[] {
    const threshold = this.config.aggregateTenantThreshold ?? 3;
    return this.db
      .prepare(
        `SELECT signature,category,SUM(count) event_count,COUNT(DISTINCT tenant_id) tenant_count,MAX(last_seen_at) last_seen_at FROM compatibility_signatures GROUP BY signature,category HAVING COUNT(DISTINCT tenant_id)>=? ORDER BY event_count DESC`,
      )
      .all(threshold) as Row[];
  }

  aggregateFailureIntelligence(): Row[] {
    const threshold = this.config.aggregateTenantThreshold ?? 3;
    const rows = this.db
      .prepare(
        `SELECT signature,category,adapter,provider,framework,reason_code,repair_rules_json,issue_shapes_json,event_count,first_seen_at,last_seen_at,affected_versions_json
         FROM failure_clusters
         WHERE signature IN (
           SELECT signature FROM failure_clusters
           GROUP BY signature HAVING COUNT(DISTINCT tenant_id)>=?
         )
         ORDER BY signature ASC`,
      )
      .all(threshold) as Row[];
    const aggregate = new Map<string, Row>();
    for (const row of rows) {
      const signature = text(row.signature);
      const current = aggregate.get(signature);
      const versions = new Set<string>([
        ...((current?.affected_versions as string[] | undefined) ?? []),
        ...(parse(row.affected_versions_json) as string[]),
      ]);
      aggregate.set(signature, {
        id: signature,
        category: row.category,
        adapter: row.adapter,
        provider: row.provider,
        framework: row.framework,
        reason_code: row.reason_code,
        repair_rule_ids: parse(row.repair_rules_json),
        issue_shapes: parse(row.issue_shapes_json),
        event_count: Number(current?.event_count ?? 0) + Number(row.event_count),
        tenant_count: Number(current?.tenant_count ?? 0) + 1,
        first_seen_at:
          current && text(current.first_seen_at) < text(row.first_seen_at)
            ? current.first_seen_at
            : row.first_seen_at,
        last_seen_at:
          current && text(current.last_seen_at) > text(row.last_seen_at)
            ? current.last_seen_at
            : row.last_seen_at,
        affected_versions: [...versions].sort(),
      });
    }
    return [...aggregate.values()].sort(
      (left, right) =>
        Number(right.event_count) - Number(left.event_count) ||
        text(left.id).localeCompare(text(right.id)),
    );
  }

  recordConformanceRun(
    principal: Principal,
    run: ConformanceRun,
  ): {
    recorded: boolean;
    report_hash: string;
  } {
    this.requireScope(principal, 'admin');
    // The aggregator performs the shared count and timestamp validation.
    try {
      aggregateCompatibilityMatrix([run]);
    } catch (error) {
      throw new ManagedError(
        400,
        'invalid_conformance_run',
        error instanceof Error ? error.message : 'conformance run is invalid',
      );
    }
    const fields = [
      run.provider,
      run.provider_version,
      run.framework,
      run.framework_version,
      run.suite_version,
    ];
    if (
      fields.some(
        (value) => typeof value !== 'string' || value.length === 0 || value.length > 128,
      ) ||
      !['json_schema', 'mcp', 'openai_agents', 'pydantic_ai', 'google_adk'].includes(run.adapter) ||
      (run.failure_signature_ids !== undefined && !Array.isArray(run.failure_signature_ids)) ||
      (run.failure_signature_ids ?? []).some(
        (signature) => typeof signature !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(signature),
      )
    )
      throw new ManagedError(
        400,
        'invalid_conformance_run',
        'conformance metadata or failure signatures are invalid',
      );
    const normalized: ConformanceRun = {
      ...run,
      executed_at: new Date(run.executed_at).toISOString(),
      failure_signature_ids: [...new Set(run.failure_signature_ids ?? [])].sort(),
    };
    const reportHash = sha256(normalized);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO conformance_runs(tenant_id,provider,provider_version,framework,framework_version,adapter,suite_version,executed_at,passed,failed,repaired,rejected,failure_signature_ids_json,report_hash,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        principal.tenantId,
        normalized.provider,
        normalized.provider_version,
        normalized.framework,
        normalized.framework_version,
        normalized.adapter,
        normalized.suite_version,
        normalized.executed_at,
        normalized.passed,
        normalized.failed,
        normalized.repaired,
        normalized.rejected,
        JSON.stringify(normalized.failure_signature_ids),
        reportHash,
        now(),
      );
    return { recorded: result.changes === 1, report_hash: reportHash };
  }

  tenantIntelligence(principal: Principal): Row {
    this.requireScope(principal, 'read:intelligence');
    const clusters = (
      this.db
        .prepare(
          `SELECT signature,category,adapter,provider,framework,reason_code,repair_rules_json,issue_shapes_json,event_count,first_seen_at,last_seen_at,affected_versions_json
           FROM failure_clusters WHERE tenant_id=? ORDER BY event_count DESC,last_seen_at DESC,signature ASC`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row): FailureCluster => ({
      id: text(row.signature),
      category: text(row.category) as FailureCluster['category'],
      adapter: text(row.adapter) as AdapterName,
      provider: text(row.provider),
      framework: text(row.framework),
      ...(row.reason_code === null
        ? {}
        : {
            reason_code: text(row.reason_code) as NonNullable<FailureCluster['reason_code']>,
          }),
      repair_rule_ids: parse(row.repair_rules_json) as FailureCluster['repair_rule_ids'],
      issue_shapes: parse(row.issue_shapes_json) as string[],
      event_count: Number(row.event_count),
      first_seen_at: text(row.first_seen_at),
      last_seen_at: text(row.last_seen_at),
      affected_versions: parse(row.affected_versions_json) as string[],
    }));
    const schemas = (
      this.db
        .prepare(
          `SELECT s.tool_name_hash,s.adapter,s.version,s.schema_hash,s.schema_json,s.drift_json,s.created_at
           FROM tool_schemas s
           WHERE s.tenant_id=? AND NOT EXISTS (
             SELECT 1 FROM tool_schemas newer
             WHERE newer.tenant_id=s.tenant_id AND newer.tool_name_hash=s.tool_name_hash AND newer.id>s.id
           )
           ORDER BY s.created_at DESC,s.id DESC`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row) => {
      const quality = scoreSchemaQuality(parse(row.schema_json) as object | boolean);
      const drift = row.drift_json === null ? null : (parse(row.drift_json) as DriftReport);
      return {
        tool_name_hash: row.tool_name_hash,
        adapter: row.adapter,
        version: row.version,
        schema_hash: row.schema_hash,
        created_at: row.created_at,
        quality,
        drift,
      };
    });
    const runs = (
      this.db
        .prepare(
          `SELECT provider,provider_version,framework,framework_version,adapter,suite_version,executed_at,passed,failed,repaired,rejected,failure_signature_ids_json
           FROM conformance_runs WHERE tenant_id=? ORDER BY executed_at DESC,id DESC`,
        )
        .all(principal.tenantId) as Row[]
    ).map((row): ConformanceRun => ({
      provider: text(row.provider),
      provider_version: text(row.provider_version),
      framework: text(row.framework),
      framework_version: text(row.framework_version),
      adapter: text(row.adapter) as AdapterName,
      suite_version: text(row.suite_version),
      executed_at: text(row.executed_at),
      passed: Number(row.passed),
      failed: Number(row.failed),
      repaired: Number(row.repaired),
      rejected: Number(row.rejected),
      failure_signature_ids: parse(row.failure_signature_ids_json) as string[],
    }));
    const severityRank = { critical: 0, warning: 1, info: 2 } as const;
    const recommendations = [
      ...recommendFixes({ clusters }).map((recommendation) => ({
        ...recommendation,
        source: 'failure_clusters' as const,
      })),
      ...schemas.flatMap((schema) =>
        recommendFixes({
          quality: schema.quality,
          ...(schema.drift === null ? {} : { drift: schema.drift }),
        }).map((recommendation) => ({
          ...recommendation,
          source: 'schema_registry' as const,
          tool_name_hash: schema.tool_name_hash,
          schema_hash: schema.schema_hash,
        })),
      ),
    ]
      .filter(
        (recommendation, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.code === recommendation.code &&
              candidate.path === recommendation.path &&
              candidate.message === recommendation.message &&
              candidate.source === recommendation.source &&
              ('tool_name_hash' in candidate ? candidate.tool_name_hash : undefined) ===
                ('tool_name_hash' in recommendation ? recommendation.tool_name_hash : undefined),
          ) === index,
      )
      .sort(
        (left, right) =>
          severityRank[left.severity] - severityRank[right.severity] ||
          left.code.localeCompare(right.code) ||
          left.path.localeCompare(right.path),
      );
    return {
      failure_clusters: clusters,
      schema_quality: schemas,
      compatibility_matrix: aggregateCompatibilityMatrix(runs),
      recommendations,
    };
  }
  usage(principal: Principal): Row {
    return (
      (this.db
        .prepare('SELECT * FROM usage_monthly WHERE tenant_id=? AND month=?')
        .get(principal.tenantId, month()) as Row | undefined) ?? {
        tenant_id: principal.tenantId,
        month: month(),
        validation_count: 0,
        repair_count: 0,
        rejection_count: 0,
        drift_count: 0,
      }
    );
  }

  publishRuleset(
    principal: Principal,
    input: Omit<SignedRuleSet, 'key_id' | 'public_key' | 'signature'>,
  ): SignedRuleSet {
    this.requireScope(principal, 'admin');
    this.assertRuleset(input);
    const key = this.db
      .prepare(
        'SELECT id,public_key_pem,encrypted_private_key FROM signing_keys ORDER BY created_at DESC LIMIT 1',
      )
      .get() as Row;
    const body = { ...input, key_id: text(key.id), public_key: text(key.public_key_pem) };
    const signed: SignedRuleSet = {
      ...body,
      signature: signRuleset(this.config.masterSecret, text(key.encrypted_private_key), body),
    };
    this.db
      .prepare(
        'INSERT INTO tenant_rulesets(tenant_id,version,body_json,issued_at,expires_at,signature) VALUES(?,?,?,?,?,?)',
      )
      .run(
        principal.tenantId,
        signed.version,
        JSON.stringify(signed),
        signed.issued_at,
        signed.expires_at,
        signed.signature,
      );
    return signed;
  }
  latestRuleset(principal: Principal): SignedRuleSet | undefined {
    const row = this.db
      .prepare(
        'SELECT body_json FROM tenant_rulesets WHERE tenant_id=? AND julianday(issued_at)<=julianday(?) AND julianday(expires_at)>julianday(?) ORDER BY julianday(issued_at) DESC LIMIT 1',
      )
      .get(principal.tenantId, now(), now()) as Row | undefined;
    return row ? (parse(row.body_json) as SignedRuleSet) : undefined;
  }
  verifyRuleset(ruleset: SignedRuleSet): boolean {
    if (Date.parse(ruleset.expires_at) <= Date.now()) return false;
    const key = this.db
      .prepare('SELECT id,public_key_pem,trust_hmac FROM signing_keys WHERE id=?')
      .get(ruleset.key_id) as Row | undefined;
    if (!key || text(key.public_key_pem) !== ruleset.public_key) return false;
    const expectedTrust = hmac(this.config.masterSecret, 'signing-key-trust-v1', {
      id: key.id,
      public_key: key.public_key_pem,
    });
    if (!constantTimeEqual(text(key.trust_hmac), expectedTrust)) return false;
    const { signature } = ruleset;
    const body = {
      version: ruleset.version,
      issued_at: ruleset.issued_at,
      expires_at: ruleset.expires_at,
      rules: ruleset.rules,
      key_id: ruleset.key_id,
      public_key: ruleset.public_key,
    };
    return verifyRulesetSignature(ruleset.public_key, body, signature);
  }
  private assertRuleset(input: Omit<SignedRuleSet, 'key_id' | 'public_key' | 'signature'>): void {
    const issued = Date.parse(input.issued_at);
    const expires = Date.parse(input.expires_at);
    const knownRules = new Set([
      'coerce.string_to_number',
      'coerce.string_to_integer',
      'coerce.string_to_boolean',
      'coerce.singleton_to_array',
    ]);
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      input.version.length === 0 ||
      input.version.length > 128 ||
      issued > Date.now() + 300_000 ||
      expires <= issued ||
      expires <= Date.now() ||
      !input.rules.length ||
      input.rules.some(
        (rule) =>
          !knownRules.has(rule.id) ||
          typeof rule.enabled_by_default !== 'boolean' ||
          typeof rule.description !== 'string' ||
          rule.description.length === 0 ||
          rule.description.length > 500,
      ) ||
      new Set(input.rules.map((rule) => rule.id)).size !== input.rules.length
    )
      throw new ManagedError(
        400,
        'invalid_ruleset',
        'ruleset dates or repair rule declarations are invalid',
      );
  }

  alerts(principal: Principal): Row[] {
    const rows = this.db
      .prepare(
        'SELECT id,kind,severity,detail_json,created_at,acknowledged_at FROM alerts WHERE tenant_id=? ORDER BY id DESC LIMIT 100',
      )
      .all(principal.tenantId) as Row[];
    return rows.map(({ detail_json, ...row }) => ({ ...row, detail: parse(detail_json) }));
  }
  private insertAlert(tenantId: string, kind: string, severity: string, detail: unknown): void {
    const createdAt = now();
    this.db
      .prepare(
        'INSERT INTO alerts(tenant_id,kind,severity,detail_json,created_at) VALUES(?,?,?,?,?)',
      )
      .run(tenantId, kind, severity, JSON.stringify(detail), createdAt);
    if (this.config.alertFile)
      void this.appendAlert({ tenant_id: tenantId, kind, severity, detail, created_at: createdAt });
  }
  private async appendAlert(alert: unknown): Promise<void> {
    if (!this.config.alertFile) return;
    await mkdir(dirname(this.config.alertFile), { recursive: true, mode: 0o700 });
    await appendFile(this.config.alertFile, `${JSON.stringify(alert)}\n`, { mode: 0o600 });
    await chmod(this.config.alertFile, 0o600);
  }
  purgeExpired(principal: Principal): number {
    this.requireScope(principal, 'admin');
    if (!this.verifyAuditChain(principal).valid)
      throw new ManagedError(
        409,
        'audit_chain_invalid',
        'refusing to purge an invalid audit chain',
      );
    return this.db.transaction(() => {
      let deleted = 0;
      const cutoff = new Date(Date.now() - principal.retentionDays * 86_400_000).toISOString();
      const boundary = this.db
        .prepare(
          `SELECT sequence,event_hash FROM audit_events WHERE tenant_id=? AND json_valid(envelope_json) AND json_extract(envelope_json,'$.timestamp')<? ORDER BY sequence DESC LIMIT 1`,
        )
        .get(principal.tenantId, cutoff) as Row | undefined;
      if (!boundary) return 0;
      const result = this.db
        .prepare('DELETE FROM audit_events WHERE tenant_id=? AND sequence<=?')
        .run(principal.tenantId, Number(boundary.sequence));
      const anchorSignature = this.auditAnchorSignature(
        principal.tenantId,
        String(boundary.event_hash),
        Number(boundary.sequence),
      );
      this.db
        .prepare(
          `INSERT INTO audit_chain_anchors(tenant_id,last_deleted_hash,deleted_through_sequence,updated_at,signature) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET last_deleted_hash=excluded.last_deleted_hash,deleted_through_sequence=excluded.deleted_through_sequence,updated_at=excluded.updated_at,signature=excluded.signature`,
        )
        .run(
          principal.tenantId,
          String(boundary.event_hash),
          Number(boundary.sequence),
          now(),
          anchorSignature,
        );
      deleted += result.changes;
      return deleted;
    })();
  }
}

function sameStringArray(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export class ManagedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
