import type { LeagueKind } from './types';

/**
 * "Still can't decide?" runs a penalty shootout: each kick is one question about a
 * specific quality, and whichever title you pick scores. Best of five, then sudden
 * death if it's level.
 */
export interface Question {
  id: string;
  ask: string;
}

export const QUESTIONS: Record<LeagueKind, Question[]> = {
  movie: [
    { id: 'story', ask: 'Which has the better story?' },
    { id: 'cinematography', ask: 'Which has the better cinematography?' },
    { id: 'performances', ask: 'Which has the stronger performances?' },
    { id: 'score', ask: 'Which has the better score or soundtrack?' },
    { id: 'script', ask: 'Which has the sharper script and dialogue?' },
    { id: 'rewatch', ask: 'Which would you rather rewatch tonight?' },
    { id: 'ending', ask: 'Which has the better ending?' },
    { id: 'stayed', ask: 'Which one stayed with you longer?' },
    { id: 'scenes', ask: 'Which has the more iconic scenes?' },
  ],
  tv: [
    { id: 'story', ask: 'Which tells the better overall story?' },
    { id: 'characters', ask: 'Which has the characters you cared about more?' },
    { id: 'acting', ask: 'Which has the better acting?' },
    { id: 'consistency', ask: 'Which stays strong across every season?' },
    { id: 'ending', ask: 'Which stuck the landing better?' },
    { id: 'binge', ask: 'Which was harder to stop watching?' },
    { id: 'world', ask: 'Which has the more vivid world?' },
    { id: 'rewatch', ask: 'Which would you rather start again from episode one?' },
    { id: 'episodes', ask: 'Which has the single best episode?' },
  ],
  game: [
    { id: 'gameplay', ask: 'Which plays better, moment to moment?' },
    { id: 'story', ask: 'Which has the better story?' },
    { id: 'art', ask: 'Which has the better art direction?' },
    { id: 'music', ask: 'Which has the better soundtrack?' },
    { id: 'world', ask: 'Which has the better world or level design?' },
    { id: 'replay', ask: 'Which would you rather replay right now?' },
    { id: 'hooked', ask: 'Which kept you up later playing it?' },
    { id: 'characters', ask: 'Which has the more memorable characters?' },
    { id: 'innovation', ask: 'Which did something you had never seen before?' },
  ],
};

export type Kick = 'a' | 'b' | 'even';

export interface Shootout {
  questions: Question[];
  kicks: Kick[];
}

export const REGULATION_KICKS = 5;

export function startShootout(kind: LeagueKind, rng: () => number = Math.random): Shootout {
  const questions = [...QUESTIONS[kind]];
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }
  return { questions, kicks: [] };
}

export function score(kicks: Kick[]): [number, number] {
  return kicks.reduce<[number, number]>(([a, b], k) => [a + (k === 'a' ? 1 : 0), b + (k === 'b' ? 1 : 0)], [0, 0]);
}

export type ShootoutState =
  | { done: false; question: Question; kickNumber: number; suddenDeath: boolean }
  | { done: true; winner: 'a' | 'b' | null; score: [number, number] };

/**
 * Where the shootout stands. It ends early once one side can't be caught within
 * five kicks, goes to sudden death if level after five, and is a draw if the
 * questions run out while level.
 */
export function shootoutState(s: Shootout): ShootoutState {
  const [a, b] = score(s.kicks);
  const taken = s.kicks.length;
  const remaining = Math.max(0, REGULATION_KICKS - taken);
  const decidedEarly = taken < REGULATION_KICKS && Math.abs(a - b) > remaining;
  const decided = decidedEarly || (taken >= REGULATION_KICKS && a !== b);
  if (decided) return { done: true, winner: a > b ? 'a' : 'b', score: [a, b] };
  if (taken >= s.questions.length) return { done: true, winner: null, score: [a, b] };
  return { done: false, question: s.questions[taken], kickNumber: taken + 1, suddenDeath: taken >= REGULATION_KICKS };
}

export const takeKick = (s: Shootout, kick: Kick): Shootout => ({ ...s, kicks: [...s.kicks, kick] });
