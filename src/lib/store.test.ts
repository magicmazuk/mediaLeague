import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_TITLES } from './catalog';
import { onOp, type Op } from './ops';
import { eligibleIds, MATCHDAY_SIZE, matchdaySnapshot, titlesFor, useStore } from './store';
import type { LeagueState } from './types';

const reset = () => useStore.setState({ leagues: { movie: empty(), tv: empty(), game: empty() } });
const empty = (): LeagueState => ({ status: {}, matches: [], custom: [], current: null, skipped: [] });
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
    expect(league().matches[0].id).toBeTruthy();
    // The same click again now refers to a pair that is no longer on screen.
    expect(useStore.getState().record('movie', shown, 'a')).toBe(false);
    expect(league().matches).toHaveLength(1);
  });

  it('announces every change as a sync operation', () => {
    const seen: Op[] = [];
    const off = onOp((op) => seen.push(op));
    pick();
    useStore.getState().undo('movie');
    useStore.getState().setStatus('movie', 'tt0111161', 'seen');
    off();
    expect(seen.map((o) => o.op)).toEqual(['match.add', 'match.remove', 'status.set']);
    const add = seen[0] as Extract<Op, { op: 'match.add' }>;
    expect((seen[1] as Extract<Op, { op: 'match.remove' }>).id).toBe(add.match.id);
  });

  it('marks a title not seen and keeps the other side on screen', () => {
    const [a, b] = current();
    useStore.getState().notSeen('movie', 0);
    const next = league().current!;
    expect(league().status[a]).toBe('unseen');
    expect(next[1]).toBe(b);
    expect(next[0]).not.toBe(a);
  });

  it('merges a backup without duplicating results it already has', () => {
    for (let i = 0; i < 3; i++) pick();
    const backup = JSON.parse(JSON.stringify({ leagues: useStore.getState().leagues }));
    backup.leagues.movie.matches.push({ a: 'tt0111161', b: 'tt0068646', s: 1, at: 5, method: 'pick' });
    const result = useStore.getState().importBackup(backup);
    expect(result).toEqual({ added: 1, alreadyHad: 3 });
    expect(league().matches).toHaveLength(4);
    expect(league().matches[0].at).toBe(5); // kept in time order
  });

  it('rejects files that are not backups', () => {
    expect(() => useStore.getState().importBackup({ hello: 'world' })).toThrow(/not a Media League backup/);
  });

  it('replaces data from the server but keeps changes not yet sent', () => {
    pick();
    const unsent = league().matches[0];
    const pending: Op[] = [{ op: 'match.add', league: 'movie', match: unsent }];
    const server = { matches: [{ id: 'remote-1', a: 'tt0111161', b: 'tt0068646', s: 0, at: 1, method: 'pick' as const }], status: {}, custom: [] };
    useStore.getState().replaceData('movie', server, pending);
    expect(league().matches.map((m) => m.id)).toEqual(['remote-1', unsent.id]);
  });
});

describe('matchdaySnapshot', () => {
  beforeEach(reset);

  it('is empty during the first matchday and fixed for the rest of each matchday', () => {
    for (let i = 0; i < MATCHDAY_SIZE; i++) pick();
    const eligible = eligibleIds('movie', league());
    expect(matchdaySnapshot(eligible, league().matches)).toEqual({});
    pick();
    const second = matchdaySnapshot(eligible, league().matches);
    expect(Object.keys(second).length).toBeGreaterThan(0);
    pick();
    expect(matchdaySnapshot(eligible, league().matches)).toEqual(second);
    useStore.getState().undo('movie');
    useStore.getState().undo('movie');
    expect(matchdaySnapshot(eligible, league().matches)).toEqual({});
  });
});

describe('titlesFor', () => {
  it('ignores custom titles that are already in the bundled list', () => {
    const dupe = { ...BASE_TITLES.movie[0], custom: true };
    const l: LeagueState = { ...empty(), custom: [dupe] };
    expect(titlesFor('movie', l).filter((t) => t.id === dupe.id)).toHaveLength(1);
  });
});
