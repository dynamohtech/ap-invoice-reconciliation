import pg from 'pg';

const { Pool } = pg;

// A single shared pool for the whole process. Do not create a new Pool per
// request — that's the #1 way local testing looks fine and production falls
// over under real concurrency.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // A background/idle client error should never crash the whole process.
  console.error('[db] unexpected error on idle client', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.LOG_SQL === 'true') {
    console.log('[db]', text.replace(/\s+/g, ' ').trim(), `${Date.now() - start}ms`, `rows=${res.rowCount}`);
  }
  return res;
}

// For multi-statement operations that must succeed or fail together
// (e.g. writing an invoice header + its line items + an activity entry).
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
