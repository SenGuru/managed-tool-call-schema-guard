import Database from 'better-sqlite3';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

export interface AnchorCheckpoint {
  checkpoint_version: '1';
  tenant_ref: string;
  revision: number;
  row_count: number;
  accumulator: string;
  updated_at: string;
  checkpoint_hash: string;
}

export interface AnchorEvent {
  schema_version: '2026-07-20';
  event_type: 'schema_guard.action_idempotency_checkpoint';
  event_id: string;
  checkpoint: AnchorCheckpoint;
}

export type AnchorIngestResult = {
  status: 'stored' | 'advanced' | 'duplicate' | 'replay';
  revision: number;
  checkpoint_hash: string;
};

export class AnchorConflict extends Error {
  constructor(
    public readonly code: 'event_conflict' | 'rollback_detected' | 'integrity_conflict',
    message: string,
  ) {
    super(message);
  }
}

function validCheckpoint(value: unknown): value is AnchorCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).sort().join(',') ===
      'accumulator,checkpoint_hash,checkpoint_version,revision,row_count,tenant_ref,updated_at' &&
    item.checkpoint_version === '1' &&
    /^hmac-sha256:[0-9a-f]{64}$/u.test(String(item.tenant_ref)) &&
    Number.isInteger(item.revision) &&
    Number(item.revision) >= 0 &&
    Number.isInteger(item.row_count) &&
    Number(item.row_count) >= 0 &&
    /^xor256:[0-9a-f]{64}$/u.test(String(item.accumulator)) &&
    typeof item.updated_at === 'string' &&
    Number.isFinite(Date.parse(item.updated_at)) &&
    /^hmac-sha256:[0-9a-f]{64}$/u.test(String(item.checkpoint_hash))
  );
}

