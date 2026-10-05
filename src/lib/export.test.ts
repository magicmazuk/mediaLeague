import { describe, expect, it } from 'vitest';
import { leagueTableCsv, letterboxdListCsv, letterboxdRatingsCsv, starRating, toCsv } from './export';
import type { Standing, Title } from './types';

const film = (id: string, title: string, year: number, credit: string): Title => ({
  id,
  kind: 'movie',
  title,
  year,
  rank: 1,
  poster: '',
  background: null,
  logo: null,
  genres: [],
  credit,
  creditLabel: 'Directed by',
  summary: '',
  score: null,
  meta: null,
  links: { imdb: `https://www.imdb.com/title/${id}/` },
});
const titles = new Map<string, Title>([
  ['tt0468569', film('tt0468569', 'The Dark Knight', 2008, 'Christopher Nolan')],
  ['tt0120338', film('tt0120338', 'Titanic', 1997, 'James Cameron')],
  ['tt0088247', film('tt0088247', 'The Terminator', 1984, 'James Cameron')],
  ['tt0047478', film('tt0047478', 'Seven Samurai', 1954, 'Akira Kurosawa')],
]);
const lookup = (id: string) => titles.get(id);
const standing = (id: string, position: number): Standing => ({
  id,
  position,
  rating: 1600 - position * 10,
  theta: 0,
  sigma: 1,
  certainty: 0.5,
  played: 4,
  won: 2,
  drawn: 1,
  lost: 1,
  form: [],
  movement: null,
});
const table = ['tt0088247', 'tt0468569', 'tt0047478', 'tt0120338'].map((id, i) => standing(id, i + 1));

describe('CSV helpers', () => {
  it('quotes cells containing commas, quotes or newlines', () => {
    expect(toCsv(['a', 'b'], [['x, y', 'say "hi"']])).toBe('a,b\r\n"x, y","say ""hi"""\r\n');
  });
});

describe('Letterboxd list export', () => {
  it('lists films in league order with Letterboxd column names', () => {
    const lines = letterboxdListCsv(table, lookup).trim().split('\r\n');
    expect(lines[0]).toBe('imdbID,Title,Year,Directors');
    expect(lines[1]).toBe('tt0088247,The Terminator,1984,James Cameron');
    expect(lines[2]).toBe('tt0468569,The Dark Knight,2008,Christopher Nolan');
    expect(lines).toHaveLength(5);
  });

  it('skips anything that is not a film', () => {
    titles.set('g-Q1', { ...film('g-Q1', 'Elden Ring', 2022, 'FromSoftware'), kind: 'game' });
    const csv = letterboxdListCsv([...table, standing('g-Q1', 5)], lookup);
    expect(csv).not.toContain('Elden Ring');
    titles.delete('g-Q1');
  });
});

describe('star ratings', () => {
  it('maps the top to 5 stars and the bottom to the floor in half steps', () => {
    expect(starRating(1, 10)).toBe(5);
    expect(starRating(10, 10)).toBe(2.5);
    expect(starRating(10, 10, 3)).toBe(3);
    for (let p = 1; p <= 10; p++) expect((starRating(p, 10) * 2) % 1).toBe(0);
  });

  it('produces a ratings import', () => {
    const lines = letterboxdRatingsCsv(table, lookup, 3).trim().split('\r\n');
    expect(lines[0]).toBe('imdbID,Title,Year,Rating');
    expect(lines[1]).toBe('tt0088247,The Terminator,1984,5');
    expect(lines[4]).toBe('tt0120338,Titanic,1997,3');
  });
});

describe('league table export', () => {
  it('includes the full record for each title, with a BOM for Excel', () => {
    const csv = leagueTableCsv(table, lookup);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Position,Title,Year,Rating,Played,Won,Drawn,Lost,Certainty %,Link');
    expect(lines[1]).toBe('1,The Terminator,1984,1590,4,2,1,1,50,https://www.imdb.com/title/tt0088247/');
  });
});
