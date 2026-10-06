import { getDb } from '../backend/db.js';
import { json } from '../backend/gate.js';

/** Public, detail-free check that the deployment can reach its database. Reveals nothing else. */
export async function GET() {
  const db = getDb();
  if (!db) return json({ ok: true, database: 'not connected' });
  try {
    await db.query('select 1');
    return json({ ok: true, database: 'ok' });
  } catch (error) {
    console.error('[health] database check failed', error);
    return json({ ok: false, database: 'unreachable' }, 503);
  }
}