export function parseAnchorEvent(body: string): AnchorEvent {
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    throw new TypeError('request body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('anchor event must be an object');
  const event = value as Record<string, unknown>;
  if (
    Object.keys(event).sort().join(',') !== 'checkpoint,event_id,event_type,schema_version' ||
    event.schema_version !== '2026-07-20' ||
    event.event_type !== 'schema_guard.action_idempotency_checkpoint' ||
    !/^hmac-sha256:[0-9a-f]{64}$/u.test(String(event.event_id)) ||
    !validCheckpoint(event.checkpoint)
  )
    throw new TypeError('anchor event shape is invalid');
  return event as unknown as AnchorEvent;
}

export class AnchorStore {
  readonly db: Database.Database;
  private observedDataVersion = 0;
  constructor(
    databasePath: string,
    private readonly chainSecret: string,
  ) {
    if (!databasePath || chainSecret.length < 32)
      throw new TypeError('database path and 32+ character chain secret are required');
    this.db = new Database(databasePath);
    this.secure(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.secure(databasePath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS anchor_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        body_hash TEXT NOT NULL,
        tenant_ref TEXT NOT NULL,
        revision INTEGER NOT NULL,
        checkpoint_hash TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL,
        received_at TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS anchor_events_tenant_revision
        ON anchor_events(tenant_ref, revision DESC);
      CREATE TABLE IF NOT EXISTS latest_checkpoints (
        tenant_ref TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        checkpoint_hash TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL,
        received_at TEXT NOT NULL,
        event_id TEXT NOT NULL
      );
    `);
    if (!this.verify().valid) {
      this.db.close();
      throw new TypeError('checkpoint anchor receiver integrity verification failed');
    }
    this.observedDataVersion = this.dataVersion();
  }
  private secure(path: string): void {
    if (path === ':memory:') return;
    for (const item of [path, `${path}-wal`, `${path}-shm`])
      if (existsSync(item)) chmodSync(item, 0o600);
  }
  close(): void {
    this.db.close();
  }
  ready(): boolean {
    try {
      this.assertFresh();
      return (this.db.prepare('SELECT 1 ready').get() as Row).ready === 1;
    } catch {
      return false;
    }
  }
  private dataVersion(): number {
    return Number(this.db.pragma('data_version', { simple: true }));
  }
  private assertFresh(): void {
    const current = this.dataVersion();
    if (current === this.observedDataVersion) return;
    if (!this.verify().valid)
      throw new TypeError('checkpoint anchor receiver integrity verification failed');
    this.observedDataVersion = current;
  }
  private eventHash(row: Omit<Row, 'event_hash'>): string {
    return `hmac-sha256:${createHmac('sha256', this.chainSecret)
      .update(
        JSON.stringify({
          event_id: row.event_id,
          body_hash: row.body_hash,
          tenant_ref: row.tenant_ref,
          revision: Number(row.revision),
          checkpoint_hash: row.checkpoint_hash,
          checkpoint_json: row.checkpoint_json,
          received_at: row.received_at,
          previous_hash: row.previous_hash,
        }),
      )
      .digest('hex')}`;
  }
  ingest(event: AnchorEvent, exactBody: string): AnchorIngestResult {
    this.assertFresh();
    return this.db
      .transaction((): AnchorIngestResult => {
        const bodyHash = digest(exactBody);
        const priorEvent = this.db
          .prepare('SELECT body_hash,revision,checkpoint_hash FROM anchor_events WHERE event_id=?')
          .get(event.event_id) as Row | undefined;
        if (priorEvent) {
          if (text(priorEvent.body_hash) !== bodyHash)
            throw new AnchorConflict('event_conflict', 'event ID was reused with a different body');
          return {
            status: 'duplicate',
            revision: Number(priorEvent.revision),
            checkpoint_hash: text(priorEvent.checkpoint_hash),
          };
        }
        const latest = this.db
          .prepare('SELECT * FROM latest_checkpoints WHERE tenant_ref=?')
          .get(event.checkpoint.tenant_ref) as Row | undefined;
        if (latest && event.checkpoint.revision < Number(latest.revision))
          throw new AnchorConflict('rollback_detected', 'checkpoint revision moved backwards');
        if (
          latest &&
          event.checkpoint.revision === Number(latest.revision) &&
          event.checkpoint.checkpoint_hash !== latest.checkpoint_hash
        )
          throw new AnchorConflict(
            'integrity_conflict',
            'the same checkpoint revision has a different hash',
          );
        if (latest && event.checkpoint.revision === Number(latest.revision))
          return {
            status: 'replay',
            revision: event.checkpoint.revision,
            checkpoint_hash: event.checkpoint.checkpoint_hash,
          };
        const previous = this.db
          .prepare('SELECT event_hash FROM anchor_events ORDER BY sequence DESC LIMIT 1')
          .get() as Row | undefined;
        const receivedAt = new Date().toISOString();
        const checkpointJson = JSON.stringify(event.checkpoint);
        const row: Row = {
          event_id: event.event_id,
          body_hash: bodyHash,
          tenant_ref: event.checkpoint.tenant_ref,
          revision: event.checkpoint.revision,
          checkpoint_hash: event.checkpoint.checkpoint_hash,
          checkpoint_json: checkpointJson,
          received_at: receivedAt,
          previous_hash: previous?.event_hash ?? 'GENESIS',
        };
        const eventHash = this.eventHash(row);
        this.db
          .prepare(
            `INSERT INTO anchor_events(event_id,body_hash,tenant_ref,revision,checkpoint_hash,checkpoint_json,received_at,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .run(...Object.values(row), eventHash);
        this.db
          .prepare(
            `INSERT INTO latest_checkpoints(tenant_ref,revision,checkpoint_hash,checkpoint_json,received_at,event_id) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_ref) DO UPDATE SET revision=excluded.revision,checkpoint_hash=excluded.checkpoint_hash,checkpoint_json=excluded.checkpoint_json,received_at=excluded.received_at,event_id=excluded.event_id`,
          )
          .run(
            event.checkpoint.tenant_ref,
            event.checkpoint.revision,
            event.checkpoint.checkpoint_hash,
            checkpointJson,
            receivedAt,
            event.event_id,
          );
        return {
          status: latest ? 'advanced' : 'stored',
          revision: event.checkpoint.revision,
          checkpoint_hash: event.checkpoint.checkpoint_hash,
        };
      })
      .immediate();
  }
  latest(tenantRef: string): AnchorCheckpoint | undefined {
    this.assertFresh();
    const row = this.db
      .prepare('SELECT checkpoint_json FROM latest_checkpoints WHERE tenant_ref=?')
      .get(tenantRef) as Row | undefined;
    return row ? (JSON.parse(text(row.checkpoint_json)) as AnchorCheckpoint) : undefined;
  }
  verify(): { valid: boolean; checked: number } {
    let previous = 'GENESIS';
    let checked = 0;
    for (const row of this.db
      .prepare('SELECT * FROM anchor_events ORDER BY sequence')
      .iterate() as Iterable<Row>) {
      if (row.previous_hash !== previous || row.event_hash !== this.eventHash(row))
        return { valid: false, checked };
      previous = text(row.event_hash);
      checked += 1;
    }
    const latestRows = this.db.prepare('SELECT * FROM latest_checkpoints').all() as Row[];
    const tenantCount = this.db
      .prepare('SELECT COUNT(DISTINCT tenant_ref) count FROM anchor_events')
      .get() as Row;
    if (Number(tenantCount.count) !== latestRows.length) return { valid: false, checked };
    for (const latest of latestRows) {
      const event = this.db
        .prepare(
          'SELECT revision,checkpoint_hash,checkpoint_json,event_id FROM anchor_events WHERE tenant_ref=? ORDER BY revision DESC LIMIT 1',
        )
        .get(latest.tenant_ref) as Row | undefined;
      if (
        !event ||
        event.revision !== latest.revision ||
        event.checkpoint_hash !== latest.checkpoint_hash ||
        event.checkpoint_json !== latest.checkpoint_json ||
        event.event_id !== latest.event_id
      )
        return { valid: false, checked };
    }
    return { valid: true, checked };
  }
}

export function verifyTransportSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  nowMs = Date.now(),
): boolean {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || Math.abs(nowMs - time) > 300_000) return false;
  const expected = `v1=${createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex')}`;
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
