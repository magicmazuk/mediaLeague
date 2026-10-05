import { describe, expect, it } from 'vitest';
import { nextPair, pairKey, replaceSide } from './matchmaker';
import type { LeagueState, Match, Title } from './types';

const title = (id: string): Title => ({
  id,
  kind: 'movie',
  title: id,
  year: 2000,
  rank: 1,
  poster: '',
  background: null,
  logo: null,
  genres: [],
  credit: null,
  creditLabel: '',
  summary: '',
  score: null,
  meta: null,
  links: {},
});
const titles = Array.from({ length: 30 }, (_, i) => title(`t${i}`));
const empty = (): Pick<LeagueState, 'status' | 'matches' | 'skipped'> => ({ status: {}, matches: [], skipped: [] });
const m = (a: string, b: string, s = 1): Match => ({ a, b, s, at: 0, method: 'pick' });

function seeded(seed: number) {
  // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('nextPair', () => {
  it('returns two different titles from an empty league', () => {
    const pair = nextPair(titles, empty(), seeded(1))!;
    expect(pair).toHaveLength(2);
    expect(pair[0]).not.toBe(pair[1]);
  });

  it('never offers a title marked not seen', () => {
    const league = empty();
    for (let i = 0; i < 28; i++) league.status[`t${i}`] = 'unseen';
    for (let k = 0; k < 20; k++) {
      expect(nextPair(titles, league, seeded(k + 1))!.sort()).toEqual(['t28', 't29']);
    }
  });

  it('returns null when fewer than two titles are left', () => {
    const league = empty();
    for (let i = 0; i < 29; i++) league.status[`t${i}`] = 'unseen';
    expect(nextPair(titles, league)).toBeNull();
  });

  it('prefers close contests over foregone conclusions', () => {
    // t0 thrashed everyone; t1..t5 are evenly matched with each other.
    const league = empty();
    const ids = ['t0', 't1', 't2', 't3', 't4', 't5'];
    ids.forEach((id) => (league.status[id] = 'seen'));
    for (let r = 0; r < 4; r++) {
      for (let i = 1; i <= 5; i++) league.matches.push(m('t0', `t${i}`));
      for (let i = 1; i <= 5; i++) league.matches.push(m(`t${i}`, `t${(i % 5) + 1}`, 0.5));
    }
    const pool = titles.filter((t) => ids.includes(t.id));
    let lopsided = 0;
    for (let k = 0; k < 200; k++) if (nextPair(pool, league, seeded(k + 1))!.includes('t0')) lopsided++;
    expect(lopsided / 200).toBeLessThan(0.35);
  });

  it('avoids pairs the user skipped', () => {
    const league = empty();
    league.status = { t0: 'seen', t1: 'seen', t2: 'seen' };
    league.skipped = [pairKey('t0', 't1')];
    const pool = titles.slice(0, 3);
    for (let k = 0; k < 50; k++) {
      const pair = nextPair(pool, league, seeded(k + 1))!;
      expect(pairKey(pair[0], pair[1])).not.toBe(pairKey('t0', 't1'));
    }
  });

  it('brings untried titles into the league over time', () => {
    const league = empty();
    const seen = new Set<string>();
    const rng = seeded(3);
    for (let k = 0; k < 120; k++) {
      const [a, b] = nextPair(titles, league, rng)!;
      seen.add(a).add(b);
      league.matches.push(m(a, b, Number(a.slice(1)) < Number(b.slice(1)) ? 1 : 0));
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('introduces familiar titles before obscure ones', () => {
    // t0 has by far the most votes, t29 the fewest.
    const pool = titles.map((t, i) => ({ ...t, popularity: 2_000_000 / (i + 1) ** 2 }));
    let early = 0;
    for (let k = 0; k < 200; k++) {
      const pair = nextPair(pool, empty(), seeded(k + 1))!;
      if (pair.some((id) => Number(id.slice(1)) < 5)) early++;
    }
    expect(early / 200).toBeGreaterThan(0.8);
  });
});

describe('replaceSide', () => {
  it('keeps the remaining title and finds it a new opponent', () => {
    const league = empty();
    for (let k = 0; k < 20; k++) {
      const b = replaceSide(titles, league, 't0', 't1', seeded(k + 1));
      expect(b).not.toBeNull();
      expect(b).not.toBe('t0');
      expect(b).not.toBe('t1');
    }
  });
});
