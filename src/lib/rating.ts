import type { Match, Standing } from './types';

/**
 * Ratings come from a Bradley-Terry model: each title has a hidden strength θ and
 * P(A beats B) = sigmoid(θA − θB). We fit θ to every result so far (a MAP estimate
 * with a Normal(0, PRIOR_SD²) prior), which makes the table independent of the order
 * you answered in — unlike Elo — and gives each title an uncertainty σ for free.
 */
export const PRIOR_SD = 1.5;
/** A title counts as "settled" once σ drops to this (≈14 close matchups). */
export const SETTLED_SD = 0.5;

const PRIOR_PRECISION = 1 / (PRIOR_SD * PRIOR_SD);
const ELO_SCALE = 400 / Math.LN10;

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface Fit {
  theta: Map<string, number>;
  sigma: Map<string, number>;
}

export function fitBradleyTerry(ids: Iterable<string>, matches: Match[], maxSweeps = 300): Fit {
  const theta = new Map<string, number>();
  for (const id of ids) theta.set(id, 0);
  const relevant = matches.filter((m) => theta.has(m.a) && theta.has(m.b));

  const grad = new Map<string, number>();
  const hess = new Map<string, number>();

  const accumulate = () => {
    for (const [id, t] of theta) {
      grad.set(id, -t * PRIOR_PRECISION);
      hess.set(id, PRIOR_PRECISION);
    }
    for (const m of relevant) {
      const p = sigmoid(theta.get(m.a)! - theta.get(m.b)!);
      const info = p * (1 - p);
      grad.set(m.a, grad.get(m.a)! + (m.s - p));
      grad.set(m.b, grad.get(m.b)! - (m.s - p));
      hess.set(m.a, hess.get(m.a)! + info);
      hess.set(m.b, hess.get(m.b)! + info);
    }
  };

  // Diagonal Newton (Jacobi) sweeps. The log-posterior is strictly concave and its
  // Hessian is diagonally dominant thanks to the prior, so this converges reliably.
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    accumulate();
    let maxStep = 0;
    for (const [id, t] of theta) {
      const step = Math.max(-1, Math.min(1, grad.get(id)! / hess.get(id)!));
      theta.set(id, t + step);
      maxStep = Math.max(maxStep, Math.abs(step));
    }
    if (maxStep < 1e-7) break;
  }

  accumulate();
  const sigma = new Map<string, number>();
  for (const [id, h] of hess) sigma.set(id, 1 / Math.sqrt(h));
  return { theta, sigma };
}

export const toRating = (theta: number) => Math.round(1500 + theta * ELO_SCALE);

export const certaintyOf = (sigma: number) =>
  Math.max(0, Math.min(1, (PRIOR_SD - sigma) / (PRIOR_SD - SETTLED_SD)));

export const outcome = (s: number): 'W' | 'D' | 'L' => (s > 0.5 ? 'W' : s < 0.5 ? 'L' : 'D');

/**
 * Builds the league table. Only titles that have played at least once appear;
 * `snapshot` holds positions from the start of the matchday for the movement arrows.
 */
export function computeStandings(
  eligible: Set<string>,
  matches: Match[],
  snapshot: Record<string, number> = {},
): Standing[] {
  const relevant = matches.filter((m) => eligible.has(m.a) && eligible.has(m.b));
  const record = new Map<string, { won: number; drawn: number; lost: number; form: ('W' | 'D' | 'L')[] }>();
  const rec = (id: string) => {
    let r = record.get(id);
    if (!r) record.set(id, (r = { won: 0, drawn: 0, lost: 0, form: [] }));
    return r;
  };
  for (const m of relevant) {
    for (const [id, s] of [
      [m.a, m.s],
      [m.b, 1 - m.s],
    ] as const) {
      const r = rec(id);
      const o = outcome(s);
      if (o === 'W') r.won++;
      else if (o === 'L') r.lost++;
      else r.drawn++;
      r.form.push(o);
    }
  }

  const ids = [...record.keys()];
  const fit = fitBradleyTerry(ids, relevant);
  const rows = ids.map((id) => {
    const r = record.get(id)!;
    const theta = fit.theta.get(id)!;
    const sigma = fit.sigma.get(id)!;
    return {
      id,
      position: 0,
      rating: toRating(theta),
      theta,
      sigma,
      certainty: certaintyOf(sigma),
      played: r.won + r.drawn + r.lost,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      form: r.form.slice(-5),
      movement: null as number | null,
    };
  });
  rows.sort((x, y) => y.theta - x.theta || y.won - x.won || x.played - y.played || x.id.localeCompare(y.id));
  rows.forEach((row, i) => {
    row.position = i + 1;
    const before = snapshot[row.id];
    row.movement = before === undefined ? null : before - row.position;
  });
  return rows;
}

/** Overall "how settled is the table" score plus a rough estimate of matchups still needed. */
export function tableCertainty(standings: Standing[]) {
  if (standings.length === 0) return { certainty: 0, matchupsToSettle: 0 };
  const certainty = standings.reduce((sum, s) => sum + s.certainty, 0) / standings.length;
  // Each close matchup adds ~0.25 information to both titles involved.
  const needed = standings.reduce((sum, s) => {
    const targetPrecision = 1 / (SETTLED_SD * SETTLED_SD);
    const precision = 1 / (s.sigma * s.sigma);
    return sum + Math.max(0, (targetPrecision - precision) / 0.25);
  }, 0);
  return { certainty, matchupsToSettle: Math.ceil(needed / 2) };
}
