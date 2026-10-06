import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Op } from '../src/lib/ops.js';
import type { Title } from '../src/lib/types.js';
import { applyOps, isLockedOut, readState, recordFailedLogin } from './data.js';
import type { Db } from './db.js';

let db: Db;
beforeEach(() => {
  const pg = new PGlite();
  db = { query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
});

const add = (id: string, at: number, a = 'tt1', b = 'tt2', s = 1): Op => ({ op: 'match.add', league: 'movie', match: { id, a, b, s, at, method: 'pick' } });

describe('applyOps / readState', () => {
  it('stores results per league in time order', async () => {
    await applyOps(db, [add('m2', 20), add('m1', 10, 'tt3', 'tt4', 0.75), { op: 'match.add', league: 'game', match: { id: 'g1', a: 'g-Q1', b: 'g-Q2', s: 0, at: 5, method: 'penalties', pens: [1, 3] } }]);
    const state = await readState(db);
    expect(state.movie.matches.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(state.movie.matches[0]).toMatchObject({ a: 'tt3', b: 'tt4', s: 0.75, at: 10 });
    expect(state.game.matches[0]).toMatchObject({ id: 'g1', pens: [1, 3], method: 'penalties' });
    expect(state.tv.matches).toEqual([]);
  });

  it('is idempotent: re-sending a batch changes nothing', async () => {
    const batch = [add('m1', 1), add('m2', 2)];
    await applyOps(db, batch);
    await applyOps(db, batch);
    expect((await readState(db)).movie.matches).toHaveLength(2);
  });

  it('keeps undone results deleted even if another device sends them again', async () => {
    await applyOps(db, [add('m1', 1), { op: 'match.remove', league: 'movie', id: 'm1', at: 2 }]);
    await applyOps(db, [add('m1', 1)]);
    expect((await readState(db)).movie.matches).toEqual([]);
    // Removal can even arrive before the result itself.
    await applyOps(db, [{ op: 'match.remove', league: 'movie', id: 'm9', at: 5 }, add('m9', 4)]);
    expect((await readState(db)).movie.matches).toEqual([]);
  });

  it('keeps the latest seen mark for each title', async () => {
    await applyOps(db, [
      { op: 'status.set', league: 'movie', titleId: 'tt1', status: 'seen', at: 10 },
      { op: 'status.set', league: 'movie', titleId: 'tt1', status: 'unseen', at: 20 },
      { op: 'status.set', league: 'movie', titleId: 'tt2', status: 'unseen', at: 10 },
    ]);
    await applyOps(db, [{ op: 'status.set', league: 'movie', titleId: 'tt1', status: 'seen', at: 15 }]); // older: ignored
    await applyOps(db, [{ op: 'status.set', league: 'movie', titleId: 'tt2', status: null, at: 30 }]); // cleared
    expect((await readState(db)).movie.status).toEqual({ tt1: 'unseen' });
  });

  it('stores added titles', async () => {
    const title: Title = { id: 'tt9', kind: 'movie', title: 'Heat', year: 1995, rank: 9999, poster: 'https://x/p.jpg', background: null, logo: null, genres: [], credit: null, creditLabel: '', summary: '', score: null, meta: null, links: {}, custom: true };
    await applyOps(db, [{ op: 'custom.add', league: 'movie', title: { ...title }, at: 1 }]);
    expect((await readState(db)).movie.custom).toEqual([{ ...title, endYear: null }]);
  });

  it('resets a league up to a point in time without touching later results or other leagues', async () => {
    await applyOps(db, [
      add('old', 10),
      add('new', 30),
      { op: 'status.set', league: 'movie', titleId: 'tt1', status: 'seen', at: 10 },
      { op: 'match.add', league: 'tv', match: { id: 't1', a: 'tt7', b: 'tt8', s: 1, at: 10, method: 'pick' } },
      { op: 'league.reset', league: 'movie', at: 20 },
    ]);
    const state = await readState(db);
    expect(state.movie.matches.map((m) => m.id)).toEqual(['new']);
    expect(state.movie.status).toEqual({});
    expect(state.tv.matches).toHaveLength(1);
  });

  it('uploads a large batch in one go', async () => {
    const ops = Array.from({ length: 1000 }, (_, i) => add(`m${i}`, i));
    await applyOps(db, ops);
    expect((await readState(db)).movie.matches).toHaveLength(1000);
  });
});

describe('login lockout', () => {
  it('locks an address out after 10 failures in 15 minutes', async () => {
    const now = Date.now();
    for (let i = 0; i < 9; i++) await recordFailedLogin(db, '1.2.3.4', now);
    expect(await isLockedOut(db, '1.2.3.4', now)).toBe(false);
    await recordFailedLogin(db, '1.2.3.4', now);
    expect(await isLockedOut(db, '1.2.3.4', now)).toBe(true);
    expect(await isLockedOut(db, '5.6.7.8', now)).toBe(false);
    expect(await isLockedOut(db, '1.2.3.4', now + 16 * 60_000)).toBe(false);
  });
});
