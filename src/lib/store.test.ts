import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_TITLES } from './catalog';
import { MATCHDAY_SIZE, sanitizeLeague, titlesFor, useStore } from './store';
import type { LeagueState } from './types';

const reset = () => useStore.getState().resetLeague('movie');
const league = () => useStore.getState().leagues.movie;
const current = () => useStore.getState().ensureCurrent('movie')!;
const pick = () => useStore.getState().record('movie', current(), 'a');

describe('store', () => {
  beforeEach(reset);

  it('records a result only for the pair the user was shown', () => {
    const shown = current();
    expect(useStore.getState().record('movie', [shown[1], shown[0]], 'a')).toBe(false);
    expect(league().matches).toHaveLength(0);
    expect(useStore.getState().record('movie', shown, 'a')).toBe(true);
    expect(league().matches).toHaveLength(1);
    // The same click again now refers to a pair that is no longer on screen.
    expect(useStore.getState().record('movie', shown, 'a')).toBe(false);
    expect(league().matches).toHaveLength(1);
  });

  it('restores the previous matchday baseline when undo crosses a boundary', () => {
    for (let i = 0; i < MATCHDAY_SIZE; i++) pick();
    const afterFirstMatchday = league().snapshot;
    pick(); // first result of matchday 2 takes a new snapshot
    const matchdayTwo = league().snapshot;
    expect(matchdayTwo).not.toEqual(afterFirstMatchday);
    useStore.getState().undo('movie');
    expect(league().matches).toHaveLength(MATCHDAY_SIZE);
    expect(league().snapshot).toEqual(afterFirstMatchday);
  });

  it('marks a title not seen and keeps the other side on screen', () => {
    const [a, b] = current();
    useStore.getState().notSeen('movie', 0);
    const next = league().current!;
    expect(league().status[a]).toBe('unseen');
    expect(next[1]).toBe(b);
    expect(next[0]).not.toBe(a);
  });
});

describe('titlesFor', () => {
  it('ignores custom titles that are already in the bundled list', () => {
    const dupe = { ...BASE_TITLES.movie[0], custom: true };
    const l: LeagueState = { status: {}, matches: [], custom: [dupe], current: null, snapshot: {}, skipped: [] };
    const titles = titlesFor('movie', l);
    expect(titles.filter((t) => t.id === dupe.id)).toHaveLength(1);
  });
});

describe('sanitizeLeague', () => {
  it('survives garbage without throwing', () => {
    for (const raw of [null, 42, 'x', [], { matches: null, status: null, custom: 'nope' }]) {
      const l = sanitizeLeague('movie', raw);
      expect(l.matches).toEqual([]);
      expect(l.status).toEqual({});
      expect(l.custom).toEqual([]);
    }
  });

  it('keeps valid entries and drops broken ones', () => {
    const l = sanitizeLeague('movie', {
      matches: [{ a: 'x', b: 'y', s: 1, at: 1, method: 'pick' }, { a: 'x', b: 'x', s: 1, at: 1 }, { a: 'x', s: 2 }],
      status: { x: 'seen', y: 'unseen', z: 'maybe' },
      custom: [{ id: 'tt1', title: 'Film', poster: 'p.jpg' }, { id: 'tt2' }],
    });
    expect(l.matches).toHaveLength(1);
    expect(l.status).toEqual({ x: 'seen', y: 'unseen' });
    expect(l.custom).toHaveLength(1);
    expect(l.custom[0]).toMatchObject({ id: 'tt1', genres: [], links: {}, kind: 'movie' });
  });
});
