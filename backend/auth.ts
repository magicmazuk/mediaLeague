/**
 * Password gate for a single-user app. You choose one password (the APP_PASSWORD
 * environment variable); signing in sets a signed, HttpOnly session cookie.
 * The signing key is derived from the password (plus SESSION_SECRET if set), so
 * changing the password signs every device out. Uses Web Crypto only.
 */

export const SESSION_COOKIE = 'ml_session';
export const SESSION_DAYS = 90;
const enc = new TextEncoder();

export interface AuthConfig {
  password: string | undefined;
  secret: string;
  /** On Vercel a missing password locks the site; in local development it disables the gate. */
  required: boolean;
}

export const authConfig = (): AuthConfig => ({
  password: process.env.APP_PASSWORD || undefined,
  secret: process.env.SESSION_SECRET ?? '',
  required: !!process.env.VERCEL,
});

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function sessionKey(password: string, secret: string) {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`media-league/session/v1\n${password}\n${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Compares two strings in time that doesn't depend on where they differ. */
function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(password: string, secret: string, expiresAt: number) {
  const payload = `v1.${expiresAt}`;
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(password, secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(token: string | null, password: string, secret: string, now = Date.now()) {
  const m = token && /^v1\.(\d{12,16})\.[A-Za-z0-9_-]{43}$/.exec(token);
  if (!m || Number(m[1]) <= now) return false;
  return sameString(await signSession(password, secret, Number(m[1])), token);
}

/** Checks a password attempt. Both sides are hashed first so the comparison is fixed-length. */
export async function passwordMatches(attempt: string, password: string) {
  const [a, b] = await Promise.all([attempt, password].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return sameString(b64url(a), b64url(b));
}

export function readCookie(header: string | null, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean) {
  return [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`, ...(secure ? ['Secure'] : [])].join('; ');
}

export const clearedCookie = (secure: boolean) =>
  [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');

export type SessionCheck = 'ok' | 'open' | 'signed-out' | 'not-configured';

/** Whether a request may see the app: signed in, gate disabled locally, signed out, or missing setup on Vercel. */
export async function checkSession(request: Request, config = authConfig()): Promise<SessionCheck> {
  if (!config.password) return config.required ? 'not-configured' : 'open';
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  return (await verifySession(token, config.password, config.secret)) ? 'ok' : 'signed-out';
}
