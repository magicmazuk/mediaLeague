// Builds src/data/movies.json and src/data/tv.json.
//
//   node scripts/build-media.mjs            # both
//   node scripts/build-media.mjs movies     # just one
//
// Sources (all free, no API key):
//   - IMDb's public GraphQL endpoint (the same one imdb.com uses) for the
//     Top 250 Movies / Top 250 TV charts: rank, title, year, poster, rating,
//     genres, plot, vote count. Personal, non-commercial use only per IMDb's terms.
//   - Cinemeta (Stremio's open metadata service) for director / creators,
//     cast, season counts, plus wide background art and transparent title
//     logos served from images.metahub.space.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'src/data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const CHARTS = {
  movies: { chartType: 'TOP_RATED_MOVIES', kind: 'movie', cinemetaType: 'movie', file: 'movies.json' },
  tv: { chartType: 'TOP_RATED_TV_SHOWS', kind: 'tv', cinemetaType: 'series', file: 'tv.json' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(500 * 2 ** i);
    }
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function fetchChart(chartType) {
  const query = `query {
    chartTitles(first: 250, chart: { chartType: ${chartType} }) {
      edges {
        currentRank
        node {
          id
          titleText { text }
          releaseYear { year endYear }
          primaryImage { url }
          ratingsSummary { aggregateRating voteCount }
          genres { genres { text } }
          plot { plotText { plainText } }
          runtime { seconds }
        }
      }
    }
  }`;
  const res = await fetchRetry('https://caching.graphql.imdb.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!json.data?.chartTitles) throw new Error(`IMDb chart ${chartType} failed: ${JSON.stringify(json).slice(0, 300)}`);
  return json.data.chartTitles.edges;
}

async function fetchCinemeta(type, id) {
  try {
    const res = await fetchRetry(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`);
    if (!res.ok) return null;
    return (await res.json()).meta || null;
  } catch {
    return null;
  }
}

// metahub returns 404 (or a tiny placeholder) when it has no art, so check before trusting a URL.
async function imageExists(url) {
  if (!url) return false;
  try {
    const res = await fetchRetry(url, { method: 'HEAD', redirect: 'follow' });
    const type = res.headers.get('content-type') || '';
    const len = Number(res.headers.get('content-length') || 0);
    return res.ok && type.startsWith('image/') && (len === 0 || len > 2000);
  } catch {
    return false;
  }
}

// IMDb image URLs accept size directives; full-size posters are 2000x3000 and huge.
const sizedImdb = (url, width) => (url ? url.replace(/\._V1_.*?\.jpg$/, `._V1_SX${width}.jpg`) : null);

function formatRuntime(seconds) {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function seasonCount(meta) {
  const seasons = new Set((meta?.videos || []).map((v) => v.season).filter((s) => s > 0));
  return seasons.size || null;
}

async function build(key) {
  const cfg = CHARTS[key];
  console.log(`\n[${key}] fetching IMDb chart ${cfg.chartType}…`);
  const edges = await fetchChart(cfg.chartType);
  console.log(`[${key}] ${edges.length} titles; enriching from Cinemeta…`);

  let done = 0;
  const titles = await pool(edges, 6, async ({ currentRank, node }) => {
    const meta = await fetchCinemeta(cfg.cinemetaType, node.id);
    const background = meta?.background || `https://images.metahub.space/background/medium/${node.id}/img`;
    const logo = meta?.logo || `https://images.metahub.space/logo/medium/${node.id}/img`;
    const [hasBg, hasLogo] = await Promise.all([imageExists(background), imageExists(logo)]);
    const poster = sizedImdb(node.primaryImage?.url, 500) || `https://images.metahub.space/poster/medium/${node.id}/img`;

    const isTv = cfg.kind === 'tv';
    const people = (isTv ? meta?.writer : meta?.director) || [];
    const seasons = isTv ? seasonCount(meta) : null;
    const metaLine = isTv
      ? [seasons && `${seasons} season${seasons === 1 ? '' : 's'}`, meta?.runtime && `${meta.runtime} episodes`].filter(Boolean).join(' · ')
      : [formatRuntime(node.runtime?.seconds), meta?.cast?.slice(0, 2).join(', ')].filter(Boolean).join(' · ');

    if (++done % 25 === 0) console.log(`[${key}]   ${done}/${edges.length}`);
    return {
      id: node.id,
      kind: cfg.kind,
      title: node.titleText.text,
      year: node.releaseYear?.year ?? null,
      ...(isTv ? { endYear: node.releaseYear?.endYear ?? null } : {}),
      rank: currentRank,
      poster,
      background: hasBg ? background : null,
      logo: hasLogo ? logo : null,
      genres: (node.genres?.genres || []).map((g) => g.text).slice(0, 3),
      credit: people.slice(0, 2).join(', ') || null,
      creditLabel: isTv ? 'Created by' : 'Directed by',
      summary: node.plot?.plotText?.plainText || meta?.description || '',
      score: node.ratingsSummary?.aggregateRating ?? null,
      // IMDb vote count: a proxy for how likely you are to have seen it, so familiar titles get matched first.
      popularity: node.ratingsSummary?.voteCount ?? null,
      meta: metaLine || null,
      links: {
        imdb: `https://www.imdb.com/title/${node.id}/`,
        ...(isTv ? {} : { letterboxd: `https://letterboxd.com/imdb/${node.id}/` }),
      },
    };
  });

  titles.sort((a, b) => a.rank - b.rank);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, cfg.file), JSON.stringify(titles, null, 1) + '\n');
  const count = (f) => titles.filter((t) => t[f]).length;
  console.log(`[${key}] wrote ${cfg.file}: ${titles.length} titles, ${count('background')} backgrounds, ${count('logo')} logos, ${count('credit')} credits`);
}

const which = process.argv.slice(2);
for (const key of which.length ? which : Object.keys(CHARTS)) {
  if (!CHARTS[key]) throw new Error(`Unknown chart "${key}" (use: ${Object.keys(CHARTS).join(', ')})`);
  await build(key);
}
