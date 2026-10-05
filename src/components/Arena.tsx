import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Crown, EyeOff, Goal, Info } from 'lucide-react';
import { LEAGUES, leagueInfo, yearLabel } from '../lib/catalog';
import { href } from '../lib/router';
import { MATCHDAY_SIZE, useLeagueStats, useStore } from '../lib/store';
import { useUi } from '../lib/ui';
import type { LeagueKind, Title } from '../lib/types';
import { Img } from './Img';
import { Poster } from './Poster';

type Result = 0 | 1 | 'draw';

interface Props {
  /** Open the penalty shootout for this pair. */
  onPenalties: (pair: [Title, Title]) => void;
  shootoutOpen: boolean;
}

/**
 * The matchup hero plus the "Still can't decide?" band beneath it. They live
 * together so every action shares one guard: nothing can act on the next pair
 * while the previous pick is still animating.
 */
export function Arena({ onPenalties, shootoutOpen }: Props) {
  const active = useStore((s) => s.active);
  const setActive = useStore((s) => s.setActive);
  const ensureCurrent = useStore((s) => s.ensureCurrent);
  const record = useStore((s) => s.record);
  const notSeen = useStore((s) => s.notSeen);
  const skip = useStore((s) => s.skip);
  const undo = useStore((s) => s.undo);
  const { league, index, matchNumber, matchday } = useLeagueStats(active);
  const { showTitle, toast, openTitle } = useUi();

  // While a pick animates we keep showing the decided pair. `animating` mirrors
  // `frozen` but only flips back once the next pair is actually in the DOM, so a
  // fast key press can never land on a matchup you haven't seen yet.
  const [frozen, setFrozen] = useState<{ pair: [Title, Title]; result: Result } | null>(null);
  const animating = useRef(false);
  const timer = useRef<number>(undefined);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  // Runs after every commit, so the flag always matches what's on screen.
  useLayoutEffect(() => {
    animating.current = !!frozen;
  });

  useEffect(() => {
    ensureCurrent(active);
  }, [active, league.current, league.status, ensureCurrent]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Switching league mid-animation shouldn't leave the old pair on screen.
  useEffect(() => {
    window.clearTimeout(timer.current);
    setFrozen(null);
  }, [active]);

  // "Matchday complete" for any new result: picks, draws and penalty wins alike.
  const lastCount = useRef({ kind: active, n: league.matches.length });
  useEffect(() => {
    const n = league.matches.length;
    const prev = lastCount.current;
    lastCount.current = { kind: active, n };
    if (prev.kind !== active || n <= prev.n || n % MATCHDAY_SIZE !== 0) return;
    const info = leagueInfo(active);
    toast(`Matchday ${n / MATCHDAY_SIZE} complete. Your ${info.name.toLowerCase()} table has been updated.`, {
      label: 'See table',
      run: () => (window.location.hash = href.league(info.slug)),
    });
  }, [league.matches.length, active, toast]);

  const current = league.current ? (league.current.map((id) => index.get(id)) as [Title?, Title?]) : null;
  const pair = frozen?.pair ?? (current && current[0] && current[1] ? (current as [Title, Title]) : null);

  /** Skip the rest of the pick animation and show the next matchup now. */
  const fastForward = () => {
    window.clearTimeout(timer.current);
    setFrozen(null);
    // Always commit, even if React would bail out on an unchanged `frozen`, so the
    // layout effect above re-syncs the flag (a quick double click can cancel out).
    forceRender();
  };

  const decide = (result: Result) => {
    if (animating.current) return fastForward();
    if (!pair) return;
    const recorded = record(active, [pair[0].id, pair[1].id], result === 'draw' ? 'draw' : result === 0 ? 'a' : 'b');
    if (!recorded) return;
    animating.current = true;
    setFrozen({ pair, result });
    timer.current = window.setTimeout(() => setFrozen(null), 650);
  };

  const openPenalties = () => {
    if (animating.current) return fastForward();
    if (pair) onPenalties(pair);
  };

  const handleUndo = () => {
    if (animating.current) fastForward();
    const last = undo(active);
    if (last) toast('Last result undone. Pick again.');
  };

  const handleSkip = () => {
    if (animating.current) return fastForward();
    skip(active);
  };

  const handleNotSeen = (side: 0 | 1) => {
    if (!pair || animating.current) return;
    notSeen(active, side);
    toast(`${pair[side].title} is out of your league. You can bring it back from the titles list.`);
  };

  // Keyboard: ← / → pick, ↓ decide, S skip, U or Backspace undo. The listener is
  // bound once and reads the latest handlers from a ref.
  const keys = useRef({ decide, handleUndo, handleSkip, openPenalties, blocked: false });
  keys.current = { decide, handleUndo, handleSkip, openPenalties, blocked: shootoutOpen || !!openTitle };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      // Ignore auto-repeat: holding a key must never fire a stream of picks or undos.
      if (k.blocked || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, dialog')) return;
      const key = e.key.toLowerCase();
      if (key === 'arrowleft') k.decide(0);
      else if (key === 'arrowright') k.decide(1);
      else if (key === 'arrowdown') k.openPenalties();
      else if (key === 's') k.handleSkip();
      else if (key === 'u' || key === 'backspace') k.handleUndo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const info = leagueInfo(active);
  const result = frozen?.result;
  const pairKey = pair ? `${pair[0].id}|${pair[1].id}` : 'empty';

  return (
    <>
      <section className="arena" data-result={result ?? undefined} aria-label={`${info.name} matchup`}>
        <div className="arena-bar">
          <div className="league-switch" role="tablist" aria-label="League">
            {LEAGUES.map((l) => (
              <button
                key={l.kind}
                role="tab"
                aria-selected={l.kind === active}
                className="league-switch-btn"
                onClick={() => setActive(l.kind as LeagueKind)}
              >
                {l.name}
              </button>
            ))}
          </div>
          <div className="round-pill">
            <button className="icon-btn" onClick={handleUndo} disabled={league.matches.length === 0} aria-label="Undo last result (U)" title="Undo last result (U)">
              <ChevronLeft size={18} />
            </button>
            <span>
              Match {matchNumber} of {MATCHDAY_SIZE} <span className="round-sep">/</span> Matchday {matchday}
            </span>
            <button className="icon-btn" onClick={handleSkip} disabled={!pair} aria-label="Skip this matchup (S)" title="Skip this matchup (S)">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {pair ? (
          <div className="arena-stage" key={pairKey}>
            {pair.map((t, i) => (
              <Contender
                key={t.id}
                title={t}
                side={i as 0 | 1}
                state={result === undefined ? 'idle' : result === 'draw' ? 'draw' : result === i ? 'won' : 'lost'}
                onPick={() => decide(i as 0 | 1)}
                onNotSeen={() => handleNotSeen(i as 0 | 1)}
                onInfo={() => showTitle(active, t.id)}
              />
            ))}
            <div className="seam" aria-hidden="true" />
            <div className="vs" aria-hidden="true">
              <svg className="vs-burst" viewBox="-100 -100 200 200">
                <defs>
                  <radialGradient id="burst" r="0.5">
                    <stop offset="0" stopColor="#fff6d6" />
                    <stop offset="0.35" stopColor="#f9dc82" stopOpacity="0.9" />
                    <stop offset="1" stopColor="#e9b949" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <polygon
                  fill="url(#burst)"
                  points={Array.from({ length: 28 }, (_, k) => {
                    const r = k % 2 ? 34 : k % 4 === 0 ? 98 : 72;
                    const a = (k / 28) * Math.PI * 2;
                    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
                  }).join(' ')}
                />
              </svg>
              <span className="vs-text">VS</span>
            </div>
            {result === 'draw' && <div className="draw-stamp display">Honours even</div>}
          </div>
        ) : (
          <div className="arena-empty">
            <h2 className="display">No matchups left</h2>
            <p className="muted">
              Everything left in this league is marked as not seen. Bring some titles back to keep playing.
            </p>
            <a className="btn btn-gold" href={href.league(info.slug, 'titles')}>
              Review {info.noun[1]}
            </a>
          </div>
        )}
      </section>

      <section className="decider wrap" aria-labelledby="decider-title">
        <div className="decider-card">
          <Goal className="decider-icon" size={30} strokeWidth={1.6} />
          <h2 id="decider-title" className="decider-title display">
            Still can't decide?
          </h2>
          <p className="decider-copy">
            Take it to penalties. Answer a few quick questions about story, craft and staying power, and we'll call the winner.
          </p>
          <div className="decider-actions">
            <button className="btn btn-gold btn-lg" onClick={openPenalties} disabled={!pair}>
              <Goal size={18} /> Take it to penalties <kbd className="kbd-on-gold">↓</kbd>
            </button>
            <button className="btn btn-quiet" disabled={!pair} onClick={() => decide('draw')}>
              Call it a draw
            </button>
            <button className="btn btn-quiet" disabled={!pair} onClick={handleSkip}>
              Skip <kbd>S</kbd>
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

interface ContenderProps {
  title: Title;
  side: 0 | 1;
  state: 'idle' | 'won' | 'lost' | 'draw';
  onPick: () => void;
  onNotSeen: () => void;
  onInfo: () => void;
}

function Contender({ title, side, state, onPick, onNotSeen, onInfo }: ContenderProps) {
  const hasArt = !!title.background;
  const [artFailed, setArtFailed] = useState(false);
  const posterMode = !hasArt || artFailed;
  const genres = title.genres.slice(0, 2).join(', ');

  return (
    <div className={`contender contender-${side === 0 ? 'a' : 'b'} is-${state}${posterMode ? ' is-poster' : ''}`}>
      <div className="contender-art">
        <picture>
          {!posterMode && <source media="(max-width: 700px)" srcSet={title.poster} />}
          <img src={posterMode ? title.poster : title.background!} alt="" onError={() => setArtFailed(true)} />
        </picture>
      </div>
      <div className="contender-shade" />
      <button className="contender-pick" onClick={onPick} disabled={state !== 'idle'}>
        <span className="sr-only">Pick {title.title}</span>
      </button>
      <div className="contender-body">
        {posterMode && <Poster className="contender-poster" src={title.poster} />}
        <div className="contender-name">
          <Img
            className="contender-logo"
            sources={[title.logo]}
            alt={title.title}
            fallback={<h2 className="contender-title display">{title.title}</h2>}
          />
        </div>
        <p className="contender-meta">
          <span>{yearLabel(title)}</span>
          {genres && <span>{genres}</span>}
        </p>
        <div className="contender-actions">
          <button className="btn btn-ghost" onClick={onNotSeen} disabled={state !== 'idle'}>
            <EyeOff size={16} /> Not seen
          </button>
          <button className="icon-btn" onClick={onInfo} aria-label={`About ${title.title}`}>
            <Info size={18} />
          </button>
        </div>
      </div>
      <span className="contender-hint" aria-hidden="true">
        {side === 0 ? (
          <>
            <kbd>←</kbd> Pick
          </>
        ) : (
          <>
            Pick <kbd>→</kbd>
          </>
        )}
      </span>
      {state === 'won' && (
        <span className="winner-stamp">
          <Crown size={18} /> Winner
        </span>
      )}
    </div>
  );
}
