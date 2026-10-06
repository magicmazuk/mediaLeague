import { authConfig, passwordMatches, sessionCookie, signSession, SESSION_DAYS } from '../backend/auth.js';
import { isLockedOut, recordFailedLogin } from '../backend/data.js';
import { getDb } from '../backend/db.js';
import { json } from '../backend/gate.js';

const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';

export async function POST(request: Request) {
  const { password, secret } = authConfig();
  if (!password) return json({ error: 'No password is set up yet. Add APP_PASSWORD in Vercel.' }, 503);

  const db = getDb();
  const ip = clientIp(request);
  if (db && (await isLockedOut(db, ip))) return json({ error: 'Too many attempts. Wait 15 minutes and try again.' }, 429);

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const attempt = typeof body?.password === 'string' ? body.password.slice(0, 500) : '';
  if (!attempt || !(await passwordMatches(attempt, password))) {
    if (db) await recordFailedLogin(db, ip);
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return json({ error: "That password isn't right." }, 401);
  }

  const token = await signSession(password, secret, Date.now() + SESSION_DAYS * 86400_000);
  const secure = new URL(request.url).protocol === 'https:';
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, secure) });
}
