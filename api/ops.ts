import { applyOps } from '../backend/data.js';
import { getDb } from '../backend/db.js';
import { json, requireSession } from '../backend/gate.js';
import { validateOp, type Op } from '../src/lib/ops.js';

const MAX_OPS = 1000;

/** Applies a batch of changes from a device. Invalid operations reject the whole batch so nothing half-applies silently. */
export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json({ error: 'No database is connected.' }, 501);

  const body = (await request.json().catch(() => null)) as { ops?: unknown } | null;
  if (!body || !Array.isArray(body.ops) || body.ops.length > MAX_OPS) return json({ error: `Send up to ${MAX_OPS} operations as { ops: [...] }.` }, 400);
  const ops = body.ops.map(validateOp);
  const bad = ops.findIndex((op) => op === null);
  if (bad !== -1) return json({ error: `Operation ${bad} is invalid.` }, 400);

  await applyOps(db, ops as Op[]);
  return json({ ok: true, applied: ops.length });
}
