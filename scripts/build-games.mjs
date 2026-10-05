#!/usr/bin/env node
// Builds src/data/games.json — the "greatest video games" dataset for The Media League.
//
// Pipeline:
//   1. Wikipedia "List of video games considered the best" (wikitext) -> rows with
//      year / linked article / genre / developer / platforms, plus which best-of lists cite
//      each game. The article's "Publications" section gives each list's year, so games are
//      ranked by the share of lists published since their release that include them
//      (smoothed towards the average so a 2-for-2 newcomer doesn't jump to #1).
//   2. Wikipedia query API (pageimages + pageprops + extracts) -> box art, Wikidata QID, intro.
//   3. Wikidata wbgetentities -> Steam app id (P1733), fallbacks for developer/genre/platform/date.
//   4. Steam IStoreBrowseService/GetItems (keyless) -> current library asset paths, then every
//      candidate image URL is verified with HEAD (fallback: ranged GET) before it is used.
//   5. Microsoft Store display catalog (keyless) -> poster + hero art for a few non-Steam games
//      (Wikidata P5885, or the OVERRIDES table below).
//   Poster preference: Steam 600x900 capsule > MS Store poster > Wikipedia box art.
//   Entries with no poster at all are dropped; the first MAX_GAMES by rank are kept.
//
// Usage:  node scripts/build-games.mjs [maxGames]      (default 250; env MAX_GAMES also works)
//         GAMES_DEBUG=debug.json  additionally writes per-entry diagnostics (sources, citations).
// Requires Node 18+ (global fetch). No npm dependencies.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '../src/data/games.json');

// Wikimedia throttles anonymous clients harder when the User-Agent has no contact details; set
// MEDIA_LEAGUE_CONTACT (an email or URL) to include one.
const UA = `MediaLeague/0.1 (personal project; games dataset builder${process.env.MEDIA_LEAGUE_CONTACT ? '; ' + process.env.MEDIA_LEAGUE_CONTACT : ''})`;
const WP_API = 'https://en.wikipedia.org/w/api.php';
const WD_API = 'https://www.wikidata.org/w/api.php';
const STEAM_ITEMS_API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const STEAM_ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';
const MS_CATALOG_API = 'https://displaycatalog.mp.microsoft.com/v7.0/products';
const LIST_PAGE = 'List of video games considered the best'; // redirects to the current title

const MAX_GAMES = Number(process.argv[2] || process.env.MAX_GAMES || 250);
const CONCURRENCY = 4; // image checks / Steam
const WM_CONCURRENCY = 1; // Wikimedia asks API clients to make requests serially
const WP_BATCH = 20; // TextExtracts returns at most 20 intro extracts per request
const WD_BATCH = 50;
const STEAM_BATCH = 50;
const SUMMARY_MAX = 300;
const MAX_WIKI_IMAGE_PX = 1000; // use a thumbnail instead of originals larger than this
const RANK_SMOOTHING = 10; // pseudo-lists added at the average citation rate (Bayesian average)
const WM_MIN_GAP_MS = 500; // minimum spacing between Wikimedia API requests

// Hand-curated fixes for famous games that have no box art in their own Wikipedia article and
// no Steam release. Keyed by Wikidata QID.
//   posterArticle: borrow the lead image of a closely related article
//   msStore:       Microsoft Store product id (poster + hero art via the public display catalog)
const OVERRIDES = {
  Q71910: { posterArticle: 'Tetris (Game Boy video game)' }, // Tetris: article image is the SVG logo
  Q49740: { msStore: '9NBLGGH2JHXJ' }, // Minecraft: no page image at all
  Q349375: { msStore: 'BT5P2X999VH2' }, // Fortnite: no page image at all
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { requests: 0, retries: 0 };

async function fetchRetry(url, init = {}, { retries = 5 } = {}) {
  let attempt = 0;
  for (;;) {
    stats.requests++;
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, ...(init.headers || {}) },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      res = null;
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable) return res;
    if (attempt >= retries) return res;
    attempt++;
    stats.retries++;
    const retryAfter = Number(res?.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * 2 ** (attempt - 1) + Math.random() * 500;
    console.warn(`  retry ${attempt}/${retries} in ${Math.round(wait)}ms (${res ? res.status : 'network error'}) ${url.slice(0, 120)}`);
    await sleep(wait);
  }
}

