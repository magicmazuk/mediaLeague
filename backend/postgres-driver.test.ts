import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Op } from '../src/lib/ops.js';
import type { Title } from '../src/lib/types.js';
import { applyOps, isLockedOut, readState, recordFailedLogin } from './data.js';
import { postgresDb } from './db.js';

/**
 * The same queries as data.test.ts, but through postgres.js (the driver used on
 * Vercel) talking to PGlite over a real socket. Drivers differ in how they send
 * parameters, e.g. postgres.js JSON-encodes values bound to json/jsonb.
 */
let pg: PGlite;
let server: PGLiteSocketServer;
let db: ReturnType<typeof postgresDb>;

beforeAll(async () => {
  pg = await PGlite.create();
  const port = 40000 + Math.floor(Math.random() * 20000);
  server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' });
  await server.start();
  db = postgresDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
}, 30_000); // starting an in-process Postgres can be slow when test files run in parallel

afterAll(async () => {
  await db?.end();
  await server?.stop();
  await pg?.close();
});

const title: Title = { id: 'tt9', kind: 'movie', title: 'Heat', year: 1995, rank: 9999, poster: 'https://x/p.jpg', background: null, logo: null, genres: ['Crime'], credit: null, creditLabel: '', summary: '', score: null, meta: null, links: {}, custom: true };

describe('applyOps through postgres.js', () => {
  it('stores and reads back results, seen marks and added titles', async () => {
    const ops: Op[] = [
      { op: 'custom.add', league: 'movie', title, at: 1 },
      { op: 'status.set', league: 'movie', titleId: 'tt1', status: 'seen', at: 1 },
      { op: 'match.add', league: 'movie', match: { id: 'm1', a: 'tt1', b: 'tt2', s: 0.75, at: 1791277633757, method: 'penalties', pens: [3, 1] } },
      { op: 'match.add', league: 'movie', match: { id: 'm2', a: 'tt3', b: 'tt1', s: 0, at: 1791277633999, method: 'pick' } },
      { op: 'match.remove', league: 'movie', id: 'm2', at: 1791277634000 },
    ];
    await applyOps(db, ops);
    await applyOps(db, ops); // retried batch: no change
    const state = await readState(db);
    expect(state.movie.matches).toEqual([{ id: 'm1', a: 'tt1', b: 'tt2', s: 0.75, at: 1791277633757, method: 'penalties', pens: [3, 1] }]);
    expect(state.movie.status).toEqual({ tt1: 'seen' });
    expect(state.movie.custom).toEqual([{ ...title, endYear: null }]);
  });

  it('runs the login lockout queries', async () => {
    await recordFailedLogin(db, '9.9.9.9');
    expect(await isLockedOut(db, '9.9.9.9')).toBe(false);
  });
});
