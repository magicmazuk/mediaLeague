import { applyOps } from '../backend/data.js';
import { getDb } from '../backend/db.js';
import { json, requireSession } from '../backend/gate.js';
import { validateOp, type Op } from '../src/lib/ops.js';

const MAX_OPS = 1000;

/**
 * Applies a batch of changes from a device. Invalid operations are skipped and
 * reported rather than failing the batch, so one bad entry can never jam a
 * device's sync queue.
 */
export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json({ error: 'No database is connected.' }, 501);

  const body = (await request.json().catch(() => null)) as { ops?: unknown } | null;
  if (!body || !Array.isArray(body.ops) || body.ops.length > MAX_OPS) return json({ error: `Send up to ${MAX_OPS} operations as { ops: [...] }.` }, 400);

  const raw: unknown[] = body.ops;
  const valid: Op[] = [];
  const rejected: number[] = [];
  raw.forEach((item, i) => {
    const op = validateOp(item);
    if (op) valid.push(op);
    else rejected.push(i);
  });
  if (rejected.length) console.warn(`[ops] skipped ${rejected.length} invalid operation(s)`, rejected.slice(0, 5).map((i) => JSON.stringify(raw[i]).slice(0, 300)));

  await applyOps(db, valid);
  return json({ ok: true, applied: valid.length, rejected });
}
