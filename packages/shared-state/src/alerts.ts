import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { isIP } from 'node:net';
import { Pool, type PoolClient } from 'pg';
import { canonicalJson, sha256 } from '@schema-guard/core';
import { SharedStateIntegrityError } from './postgres.js';

export interface SharedAlert {
  id: number;
  alert_id: string;
  kind: string;
  severity: string;
  detail: Record<string, unknown>;
  created_at: string;
  acknowledged_at: null;
}
export interface SharedAlertWebhook {
  webhook_id: string;
  label: string;
  endpoint_hash: string;
  created_at: string;
  disabled_at: string | null;
}
export interface SharedAlertDelivery {
  delivery_id: string;
  webhook_id: string;
  alert_id: number;
  status: 'pending' | 'processing' | 'delivered' | 'dead';
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  delivered_at: string | null;
  response_status: number | null;
  error_code: string | null;
  created_at: string;
}
export interface SharedAlertClaim {
  deliveryId: string;
  leaseId: string;
  endpoint: string;
  signingSecret: string;
  payload: string;
  attemptCount: number;
}
export interface AlertState {
  migrate(): Promise<void>;
  ready(): Promise<boolean>;
  bootstrapTenant(tenantId: string): Promise<void>;
  recordAlert(
    tenantId: string,
    kind: string,
    severity: string,
    detail: unknown,
    sourceKey: string,
  ): Promise<SharedAlert>;
  listAlerts(tenantId: string, limit?: number): Promise<SharedAlert[]>;
  createWebhook(
    tenantId: string,
    label: string,
    normalizedEndpoint: string,
  ): Promise<SharedAlertWebhook & { signing_secret: string }>;
  listWebhooks(tenantId: string): Promise<SharedAlertWebhook[]>;
  disableWebhook(tenantId: string, webhookId: string): Promise<boolean>;
  listDeliveries(tenantId: string, limit?: number): Promise<SharedAlertDelivery[]>;
  redriveDelivery(tenantId: string, deliveryId: string): Promise<boolean>;
  claimDeliveries(limit: number): Promise<SharedAlertClaim[]>;
  finishDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): Promise<'delivered' | 'pending' | 'dead' | undefined>;
  verifyTenant(tenantId: string): Promise<{ valid: boolean; checked: number }>;
  close(): Promise<void>;
}
export interface TransactionalAlertWriter {
  recordAlertWithClient(
    client: PoolClient,
    tenantId: string,
    kind: string,
    severity: string,
    detail: unknown,
    sourceKey: string,
  ): Promise<SharedAlert>;
}

type ManifestRow = {
  tenant_id: string;
  revision: string;
  alert_count: string;
  webhook_count: string;
  tip_hash: string;
  updated_at: Date;
  control_hmac: string;
};
type AlertRow = {
  sequence: string;
  alert_id: string;
  tenant_id: string;
  source_key_hash: string;
  kind: string;
  severity: string;
  detail_json: string;
  expected_delivery_count: number;
  created_at: Date;
  previous_hash: string;
  record_hash: string;
};
type WebhookRow = {
  webhook_id: string;
  tenant_id: string;
  label: string;
  endpoint_hash: string;
  encrypted_endpoint: string;
  encrypted_signing_secret: string;
  created_at: Date;
  disabled_at: Date | null;
  control_hmac: string;
};
type DeliveryRow = {
  delivery_id: string;
  tenant_id: string;
  webhook_id: string;
  alert_id: string;
  payload_json: string;
  payload_hmac: string;
  status: SharedAlertDelivery['status'];
  attempt_count: number;
  next_attempt_at: Date;
  last_attempt_at: Date | null;
  delivered_at: Date | null;
  response_status: number | null;
  error_code: string | null;
  lease_id: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  state_hmac: string;
};

