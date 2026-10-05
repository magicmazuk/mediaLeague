import movies from '../data/movies.json';
import tv from '../data/tv.json';
import type { LeagueKind, Title } from './types';

// Games are generated separately (scripts/build-games.mjs); glob keeps the app
// building even before that dataset exists.
const gameFiles = import.meta.glob<{ default: Title[] }>('../data/games.json', { eager: true });
const games: Title[] = Object.values(gameFiles)[0]?.default ?? [];

export const BASE_TITLES: Record<LeagueKind, Title[]> = {
  movie: movies as Title[],
  tv: tv as Title[],
  game: games,
};

export interface LeagueInfo {
  kind: LeagueKind;
  slug: string;
  name: string;
  noun: [string, string];
  source: string;
  blurb: string;
}

export const LEAGUES: LeagueInfo[] = [
  {
    kind: 'movie',
    slug: 'movies',
    name: 'Movies',
    noun: ['film', 'films'],
    source: 'IMDb Top 250',
    blurb: 'Classics, crowd-pleasers and cult favourites, reordered by the only critic who matters.',
  },
  {
    kind: 'tv',
    slug: 'tv',
    name: 'TV Shows',
    noun: ['show', 'shows'],
    source: 'IMDb Top 250 TV',
    blurb: 'Prestige drama, comfort sitcoms and the box sets you lost weekends to.',
  },
  {
    kind: 'game',
    slug: 'games',
    name: 'Games',
    noun: ['game', 'games'],
    source: 'Wikipedia best-games list',
    blurb: 'Console, PC and handheld classics, settled controller in hand.',
  },
];

export const leagueInfo = (kind: LeagueKind) => LEAGUES.find((l) => l.kind === kind)!;
export const leagueBySlug = (slug: string) => LEAGUES.find((l) => l.slug === slug);

const indexCache = new Map<Title[], Map<string, Title>>();
export function titleIndex(list: Title[]) {
  let index = indexCache.get(list);
  if (!index) {
    index = new Map(list.map((t) => [t.id, t]));
    indexCache.set(list, index);
  }
  return index;
}

export function yearLabel(t: Title) {
  if (t.year == null) return '';
  if (t.kind !== 'tv' || !t.endYear || t.endYear === t.year) return String(t.year);
  return `${t.year}–${t.endYear}`;
}
