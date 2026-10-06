import type { LeagueKind, Match, SeenStatus, Title } from './types.js';
import { isObject, isKind, isStr, matchId, sanitizeMatch, sanitizeStatus, sanitizeTitle, type LeagueData } from './validate.js';

/**
 * Every change to your results is an operation. The browser applies it straight
 * away and queues it; the server applies the same operations to the database.
 * Operations are idempotent and keyed by id, so votes from your phone and your
 * laptop merge instead of overwriting each other.
 */
export type Op =
  | { op: 'match.add'; league: LeagueKind; match: Match }
  | { op: 'match.remove'; league: LeagueKind; id: string; at: number }
  | { op: 'status.set'; league: LeagueKind; titleId: string; status: SeenStatus | null; at: number }
  | { op: 'custom.add'; league: LeagueKind; title: Title; at: number }
  | { op: 'league.reset'; league: LeagueKind; at: number };

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isId = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= 128;

/** Parses an operation from untrusted JSON. */
export function validateOp(raw: unknown): Op | null {
  if (!isObject(raw) || !isKind(raw.league)) return null;
  const league = raw.league;
  switch (raw.op) {
    case 'match.add': {
      const match = sanitizeMatch(raw.match);
      return match ? { op: 'match.add', league, match } : null;
    }
    case 'match.remove':
      return isId(raw.id) && isTime(raw.at) ? { op: 'match.remove', league, id: raw.id, at: raw.at } : null;
    case 'status.set': {
      if (!isId(raw.titleId) || !isTime(raw.at)) return null;
      if (raw.status !== null && !sanitizeStatus(raw.status)) return null;
      return { op: 'status.set', league, titleId: raw.titleId, status: sanitizeStatus(raw.status), at: raw.at };
    }
    case 'custom.add': {
      const title = sanitizeTitle(raw.title, league);
      return title && isTime(raw.at) ? { op: 'custom.add', league, title, at: raw.at } : null;
    }
    case 'league.reset':
      return isTime(raw.at) ? { op: 'league.reset', league, at: raw.at } : null;
    default:
      return null;
  }
}

/** Applies an operation to one league's data, the same way the server does. Returns the same object if nothing changed. */
export function applyOp<T extends LeagueData>(league: T, op: Op): T {
  switch (op.op) {
    case 'match.add': {
      const id = matchId(op.match);
      if (league.matches.some((m) => matchId(m) === id)) return league;
      const matches = [...league.matches, { ...op.match, id }];
      const n = matches.length;
      if (n > 1 && matches[n - 1].at < matches[n - 2].at) matches.sort((x, y) => x.at - y.at);
      return { ...league, matches };
    }
    case 'match.remove': {
      const matches = league.matches.filter((m) => matchId(m) !== op.id);
      return matches.length === league.matches.length ? league : { ...league, matches };
    }
    case 'status.set': {
      if ((league.status[op.titleId] ?? null) === op.status) return league;
      const status = { ...league.status };
      if (op.status) status[op.titleId] = op.status;
      else delete status[op.titleId];
      return { ...league, status };
    }
    case 'custom.add': {
      const i = league.custom.findIndex((t) => t.id === op.title.id);
      const custom = i === -1 ? [...league.custom, op.title] : league.custom.map((t, k) => (k === i ? op.title : t));
      return { ...league, custom };
    }
    case 'league.reset':
      return { ...league, matches: league.matches.filter((m) => m.at > op.at), status: {}, custom: [] };
  }
}

/** Operations that recreate a league's data, for uploading this device's results or importing a backup. */
export function opsFromData(kind: LeagueKind, data: LeagueData, at = Date.now()): Op[] {
  return [
    ...data.custom.map((title): Op => ({ op: 'custom.add', league: kind, title, at })),
    ...Object.entries(data.status).map(([titleId, status]): Op => ({ op: 'status.set', league: kind, titleId, status, at })),
    ...data.matches.map((match): Op => ({ op: 'match.add', league: kind, match: { ...match, id: matchId(match) } })),
  ];
}

// The store announces each operation here; the sync module listens and queues them.
const listeners = new Set<(op: Op) => void>();
export function onOp(fn: (op: Op) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const emitOp = (op: Op) => listeners.forEach((fn) => fn(op));
