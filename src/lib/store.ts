import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useMemo } from 'react';
import { BASE_TITLES, titleIndex } from './catalog';
import { nextPair, pairKey, replaceSide } from './matchmaker';
import { computeStandings, tableCertainty } from './rating';
import type { LeagueKind, LeagueState, Match, MatchMethod, SeenStatus, Title } from './types';

export const MATCHDAY_SIZE = 10;
const KINDS: LeagueKind[] = ['movie', 'tv', 'game'];

const emptyLeague = (): LeagueState => ({ status: {}, matches: [], custom: [], current: null, snapshot: {}, skipped: [] });

// Stable title arrays per (kind, custom list) so memoised consumers don't churn.
const titlesCache = new Map<string, { custom: Title[]; titles: Title[] }>();
export function titlesFor(kind: LeagueKind, league: LeagueState): Title[] {
  const hit = titlesCache.get(kind);
  if (hit && hit.custom === league.custom) return hit.titles;
  // A custom title can later appear in a refreshed bundled list; the bundled copy wins.
  const base = titleIndex(BASE_TITLES[kind]);
  const extra = league.custom.filter((t) => !base.has(t.id));
  const titles = extra.length ? [...BASE_TITLES[kind], ...extra] : BASE_TITLES[kind];
  titlesCache.set(kind, { custom: league.custom, titles });
  return titles;
}

export function eligibleIds(kind: LeagueKind, league: LeagueState) {
  return new Set(
    titlesFor(kind, league)
      .filter((t) => league.status[t.id] !== 'unseen')
      .map((t) => t.id),
  );
}

function standingsFor(kind: LeagueKind, league: LeagueState) {
  return computeStandings(eligibleIds(kind, league), league.matches, league.snapshot);
}

