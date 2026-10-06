import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/ops.js';
import { readState } from './data.js';
import { setDb, type Db } from './db.js';

let db: Db;
beforeEach(() => {
  const pg = new PGlite();
  db = { query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
  setDb(db);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  setDb(null);
  vi.restoreAllMocks();
});

const post = (body: unknown) => POST(new Request('http://localhost/api/ops', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

describe('POST /api/ops', () => {
  it('applies the valid operations and reports the invalid ones instead of failing the batch', async () => {
    const res = await post({
      ops: [
        { op: 'match.add', league: 'movie', match: { id: 'm1', a: 'tt1', b: 'tt2', s: 1, at: 1, method: 'pick' } },
        { op: 'match.add', league: 'movie', match: { id: 'bad', a: 'tt1', b: 'tt1', s: 1, at: 2, method: 'pick' } },
        { op: 'status.set', league: 'movie', titleId: 'tt3', status: 'unseen', at: 3 },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: 2, rejected: [1] });
    const state = await readState(db);
    expect(state.movie.matches.map((m) => m.id)).toEqual(['m1']);
    expect(state.movie.status).toEqual({ tt3: 'unseen' });
  });

  it('rejects a malformed body', async () => {
    expect((await post({ nope: true })).status).toBe(400);
  });
});
