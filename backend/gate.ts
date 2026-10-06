import { checkSession } from './auth.js';
import { loginPage, setupPage } from './login-page.js';

/** Paths anyone can reach: signing in and out, a bare health check, and the "don't index this site" file. */
const OPEN_PATHS = new Set(['/api/login', '/api/logout', '/api/health', '/robots.txt']);

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE, ...headers } });

/**
 * Runs before every request. Returns a response to send instead (the sign-in
 * page, or a 401 for data requests), or null to let the request through.
 */
export async function gate(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (OPEN_PATHS.has(url.pathname)) return null;

  const session = await checkSession(request);
  if (session === 'ok' || session === 'open') return null;

  const isApi = url.pathname.startsWith('/api/');
  if (session === 'not-configured') {
    return isApi
      ? json({ error: 'Set APP_PASSWORD in Vercel to finish setting up.' }, 503)
      : new Response(setupPage(), { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } });
  }
  if (isApi) return json({ error: 'Sign in to continue.' }, 401);
  const wantsPage = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
  if (!wantsPage) return new Response('Sign in to continue.', { status: 401, headers: NO_STORE });
  return new Response(loginPage(), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } });
}

/** For API handlers: belt and braces in case a request reaches them without passing the gate. */
export async function requireSession(request: Request): Promise<Response | null> {
  const session = await checkSession(request);
  if (session === 'ok' || session === 'open') return null;
  return session === 'not-configured' ? json({ error: 'Set APP_PASSWORD in Vercel to finish setting up.' }, 503) : json({ error: 'Sign in to continue.' }, 401);
}
