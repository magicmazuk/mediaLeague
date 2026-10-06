import { authConfig } from '../backend/auth.js';
import { getDb } from '../backend/db.js';
import { json, requireSession } from '../backend/gate.js';

/** Tells the app whether cloud sync is available and whether there's a password to sign out of. */
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  return json({ cloud: !!getDb(), passwordProtected: !!authConfig().password });
}
