import { useEffect, useMemo, useState } from 'react';
import { Goal, Undo2, X } from 'lucide-react';
import { REGULATION_KICKS, score, shootoutState, startShootout, takeKick, type Kick } from '../lib/penalties';
import type { LeagueKind, Title } from '../lib/types';
import { Poster } from './Poster';

interface Props {
  kind: LeagueKind;
  pair: [Title, Title];
  onClose: () => void;
  onResolve: (winner: 'a' | 'b' | 'draw', pens: [number, number]) => void;
}

export function PenaltyShootout({ kind, pair, onClose, onResolve }: Props) {
  const [shootout, setShootout] = useState(() => startShootout(kind));
  const state = shootoutState(shootout);
  const [a, b] = pair;
  const [goalsA, goalsB] = score(shootout.kicks);

  const kick = (k: Kick) => !state.done && setShootout((s) => takeKick(s, k));
  const retake = () => setShootout((s) => ({ ...s, kicks: s.kicks.slice(0, -1) }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.done || e.repeat) return;
      if (e.key === 'ArrowLeft') kick('a');
      else if (e.key === 'ArrowRight') kick('b');
      else if (e.key === 'ArrowDown') kick('even');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const rounds = Math.max(REGULATION_KICKS, shootout.kicks.length + (state.done ? 0 : 1));

  return (
    <div className="shootout">
      <header className="shootout-head">
        <p className="shootout-label">
          <Goal size={18} />
          {state.done ? 'Full time' : state.suddenDeath ? `Sudden death, question ${state.kickNumber}` : `Penalties, question ${state.kickNumber} of ${REGULATION_KICKS}`}
        </p>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </header>

      <div className="scoreboard">
        <TeamBadge title={a} side="a" />
        <div className="scoreboard-mid">
          <p className="scoreline display" aria-label={`${goalsA} to ${goalsB}`}>
            {goalsA}
            <span>–</span>
            {goalsB}
          </p>
          <div className="kick-rows" aria-hidden="true">
            {(['a', 'b'] as const).map((side) => (
              <div className="kick-row" key={side}>
                {Array.from({ length: rounds }, (_, i) => {
                  const k = shootout.kicks[i];
                  const cls = k === undefined ? 'pending' : k === side ? 'scored' : 'missed';
                  return <span key={i} className={`kick-dot ${cls}`} />;
                })}
              </div>
            ))}
          </div>
        </div>
        <TeamBadge title={b} side="b" />
      </div>

      {!state.done ? (
        <div className="shootout-question" key={state.kickNumber}>
          <h2 className="question display">{state.question.ask}</h2>
          <div className="kick-choices">
            <button className="kick-choice" onClick={() => kick('a')}>
              <Poster src={a.poster} />
              <span>{a.title}</span>
              <kbd>←</kbd>
            </button>
            <button className="kick-even btn btn-ghost" onClick={() => kick('even')}>
              Can't split them <kbd>↓</kbd>
            </button>
            <button className="kick-choice" onClick={() => kick('b')}>
              <Poster src={b.poster} />
              <span>{b.title}</span>
              <kbd>→</kbd>
            </button>
          </div>
          {shootout.kicks.length > 0 && (
            <button className="btn btn-quiet retake" onClick={retake}>
              <Undo2 size={16} /> Change last answer
            </button>
          )}
        </div>
      ) : (
        <Verdict
          pair={pair}
          winner={state.winner}
          pens={state.score}
          kicks={shootout.kicks}
          questions={shootout.questions.map((q) => q.ask)}
          onRetake={retake}
          onResolve={onResolve}
        />
      )}
    </div>
  );
}

function TeamBadge({ title, side }: { title: Title; side: 'a' | 'b' }) {
  return (
    <div className={`team-badge team-${side}`}>
      <Poster src={title.poster} fallbackText={title.title} />
      <p>{title.title}</p>
    </div>
  );
}

interface VerdictProps {
  pair: [Title, Title];
  winner: 'a' | 'b' | null;
  pens: [number, number];
  kicks: Kick[];
  questions: string[];
  onRetake: () => void;
  onResolve: Props['onResolve'];
}

function Verdict({ pair, winner, pens, kicks, questions, onRetake, onResolve }: VerdictProps) {
  const [a, b] = pair;
  const breakdown = useMemo(
    () => kicks.map((k, i) => ({ q: questions[i], who: k === 'a' ? a.title : k === 'b' ? b.title : 'Even' })),
    [kicks, questions, a, b],
  );

  if (!winner) {
    return (
      <div className="verdict">
        <h2 className="verdict-title display">Too close to call</h2>
        <p className="verdict-sub">Level after every question. Maybe they really are equals.</p>
        <Breakdown rows={breakdown} />
        <div className="verdict-actions">
          <button className="btn btn-gold btn-lg" onClick={() => onResolve('draw', pens)} autoFocus>
            Record a draw
          </button>
          <button className="btn btn-ghost" onClick={() => onResolve('a', pens)}>
            {a.title} edges it
          </button>
          <button className="btn btn-ghost" onClick={() => onResolve('b', pens)}>
            {b.title} edges it
          </button>
        </div>
      </div>
    );
  }

  const w = winner === 'a' ? a : b;
  const l = winner === 'a' ? b : a;
  const [hi, lo] = pens[0] > pens[1] ? pens : [pens[1], pens[0]];
  return (
    <div className="verdict">
      <h2 className="verdict-title display">Ah, so you think {w.title} is better.</h2>
      <p className="verdict-sub">
        Won {hi}–{lo} on penalties.
      </p>
      <Breakdown rows={breakdown} />
      <div className="verdict-actions">
        <button className="btn btn-gold btn-lg" onClick={() => onResolve(winner, pens)} autoFocus>
          Yes, {w.title} wins
        </button>
        <button className="btn btn-ghost" onClick={() => onResolve(winner === 'a' ? 'b' : 'a', pens)}>
          No, {l.title} is better
        </button>
        <button className="btn btn-quiet" onClick={() => onResolve('draw', pens)}>
          Call it a draw
        </button>
        <button className="btn btn-quiet" onClick={onRetake}>
          <Undo2 size={16} /> Change last answer
        </button>
      </div>
    </div>
  );
}

function Breakdown({ rows }: { rows: { q: string; who: string }[] }) {
  return (
    <ol className="breakdown">
      {rows.map((r, i) => (
        <li key={i} className={r.who === 'Even' ? 'is-even' : ''}>
          <span className="breakdown-q">{r.q}</span>
          <span className="breakdown-who">{r.who}</span>
        </li>
      ))}
    </ol>
  );
}
