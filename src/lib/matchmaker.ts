import { fitBradleyTerry, PRIOR_SD, sigmoid } from './rating';
import type { LeagueState, Title } from './types';

export type Rng = () => number;
type LeagueView = Pick<LeagueState, 'status' | 'matches' | 'skipped'>;

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function weightedPick<T>(items: T[], weight: (item: T) => number, rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  const weights = items.map(weight);
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

const randomItem = <T>(items: T[], rng: Rng): T | undefined => items[Math.floor(rng() * items.length)];

/**
 * How likely you are to have seen a title: IMDb vote count where we have it,
 * otherwise its position in the source list. Untried titles are drawn in
 * proportion to this, so the first matchups feature films people have actually seen.
 */
const familiarity = (t: Title) => (t.popularity ? t.popularity ** 0.75 : 1 / Math.sqrt(t.rank || 1));
const drawUntried = (list: Title[], rng: Rng) => weightedPick(list, familiarity, rng);

function buildContext(titles: Title[], league: LeagueView, exclude: string[]) {
  const excluded = new Set(exclude);
  const pool = titles.filter((t) => league.status[t.id] !== 'unseen' && !excluded.has(t.id));

  const played = new Map<string, number>();
  const compared = new Map<string, number>();
  for (const m of league.matches) {
    played.set(m.a, (played.get(m.a) ?? 0) + 1);
    played.set(m.b, (played.get(m.b) ?? 0) + 1);
    const k = pairKey(m.a, m.b);
    compared.set(k, (compared.get(k) ?? 0) + 1);
  }
  const isKnown = (t: Title) => league.status[t.id] === 'seen' || played.has(t.id);
  const known = pool.filter(isKnown);
  const unknown = pool.filter((t) => !isKnown(t));

  const fit = fitBradleyTerry(
    known.map((t) => t.id),
    league.matches,
  );
  const sigma = (id: string) => fit.sigma.get(id) ?? PRIOR_SD;
  const meanSigma = known.length ? known.reduce((s, t) => s + sigma(t.id), 0) / known.length : PRIOR_SD;
  const settledness = 1 - meanSigma / PRIOR_SD; // 0 = nothing known, ~0.6 = well settled

  const recentIds = new Set(league.matches.slice(-2).flatMap((m) => [m.a, m.b]));
  return {
    pool,
    known,
    unknown,
    played,
    compared,
    skipped: new Set(league.skipped),
    theta: (id: string) => fit.theta.get(id) ?? 0,
    sigma,
    freshness: (id: string) => (recentIds.has(id) ? 0.15 : 1),
    introduceChance: known.length < 8 ? 0.6 : Math.min(0.6, 0.15 + settledness * 0.8),
  };
}
type Context = ReturnType<typeof buildContext>;

/**
 * Expected information from a matchup: a close contest (P ≈ 50%) between titles
 * whose placings are uncertain teaches us the most. Repeats and titles that were
 * just on screen are discounted.
 */
function pairScore(ctx: Context, a: string, b: string) {
  if (ctx.skipped.has(pairKey(a, b))) return 0;
  const p = sigmoid(ctx.theta(a) - ctx.theta(b));
  const info = p * (1 - p) * (ctx.sigma(a) ** 2 + ctx.sigma(b) ** 2);
  const repeatPenalty = 1 / (1 + 3 * (ctx.compared.get(pairKey(a, b)) ?? 0));
  return info * repeatPenalty * ctx.freshness(a) * ctx.freshness(b);
}

/** Finds the opponent for `anchor` whose result would teach us the most. */
function chooseOpponent(ctx: Context, anchor: string, rng: Rng): string | null {
  const others = (list: Title[]) => list.filter((t) => t.id !== anchor);
  const unknown = others(ctx.unknown);
  if (unknown.length > 0 && rng() < ctx.introduceChance) return drawUntried(unknown, rng)!.id;

  const candidates = others(ctx.known)
    .map((t) => ({ id: t.id, score: pairScore(ctx, anchor, t.id) }))
    .filter((c) => c.score > 0)
    .sort((x, y) => y.score - x.score);

  // Sample among the most informative few so matchups don't feel mechanical.
  const pick = weightedPick(candidates.slice(0, 5), (c) => c.score, rng);
  return pick?.id ?? drawUntried(unknown, rng)?.id ?? null;
}

const shuffled = (a: string, b: string, rng: Rng): [string, string] => (rng() < 0.5 ? [a, b] : [b, a]);

/**
 * Chooses the next matchup.
 *
 * Titles you've already rated (or ticked as seen) form the "known" pool. Each pick
 * starts from a title whose placing is still uncertain, then finds the opponent
 * whose result would teach us the most: a close contest (P ≈ 50%) between
 * uncertain titles. Every so often an untried title from the list is brought in
 * instead, more often as the known part of the table settles.
 */
export function nextPair(titles: Title[], league: LeagueView, rng: Rng = Math.random, exclude: string[] = []): [string, string] | null {
  const ctx = buildContext(titles, league, exclude);
  if (ctx.pool.length < 2) return null;

  if (ctx.known.length < 2) {
    const first = ctx.known[0] ?? drawUntried(ctx.unknown, rng)!;
    const second = drawUntried(
      ctx.unknown.filter((t) => t.id !== first.id),
      rng,
    );
    return second ? shuffled(first.id, second.id, rng) : null;
  }

  if (ctx.unknown.length > 0 && rng() < ctx.introduceChance) {
    // A new title enters against a mid-table opponent so its first result is informative.
    const anchor = weightedPick(ctx.known, (t) => Math.exp(-(ctx.theta(t.id) ** 2)) * ctx.freshness(t.id), rng)!;
    return shuffled(anchor.id, drawUntried(ctx.unknown, rng)!.id, rng);
  }

  // Score every known pair (≤ ~31k for a full 250-title league; cheap) and sample
  // among the best few so matchups don't feel mechanical.
  const pairs: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < ctx.known.length; i++) {
    for (let j = i + 1; j < ctx.known.length; j++) {
      if (ctx.known[i].id === ctx.known[j].id) continue;
      const score = pairScore(ctx, ctx.known[i].id, ctx.known[j].id);
      if (score > 0) pairs.push({ a: ctx.known[i].id, b: ctx.known[j].id, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const best = weightedPick(pairs.slice(0, 8), (p) => p.score, rng);
  if (best) return shuffled(best.a, best.b, rng);
  const fallback = drawUntried(ctx.unknown, rng);
  return fallback ? shuffled(randomItem(ctx.known, rng)!.id, fallback.id, rng) : null;
}

/** New opponent for `keep` when the other side is marked "not seen". */
export function replaceSide(titles: Title[], league: LeagueView, keep: string, drop: string, rng: Rng = Math.random): string | null {
  const ctx = buildContext(titles, { ...league, status: { ...league.status, [drop]: 'unseen' } }, []);
  return chooseOpponent(ctx, keep, rng);
}
