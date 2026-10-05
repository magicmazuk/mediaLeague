import { describe, expect, it } from 'vitest';
import { computeStandings, fitBradleyTerry, sigmoid, tableCertainty, toRating } from './rating';
import type { Match } from './types';

const m = (a: string, b: string, s = 1): Match => ({ a, b, s, at: 0, method: 'pick' });

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fitBradleyTerry', () => {
  it('orders a transitive chain', () => {
    const fit = fitBradleyTerry(['a', 'b', 'c', 'd'], [m('a', 'b'), m('b', 'c'), m('c', 'd'), m('a', 'c')]);
    const t = (id: string) => fit.theta.get(id)!;
    expect(t('a')).toBeGreaterThan(t('b'));
    expect(t('b')).toBeGreaterThan(t('c'));
    expect(t('c')).toBeGreaterThan(t('d'));
  });

  it('gives equal strength for draws and keeps the mean at zero', () => {
    const fit = fitBradleyTerry(['a', 'b'], [m('a', 'b', 0.5), m('b', 'a', 0.5)]);
    expect(fit.theta.get('a')).toBeCloseTo(0, 6);
    expect(fit.theta.get('b')).toBeCloseTo(0, 6);
  });

  it('does not depend on the order results were entered', () => {
    const matches = [m('a', 'b'), m('b', 'c'), m('c', 'a'), m('a', 'd'), m('d', 'b', 0.75), m('c', 'd', 0.5)];
    const f1 = fitBradleyTerry(['a', 'b', 'c', 'd'], matches);
    const f2 = fitBradleyTerry(['a', 'b', 'c', 'd'], [...matches].reverse());
    for (const id of ['a', 'b', 'c', 'd']) expect(f1.theta.get(id)).toBeCloseTo(f2.theta.get(id)!, 6);
  });

  it('shrinks uncertainty as a title plays more', () => {
    const few = fitBradleyTerry(['a', 'b'], [m('a', 'b')]);
    const many = fitBradleyTerry(['a', 'b'], Array.from({ length: 10 }, (_, i) => m('a', 'b', i % 2)));
    expect(many.sigma.get('a')!).toBeLessThan(few.sigma.get('a')!);
  });

  it('stays finite for an unbeaten title', () => {
    const fit = fitBradleyTerry(['a', 'b'], Array.from({ length: 30 }, () => m('a', 'b')));
    expect(Number.isFinite(fit.theta.get('a'))).toBe(true);
    expect(fit.theta.get('a')!).toBeGreaterThan(1);
  });

  it('recovers a hidden ranking from noisy picks', () => {
    const rand = mulberry32(7);
    const n = 40;
    const truth = Array.from({ length: n }, (_, i) => (n - i) / 8); // id i0 is best
    const ids = truth.map((_, i) => `i${i}`);
    const matches: Match[] = [];
    for (let k = 0; k < n * 8; k++) {
      const i = Math.floor(rand() * n);
      let j = Math.floor(rand() * n);
      if (j === i) j = (j + 1) % n;
      matches.push(m(ids[i], ids[j], rand() < sigmoid(truth[i] - truth[j]) ? 1 : 0));
    }
    const fit = fitBradleyTerry(ids, matches);
    const order = [...ids].sort((x, y) => fit.theta.get(y)! - fit.theta.get(x)!);
    // Spearman rank correlation between fitted and true order.
    const d2 = order.reduce((sum, id, pos) => sum + (pos - Number(id.slice(1))) ** 2, 0);
    const rho = 1 - (6 * d2) / (n * (n * n - 1));
    expect(rho).toBeGreaterThan(0.9);
  });
});

describe('computeStandings', () => {
  const eligible = new Set(['a', 'b', 'c', 'x']);

  it('builds a football-style table with W/D/L and form', () => {
    const table = computeStandings(eligible, [m('a', 'b'), m('a', 'c'), m('b', 'c', 0.5), m('c', 'a', 0)]);
    expect(table.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const a = table[0];
    expect(a).toMatchObject({ position: 1, played: 3, won: 3, drawn: 0, lost: 0 });
    expect(a.form).toEqual(['W', 'W', 'W']);
    const c = table.find((r) => r.id === 'c')!;
    expect(c).toMatchObject({ won: 0, drawn: 1, lost: 2, form: ['L', 'D', 'L'] });
  });

  it('leaves out titles that have not played or are no longer eligible', () => {
    const table = computeStandings(new Set(['a', 'b']), [m('a', 'b'), m('a', 'c')]);
    expect(table.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(table.find((r) => r.id === 'a')!.played).toBe(1);
  });

  it('reports movement against the matchday snapshot', () => {
    const table = computeStandings(eligible, [m('b', 'a'), m('b', 'c')], { a: 1, b: 2 });
    expect(table[0]).toMatchObject({ id: 'b', movement: 1 });
    expect(table.find((r) => r.id === 'a')!.movement).toBe(-1);
    expect(table.find((r) => r.id === 'c')!.movement).toBeNull();
  });

  it('scales ratings around 1500', () => {
    expect(toRating(0)).toBe(1500);
    expect(toRating(1)).toBeGreaterThan(1600);
  });
});

describe('tableCertainty', () => {
  it('grows as more matchups are played', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const few = computeStandings(new Set(ids), [m('a', 'b'), m('c', 'd')]);
    const lots: Match[] = [];
    for (let k = 0; k < 30; k++) for (let i = 0; i < 4; i++) lots.push(m(ids[i], ids[(i + 1) % 4], k % 2));
    const many = computeStandings(new Set(ids), lots);
    expect(tableCertainty(many).certainty).toBeGreaterThan(tableCertainty(few).certainty);
    expect(tableCertainty(many).matchupsToSettle).toBeLessThan(tableCertainty(few).matchupsToSettle);
  });
});
