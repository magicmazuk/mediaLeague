import { clearedCookie } from '../backend/auth.js';
import { json } from '../backend/gate.js';

export function POST(request: Request) {
  const secure = new URL(request.url).protocol === 'https:';
  return json({ ok: true }, 200, { 'set-cookie': clearedCookie(secure) });
}
