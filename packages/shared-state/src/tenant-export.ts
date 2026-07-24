import { canonicalJson, sha256 } from '@schema-guard/core';
import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { SharedStatePool } from './pool.js';

type Row = Record<string, unknown>;

const CONTROL_TENANT_TABLES = [
  'sg_billing_checkout_sessions',
  'sg_billing_events',
  'sg_billing_subscriptions',
  'sg_alert_acknowledgements',
  'sg_alert_deliveries',
  'sg_alert_manifests',
  'sg_alert_webhooks',
  'sg_alerts',
  'sg_conformance_runs',
  'sg_control_api_keys',
  'sg_control_audit_anchors',
  'sg_control_audit_events',
  'sg_control_audit_manifests',
  'sg_failure_observations',
  'sg_intelligence_manifests',
  'sg_schema_environments',
  'sg_schema_release_manifests',
  'sg_schema_releases',
  'sg_tenant_lifecycle',
  'sg_tenant_rulesets',
  'sg_tool_schema_manifests',
  'sg_tool_schemas',
] as const;

const ACTION_TENANT_TABLES = [
  'sg_accepted_action_decisions',
  'sg_action_approvals',
  'sg_action_descriptors',
  'sg_action_manifests',
  'sg_action_reconciliation_manifests',
  'sg_action_reconciliations',
  'sg_action_reservations',
  'sg_checkpoint_anchor_deliveries',
] as const;

const SECRET_COLUMNS = new Set([
  'acknowledgement_hmac',
  'control_hmac',
  'encrypted_endpoint',
  'encrypted_signing_secret',
  'key_hash',
  'payload_hmac',
]);

function exportedValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `base64:${value.toString('base64')}`;
  return value;
}

function exportedRow(row: Row): Row {
  const safe: Row = {};
  for (const [key, raw] of Object.entries(row)) {
    if (SECRET_COLUMNS.has(key) || key.endsWith('_key_hash')) continue;
    const value = exportedValue(raw);
    if (key.endsWith('_json') && typeof value === 'string') {
      try {
        safe[key.slice(0, -'_json'.length)] = JSON.parse(value) as unknown;
        continue;
      } catch {
        throw new TypeError(`shared tenant export encountered malformed ${key}`);
      }
    }
    safe[key] = value;
  }
  return safe;
}

function hmac(secret: string, purpose: string, value: unknown): string {
  return `hmac-sha256:${createHmac('sha256', secret)
    .update(purpose)
    .update('\0')
    .update(canonicalJson(value))
    .digest('hex')}`;
}

async function tableRows(client: PoolClient, table: string, tenantId: string): Promise<Row[]> {
  const rows = await client.query<Row>(`SELECT * FROM ${table} WHERE tenant_id=$1 ORDER BY ctid`, [
    tenantId,
  ]);
  return rows.rows.map(exportedRow);
}

async function withinReadSnapshot<T>(
  pool: SharedStatePool,
  body: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
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

export async function exportSharedTenantData(
  controlPool: SharedStatePool,
  actionPool: SharedStatePool,
  tenantId: string,
): Promise<Row> {
  if (actionPool === controlPool)
    return withinReadSnapshot(controlPool, async (client) => {
      const tenant = (
        await client.query<Row>('SELECT * FROM sg_control_tenants WHERE id=$1', [tenantId])
      ).rows[0];
      if (!tenant) throw new TypeError('shared tenant does not exist');
      const tables: Record<string, Row[]> = {};
      for (const table of [...CONTROL_TENANT_TABLES, ...ACTION_TENANT_TABLES])
        tables[table] = await tableRows(client, table, tenantId);
      const content = { tenant: exportedRow(tenant), tables };
      return {
        export_version: 1,
        generated_at: new Date().toISOString(),
        tenant_id: tenantId,
        content_sha256: sha256(JSON.parse(canonicalJson(content)) as unknown),
        source: 'shared_postgresql',
        ...content,
      };
    });
  const control = await withinReadSnapshot(controlPool, async (client) => {
    const tenant = (
      await client.query<Row>('SELECT * FROM sg_control_tenants WHERE id=$1', [tenantId])
    ).rows[0];
    if (!tenant) throw new TypeError('shared tenant does not exist');
    const tables: Record<string, Row[]> = {};
    for (const table of CONTROL_TENANT_TABLES)
      tables[table] = await tableRows(client, table, tenantId);
    return { tenant: exportedRow(tenant), tables };
  });
  const action = await withinReadSnapshot(actionPool, async (client) => {
    const tables: Record<string, Row[]> = {};
    for (const table of ACTION_TENANT_TABLES)
      tables[table] = await tableRows(client, table, tenantId);
    return tables;
  });
  const content = {
    tenant: control.tenant,
    tables: { ...control.tables, ...action },
  };
  return {
    export_version: 1,
    generated_at: new Date().toISOString(),
    tenant_id: tenantId,
    content_sha256: sha256(JSON.parse(canonicalJson(content)) as unknown),
    source: 'shared_postgresql',
    ...content,
  };
}

export async function deleteSharedTenantData(
  controlPool: SharedStatePool,
  actionPool: SharedStatePool,
  tenantId: string,
  expectedExportSha256: string,
  masterSecret: string,
): Promise<{
  tenant_ref: string;
  export_sha256: string;
  deleted_at: string;
  receipt_hmac: string;
}> {
  if (controlPool !== actionPool)
    throw new TypeError(
      'shared tenant deletion requires control and action state in the same PostgreSQL database',
    );
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(tenantId)) throw new TypeError('shared tenant ID is invalid');
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedExportSha256))
    throw new TypeError('shared tenant export hash is invalid');
  const latest = await exportSharedTenantData(controlPool, actionPool, tenantId);
  if (latest.content_sha256 !== expectedExportSha256)
    throw new TypeError('shared tenant data changed after export');
  const client = await controlPool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const lifecycle = (
      await client.query<{ status: string }>(
        'SELECT status FROM sg_tenant_lifecycle WHERE tenant_id=$1 FOR UPDATE',
        [tenantId],
      )
    ).rows[0];
    if (lifecycle?.status !== 'deletion_pending')
      throw new TypeError('shared tenant deletion is not pending');
    for (const table of [...ACTION_TENANT_TABLES].reverse())
      await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    if (
      (await client.query('DELETE FROM sg_control_tenants WHERE id=$1', [tenantId])).rowCount !== 1
    )
      throw new TypeError('shared tenant does not exist');
    const row = {
      tenant_ref: hmac(masterSecret, 'shared-managed-tenant-deletion-reference-v1', tenantId),
      export_sha256: expectedExportSha256,
      deleted_at: new Date().toISOString(),
    };
    const receiptHmac = hmac(masterSecret, 'shared-managed-tenant-deletion-receipt-v1', row);
    await client.query(
      `INSERT INTO sg_tenant_deletion_receipts(tenant_ref,export_sha256,deleted_at,receipt_hmac)
       VALUES($1,$2,$3,$4)`,
      [row.tenant_ref, row.export_sha256, row.deleted_at, receiptHmac],
    );
    await client.query('COMMIT');
    return { ...row, receipt_hmac: receiptHmac };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