function validPair(kind: LeagueKind, league: LeagueState, pair: [string, string] | null): pair is [string, string] {
  if (!pair) return false;
  const index = titleIndex(titlesFor(kind, league));
  return pair.every((id) => index.has(id) && league.status[id] !== 'unseen') && pair[0] !== pair[1];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Rebuilds a league from untrusted JSON (a backup file), dropping anything malformed. */
export function sanitizeLeague(kind: LeagueKind, raw: unknown): LeagueState {
  const l = isObject(raw) ? raw : {};
  const matches = (Array.isArray(l.matches) ? l.matches : []).filter(
    (m): m is Match =>
      isObject(m) && isStr(m.a) && isStr(m.b) && m.a !== m.b && typeof m.s === 'number' && m.s >= 0 && m.s <= 1 && typeof m.at === 'number',
  );
  const status: Record<string, SeenStatus> = {};
  if (isObject(l.status)) for (const [id, v] of Object.entries(l.status)) if (v === 'seen' || v === 'unseen') status[id] = v;
  const snapshot: Record<string, number> = {};
  if (isObject(l.snapshot)) for (const [id, v] of Object.entries(l.snapshot)) if (typeof v === 'number') snapshot[id] = v;
  const custom: Title[] = (Array.isArray(l.custom) ? l.custom : [])
    .filter((t): t is Record<string, unknown> => isObject(t) && isStr(t.id) && isStr(t.title) && isStr(t.poster))
    .map((t) => ({
      id: t.id as string,
      kind,
      title: t.title as string,
      year: typeof t.year === 'number' ? t.year : null,
      endYear: typeof t.endYear === 'number' ? t.endYear : null,
      rank: typeof t.rank === 'number' ? t.rank : 9999,
      poster: t.poster as string,
      background: isStr(t.background) ? t.background : null,
      logo: isStr(t.logo) ? t.logo : null,
      genres: Array.isArray(t.genres) ? t.genres.filter(isStr) : [],
      credit: isStr(t.credit) ? t.credit : null,
      creditLabel: isStr(t.creditLabel) ? t.creditLabel : '',
      summary: isStr(t.summary) ? t.summary : '',
      score: typeof t.score === 'number' ? t.score : null,
      meta: isStr(t.meta) ? t.meta : null,
      links: isObject(t.links) ? Object.fromEntries(Object.entries(t.links).filter(([, v]) => isStr(v))) : {},
      custom: true,
    }));
  const skipped = (Array.isArray(l.skipped) ? l.skipped : []).filter(isStr);
  return { status, matches, custom, current: null, snapshot, skipped };
}

interface Store {
  leagues: Record<LeagueKind, LeagueState>;
  active: LeagueKind;
  setActive: (kind: LeagueKind) => void;
  /** Returns the pair to show, choosing a fresh one if needed. */
  ensureCurrent: (kind: LeagueKind) => [string, string] | null;
  /** `shown` is the pair the user judged; the result is dropped if it's no longer the current pair. */
  record: (kind: LeagueKind, shown: [string, string], winner: 'a' | 'b' | 'draw', method?: MatchMethod, pens?: [number, number]) => boolean;
  notSeen: (kind: LeagueKind, side: 0 | 1) => void;
  skip: (kind: LeagueKind) => void;
  undo: (kind: LeagueKind) => Match | undefined;
  setStatus: (kind: LeagueKind, id: string, status: SeenStatus | null) => void;
  addCustom: (kind: LeagueKind, title: Title) => void;
  resetLeague: (kind: LeagueKind) => void;
  importBackup: (data: unknown) => void;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const update = (kind: LeagueKind, fn: (l: LeagueState) => LeagueState) =>
        set((s) => ({ leagues: { ...s.leagues, [kind]: fn(s.leagues[kind]) } }));

      const freshPair = (kind: LeagueKind, league: LeagueState, exclude: string[] = []) =>
        nextPair(titlesFor(kind, league), league, Math.random, exclude) ?? nextPair(titlesFor(kind, league), league);

      return {
        leagues: { movie: emptyLeague(), tv: emptyLeague(), game: emptyLeague() },
        active: 'movie',
        setActive: (kind) => set({ active: kind }),

        ensureCurrent: (kind) => {
          const league = get().leagues[kind];
          if (validPair(kind, league, league.current)) return league.current;
          const pair = freshPair(kind, league);
          update(kind, (l) => ({ ...l, current: pair }));
          return pair;
        },

        record: (kind, shown, winner, method = 'pick', pens) => {
          const league = get().leagues[kind];
          const pair = league.current;
          if (!validPair(kind, league, pair) || pair[0] !== shown[0] || pair[1] !== shown[1]) return false;
          const s = winner === 'draw' ? 0.5 : method === 'penalties' ? (winner === 'a' ? 0.75 : 0.25) : winner === 'a' ? 1 : 0;
          const match: Match = { a: pair[0], b: pair[1], s, at: Date.now(), method: winner === 'draw' ? 'draw' : method, ...(pens ? { pens } : {}) };
          // A new matchday starts: remember positions so the table can show who moved.
          const snapshot =
            league.matches.length % MATCHDAY_SIZE === 0
              ? Object.fromEntries(standingsFor(kind, league).map((r) => [r.id, r.position]))
              : league.snapshot;
          const next: LeagueState = { ...league, matches: [...league.matches, match], snapshot };
          // Don't show either of the last pair straight away if there's any alternative.
          next.current = freshPair(kind, next, pair);
          update(kind, () => next);
          return true;
        },

        notSeen: (kind, side) => {
          const league = get().leagues[kind];
          const pair = league.current;
          if (!pair) return;
          const drop = pair[side];
          const keep = pair[1 - side];
          const status = { ...league.status, [drop]: 'unseen' as const };
          const replacement = replaceSide(titlesFor(kind, league), { ...league, status }, keep, drop);
          const current: [string, string] | null = replacement
            ? side === 0
              ? [replacement, keep]
              : [keep, replacement]
            : null;
          update(kind, (l) => ({ ...l, status, current }));
        },

        skip: (kind) => {
          const league = get().leagues[kind];
          const pair = league.current;
          if (!pair) return;
          const skipped = [...league.skipped, pairKey(pair[0], pair[1])].slice(-50);
          const next = { ...league, skipped };
          update(kind, () => ({ ...next, current: freshPair(kind, next, pair) }));
        },

        undo: (kind) => {
          const league = get().leagues[kind];
          const last = league.matches[league.matches.length - 1];
          if (!last) return undefined;
          const matches = league.matches.slice(0, -1);
          // Undoing the first result of a matchday: rebuild the previous matchday's baseline.
          let snapshot = league.snapshot;
          if (matches.length % MATCHDAY_SIZE === 0) {
            const start = matches.length === 0 ? 0 : Math.floor((matches.length - 1) / MATCHDAY_SIZE) * MATCHDAY_SIZE;
            const before = standingsFor(kind, { ...league, matches: matches.slice(0, start), snapshot: {} });
            snapshot = Object.fromEntries(before.map((r) => [r.id, r.position]));
          }
          update(kind, (l) => ({ ...l, matches, snapshot, current: [last.a, last.b] }));
          return last;
        },

        setStatus: (kind, id, status) =>
          update(kind, (l) => {
            const next = { ...l.status };
            if (status) next[id] = status;
            else delete next[id];
            const current = l.current?.includes(id) && status === 'unseen' ? null : l.current;
            return { ...l, status: next, current };
          }),

        addCustom: (kind, title) =>
          update(kind, (l) =>
            titleIndex(titlesFor(kind, l)).has(title.id)
              ? { ...l, status: { ...l.status, [title.id]: 'seen' } }
              : { ...l, custom: [...l.custom, { ...title, custom: true }], status: { ...l.status, [title.id]: 'seen' } },
          ),

        resetLeague: (kind) => update(kind, () => emptyLeague()),

        importBackup: (data) => {
          const d = data as { leagues?: Record<string, unknown> };
          if (!isObject(d) || !isObject(d.leagues)) throw new Error('This file is not a Media League backup.');
          const leagues = { ...get().leagues };
          for (const kind of KINDS) {
            if (d.leagues[kind] !== undefined) leagues[kind] = sanitizeLeague(kind, d.leagues[kind]);
          }
          set({ leagues });
        },
      };
    },
    {
      name: 'media-league',
      version: 1,
      partialize: (s) => ({ leagues: s.leagues, active: s.active }),
    },
  ),
);

/** League table and headline numbers for one league, memoised on the inputs that matter. */
export function useLeagueStats(kind: LeagueKind) {
  const league = useStore((s) => s.leagues[kind]);
  return useMemo(() => {
    const titles = titlesFor(kind, league);
    const index = titleIndex(titles);
    const standings = standingsFor(kind, league);
    const unseen = Object.values(league.status).filter((v) => v === 'unseen').length;
    return {
      league,
      titles,
      index,
      standings,
      ...tableCertainty(standings),
      unseen,
      matchNumber: (league.matches.length % MATCHDAY_SIZE) + 1,
      matchday: Math.floor(league.matches.length / MATCHDAY_SIZE) + 1,
    };
  }, [kind, league]);
}
