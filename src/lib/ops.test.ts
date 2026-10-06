import { describe, expect, it } from 'vitest';
import { applyOp, opsFromData, validateOp, type Op } from './ops';
import { legacyMatchId, sanitizeLeagueData, type LeagueData } from './validate';

const empty = (): LeagueData => ({ matches: [], status: {}, custom: [] });
const match = (id: string, at: number) => ({ id, a: 'tt1', b: 'tt2', s: 1, at, method: 'pick' as const });

describe('validateOp', () => {
  it('accepts well-formed operations', () => {
    expect(validateOp({ op: 'match.add', league: 'movie', match: match('x', 1) })).toMatchObject({ op: 'match.add' });
    expect(validateOp({ op: 'status.set', league: 'tv', titleId: 'tt1', status: null, at: 1 })).toMatchObject({ status: null });
    expect(validateOp({ op: 'league.reset', league: 'game', at: 1 })).toMatchObject({ op: 'league.reset' });
  });

  it('rejects anything malformed', () => {
    for (const bad of [
      null,
      'x',
      { op: 'match.add', league: 'books', match: match('x', 1) },
      { op: 'match.add', league: 'movie', match: { ...match('x', 1), s: 2 } },
      { op: 'match.add', league: 'movie', match: { ...match('x', 1), b: 'tt1' } },
      { op: 'status.set', league: 'movie', titleId: 'tt1', status: 'maybe', at: 1 },
      { op: 'custom.add', league: 'movie', title: { id: 'tt1', title: 'X', poster: 'javascript:alert(1)' }, at: 1 },
      { op: 'drop.tables', league: 'movie' },
    ]) {
      expect(validateOp(bad)).toBeNull();
    }
  });
});

describe('applyOp', () => {
  it('adds results once and keeps them in time order', () => {
    let l = applyOp(empty(), { op: 'match.add', league: 'movie', match: match('b', 20) });
    l = applyOp(l, { op: 'match.add', league: 'movie', match: match('a', 10) });
    const same = applyOp(l, { op: 'match.add', league: 'movie', match: match('a', 10) });
    expect(same).toBe(l);
    expect(l.matches.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('removes, marks and resets', () => {
    const ops: Op[] = [
      { op: 'match.add', league: 'movie', match: match('a', 10) },
      { op: 'status.set', league: 'movie', titleId: 'tt1', status: 'seen', at: 1 },
      { op: 'match.remove', league: 'movie', id: 'a', at: 11 },
    ];
    const l = ops.reduce(applyOp, empty());
    expect(l.matches).toEqual([]);
    expect(l.status).toEqual({ tt1: 'seen' });
    expect(applyOp(l, { op: 'league.reset', league: 'movie', at: 99 }).status).toEqual({});
  });

  it('round-trips a league through opsFromData', () => {
    const data: LeagueData = { matches: [match('a', 1), match('b', 2)], status: { tt1: 'seen', tt3: 'unseen' }, custom: [] };
    const rebuilt = opsFromData('movie', data).reduce(applyOp, empty());
    expect(rebuilt).toEqual(data);
  });
});

describe('sanitizeLeagueData', () => {
  it('gives old results without ids a stable id', () => {
    const raw = { matches: [{ a: 'tt1', b: 'tt2', s: 1, at: 5, method: 'pick' }] };
    const once = sanitizeLeagueData('movie', raw);
    const twice = sanitizeLeagueData('movie', raw);
    expect(once.matches[0].id).toBe(legacyMatchId({ a: 'tt1', b: 'tt2', at: 5 }));
    expect(twice.matches[0].id).toBe(once.matches[0].id);
  });

  it('survives garbage', () => {
    for (const raw of [null, 42, 'x', [], { matches: null, status: null, custom: 'nope' }]) {
      expect(sanitizeLeagueData('movie', raw)).toEqual(empty());
    }
  });
});
