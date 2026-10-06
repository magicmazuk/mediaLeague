import type { Standing, Title } from './types';

const csvCell = (value: unknown) => {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const imdbId = (t: Title) => (/^tt\d+$/.test(t.id) ? t.id : '');

type Lookup = (id: string) => Title | undefined;

/**
 * Letterboxd list import (letterboxd.com/list/new → Import). Letterboxd appends films
 * in file order, so row order *is* the ranking; tick "Show position" on the list.
 * Columns follow letterboxd.com/about/importing-data.
 */
export function letterboxdListCsv(standings: Standing[], lookup: Lookup) {
  const rows = standings
    .map((s) => lookup(s.id))
    .filter((t): t is Title => !!t && t.kind === 'movie')
    .map((t) => [imdbId(t), t.title, t.year ?? '', t.credit ?? '']);
  return toCsv(['imdbID', 'Title', 'Year', 'Directors'], rows);
}

/**
 * Converts league position to a Letterboxd star rating (0.5 steps). The top of
 * your table gets 5★ and ratings fall evenly to `floor` at the bottom.
 */
export function starRating(position: number, total: number, floor = 2.5) {
  if (total <= 1) return 5;
  const steps = Math.round((5 - floor) * 2);
  const fraction = (position - 1) / (total - 1);
  return 5 - Math.round(fraction * steps) / 2;
}

/** Letterboxd ratings import (letterboxd.com/import). */
export function letterboxdRatingsCsv(standings: Standing[], lookup: Lookup, floor = 2.5) {
  const films = standings.filter((s) => lookup(s.id)?.kind === 'movie');
  const rows = films.map((s, i) => {
    const t = lookup(s.id)!;
    return [imdbId(t), t.title, t.year ?? '', starRating(i + 1, films.length, floor)];
  });
  return toCsv(['imdbID', 'Title', 'Year', 'Rating'], rows);
}

/**
 * Plain spreadsheet export of a league table (works for every league). Starts with a
 * byte-order mark so Excel reads accented titles (Léon, Pokémon) as UTF-8.
 */
export function leagueTableCsv(standings: Standing[], lookup: Lookup) {
  const rows = standings.map((s) => {
    const t = lookup(s.id);
    const link = t?.links.imdb ?? t?.links.wikipedia ?? '';
    return [s.position, t?.title ?? s.id, t?.year ?? '', s.rating, s.played, s.won, s.drawn, s.lost, Math.round(s.certainty * 100), link];
  });
  return '\uFEFF' + toCsv(['Position', 'Title', 'Year', 'Rating', 'Played', 'Won', 'Drawn', 'Lost', 'Certainty %', 'Link'], rows);
}

export function download(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Everything you've voted, marked and added, as a JSON file you can import again here or on another device. */
export function downloadBackup(leagues: Record<string, { matches: unknown[]; status: unknown; custom: unknown[] }>) {
  const data = Object.fromEntries(Object.entries(leagues).map(([k, l]) => [k, { matches: l.matches, status: l.status, custom: l.custom }]));
  const stamp = new Date().toISOString().slice(0, 10);
  download(`media-league-backup-${stamp}.json`, JSON.stringify({ app: 'media-league', version: 2, exportedAt: new Date().toISOString(), leagues: data }, null, 1), 'application/json');
}