const DDL = `
  CREATE TABLE IF NOT EXISTS sg_alert_state_migrations (
    version INTEGER PRIMARY KEY,migration_name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_alert_manifests (
    tenant_id TEXT PRIMARY KEY REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK(revision>=0),alert_count BIGINT NOT NULL CHECK(alert_count>=0),
    webhook_count BIGINT NOT NULL CHECK(webhook_count>=0),tip_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,control_hmac TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sg_alerts (
    sequence BIGSERIAL PRIMARY KEY,alert_id TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    source_key_hash TEXT NOT NULL,kind TEXT NOT NULL,severity TEXT NOT NULL,detail_json TEXT NOT NULL,
    expected_delivery_count INTEGER NOT NULL CHECK(expected_delivery_count>=0),created_at TIMESTAMPTZ NOT NULL,
    previous_hash TEXT NOT NULL,record_hash TEXT NOT NULL,UNIQUE(tenant_id,source_key_hash)
  );
  CREATE INDEX IF NOT EXISTS sg_alerts_tenant_sequence ON sg_alerts(tenant_id,sequence DESC);
  CREATE TABLE IF NOT EXISTS sg_alert_webhooks (
    webhook_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    label TEXT NOT NULL,endpoint_hash TEXT NOT NULL,encrypted_endpoint TEXT NOT NULL,
    encrypted_signing_secret TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,disabled_at TIMESTAMPTZ,
    control_hmac TEXT NOT NULL,UNIQUE(tenant_id,label),UNIQUE(tenant_id,endpoint_hash),UNIQUE(tenant_id,webhook_id)
  );
  CREATE TABLE IF NOT EXISTS sg_alert_deliveries (
    delivery_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES sg_control_tenants(id) ON DELETE CASCADE,
    webhook_id TEXT NOT NULL,alert_id TEXT NOT NULL REFERENCES sg_alerts(alert_id) ON DELETE RESTRICT,
    payload_json TEXT NOT NULL,payload_hmac TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','processing','delivered','dead')),
    attempt_count INTEGER NOT NULL CHECK(attempt_count>=0),next_attempt_at TIMESTAMPTZ NOT NULL,
    last_attempt_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,response_status INTEGER,error_code TEXT,
    lease_id TEXT,lease_expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,state_hmac TEXT NOT NULL,
    FOREIGN KEY(tenant_id,webhook_id) REFERENCES sg_alert_webhooks(tenant_id,webhook_id) ON DELETE RESTRICT,
    UNIQUE(alert_id,webhook_id)
  );
  CREATE INDEX IF NOT EXISTS sg_alert_deliveries_due
    ON sg_alert_deliveries(status,next_attempt_at,lease_expires_at);
  CREATE INDEX IF NOT EXISTS sg_alert_deliveries_tenant
    ON sg_alert_deliveries(tenant_id,created_at DESC);
`;

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
const key = (secret: string, purpose: string): Buffer =>
  createHash('sha256')
    .update('schema-guard-shared-sealed-value-v1\0')
    .update(purpose)
    .update('\0')
    .update(secret)
    .digest();
