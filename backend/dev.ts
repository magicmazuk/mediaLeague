import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import * as login from '../api/login.js';
import * as logout from '../api/logout.js';
import * as ops from '../api/ops.js';
import * as session from '../api/session.js';
import * as state from '../api/state.js';
import { getDb, setDb, type Db } from './db.js';
import { gate, json } from './gate.js';

type Handler = (request: Request) => Response | Promise<Response>;
const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  '/api/login': { POST: login.POST },
  '/api/logout': { POST: logout.POST },
  '/api/session': { GET: session.GET },
  '/api/state': { GET: state.GET },
  '/api/ops': { POST: ops.POST },
};

/** Opens a local PGlite database in .data/ unless DATABASE_URL points at a real one. One folder per Vite mode. */
async function localDb(root: string, mode: string): Promise<void> {
  if (getDb()) return;
  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(`${root}/.data`, { recursive: true });
  const pg = new PGlite(`${root}/.data/${mode === 'development' ? 'pglite' : `pglite-${mode}`}`);
  const db: Db = { query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
  setDb(db);
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const method = req.method ?? 'GET';
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const buf = Buffer.concat(chunks);
    body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method, headers, body });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => k !== 'set-cookie' && res.setHeader(k, v));
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Runs the Vercel middleware and /api functions inside `npm run dev`, so the
 * password gate and cloud sync work locally exactly as they do when deployed.
 * Set APP_PASSWORD when starting the dev server to try the sign-in page.
 */
export function devApi(): Plugin {
  return {
    name: 'media-league-dev-api',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return;
      const ready = localDb(server.config.root, server.config.mode);
      server.middlewares.use(async (req, res, next) => {
        try {
          const request = await toRequest(req);
          const blocked = await gate(request);
          if (blocked) return void (await send(res, blocked));
          const path = new URL(request.url).pathname;
          if (!path.startsWith('/api/')) return next();
          await ready;
          const route = ROUTES[path];
          const handler = route?.[request.method];
          await send(res, handler ? await handler(request) : json({ error: route ? 'Method not allowed' : 'Not found' }, route ? 405 : 404));
        } catch (error) {
          server.config.logger.error(`[api] ${(error as Error).stack ?? error}`);
          await send(res, json({ error: 'Something went wrong on the server.' }, 500));
        }
      });
    },
  };
}
