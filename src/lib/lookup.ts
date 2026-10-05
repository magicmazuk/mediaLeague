import type { LeagueKind, Title } from './types';

/**
 * Live lookups for adding titles that aren't in the bundled lists.
 * Films and TV: Cinemeta (Stremio's open metadata API, no key, CORS-enabled).
 * Games: the Wikipedia API (no key, CORS via origin=*), with box art from the article.
 */
export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  poster: string | null;
  load: () => Promise<Title>;
}

const CINEMETA = 'https://v3-cinemeta.strem.io';

interface CinemetaMeta {
  id: string;
  imdb_id?: string;
  name: string;
  type: string;
  poster?: string;
  background?: string;
  logo?: string;
  year?: string;
  releaseInfo?: string;
  genres?: string[];
  genre?: string[];
  director?: string[] | null;
  writer?: string[] | null;
  description?: string;
  imdbRating?: string;
  runtime?: string;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function parseYears(info?: string) {
  const years = (info ?? '').match(/\d{4}/g)?.map(Number) ?? [];
  return { year: years[0] ?? null, endYear: years[1] ?? null };
}

function cinemetaToTitle(kind: LeagueKind, m: CinemetaMeta): Title {
  const id = m.imdb_id || m.id;
  const { year, endYear } = parseYears(m.releaseInfo || m.year);
  const people = (kind === 'tv' ? m.writer : m.director) ?? [];
  return {
    id,
    kind,
    title: m.name,
    year,
    ...(kind === 'tv' ? { endYear } : {}),
    rank: 9999,
    poster: m.poster?.replace('/poster/small/', '/poster/medium/') || `https://images.metahub.space/poster/medium/${id}/img`,
    background: m.background ?? null,
    logo: m.logo ?? null,
    genres: (m.genres ?? m.genre ?? []).slice(0, 3),
    credit: people.slice(0, 2).join(', ') || null,
    creditLabel: kind === 'tv' ? 'Created by' : 'Directed by',
    summary: m.description ?? '',
    score: m.imdbRating ? Number(m.imdbRating) : null,
    meta: m.runtime ?? null,
    links: { imdb: `https://www.imdb.com/title/${id}/`, ...(kind === 'movie' ? { letterboxd: `https://letterboxd.com/imdb/${id}/` } : {}) },
    custom: true,
  };
}

async function searchCinemeta(kind: 'movie' | 'tv', q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const type = kind === 'tv' ? 'series' : 'movie';
  const data = await getJson<{ metas?: CinemetaMeta[] }>(`${CINEMETA}/catalog/${type}/top/search=${encodeURIComponent(q)}.json`, signal);
  return (data.metas ?? []).slice(0, 10).map((m) => ({
    id: m.imdb_id || m.id,
    title: m.name,
    subtitle: m.releaseInfo || m.year || '',
    poster: m.poster ?? null,
    load: async () => {
      const full = await getJson<{ meta?: CinemetaMeta }>(`${CINEMETA}/meta/${type}/${m.id}.json`).catch(() => ({ meta: undefined }));
      return cinemetaToTitle(kind, { ...m, ...(full.meta ?? {}) });
    },
  }));
}

interface WikiPage {
  pageid: number;
  title: string;
  index?: number;
  original?: { source: string };
  thumbnail?: { source: string };
  extract?: string;
  pageprops?: { wikibase_item?: string; 'wikibase-shortdesc'?: string };
}

async function searchGames(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${q} video game`,
    gsrlimit: '12',
    prop: 'pageimages|pageprops|extracts',
    piprop: 'original|thumbnail',
    pithumbsize: '500',
    pilicense: 'any',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    exlimit: 'max',
    redirects: '1',
  });
  const data = await getJson<{ query?: { pages?: Record<string, WikiPage> } }>(`https://en.wikipedia.org/w/api.php?${params}`, signal);
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .filter((p) => /video game/i.test(p.pageprops?.['wikibase-shortdesc'] ?? '') && (p.thumbnail || p.original))
    .slice(0, 10)
    .map((p) => {
      const shortdesc = p.pageprops?.['wikibase-shortdesc'] ?? '';
      const year = Number(shortdesc.match(/\d{4}/)?.[0]) || null;
      const name = p.title.replace(/\s*\((?:\d{4} )?video game\)$/i, '');
      const id = `g-${p.pageprops?.wikibase_item ?? p.pageid}`;
      const poster = (p.thumbnail?.source ?? p.original?.source ?? '').replace(/\?.*$/, '');
      return {
        id,
        title: name,
        subtitle: shortdesc,
        poster,
        load: async (): Promise<Title> => ({
          id,
          kind: 'game',
          title: name,
          year,
          rank: 9999,
          poster,
          background: null,
          logo: null,
          genres: [],
          credit: null,
          creditLabel: 'Developer',
          summary: p.extract ?? '',
          score: null,
          meta: null,
          links: { wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` },
          custom: true,
        }),
      };
    });
}

export function searchTitles(kind: LeagueKind, q: string, signal?: AbortSignal) {
  return kind === 'game' ? searchGames(q, signal) : searchCinemeta(kind, q, signal);
}
