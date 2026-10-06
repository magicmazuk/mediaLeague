import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useMemo } from 'react';
import { BASE_TITLES, titleIndex } from './catalog';
import { nextPair, pairKey, replaceSide } from './matchmaker';
import { applyOp, emitOp, opsFromData, type Op } from './ops';
import { computeStandings, tableCertainty } from './rating';
import type { LeagueKind, LeagueState, Match, MatchMethod, SeenStatus, Title } from './types';
import { isObject, KINDS, matchId, sanitizeLeagueData, type LeagueData } from './validate';

export const MATCHDAY_SIZE = 10;

const emptyLeague = (): LeagueState => ({ status: {}, matches: [], custom: [], current: null, skipped: [] });

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

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

/**
 * Table positions at the start of the current matchday, for the movement arrows.
 * Derived from the results rather than stored, so it's the same on every device.
 */
export function matchdaySnapshot(eligible: Set<string>, matches: Match[]): Record<string, number> {
  const n = matches.length;
  const start = n === 0 ? 0 : Math.floor((n - 1) / MATCHDAY_SIZE) * MATCHDAY_SIZE;
  if (start === 0) return {};
  return Object.fromEntries(computeStandings(eligible, matches.slice(0, start)).map((r) => [r.id, r.position]));
}

function validPair(kind: LeagueKind, league: LeagueState, pair: [string, string] | null): pair is [string, string] {
  if (!pair) return false;
  const index = titleIndex(titlesFor(kind, league));
  return pair.every((id) => index.has(id) && league.status[id] !== 'unseen') && pair[0] !== pair[1];
}

export interface ImportResult {
  added: number;
  alreadyHad: number;
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
  /** Merges a backup file into your leagues. Results you already have are skipped. */
  importBackup: (data: unknown) => ImportResult;
  /** Replaces a league's results with the server's copy, then re-applies changes not yet sent. */
  replaceData: (kind: LeagueKind, data: LeagueData, pending: Op[]) => void;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const update = (kind: LeagueKind, fn: (l: LeagueState) => LeagueState) =>
        set((s) => ({ leagues: { ...s.leagues, [kind]: fn(s.leagues[kind]) } }));

      /** Applies a change locally and announces it for syncing. */
      const commit = (league: LeagueState, op: Op): LeagueState => {
        const next = applyOp(league, op);
        if (next !== league) emitOp(op);
        return next;
      };

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
          const match: Match = {
            id: newId(),
            a: pair[0],
            b: pair[1],
            s,
            at: Date.now(),
            method: winner === 'draw' ? 'draw' : method,
            ...(pens ? { pens } : {}),
          };
          const next = commit(league, { op: 'match.add', league: kind, match });
          // Don't show either of the last pair straight away if there's any alternative.
          update(kind, () => ({ ...next, current: freshPair(kind, next, pair) }));
          return true;
        },

        notSeen: (kind, side) => {
          const league = get().leagues[kind];
          const pair = league.current;
          if (!pair) return;
          const drop = pair[side];
          const keep = pair[1 - side];
          const next = commit(league, { op: 'status.set', league: kind, titleId: drop, status: 'unseen', at: Date.now() });
          const replacement = replaceSide(titlesFor(kind, next), next, keep, drop);
          const current: [string, string] | null = replacement ? (side === 0 ? [replacement, keep] : [keep, replacement]) : null;
          update(kind, () => ({ ...next, current }));
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
          const next = commit(league, { op: 'match.remove', league: kind, id: matchId(last), at: Date.now() });
          update(kind, () => ({ ...next, current: [last.a, last.b] }));
          return last;
        },

        setStatus: (kind, id, status) => {
          const league = get().leagues[kind];
          const next = commit(league, { op: 'status.set', league: kind, titleId: id, status, at: Date.now() });
          const current = next.current?.includes(id) && status === 'unseen' ? null : next.current;
          update(kind, () => ({ ...next, current }));
        },

        addCustom: (kind, title) => {
          const at = Date.now();
          let next = get().leagues[kind];
          if (!titleIndex(titlesFor(kind, next)).has(title.id)) next = commit(next, { op: 'custom.add', league: kind, title: { ...title, custom: true }, at });
          next = commit(next, { op: 'status.set', league: kind, titleId: title.id, status: 'seen', at });
          update(kind, () => next);
        },

        resetLeague: (kind) => {
          const next = commit(get().leagues[kind], { op: 'league.reset', league: kind, at: Date.now() });
          update(kind, () => ({ ...next, current: null, skipped: [] }));
        },

        importBackup: (data) => {
          const d = data as { leagues?: unknown };
          if (!isObject(d) || !isObject(d.leagues)) throw new Error('This file is not a Media League backup.');
          const leagues = d.leagues;
          const result: ImportResult = { added: 0, alreadyHad: 0 };
          for (const kind of KINDS) {
            if (leagues[kind] === undefined) continue;
            let league = get().leagues[kind];
            for (const op of opsFromData(kind, sanitizeLeagueData(kind, leagues[kind]))) {
              const next = commit(league, op);
              if (op.op === 'match.add') next === league ? result.alreadyHad++ : result.added++;
              league = next;
            }
            update(kind, () => league);
          }
          return result;
        },

        replaceData: (kind, data, pending) =>
          update(kind, (l) => {
            let next: LeagueState = { ...l, matches: data.matches, status: data.status, custom: data.custom };
            for (const op of pending) if (op.league === kind) next = applyOp(next, op);
            return next;
          }),
      };
    },
    {
      name: 'media-league',
      version: 2,
      partialize: (s) => ({ leagues: s.leagues, active: s.active }),
      migrate: (persisted, version) => {
        const state = (isObject(persisted) ? persisted : {}) as { leagues?: Record<string, unknown>; active?: LeagueKind };
        if (version < 2) {
          // Keep an untouched copy of the old data before changing its shape.
          try {
            localStorage.setItem(`media-league-v${version}-backup`, JSON.stringify(state));
          } catch {
            /* storage full or unavailable: carry on, the migration below is lossless */
          }
        }
        const leagues = {} as Record<LeagueKind, LeagueState>;
        for (const kind of KINDS) {
          const raw = isObject(state.leagues) && isObject(state.leagues[kind]) ? state.leagues[kind] : {};
          const data = sanitizeLeagueData(kind, raw);
          const skipped = Array.isArray(raw.skipped) ? raw.skipped.filter((v): v is string => typeof v === 'string') : [];
          leagues[kind] = { ...data, current: null, skipped };
        }
        return { leagues, active: KINDS.includes(state.active as LeagueKind) ? (state.active as LeagueKind) : 'movie' };
      },
    },
  ),
);

/** A league's results, seen marks and added titles: the part that syncs. */
export const leagueData = (l: LeagueState): LeagueData => ({ matches: l.matches, status: l.status, custom: l.custom });

/** League table and headline numbers for one league, memoised on the inputs that matter. */
export function useLeagueStats(kind: LeagueKind) {
  const league = useStore((s) => s.leagues[kind]);
  return useMemo(() => {
    const titles = titlesFor(kind, league);
    const index = titleIndex(titles);
    const eligible = eligibleIds(kind, league);
    const standings = computeStandings(eligible, league.matches, matchdaySnapshot(eligible, league.matches));
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