let lastWikimediaCall = 0;
async function getJson(url) {
  if (/\.(wikipedia|wikidata)\.org\//.test(url)) {
    const wait = lastWikimediaCall + WM_MIN_GAP_MS - Date.now();
    lastWikimediaCall = Math.max(Date.now(), lastWikimediaCall + WM_MIN_GAP_MS);
    if (wait > 0) await sleep(wait);
  }
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const qs = (params) => new URLSearchParams(params).toString();

/** Run fn over items with at most `limit` in flight. Results keep input order. */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** True if url answers 200/206 with an image content-type. */
const imageCheckCache = new Map();
function isImage(url) {
  if (!imageCheckCache.has(url)) imageCheckCache.set(url, checkImage(url));
  return imageCheckCache.get(url);
}
async function checkImage(url) {
  try {
    let res = await fetchRetry(url, { method: 'HEAD' }, { retries: 3 });
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetchRetry(url, { headers: { Range: 'bytes=0-1023' } }, { retries: 3 });
      res.body?.cancel().catch(() => {});
    }
    const type = res.headers.get('content-type') || '';
    return (res.status === 200 || res.status === 206) && type.startsWith('image/');
  } catch {
    return false;
  }
}

async function firstImage(urls) {
  for (const u of urls) if (u && (await isImage(u))) return u;
  return null;
}

// ---------------------------------------------------------------------------
// Wikitext helpers
// ---------------------------------------------------------------------------

/** Index of the first `|` at bracket depth 0 (outside [[ ]] and {{ }}), or -1. */
function topLevelPipe(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; i++; continue; }
    if (two === ']]' || two === '}}') { depth = Math.max(0, depth - 1); i++; continue; }
    if (s[i] === '|' && depth === 0) return i;
  }
  return -1;
}

/** Remove a leading cell-attribute section such as `colspan="2" |` or `data-sort-value="X" |`. */
function stripCellAttrs(cell) {
  const p = topLevelPipe(cell);
  if (p === -1) return cell.trim();
  const prefix = cell.slice(0, p);
  if (prefix.trim() === '' || /^\s*[\w-]+\s*=/.test(prefix)) return cell.slice(p + 1).trim();
  return cell.trim();
}

/** All [[target|display]] links in a string. */
function links(s) {
  return [...s.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)].map((m) => ({
    target: m[1].trim().replace(/_/g, ' '),
    display: cleanText(m[2] ?? m[1]),
  }));
}

/** Wikitext -> plain display text. */
function cleanText(s) {
  return s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\[[a-z0-9]{1,3}\]/gi, '') // footnote markers like [a] / [1]
    .replace(/\s+/g, ' ')
    .trim();
}

const stripDisambig = (t) => t.replace(/\s*\([^()]*\)\s*$/, '').trim();

