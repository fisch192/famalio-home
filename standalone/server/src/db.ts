import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  // Plain parameterized queries only; no string-built SQL from request data (SEC-06).
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 15_000 });
}

/** Serializable-enough for our writers: every family write locks the family row first. */
export async function transaction<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
