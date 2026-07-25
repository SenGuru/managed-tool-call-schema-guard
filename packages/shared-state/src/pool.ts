import { Pool } from 'pg';

export type SharedStatePool = Pool;

export function createSharedStatePool(connectionString: string, maxConnections = 20): Pool {
  if (
    !connectionString ||
    !Number.isInteger(maxConnections) ||
    maxConnections < 1 ||
    maxConnections > 100
  )
    throw new TypeError('shared-state pool configuration is invalid');
  const pool = new Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
  // pg emits idle-client errors on the pool itself. Without a listener, a brief
  // database restart terminates the process instead of letting later queries
  // establish fresh connections and readiness report the transient outage.
  pool.on('error', () => undefined);
  // A connection can also fail while it is checked out by a readiness or
  // transactional query. pg emits that failure on the client rather than the
  // pool, so every new client needs an error listener before it is borrowed.
  pool.on('connect', (client) => {
    client.on('error', () => undefined);
  });
  return pool;
}
