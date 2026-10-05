import { describe, expect, it } from 'vitest';
import { QUESTIONS, score, shootoutState, startShootout, takeKick, type Kick, type Shootout } from './penalties';

const play = (kicks: Kick[]): Shootout => kicks.reduce(takeKick, startShootout('movie', () => 0.5));

describe('penalty shootout', () => {
  it('asks questions specific to the medium, in a shuffled order', () => {
    const s = startShootout('game', () => 0.1);
    expect(s.questions.map((q) => q.id).sort()).toEqual(QUESTIONS.game.map((q) => q.id).sort());
    expect(QUESTIONS.movie.some((q) => q.ask.includes('cinematography'))).toBe(true);
    expect(QUESTIONS.game.some((q) => q.ask.includes('plays'))).toBe(true);
  });

  it('starts at kick one', () => {
    const st = shootoutState(play([]));
    expect(st).toMatchObject({ done: false, kickNumber: 1, suddenDeath: false });
  });

  it('ends early once the lead cannot be caught', () => {
    expect(shootoutState(play(['a', 'a', 'a']))).toEqual({ done: true, winner: 'a', score: [3, 0] });
    expect(shootoutState(play(['a', 'a']))).toMatchObject({ done: false });
    expect(shootoutState(play(['b', 'even', 'b', 'b']))).toEqual({ done: true, winner: 'b', score: [0, 3] });
  });

  it('is won 3-2 after five kicks', () => {
    expect(shootoutState(play(['a', 'b', 'a', 'b', 'a']))).toEqual({ done: true, winner: 'a', score: [3, 2] });
  });

  it('goes to sudden death when level after five', () => {
    const st = shootoutState(play(['a', 'b', 'even', 'a', 'b']));
    expect(st).toMatchObject({ done: false, kickNumber: 6, suddenDeath: true });
    expect(shootoutState(play(['a', 'b', 'even', 'a', 'b', 'b']))).toMatchObject({ done: true, winner: 'b' });
  });

  it('is a draw when the questions run out level', () => {
    const allEven = Array<Kick>(QUESTIONS.movie.length).fill('even');
    expect(shootoutState(play(allEven))).toEqual({ done: true, winner: null, score: [0, 0] });
  });

  it('counts the score', () => {
    expect(score(['a', 'even', 'b', 'a'])).toEqual([2, 1]);
  });
});