const refName = (attrs) => {
  const m = attrs.match(/name\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
  return m ? (m[1] || m[2] || m[3]).trim() : null;
};

/** "Publications" section: `* ''IGN'' – 2003,<ref name=IGN2003/> 2005,<ref name=IGN2005/>` -> Map(refName -> year). */
function parseListYears(wikitext) {
  const start = wikitext.search(/==\s*Publications\s*==/);
  if (start === -1) return new Map();
  const end = wikitext.indexOf('\n==', start + 5);
  const section = wikitext.slice(start, end === -1 ? undefined : end);
  const years = new Map();
  for (const m of section.matchAll(/\b(19[789]\d|20\d\d)\b\s*,?\s*<ref\b([^>]*?)\/>/g)) {
    const name = refName(m[2]);
    if (name) years.set(name, Number(m[1]));
  }
  return years;
}

/**
 * Score = smoothed share of eligible lists (published in or after the game's year) citing it.
 * Lists whose year is unknown count as eligible for every game. Falls back to raw counts if the
 * Publications section could not be parsed.
 */
function scoreRows(rows, listYears) {
  if (listYears.size < 20) {
    console.warn('  ! Could not read list years from the Publications section; ranking by raw citation count');
    for (const r of rows) r.score = r.citations;
    return;
  }
  const unknownLists = new Set(rows.flatMap((r) => r.lists).filter((n) => !listYears.has(n)));
  const years = [...listYears.values()];
  for (const r of rows) r.eligible = years.filter((y) => y >= r.year).length + unknownLists.size;
  const prior = rows.reduce((a, r) => a + r.citations, 0) / rows.reduce((a, r) => a + r.eligible, 0);
  for (const r of rows) r.score = (r.citations + RANK_SMOOTHING * prior) / (r.eligible + RANK_SMOOTHING);
  console.log(`Ranking: ${listYears.size} dated lists (${unknownLists.size} undated), mean citation rate ${prior.toFixed(3)}`);
}

/** Parse the main list table into rows. */
function parseListTable(wikitext) {
  const start = wikitext.search(/\{\|\s*class="wikitable[^\n]*\n(?:[^\n]*\n){0,4}?[^\n]*scope="col"\s*\|\s*Year/);
  if (start === -1) throw new Error('Could not find the games table in the list article');
  const end = wikitext.indexOf('\n|}', start);
  const table = wikitext.slice(start, end);
  const rawRows = table.split(/\n\|-[^\n]*/).slice(1);

  const rows = [];
  let year = null;
  rawRows.forEach((raw, order) => {
    const cells = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('!')) cells.push({ header: true, text: line.slice(1) });
      else if (line.startsWith('|') && !line.startsWith('|+')) cells.push({ header: false, text: line.slice(1) });
      else if (cells.length) cells[cells.length - 1].text += '\n' + line;
    }
    const header = cells.find((c) => c.header);
    if (header) {
      const m = header.text.match(/\b(1[89]\d\d|20\d\d)\b/);
      if (m) year = Number(m[1]);
    }
    const tds = cells.filter((c) => !c.header);
    if (tds.length < 3) return;

    const refIdx = tds.findIndex((c) => /efn-ua|<ref/i.test(c.text));
    const refCell = refIdx >= 0 ? tds[refIdx].text : '';
    const dataCells = (refIdx >= 0 ? tds.slice(0, refIdx) : tds).map((c) => stripCellAttrs(c.text));

    const gameCell = dataCells[0];
    const gameLink = links(gameCell)[0];
    if (!gameLink) return;
    const genreCell = dataCells[1] || '';
    const devCell = dataCells[2] || '';
    const platformCell = dataCells.length >= 4 ? dataCells[dataCells.length - 1] : '';

    const refNames = new Set();
    let anonymous = 0;
    for (const m of refCell.matchAll(/<ref\b([^>]*?)(\/?)>/gi)) {
      const name = refName(m[1]);
      if (name) refNames.add(name);
      else anonymous++;
    }

    rows.push({
      order,
      year,
      article: gameLink.target,
      title: cleanText(gameCell),
      genres: links(genreCell).map((l) => l.display).filter(Boolean),
      developers: links(devCell).map((l) => l.display).filter(Boolean),
      platforms: links(platformCell).map((l) => l.display).filter(Boolean),
      lists: [...refNames],
      citations: refNames.size + anonymous,
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set(['inc', 'ltd', 'co', 'corp', 'jr', 'sr', 'dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'no', 'vol', 'ca', 'approx', 'etc', 'u.s', 'u.k', 'e.g', 'i.e']);
const SENTENCE_OPENERS = /^(The|It|Its|A|An|In|On|At|As|After|Before|During|Following|Upon|While|This|These|That|He|She|They|His|Her|Their|Players?|Set|Originally|Development)\b/;

function splitSentences(text) {
  const out = [];
  let startIdx = 0;
  const re = /[.!?](?=["')\]]?\s+["'(]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(startIdx, m.index);
    const word = (before.match(/(\S+)$/)?.[1] || '').toLowerCase().replace(/^["'(]/, '');
    if (ABBREVIATIONS.has(word)) continue;
    // A single letter is usually an initial ("George R. R. Martin") unless a typical sentence
    // opener follows ("... and OS X. The game ...").
    if (/^[a-z]$/.test(word) && !SENTENCE_OPENERS.test(text.slice(m.index + 1).trimStart())) continue;
    let endIdx = m.index + 1;
    while (/["')\]]/.test(text[endIdx] || '')) endIdx++;
    out.push(text.slice(startIdx, endIdx).trim());
    startIdx = endIdx;
  }
  const rest = text.slice(startIdx).trim();
  if (rest) out.push(rest);
  return out;
}

function cleanExtract(text) {
  if (!text) return '';
  let t = text.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, ''); // soft hyphens / zero-width chars
  t = t.split('\n').find((p) => p.trim().length > 40) || t; // first real paragraph
  // Drop parentheticals holding foreign-script names, romanizations, pronunciations, etc.
  for (let i = 0; i < 3; i++) {
    t = t.replace(/\s*\((?:[^()]|\([^()]*\))*\)/g, (paren) =>
      /[\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]|Japanese|Hepburn|Korean|Chinese|Russian|French|German|Polish|lit\.|romanized|pronounced|abbreviated|also known|known as|referred to|titled|released as|originally|stylized|stylised|^\s*\(\s*[;,]?\s*\)$/i.test(paren)
        ? ''
        : paren,
    );
  }
  return t.replace(/\(\s*[;,]?\s*\)/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

function makeSummary(extract) {
  const text = cleanExtract(extract);
  if (!text) return '';
  const sentences = splitSentences(text);
  let summary = sentences[0] || '';
  if (sentences[1] && summary.length + 1 + sentences[1].length <= SUMMARY_MAX) summary += ' ' + sentences[1];
  if (summary.length > SUMMARY_MAX) {
    summary = summary.slice(0, SUMMARY_MAX - 1).replace(/[\s,;:]+\S*$/, '') + '…';
  }
  return summary;
}

const PLATFORM_SHORT = {
  'PC': 'PC', 'Windows': 'PC', 'Microsoft Windows': 'PC', 'MS-DOS': 'PC', 'DOS': 'PC',
  'Mac': 'Mac', 'macOS': 'Mac', 'Classic Mac OS': 'Mac', 'Linux': 'Linux',
  'PlayStation': 'PS1', 'PlayStation 2': 'PS2', 'PlayStation 3': 'PS3', 'PlayStation 4': 'PS4', 'PlayStation 5': 'PS5',
  'PlayStation Portable': 'PSP', 'PlayStation Vita': 'Vita',
  'Xbox Series X/S': 'Xbox Series', 'Xbox Series X and Series S': 'Xbox Series',
  'Nintendo Switch': 'Switch', 'Nintendo Switch 2': 'Switch 2', 'Nintendo 64': 'N64', 'Super NES': 'SNES',
  'Super Nintendo Entertainment System': 'SNES', 'Nintendo Entertainment System': 'NES',
  'Game Boy Advance': 'GBA', 'Game Boy Color': 'GBC', 'Nintendo DS': 'DS', 'Nintendo 3DS': '3DS',
  'Sega Genesis': 'Genesis', 'Mega Drive': 'Genesis', 'Sega Saturn': 'Saturn', 'Sega CD': 'Sega CD',
  'Commodore 64': 'C64', 'Arcade video game': 'Arcade', 'arcade video game machine': 'Arcade',
};

function platformsLine(platforms) {
  let list = [...new Set(platforms.map((p) => PLATFORM_SHORT[p] || p))];
  if (list.includes('Xbox One') && list.includes('Xbox Series')) {
    list = list.filter((p) => p !== 'Xbox Series').map((p) => (p === 'Xbox One' ? 'Xbox' : p));
  }
  return list.slice(0, 4).join(' · ');
}

function titleCaseGenre(g) {
  const s = g.replace(/\s+(video )?game$/i, '').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function wikiUrl(title) {
  return 'https://en.wikipedia.org/wiki/' + encodeURI(title.replace(/ /g, '_')).replace(/\?/g, '%3F');
}

const stripQuery = (u) => (u ? u.split('?')[0] : u);

// ---------------------------------------------------------------------------
// Wikipedia / Wikidata
// ---------------------------------------------------------------------------

async function fetchListRows() {
  const url = `${WP_API}?${qs({ action: 'parse', page: LIST_PAGE, prop: 'wikitext', redirects: 1, format: 'json', formatversion: 2 })}`;
  const json = await getJson(url);
  if (!json.parse?.wikitext) throw new Error('No wikitext returned for list page');
  console.log(`List article: "${json.parse.title}"`);
  const rows = parseListTable(json.parse.wikitext);
  scoreRows(rows, parseListYears(json.parse.wikitext));
  return rows;
}

/** Resolve article titles -> { finalTitle, qid, image, extract }. */
async function fetchWikipediaPages(titles) {
  const result = new Map();
  await mapPool(chunk(titles, WP_BATCH), WM_CONCURRENCY, async (batch) => {
    const params = {
      action: 'query', titles: batch.join('|'), redirects: 1, format: 'json', formatversion: 2,
      prop: 'pageimages|pageprops|extracts', piprop: 'original|thumbnail', pithumbsize: 600, pilicense: 'any', pilimit: 50,
      ppprop: 'wikibase_item', exintro: 1, explaintext: 1, exlimit: 'max',
    };
    let cont = {};
    const pages = new Map();
    let normalized = [], redirects = [];
    do {
      const json = await getJson(`${WP_API}?${qs({ ...params, ...cont })}`);
      normalized = normalized.concat(json.query?.normalized || []);
      redirects = redirects.concat(json.query?.redirects || []);
      for (const p of json.query?.pages || []) {
        const prev = pages.get(p.title) || {};
        pages.set(p.title, { ...prev, ...p, pageprops: { ...prev.pageprops, ...p.pageprops } });
      }
      cont = json.continue || null;
    } while (cont);

    const norm = new Map(normalized.map((n) => [n.from, n.to]));
    const redir = new Map(redirects.map((r) => [r.from, r.to]));
    for (const t of batch) {
      let final = norm.get(t) || t;
      final = redir.get(final) || final;
      const p = pages.get(final);
      if (!p || p.missing || p.invalid) { console.warn(`  ! Wikipedia page missing: ${t}`); continue; }
      result.set(t, {
        finalTitle: p.title,
        qid: p.pageprops?.wikibase_item || null,
        image: pickWikiImage(p),
        extract: p.extract || '',
      });
    }
  });
  return result;
}

/** Original lead image, or its thumbnail when the original is a huge file (e.g. a photo). */
function pickWikiImage(p) {
  const o = p.original;
  if (!o) return null;
  const t = p.thumbnail;
  const img = Math.max(o.width, o.height) > MAX_WIKI_IMAGE_PX && t ? t : o;
  return { url: stripQuery(img.source), width: img.width, height: img.height };
}

const claimValues = (entity, prop) =>
  (entity?.claims?.[prop] || [])
    .filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue)
    .sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred'))
    .map((c) => c.mainsnak.datavalue.value);

async function fetchWikidataEntities(ids, props = 'claims') {
  const out = new Map();
  await mapPool(chunk([...new Set(ids)], WD_BATCH), WM_CONCURRENCY, async (batch) => {
    const json = await getJson(`${WD_API}?${qs({ action: 'wbgetentities', ids: batch.join('|'), props, languages: 'en', format: 'json' })}`);
    for (const [id, e] of Object.entries(json.entities || {})) if (!e.missing) out.set(id, e);
  });
  return out;
}

async function fetchLabels(ids) {
  const entities = await fetchWikidataEntities(ids, 'labels');
  return new Map([...entities].map(([id, e]) => [id, e.labels?.en?.value]).filter(([, v]) => v));
}

// ---------------------------------------------------------------------------
// Steam
// ---------------------------------------------------------------------------

async function fetchSteamItems(appids) {
  const out = new Map();
  await mapPool(chunk([...new Set(appids)], STEAM_BATCH), CONCURRENCY, async (batch) => {
    const input = {
      ids: batch.map((appid) => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: { include_assets: true },
    };
    try {
      const json = await getJson(`${STEAM_ITEMS_API}?${qs({ input_json: JSON.stringify(input) })}`);
      for (const item of json.response?.store_items || []) {
        if (item.success === 1 && item.appid) out.set(item.appid, item);
      }
    } catch (err) {
      console.warn(`  ! Steam GetItems failed for a batch (${err.message}); falling back to plain CDN paths`);
    }
  });
  return out;
}

function steamAssetUrl(item, key) {
  const fmt = item?.assets?.asset_url_format;
  const file = item?.assets?.[key];
  return fmt && file ? STEAM_ASSET_BASE + stripQuery(fmt.replace('${FILENAME}', file)) : null;
}

async function steamArt(appid, item) {
  const cdn = (f) => `${STEAM_CDN}${appid}/${f}`;
  const [poster, background, logo] = await Promise.all([
    firstImage([
      steamAssetUrl(item, 'library_capsule_2x'),
      steamAssetUrl(item, 'library_capsule'),
      cdn('library_600x900_2x.jpg'),
      cdn('library_600x900.jpg'),
    ]),
    firstImage([steamAssetUrl(item, 'library_hero'), cdn('library_hero.jpg')]),
    firstImage([cdn('logo.png')]),
  ]);
  return { poster, background, logo };
}

// ---------------------------------------------------------------------------
// Microsoft Store (fallback artwork for games with no Steam release)
// ---------------------------------------------------------------------------

async function fetchMsStoreArt(productIds) {
  const out = new Map();
  for (const batch of chunk([...new Set(productIds.map((id) => id.toUpperCase()))], 20)) {
    try {
      const json = await getJson(`${MS_CATALOG_API}?${qs({ bigIds: batch.join(','), market: 'US', languages: 'en-US' })}`);
      for (const p of json.Products || []) {
        const lp = p.LocalizedProperties?.[0];
        const img = (purpose) => {
          const i = (lp?.Images || []).filter((x) => x.ImagePurpose === purpose).sort((a, b) => b.Width - a.Width)[0];
          return i ? (i.Uri.startsWith('//') ? 'https:' + i.Uri : i.Uri) : null;
        };
        out.set(p.ProductId.toUpperCase(), { name: lp?.ProductTitle, poster: img('Poster'), background: img('SuperHeroArt') });
      }
    } catch (err) {
      console.warn(`  ! Microsoft Store catalog request failed (${err.message})`);
    }
  }
  return out;
}

const normName = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  console.log(`Building games dataset (max ${MAX_GAMES})…`);

  // 1. List rows
  const rows = await fetchListRows();
  console.log(`Parsed ${rows.length} rows from the list table`);

  // 2. Wikipedia pages
  const pages = await fetchWikipediaPages([...new Set(rows.map((r) => r.article))]);
  console.log(`Resolved ${pages.size} Wikipedia articles`);

  // Merge, rank by score (ties: more citations, then article order), de-duplicate by QID
  let games = rows
    .map((r) => ({ ...r, page: pages.get(r.article) }))
    .filter((g) => g.page?.qid);
  games.sort((a, b) => b.score - a.score || b.citations - a.citations || a.order - b.order);
  const seen = new Set();
  games = games.filter((g) => (seen.has(g.page.qid) ? (console.log(`  dup QID ${g.page.qid}: ${g.title}`), false) : seen.add(g.page.qid)));
  console.log(`${games.length} unique games with a Wikidata item`);

  // 3. Wikidata claims
  const entities = await fetchWikidataEntities(games.map((g) => g.page.qid));
  for (const g of games) g.entity = entities.get(g.page.qid);
  const fallbackIds = new Set();
  for (const g of games) {
    if (!g.developers.length) claimValues(g.entity, 'P178').forEach((v) => fallbackIds.add(v.id));
    if (!g.genres.length) claimValues(g.entity, 'P136').forEach((v) => fallbackIds.add(v.id));
    if (!g.platforms.length) claimValues(g.entity, 'P400').forEach((v) => fallbackIds.add(v.id));
  }
  const labels = fallbackIds.size ? await fetchLabels([...fallbackIds]) : new Map();
  if (fallbackIds.size) console.log(`Resolved ${labels.size} Wikidata labels for fallbacks`);

  // 4. Steam: asset paths for every candidate app id
  for (const g of games) g.steamIds = [...new Set(claimValues(g.entity, 'P1733').map((v) => Number(v)).filter(Number.isFinite))];
  const steamItems = await fetchSteamItems(games.flatMap((g) => g.steamIds));
  console.log(`Steam store items found: ${steamItems.size}`);

  // Microsoft Store art (Wikidata P5885, or a hand-curated override) for games Steam can't cover
  for (const g of games) {
    const o = OVERRIDES[g.page.qid] || {};
    g.override = o;
    g.msStoreId = o.msStore || (!g.steamIds.some((id) => steamItems.has(id)) ? claimValues(g.entity, 'P5885')[0] : null) || null;
  }
  const msArt = await fetchMsStoreArt(games.map((g) => g.msStoreId).filter(Boolean));
  console.log(`Microsoft Store products found: ${msArt.size}`);
  const posterArticles = Object.values(OVERRIDES).map((o) => o.posterArticle).filter(Boolean);
  const overridePages = posterArticles.length ? await fetchWikipediaPages(posterArticles) : new Map();

  // 5. Build entries in rank order until MAX_GAMES have a verified poster
  const out = [];
  const dropped = [];
  const steamNameMismatches = [];
  const batchSize = CONCURRENCY * 3;
  for (let i = 0; i < games.length && out.length < MAX_GAMES; i += batchSize) {
    const built = await mapPool(games.slice(i, i + batchSize), CONCURRENCY, buildEntry);
    for (const e of built) {
      if (!e.entry) { dropped.push(e.reason); continue; }
      if (e.mismatch) steamNameMismatches.push(e.mismatch);
      if (out.length < MAX_GAMES) out.push(e.entry);
    }
  }

  async function buildEntry(g) {
    const page = g.page;
    // Steam: first listed app id that is a live store item, else first id (CDN paths may still work)
    const appid = g.steamIds.find((id) => steamItems.has(id)) ?? g.steamIds[0] ?? null;
    const item = appid ? steamItems.get(appid) : null;
    const art = appid ? await steamArt(appid, item) : { poster: null, background: null, logo: null };

    const ms = g.msStoreId ? msArt.get(g.msStoreId.toUpperCase()) : null;
    if (ms) {
      const [msPoster, msBackground] = await Promise.all([firstImage([ms.poster]), firstImage([ms.background])]);
      if (!art.poster && msPoster) Object.assign(art, { poster: msPoster, posterSource: 'msstore' });
      if (!art.background && msBackground) art.background = msBackground;
    }

    let poster = art.poster;
    let posterSource = poster ? art.posterSource || 'steam' : null;
    const wikiImage = overridePages.get(g.override.posterArticle)?.image || page.image;
    // Wikipedia box art: the query API only returns `original` for an existing file (with its
    // dimensions), so it is not re-checked over HTTP — upload.wikimedia.org 429s bursts of HEADs.
    if (!poster && wikiImage && !/\.svg$/i.test(wikiImage.url)) {
      poster = wikiImage.url;
      posterSource = 'wikipedia';
    }
    const title = g.title || stripDisambig(page.finalTitle);
    if (!poster) return { reason: `${title} (no usable poster)` };

    const dateClaim = claimValues(g.entity, 'P577')[0];
    const year = g.year ?? (dateClaim ? Number(dateClaim.time.slice(1, 5)) : null);
    if (!Number.isFinite(year)) return { reason: `${title} (no year)` };

    const developers = g.developers.length ? g.developers : claimValues(g.entity, 'P178').map((v) => labels.get(v.id)).filter(Boolean);
    const genres = g.genres.length ? g.genres : claimValues(g.entity, 'P136').map((v) => labels.get(v.id)).filter(Boolean);
    const platforms = g.platforms.length ? g.platforms : claimValues(g.entity, 'P400').map((v) => labels.get(v.id)).filter(Boolean);

    let mismatch = null;
    if (item?.name) {
      const a = normName(item.name), b = normName(title);
      const overlap = b.split(' ').filter((w) => w.length > 2 && a.includes(w)).length;
      if (!a.includes(b) && !b.includes(a) && overlap === 0) mismatch = `${title} -> Steam ${appid} "${item.name}"`;
    }

    const linksObj = { wikipedia: wikiUrl(page.finalTitle) };
    if (item) linksObj.steam = `https://store.steampowered.com/app/${appid}`;

    return {
      mismatch,
      entry: {
        id: `g-${page.qid}`,
        kind: 'game',
        title,
        year,
        rank: 0,
        poster,
        background: art.background,
        logo: art.logo,
        genres: [...new Set(genres.map(titleCaseGenre))].slice(0, 3),
        credit: developers.slice(0, 2).join(', ') || null,
        creditLabel: 'Developer',
        summary: makeSummary(page.extract),
        score: null,
        meta: platformsLine(platforms),
        links: linksObj,
        _posterSource: posterSource,
        _citations: g.citations,
        _eligible: g.eligible,
        _wikiImage: wikiImage,
        _steamIds: g.steamIds,
        _steamName: item?.name,
        _msName: ms?.name,
      },
    };
  }

  out.forEach((e, i) => (e.rank = i + 1));

  // Report
  const count = (pred) => out.filter(pred).length;
  console.log('\n=== Summary ===');
  console.log(`Entries written:        ${out.length}`);
  console.log(`Poster from Steam:      ${count((e) => e._posterSource === 'steam')}`);
  console.log(`Poster from MS Store:   ${count((e) => e._posterSource === 'msstore')}`);
  console.log(`Poster from Wikipedia:  ${count((e) => e._posterSource === 'wikipedia')}`);
  const landscape = out.filter((e) => e._posterSource === 'wikipedia' && e._wikiImage.height / e._wikiImage.width < 1.1);
  console.log(`Landscape/square Wikipedia posters (h/w < 1.1): ${landscape.length}`);
  console.log(`With background:        ${count((e) => e.background)}`);
  console.log(`With logo:              ${count((e) => e.logo)}`);
  console.log(`With Steam link:        ${count((e) => e.links.steam)}`);
  console.log(`Missing summary:        ${count((e) => !e.summary)}`);
  const cites = out.map((e) => e._citations);
  console.log(`Citations range:        ${Math.min(...cites)}–${Math.max(...cites)}`);
  if (dropped.length) console.log(`Dropped (${dropped.length}): ${dropped.join('; ')}`);
  if (steamNameMismatches.length) console.log(`Steam name check (review): \n  ${steamNameMismatches.join('\n  ')}`);
  console.log(`HTTP requests: ${stats.requests} (retries: ${stats.retries}); ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (process.env.GAMES_DEBUG) await writeFile(process.env.GAMES_DEBUG, JSON.stringify({ out, dropped }, null, 2));
  const final = out.map(({ _posterSource, _citations, _eligible, _wikiImage, _steamIds, _steamName, _msName, ...e }) => e);
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(final, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
