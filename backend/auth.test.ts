import { afterEach, describe, expect, it } from 'vitest';
import { checkSession, passwordMatches, readCookie, sessionCookie, signSession, verifySession } from './auth.js';
import { gate } from './gate.js';

const withCookie = (path: string, cookie = '', accept = 'text/html') => new Request(`https://example.com${path}`, { headers: { cookie, accept } });

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.VERCEL;
});

describe('sessions', () => {
  it('accepts its own signature until it expires', async () => {
    const token = await signSession('pw', '', Date.now() + 60_000);
    expect(await verifySession(token, 'pw', '')).toBe(true);
    expect(await verifySession(token, 'pw', '', Date.now() + 120_000)).toBe(false);
  });

  it('rejects tampering, other passwords and other secrets', async () => {
    const token = await signSession('pw', 's', Date.now() + 60_000);
    expect(await verifySession(token, 'other', 's')).toBe(false);
    expect(await verifySession(token, 'pw', 'x')).toBe(false);
    const later = token.replace(/^v1\.(\d+)/, (_, n) => `v1.${Number(n) + 1000}`);
    expect(await verifySession(later, 'pw', 's')).toBe(false);
    expect(await verifySession('garbage', 'pw', 's')).toBe(false);
    expect(await verifySession(null, 'pw', 's')).toBe(false);
  });

  it('compares passwords exactly', async () => {
    expect(await passwordMatches('correct horse', 'correct horse')).toBe(true);
    expect(await passwordMatches('correct hors', 'correct horse')).toBe(false);
    expect(await passwordMatches('', 'x')).toBe(false);
  });

  it('reads and writes the cookie', () => {
    expect(readCookie('a=1; ml_session=v1.2.abc; b=2', 'ml_session')).toBe('v1.2.abc');
    expect(readCookie(null, 'ml_session')).toBeNull();
    const cookie = sessionCookie('tok', true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });
});

describe('gate', () => {
  it('is open in local development when no password is set', async () => {
    expect(await checkSession(withCookie('/'))).toBe('open');
    expect(await gate(withCookie('/'))).toBeNull();
  });

  it('locks the deployed site until a password is set', async () => {
    process.env.VERCEL = '1';
    const page = await gate(withCookie('/'));
    expect(page?.status).toBe(503);
    expect(await page?.text()).toContain('APP_PASSWORD');
    expect((await gate(withCookie('/api/state', '', 'application/json')))?.status).toBe(503);
  });

  it('shows the sign-in page to visitors without a session and 401s everything else', async () => {
    process.env.APP_PASSWORD = 'pw';
    const page = await gate(withCookie('/'));
    expect(page?.status).toBe(401);
    expect(await page?.text()).toContain('Enter your password');
    expect((await gate(withCookie('/assets/index.js', '', '*/*')))?.status).toBe(401);
    const api = await gate(withCookie('/api/state', '', 'application/json'));
    expect(api?.status).toBe(401);
    expect(api?.headers.get('content-type')).toContain('json');
  });

  it('lets signed-in requests through, and always allows the sign-in endpoint', async () => {
    process.env.APP_PASSWORD = 'pw';
    const token = await signSession('pw', '', Date.now() + 60_000);
    expect(await gate(withCookie('/', `ml_session=${token}`))).toBeNull();
    expect(await gate(withCookie('/api/state', `ml_session=${token}`))).toBeNull();
    expect(await gate(withCookie('/api/login'))).toBeNull();
    expect(await gate(withCookie('/robots.txt'))).toBeNull();
  });
});

describe('database URL handling', () => {
  it('strips libpq-only options and keeps SSL on for hosted databases', async () => {
    const { connectionOptions } = await import('./db.js');
    const neon = connectionOptions('postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
    expect(neon.ssl).toBe('require');
    expect(neon.url).toBe('postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/neondb');
    expect(connectionOptions('postgres://u:p@localhost:5432/db').ssl).toBe(false);
    expect(connectionOptions('postgres://u:p@host/db?sslmode=verify-full&application_name=ml').url).toContain('application_name=ml');
  });

  it('leaves the health check open', async () => {
    process.env.APP_PASSWORD = 'pw';
    expect(await gate(withCookie('/api/health', '', 'application/json'))).toBeNull();
  });
});
