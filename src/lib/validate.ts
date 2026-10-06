import type { LeagueKind, Match, MatchMethod, SeenStatus, Title } from './types.js';

/**
 * Validation for anything that crosses a trust boundary: backup files, data
 * coming back from the server, and operations the server receives. Kept free of
 * dependencies so the server functions can import it without pulling in the UI.
 */

export const KINDS: LeagueKind[] = ['movie', 'tv', 'game'];
const METHODS: MatchMethod[] = ['pick', 'penalties', 'draw'];

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isKind = (v: unknown): v is LeagueKind => KINDS.includes(v as LeagueKind);
const isId = (v: unknown, max = 128): v is string => isStr(v) && v.length > 0 && v.length <= max;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const text = (v: unknown, max: number) => (isStr(v) ? v.slice(0, max) : null);

/** Ids for results recorded before matches had ids. Deterministic, so the same result never duplicates. */
export const legacyMatchId = (m: Pick<Match, 'at' | 'a' | 'b'>) => `m-${m.at}-${m.a}-${m.b}`;
export const matchId = (m: Match) => m.id ?? legacyMatchId(m);

export function sanitizeMatch(raw: unknown): Match | null {
  if (!isObject(raw)) return null;
  const { a, b, s, at } = raw;
  if (!isId(a, 64) || !isId(b, 64) || a === b) return null;
  if (typeof s !== 'number' || !(s >= 0 && s <= 1) || !isTime(at)) return null;
  const method = METHODS.includes(raw.method as MatchMethod) ? (raw.method as MatchMethod) : s === 0.5 ? 'draw' : 'pick';
  const pens =
    Array.isArray(raw.pens) && raw.pens.length === 2 && raw.pens.every((n) => Number.isInteger(n) && n >= 0 && n <= 20)
      ? (raw.pens as [number, number])
      : undefined;
  const match: Match = { id: isId(raw.id) ? raw.id : legacyMatchId({ a, b, at }), a, b, s, at, method };
  if (pens) match.pens = pens;
  return match;
}

export const sanitizeStatus = (v: unknown): SeenStatus | null => (v === 'seen' || v === 'unseen' ? v : null);

export function sanitizeTitle(raw: unknown, kind: LeagueKind): Title | null {
  if (!isObject(raw) || !isId(raw.id, 64) || !isStr(raw.title) || !raw.title.trim() || !isStr(raw.poster)) return null;
  const links: Title['links'] = {};
  if (isObject(raw.links)) {
    for (const key of ['imdb', 'letterboxd', 'wikipedia', 'steam'] as const) {
      const url = raw.links[key];
      if (isStr(url) && /^https:\/\//.test(url) && url.length <= 500) links[key] = url;
    }
  }
  const url = (v: unknown) => (isStr(v) && /^https:\/\//.test(v) && v.length <= 1000 ? v : null);
  const poster = url(raw.poster);
  if (!poster) return null;
  return {
    id: raw.id,
    kind,
    title: raw.title.slice(0, 200),
    year: typeof raw.year === 'number' ? raw.year : null,
    endYear: typeof raw.endYear === 'number' ? raw.endYear : null,
    rank: typeof raw.rank === 'number' ? raw.rank : 9999,
    poster,
    background: url(raw.background),
    logo: url(raw.logo),
    genres: Array.isArray(raw.genres) ? raw.genres.filter(isStr).slice(0, 5).map((g) => g.slice(0, 40)) : [],
    credit: text(raw.credit, 200),
    creditLabel: text(raw.creditLabel, 40) ?? '',
    summary: text(raw.summary, 1000) ?? '',
    score: typeof raw.score === 'number' ? raw.score : null,
    meta: text(raw.meta, 200),
    links,
    custom: true,
  };
}

export interface LeagueData {
  matches: Match[];
  status: Record<string, SeenStatus>;
  custom: Title[];
}

/** One league's results, seen marks and added titles from untrusted JSON. Anything malformed is dropped. */
export function sanitizeLeagueData(kind: LeagueKind, raw: unknown): LeagueData {
  const l = isObject(raw) ? raw : {};
  const seen = new Set<string>();
  const matches: Match[] = [];
  for (const m of Array.isArray(l.matches) ? l.matches : []) {
    const match = sanitizeMatch(m);
    if (match && !seen.has(match.id!)) {
      seen.add(match.id!);
      matches.push(match);
    }
  }
  matches.sort((x, y) => x.at - y.at);
  const status: Record<string, SeenStatus> = {};
  if (isObject(l.status)) {
    for (const [id, v] of Object.entries(l.status)) {
      const st = sanitizeStatus(v);
      if (st && isId(id, 64)) status[id] = st;
    }
  }
  const custom = (Array.isArray(l.custom) ? l.custom : []).map((t) => sanitizeTitle(t, kind)).filter((t): t is Title => !!t);
  return { matches, status, custom };
}