const seal = (secret: string, purpose: string, value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
};
const open = (secret: string, purpose: string, value: string): string => {
  const packed = Buffer.from(value, 'base64url');
  if (packed.length < 29) throw new Error('sealed value is malformed');
  const decipher = createDecipheriv('aes-256-gcm', key(secret, purpose), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
};
const safeDetail = (kind: string, detail: unknown): Record<string, unknown> => {
  const source =
    detail !== null && typeof detail === 'object' && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : {};
  const allowed: Record<string, string[]> = {
    action_reconciled: [
      'reservation_id',
      'reconciliation_id',
      'audit_id',
      'outcome',
      'evidence_hash',
    ],
    breaking_schema_drift: ['tool_name_hash', 'changes'],
    schema_promoted: [
      'release_id',
      'tool_name_hash',
      'environment',
      'schema_hash',
      'compatibility',
    ],
    schema_enforcement_changed: ['environment', 'mode'],
    validation_rejected: ['audit_id', 'reason_code'],
  };
  const result: Record<string, unknown> = {};
  for (const name of allowed[kind] ?? []) {
    const value = source[name];
    if (typeof value === 'string' && value.length <= 512) result[name] = value;
    else if (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every((item) => typeof item === 'string' && item.length <= 128)
    )
      result[name] = value;
  }
  return result;
};

export class PostgresAlertState implements AlertState {
  readonly pool: Pool;
  private readonly ownsPool: boolean;
  constructor(
    databaseUrl: string,
    private readonly masterSecret: string,
    pool?: Pool,
    private readonly maxAttempts = 8,
  ) {
    this.ownsPool = pool === undefined;
    this.pool = pool ?? new Pool({ connectionString: databaseUrl, max: 10 });
    if (
      masterSecret.length < 32 ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 100
    )
      throw new TypeError('shared alert max attempts is invalid');
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
  private manifestHmac(row: Omit<ManifestRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-alert-manifest-v1', {
      tenant_id: row.tenant_id,
      revision: row.revision,
      alert_count: row.alert_count,
      webhook_count: row.webhook_count,
      tip_hash: row.tip_hash,
      updated_at: row.updated_at.toISOString(),
    });
  }
  private webhookHmac(row: Omit<WebhookRow, 'control_hmac'>): string {
    return hmac(this.masterSecret, 'shared-alert-webhook-v1', {
      webhook_id: row.webhook_id,
      tenant_id: row.tenant_id,
      label: row.label,
      endpoint_hash: row.endpoint_hash,
      encrypted_endpoint: row.encrypted_endpoint,
      encrypted_signing_secret: row.encrypted_signing_secret,
      created_at: row.created_at.toISOString(),
      disabled_at: row.disabled_at?.toISOString() ?? null,
    });
  }
  private alertHash(row: Omit<AlertRow, 'sequence' | 'record_hash'>): string {
    return hmac(this.masterSecret, 'shared-alert-record-v1', {
      ...row,
      created_at: row.created_at.toISOString(),
    });
  }
  private payloadHmac(
    row: Pick<
      DeliveryRow,
      'delivery_id' | 'tenant_id' | 'webhook_id' | 'alert_id' | 'payload_json' | 'created_at'
    >,
  ): string {
    return hmac(this.masterSecret, 'shared-alert-delivery-payload-v1', {
      delivery_id: row.delivery_id,
      tenant_id: row.tenant_id,
      webhook_id: row.webhook_id,
      alert_id: row.alert_id,
      payload_json: row.payload_json,
      created_at: row.created_at.toISOString(),
    });
  }
  private stateHmac(row: Omit<DeliveryRow, 'state_hmac'>): string {
    return hmac(this.masterSecret, 'shared-alert-delivery-state-v1', {
      delivery_id: row.delivery_id,
      tenant_id: row.tenant_id,
      webhook_id: row.webhook_id,
      alert_id: row.alert_id,
      payload_json: row.payload_json,
      payload_hmac: row.payload_hmac,
      status: row.status,
      attempt_count: row.attempt_count,
      next_attempt_at: row.next_attempt_at.toISOString(),
      last_attempt_at: row.last_attempt_at?.toISOString() ?? null,
      delivered_at: row.delivered_at?.toISOString() ?? null,
      response_status: row.response_status,
      error_code: row.error_code,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    });
  }
  private assertManifest(row: ManifestRow): void {
    if (
      !/^\d+$/u.test(row.revision) ||
      !/^\d+$/u.test(row.alert_count) ||
      !/^\d+$/u.test(row.webhook_count) ||
      !equal(row.control_hmac, this.manifestHmac(row))
    )
      throw new SharedStateIntegrityError('shared alert manifest integrity failed');
  }
  private assertWebhook(row: WebhookRow): void {
    if (!equal(row.control_hmac, this.webhookHmac(row)))
      throw new SharedStateIntegrityError('shared alert webhook integrity failed');
  }
  private assertDelivery(row: DeliveryRow): void {
    if (
      !equal(row.payload_hmac, this.payloadHmac(row)) ||
      !equal(row.state_hmac, this.stateHmac(row))
    )
      throw new SharedStateIntegrityError('shared alert delivery integrity failed');
  }
  private alertFrom(row: AlertRow): SharedAlert {
    return {
      id: Number(row.sequence),
      alert_id: row.alert_id,
      kind: row.kind,
      severity: row.severity,
      detail: JSON.parse(row.detail_json) as Record<string, unknown>,
      created_at: row.created_at.toISOString(),
      acknowledged_at: null,
    };
  }
  private deliveryFrom(row: DeliveryRow, alertSequence: number): SharedAlertDelivery {
    return {
      delivery_id: row.delivery_id,
      webhook_id: row.webhook_id,
      alert_id: alertSequence,
      status: row.status,
      attempt_count: row.attempt_count,
      next_attempt_at: row.next_attempt_at.toISOString(),
      last_attempt_at: row.last_attempt_at?.toISOString() ?? null,
      delivered_at: row.delivered_at?.toISOString() ?? null,
      response_status: row.response_status,
      error_code: row.error_code,
      created_at: row.created_at.toISOString(),
    };
  }
  private async verifyWith(
    client: PoolClient,
    tenantId: string,
    lock = false,
  ): Promise<{ valid: boolean; checked: number }> {
    const suffix = lock ? ' FOR UPDATE' : '';
    const manifest = (
      await client.query<ManifestRow>(
        `SELECT * FROM sg_alert_manifests WHERE tenant_id=$1${suffix}`,
        [tenantId],
      )
    ).rows[0];
    if (!manifest) return { valid: false, checked: 0 };
    try {
      this.assertManifest(manifest);
    } catch {
      return { valid: false, checked: 0 };
    }
    const webhooks = (
      await client.query<WebhookRow>(
        `SELECT * FROM sg_alert_webhooks WHERE tenant_id=$1 ORDER BY webhook_id${suffix}`,
        [tenantId],
      )
    ).rows;
    if (BigInt(webhooks.length) !== BigInt(manifest.webhook_count))
      return { valid: false, checked: 0 };
    try {
      for (const row of webhooks) this.assertWebhook(row);
    } catch {
      return { valid: false, checked: 0 };
    }
    const alerts = (
      await client.query<AlertRow>(
        `SELECT * FROM sg_alerts WHERE tenant_id=$1 ORDER BY sequence${suffix}`,
        [tenantId],
      )
    ).rows;
    if (BigInt(alerts.length) !== BigInt(manifest.alert_count)) return { valid: false, checked: 0 };
    let previous = 'GENESIS';
    for (let index = 0; index < alerts.length; index += 1) {
      const row = alerts[index]!;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.detail_json) as unknown;
      } catch {
        return { valid: false, checked: index };
      }
      const unsigned = {
        alert_id: row.alert_id,
        tenant_id: row.tenant_id,
        source_key_hash: row.source_key_hash,
        kind: row.kind,
        severity: row.severity,
        detail_json: row.detail_json,
        expected_delivery_count: row.expected_delivery_count,
        created_at: row.created_at,
        previous_hash: row.previous_hash,
      };
      if (
        canonicalJson(parsed) !== row.detail_json ||
        canonicalJson(safeDetail(row.kind, parsed)) !== row.detail_json ||
        row.previous_hash !== previous ||
        row.record_hash !== this.alertHash(unsigned)
      )
        return { valid: false, checked: index };
      previous = row.record_hash;
      const deliveries = (
        await client.query<DeliveryRow>(
          `SELECT * FROM sg_alert_deliveries WHERE tenant_id=$1 AND alert_id=$2 ORDER BY delivery_id${suffix}`,
          [tenantId, row.alert_id],
        )
      ).rows;
      if (deliveries.length !== row.expected_delivery_count)
        return { valid: false, checked: index };
      try {
        for (const delivery of deliveries) this.assertDelivery(delivery);
      } catch {
        return { valid: false, checked: index };
      }
    }
    return { valid: previous === manifest.tip_hash, checked: alerts.length };
  }
  async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('schema-guard-alert-state-migrations-v1'))",
      );
      await client.query(DDL);
      const checksum = sha256(DDL);
      const rows = await client.query<{ version: number; checksum: string }>(
        'SELECT version,checksum FROM sg_alert_state_migrations ORDER BY version',
      );
      if (rows.rows.some((row) => row.version !== 1 || row.checksum !== checksum))
        throw new SharedStateIntegrityError('shared alert migration history is incompatible');
      if (!rows.rows.length)
        await client.query(
          "INSERT INTO sg_alert_state_migrations(version,migration_name,checksum,applied_at) VALUES(1,'initial_alert_state',$1,$2)",
          [checksum, new Date()],
        );
    });
    const tenants = await this.pool.query<{ id: string }>(
      'SELECT id FROM sg_control_tenants ORDER BY id',
    );
    for (const { id } of tenants.rows) await this.bootstrapTenant(id);
  }
  async bootstrapTenant(tenantId: string): Promise<void> {
    await this.transaction(async (client) => {
      const tenant = (
        await client.query<{ id: string }>(
          'SELECT id FROM sg_control_tenants WHERE id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0];
      if (!tenant) throw new SharedStateIntegrityError('shared tenant is required for alerts');
      const existing = (
        await client.query<ManifestRow>(
          'SELECT * FROM sg_alert_manifests WHERE tenant_id=$1 FOR UPDATE',
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
        alert_count: '0',
        webhook_count: '0',
        tip_hash: 'GENESIS',
        updated_at: new Date(),
      };
      await client.query(
        'INSERT INTO sg_alert_manifests(tenant_id,revision,alert_count,webhook_count,tip_hash,updated_at,control_hmac) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [...Object.values(unsigned), this.manifestHmac(unsigned)],
      );
    });
  }
  async ready(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const missing = await client.query<{ count: string }>(
        `SELECT COUNT(*) count FROM sg_control_tenants t LEFT JOIN sg_alert_manifests m ON m.tenant_id=t.id WHERE m.tenant_id IS NULL`,
      );
      if (missing.rows[0]?.count !== '0') {
        await client.query('ROLLBACK');
        return false;
      }
      const tenants = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM sg_alert_manifests ORDER BY tenant_id',
      );
      for (const { tenant_id } of tenants.rows)
        if (!(await this.verifyWith(client, tenant_id)).valid) {
          await client.query('ROLLBACK');
          return false;
        }
      await client.query('COMMIT');
      return true;
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      return false;
    } finally {
      client.release();
    }
  }
  async recordAlert(
    tenantId: string,
    kind: string,
    severity: string,
    detail: unknown,
    sourceKey: string,
  ): Promise<SharedAlert> {
    return this.transaction((client) =>
      this.recordAlertWithClient(client, tenantId, kind, severity, detail, sourceKey),
    );
  }
  async recordAlertWithClient(
    client: PoolClient,
    tenantId: string,
    kind: string,
    severity: string,
    detail: unknown,
    sourceKey: string,
  ): Promise<SharedAlert> {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/u.test(kind) ||
      !['info', 'warning', 'critical'].includes(severity) ||
      sourceKey.length < 1 ||
      sourceKey.length > 512
    )
      throw new TypeError('shared alert input is invalid');
    const safe = safeDetail(kind, detail);
    const detailJson = canonicalJson(safe);
    const sourceHash = hmac(this.masterSecret, `shared-alert-source:${tenantId}`, sourceKey);
    {
      const verified = await this.verifyWith(client, tenantId, true);
      if (!verified.valid) throw new SharedStateIntegrityError('shared alert state is invalid');
      const existing = (
        await client.query<AlertRow>(
          'SELECT * FROM sg_alerts WHERE tenant_id=$1 AND source_key_hash=$2 FOR UPDATE',
          [tenantId, sourceHash],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.kind !== kind ||
          existing.severity !== severity ||
          existing.detail_json !== detailJson
        )
          throw new SharedStateIntegrityError('shared alert source conflicts');
        return this.alertFrom(existing);
      }
      const manifest = (
        await client.query<ManifestRow>(
          'SELECT * FROM sg_alert_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0]!;
      this.assertManifest(manifest);
      const webhooks = (
        await client.query<WebhookRow>(
          'SELECT * FROM sg_alert_webhooks WHERE tenant_id=$1 AND disabled_at IS NULL ORDER BY webhook_id FOR UPDATE',
          [tenantId],
        )
      ).rows;
      for (const webhook of webhooks) this.assertWebhook(webhook);
      const createdAt = new Date();
      const alertId = `alert_${randomUUID()}`;
      const unsigned = {
        alert_id: alertId,
        tenant_id: tenantId,
        source_key_hash: sourceHash,
        kind,
        severity,
        detail_json: detailJson,
        expected_delivery_count: webhooks.length,
        created_at: createdAt,
        previous_hash: manifest.tip_hash,
      };
      const recordHash = this.alertHash(unsigned);
      const inserted = (
        await client.query<AlertRow>(
          `INSERT INTO sg_alerts(alert_id,tenant_id,source_key_hash,kind,severity,detail_json,expected_delivery_count,created_at,previous_hash,record_hash)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [...Object.values(unsigned), recordHash],
        )
      ).rows[0]!;
      const payload = canonicalJson({
        schema_version: '2026-07-20',
        event_type: 'schema_guard.alert',
        event_id: alertId,
        tenant_ref: hmac(this.masterSecret, 'shared-alert-tenant-v1', tenantId),
        alert_id: Number(inserted.sequence),
        kind,
        severity,
        created_at: createdAt.toISOString(),
        detail: safe,
      });
      for (const webhook of webhooks) {
        const base: Omit<DeliveryRow, 'payload_hmac' | 'state_hmac'> = {
          delivery_id: `delivery_${randomUUID()}`,
          tenant_id: tenantId,
          webhook_id: webhook.webhook_id,
          alert_id: alertId,
          payload_json: payload,
          status: 'pending',
          attempt_count: 0,
          next_attempt_at: createdAt,
          last_attempt_at: null,
          delivered_at: null,
          response_status: null,
          error_code: null,
          lease_id: null,
          lease_expires_at: null,
          created_at: createdAt,
        };
        const payloadHmac = this.payloadHmac(base);
        const delivery = { ...base, payload_hmac: payloadHmac };
        await client.query(
          `INSERT INTO sg_alert_deliveries(delivery_id,tenant_id,webhook_id,alert_id,payload_json,payload_hmac,status,attempt_count,next_attempt_at,last_attempt_at,delivered_at,response_status,error_code,lease_id,lease_expires_at,created_at,state_hmac)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            delivery.delivery_id,
            delivery.tenant_id,
            delivery.webhook_id,
            delivery.alert_id,
            delivery.payload_json,
            delivery.payload_hmac,
            delivery.status,
            delivery.attempt_count,
            delivery.next_attempt_at,
            delivery.last_attempt_at,
            delivery.delivered_at,
            delivery.response_status,
            delivery.error_code,
            delivery.lease_id,
            delivery.lease_expires_at,
            delivery.created_at,
            this.stateHmac(delivery),
          ],
        );
      }
      const updated = {
        tenant_id: tenantId,
        revision: String(BigInt(manifest.revision) + 1n),
        alert_count: String(BigInt(manifest.alert_count) + 1n),
        webhook_count: manifest.webhook_count,
        tip_hash: recordHash,
        updated_at: createdAt,
      };
      await client.query(
        'UPDATE sg_alert_manifests SET revision=$1,alert_count=$2,webhook_count=$3,tip_hash=$4,updated_at=$5,control_hmac=$6 WHERE tenant_id=$7',
        [
          updated.revision,
          updated.alert_count,
          updated.webhook_count,
          updated.tip_hash,
          updated.updated_at,
          this.manifestHmac(updated),
          tenantId,
        ],
      );
      return this.alertFrom(inserted);
    }
  }
  async listAlerts(tenantId: string, limit = 100): Promise<SharedAlert[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (!(await this.verifyWith(client, tenantId)).valid)
        throw new SharedStateIntegrityError('shared alert state is invalid');
      const rows = await client.query<AlertRow>(
        'SELECT * FROM sg_alerts WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT $2',
        [tenantId, bounded],
      );
      return rows.rows.map((row) => this.alertFrom(row));
    });
  }
  async createWebhook(
    tenantId: string,
    label: string,
    normalizedEndpoint: string,
  ): Promise<SharedAlertWebhook & { signing_secret: string }> {
    let endpoint: URL;
    try {
      endpoint = new URL(normalizedEndpoint);
    } catch {
      throw new TypeError('shared webhook endpoint is invalid');
    }
    const hostname = endpoint.hostname.toLowerCase();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/u.test(label) ||
      normalizedEndpoint.length > 2048 ||
      endpoint.protocol !== 'https:' ||
      endpoint.username !== '' ||
      endpoint.password !== '' ||
      endpoint.hash !== '' ||
      (endpoint.port !== '' && endpoint.port !== '443') ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      !hostname.includes('.') ||
      isIP(hostname) !== 0
    )
      throw new TypeError('shared webhook input is invalid');
    return this.transaction(async (client) => {
      if (!(await this.verifyWith(client, tenantId, true)).valid)
        throw new SharedStateIntegrityError('shared alert state is invalid');
      const manifest = (
        await client.query<ManifestRow>(
          'SELECT * FROM sg_alert_manifests WHERE tenant_id=$1 FOR UPDATE',
          [tenantId],
        )
      ).rows[0]!;
      const webhookId = `wh_${randomUUID()}`;
      const signingSecret = `sgwhsec_${randomBytes(32).toString('base64url')}`;
      const endpointHash = hmac(
        this.masterSecret,
        `shared-alert-endpoint:${tenantId}`,
        endpoint.href,
      );
      const timestamp = new Date();
      const endpointPurpose = `shared-alert-endpoint-v1:${tenantId}:${webhookId}`;
      const secretPurpose = `shared-alert-secret-v1:${tenantId}:${webhookId}`;
      const unsigned = {
        webhook_id: webhookId,
        tenant_id: tenantId,
        label,
        endpoint_hash: endpointHash,
        encrypted_endpoint: seal(this.masterSecret, endpointPurpose, endpoint.href),
        encrypted_signing_secret: seal(this.masterSecret, secretPurpose, signingSecret),
        created_at: timestamp,
        disabled_at: null,
      };
      try {
        await client.query(
          `INSERT INTO sg_alert_webhooks(webhook_id,tenant_id,label,endpoint_hash,encrypted_endpoint,encrypted_signing_secret,created_at,disabled_at,control_hmac)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [...Object.values(unsigned), this.webhookHmac(unsigned)],
        );
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
          throw new TypeError('shared webhook conflicts with an existing webhook', {
            cause: error,
          });
        throw error;
      }
      const updated = {
        tenant_id: tenantId,
        revision: String(BigInt(manifest.revision) + 1n),
        alert_count: manifest.alert_count,
        webhook_count: String(BigInt(manifest.webhook_count) + 1n),
        tip_hash: manifest.tip_hash,
        updated_at: timestamp,
      };
      await client.query(
        'UPDATE sg_alert_manifests SET revision=$1,alert_count=$2,webhook_count=$3,tip_hash=$4,updated_at=$5,control_hmac=$6 WHERE tenant_id=$7',
        [
          updated.revision,
          updated.alert_count,
          updated.webhook_count,
          updated.tip_hash,
          updated.updated_at,
          this.manifestHmac(updated),
          tenantId,
        ],
      );
      return {
        webhook_id: webhookId,
        label,
        endpoint_hash: endpointHash,
        created_at: timestamp.toISOString(),
        disabled_at: null,
        signing_secret: signingSecret,
      };
    });
  }
  async listWebhooks(tenantId: string): Promise<SharedAlertWebhook[]> {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (!(await this.verifyWith(client, tenantId)).valid)
        throw new SharedStateIntegrityError('shared alert state is invalid');
      const rows = await client.query<WebhookRow>(
        'SELECT * FROM sg_alert_webhooks WHERE tenant_id=$1 ORDER BY created_at DESC',
        [tenantId],
      );
      return rows.rows.map((row) => ({
        webhook_id: row.webhook_id,
        label: row.label,
        endpoint_hash: row.endpoint_hash,
        created_at: row.created_at.toISOString(),
        disabled_at: row.disabled_at?.toISOString() ?? null,
      }));
    });
  }
  async disableWebhook(tenantId: string, webhookId: string): Promise<boolean> {
    return this.transaction(async (client) => {
      if (!(await this.verifyWith(client, tenantId, true)).valid)
        throw new SharedStateIntegrityError('shared alert state is invalid');
      const row = (
        await client.query<WebhookRow>(
          'SELECT * FROM sg_alert_webhooks WHERE tenant_id=$1 AND webhook_id=$2 FOR UPDATE',
          [tenantId, webhookId],
        )
      ).rows[0];
      if (!row) return false;
      this.assertWebhook(row);
      const disabledAt = row.disabled_at ?? new Date();
      const updatedWebhook = { ...row, disabled_at: disabledAt };
      await client.query(
        'UPDATE sg_alert_webhooks SET disabled_at=$1,control_hmac=$2 WHERE tenant_id=$3 AND webhook_id=$4',
        [disabledAt, this.webhookHmac(updatedWebhook), tenantId, webhookId],
      );
      const deliveries = await client.query<DeliveryRow>(
        `SELECT * FROM sg_alert_deliveries WHERE tenant_id=$1 AND webhook_id=$2 AND status IN ('pending','processing') FOR UPDATE`,
        [tenantId, webhookId],
      );
      for (const delivery of deliveries.rows) {
        this.assertDelivery(delivery);
        const updated: Omit<DeliveryRow, 'state_hmac'> = {
          ...delivery,
          status: 'dead',
          lease_id: null,
          lease_expires_at: null,
          error_code: 'webhook_disabled',
        };
        await client.query(
          `UPDATE sg_alert_deliveries SET status='dead',lease_id=NULL,lease_expires_at=NULL,error_code='webhook_disabled',state_hmac=$1 WHERE delivery_id=$2`,
          [this.stateHmac(updated), delivery.delivery_id],
        );
      }
      return true;
    });
  }
  async listDeliveries(tenantId: string, limit = 100): Promise<SharedAlertDelivery[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (!(await this.verifyWith(client, tenantId)).valid)
        throw new SharedStateIntegrityError('shared alert state is invalid');
      const rows = await client.query<DeliveryRow & { alert_sequence: string }>(
        `SELECT d.*,a.sequence alert_sequence FROM sg_alert_deliveries d JOIN sg_alerts a ON a.alert_id=d.alert_id
         WHERE d.tenant_id=$1 ORDER BY d.created_at DESC LIMIT $2`,
        [tenantId, bounded],
      );
      return rows.rows.map((row) => this.deliveryFrom(row, Number(row.alert_sequence)));
    });
  }
  async redriveDelivery(tenantId: string, deliveryId: string): Promise<boolean> {
    return this.transaction(async (client) => {
      if (!(await this.verifyWith(client, tenantId, true)).valid)
        throw new SharedStateIntegrityError('shared alert state is invalid');
      const delivery = (
        await client.query<DeliveryRow>(
          'SELECT * FROM sg_alert_deliveries WHERE tenant_id=$1 AND delivery_id=$2 FOR UPDATE',
          [tenantId, deliveryId],
        )
      ).rows[0];
      if (!delivery || delivery.status !== 'dead') return false;
      this.assertDelivery(delivery);
      const webhook = (
        await client.query<WebhookRow>(
          'SELECT * FROM sg_alert_webhooks WHERE tenant_id=$1 AND webhook_id=$2 FOR UPDATE',
          [tenantId, delivery.webhook_id],
        )
      ).rows[0];
      if (!webhook || webhook.disabled_at) return false;
      this.assertWebhook(webhook);
      const updated: Omit<DeliveryRow, 'state_hmac'> = {
        ...delivery,
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: new Date(),
        last_attempt_at: null,
        delivered_at: null,
        response_status: null,
        error_code: null,
        lease_id: null,
        lease_expires_at: null,
      };
      await client.query(
        `UPDATE sg_alert_deliveries SET status=$1,attempt_count=$2,next_attempt_at=$3,last_attempt_at=$4,
         delivered_at=$5,response_status=$6,error_code=$7,lease_id=$8,lease_expires_at=$9,state_hmac=$10 WHERE delivery_id=$11`,
        [
          updated.status,
          updated.attempt_count,
          updated.next_attempt_at,
          updated.last_attempt_at,
          updated.delivered_at,
          updated.response_status,
          updated.error_code,
          updated.lease_id,
          updated.lease_expires_at,
          this.stateHmac(updated),
          deliveryId,
        ],
      );
      return true;
    });
  }
  async claimDeliveries(limit: number): Promise<SharedAlertClaim[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
    return this.transaction(async (client) => {
      const claimedAt = new Date();
      const expiresAt = new Date(claimedAt.getTime() + 30_000);
      const rows = await client.query<
        DeliveryRow & {
          encrypted_endpoint: string;
          encrypted_signing_secret: string;
          webhook_created_at: Date;
          webhook_disabled_at: Date | null;
          webhook_label: string;
          endpoint_hash: string;
          webhook_control_hmac: string;
        }
      >(
        `SELECT d.*,w.encrypted_endpoint,w.encrypted_signing_secret,w.created_at webhook_created_at,
                w.disabled_at webhook_disabled_at,w.label webhook_label,w.endpoint_hash,w.control_hmac webhook_control_hmac
         FROM sg_alert_deliveries d JOIN sg_alert_webhooks w ON w.tenant_id=d.tenant_id AND w.webhook_id=d.webhook_id
         WHERE w.disabled_at IS NULL AND ((d.status='pending' AND d.next_attempt_at<=$1)
            OR (d.status='processing' AND d.lease_expires_at<=$1))
         ORDER BY d.next_attempt_at,d.created_at LIMIT $2 FOR UPDATE OF d SKIP LOCKED`,
        [claimedAt, bounded],
      );
      const claims: SharedAlertClaim[] = [];
      for (const row of rows.rows) {
        this.assertDelivery(row);
        const webhook: WebhookRow = {
          webhook_id: row.webhook_id,
          tenant_id: row.tenant_id,
          label: row.webhook_label,
          endpoint_hash: row.endpoint_hash,
          encrypted_endpoint: row.encrypted_endpoint,
          encrypted_signing_secret: row.encrypted_signing_secret,
          created_at: row.webhook_created_at,
          disabled_at: row.webhook_disabled_at,
          control_hmac: row.webhook_control_hmac,
        };
        this.assertWebhook(webhook);
        const leaseId = `lease_${randomUUID()}`;
        const updated: Omit<DeliveryRow, 'state_hmac'> = {
          ...row,
          status: 'processing',
          attempt_count: row.attempt_count + 1,
          last_attempt_at: claimedAt,
          lease_id: leaseId,
          lease_expires_at: expiresAt,
        };
        const changed = await client.query(
          `UPDATE sg_alert_deliveries SET status='processing',attempt_count=$1,last_attempt_at=$2,lease_id=$3,
           lease_expires_at=$4,state_hmac=$5 WHERE delivery_id=$6 AND state_hmac=$7`,
          [
            updated.attempt_count,
            claimedAt,
            leaseId,
            expiresAt,
            this.stateHmac(updated),
            row.delivery_id,
            row.state_hmac,
          ],
        );
        if (changed.rowCount !== 1) continue;
        try {
          claims.push({
            deliveryId: row.delivery_id,
            leaseId,
            endpoint: open(
              this.masterSecret,
              `shared-alert-endpoint-v1:${row.tenant_id}:${row.webhook_id}`,
              row.encrypted_endpoint,
            ),
            signingSecret: open(
              this.masterSecret,
              `shared-alert-secret-v1:${row.tenant_id}:${row.webhook_id}`,
              row.encrypted_signing_secret,
            ),
            payload: row.payload_json,
            attemptCount: updated.attempt_count,
          });
        } catch {
          const dead: Omit<DeliveryRow, 'state_hmac'> = {
            ...updated,
            status: 'dead',
            error_code: 'credential_decryption_failed',
            lease_id: null,
            lease_expires_at: null,
          };
          await client.query(
            `UPDATE sg_alert_deliveries SET status='dead',error_code='credential_decryption_failed',lease_id=NULL,
             lease_expires_at=NULL,state_hmac=$1 WHERE delivery_id=$2 AND lease_id=$3`,
            [this.stateHmac(dead), row.delivery_id, leaseId],
          );
        }
      }
      return claims;
    });
  }
  async finishDelivery(input: {
    deliveryId: string;
    leaseId: string;
    delivered: boolean;
    retryable: boolean;
    responseStatus?: number;
    errorCode?: string;
  }): Promise<'delivered' | 'pending' | 'dead' | undefined> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<DeliveryRow>(
          `SELECT * FROM sg_alert_deliveries WHERE delivery_id=$1 AND status='processing' AND lease_id=$2 FOR UPDATE`,
          [input.deliveryId, input.leaseId],
        )
      ).rows[0];
      if (!row) return undefined;
      this.assertDelivery(row);
      const responseStatus = input.responseStatus ?? null;
      const errorCode = (input.errorCode ?? (input.delivered ? null : 'delivery_failed'))?.slice(
        0,
        128,
      );
      let status: 'delivered' | 'pending' | 'dead';
      let updated: Omit<DeliveryRow, 'state_hmac'>;
      if (input.delivered) {
        status = 'delivered';
        updated = {
          ...row,
          status,
          delivered_at: new Date(),
          response_status: responseStatus,
          error_code: null,
          lease_id: null,
          lease_expires_at: null,
        };
      } else if (input.retryable && row.attempt_count < this.maxAttempts) {
        status = 'pending';
        const delaySeconds = Math.min(3600, 2 ** Math.min(row.attempt_count, 11));
        updated = {
          ...row,
          status,
          next_attempt_at: new Date(Date.now() + delaySeconds * 1_000),
          response_status: responseStatus,
          error_code: errorCode ?? null,
          lease_id: null,
          lease_expires_at: null,
        };
      } else {
        status = 'dead';
        updated = {
          ...row,
          status,
          response_status: responseStatus,
          error_code: errorCode ?? null,
          lease_id: null,
          lease_expires_at: null,
        };
      }
      const changed = await client.query(
        `UPDATE sg_alert_deliveries SET status=$1,next_attempt_at=$2,last_attempt_at=$3,delivered_at=$4,
         response_status=$5,error_code=$6,lease_id=$7,lease_expires_at=$8,state_hmac=$9
         WHERE delivery_id=$10 AND lease_id=$11`,
        [
          updated.status,
          updated.next_attempt_at,
          updated.last_attempt_at,
          updated.delivered_at,
          updated.response_status,
          updated.error_code,
          updated.lease_id,
          updated.lease_expires_at,
          this.stateHmac(updated),
          input.deliveryId,
          input.leaseId,
        ],
      );
      return changed.rowCount === 1 ? status : undefined;
    });
  }
  async verifyTenant(tenantId: string): Promise<{ valid: boolean; checked: number }> {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return this.verifyWith(client, tenantId);
    });
  }
  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
