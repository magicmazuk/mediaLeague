import { readState } from '../backend/data.js';
import { getDb } from '../backend/db.js';
import { json, requireSession } from '../backend/gate.js';

/** Every league's results, seen marks and added titles. */
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json({ error: 'No database is connected.' }, 501);
  return json({ leagues: await readState(db), at: Date.now() });
}
