import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Arena } from '../components/Arena';
import { Img } from '../components/Img';
import { Poster } from '../components/Poster';
import { Modal } from '../components/Modal';
import { PenaltyShootout } from '../components/PenaltyShootout';
import { LEAGUES, type LeagueInfo } from '../lib/catalog';
import { href } from '../lib/router';
import { useLeagueStats, useStore } from '../lib/store';
import { useUi } from '../lib/ui';
import type { Match, Title } from '../lib/types';

export function HomePage() {
  const active = useStore((s) => s.active);
  const record = useStore((s) => s.record);
  const toast = useUi((s) => s.toast);
  // The shootout keeps the exact pair it was opened for; the result is recorded against it.
  const [shootout, setShootout] = useState<[Title, Title] | null>(null);

  const resolve = (winner: 'a' | 'b' | 'draw', pens: [number, number]) => {
    if (!shootout) return;
    const [a, b] = shootout;
    setShootout(null);
    if (!record(active, [a.id, b.id], winner, 'penalties', pens)) return;
    if (winner === 'draw') toast(`${a.title} and ${b.title} share the points.`);
    else toast(`${winner === 'a' ? a.title : b.title} goes through on penalties.`);
  };

  return (
    <>
      <Arena onPenalties={setShootout} shootoutOpen={!!shootout} />

      <section className="wrap home-section" aria-labelledby="leagues-title">
        <div className="section-head">
          <h2 id="leagues-title" className="section-title">
            Your leagues
          </h2>
        </div>
        <div className="league-cards">
          {LEAGUES.map((l) => (
            <LeagueCard key={l.kind} info={l} />
          ))}
        </div>
      </section>

      <RecentResults />

      <Modal open={!!shootout} onClose={() => setShootout(null)} label="Penalty shootout" className="modal-shootout">
        {shootout && (
          <PenaltyShootout key={shootout.map((t) => t.id).join('|')} kind={active} pair={shootout} onClose={() => setShootout(null)} onResolve={resolve} />
        )}
      </Modal>
    </>
  );
}

function LeagueCard({ info }: { info: LeagueInfo }) {
  const { standings, titles, index, league, certainty } = useLeagueStats(info.kind);
  const setActive = useStore((s) => s.setActive);
  const leader = standings[0] ? index.get(standings[0].id) : undefined;
  const art = leader ?? titles[0];
  const top3 = standings.slice(0, 3).map((s) => index.get(s.id)!);

  return (
    <article className="league-card">
      <a className="league-card-link" href={href.league(info.slug)} aria-label={`${info.name} league table`} />
      <div className="league-card-art">
        {art && <Img sources={[art.background, art.poster]} alt="" />}
      </div>
      <div className="league-card-body">
        <h3 className="league-card-name display">{info.name}</h3>
        <p className="league-card-blurb">{info.blurb}</p>
        {top3.length > 0 ? (
          <ol className="league-card-top">
            {top3.map((t) => (
              <li key={t.id}>
                <span>{t.title}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="league-card-empty">No results yet. {titles.length} {info.noun[1]} waiting.</p>
        )}
        <div className="league-card-foot">
          <span>
            {standings.length} rated <span className="dot-sep" /> {league.matches.length} matchups
            {standings.length > 0 && (
              <>
                <span className="dot-sep" /> {Math.round(certainty * 100)}% settled
              </>
            )}
          </span>
          <button
            className="btn btn-ghost league-card-play"
            onClick={() => {
              setActive(info.kind);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            Play <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

function RecentResults() {
  const active = useStore((s) => s.active);
  const { league, index } = useLeagueStats(active);
  const showTitle = useUi((s) => s.showTitle);
  const recent = league.matches.slice(-6).reverse();
  if (recent.length === 0) return null;

  return (
    <section className="wrap home-section" aria-labelledby="results-title">
      <div className="section-head">
        <h2 id="results-title" className="section-title">
          Latest results
        </h2>
      </div>
      <ul className="results">
        {recent.map((m, i) => (
          <ResultRow key={`${m.at}-${i}`} match={m} a={index.get(m.a)} b={index.get(m.b)} onOpen={(id) => showTitle(active, id)} />
        ))}
      </ul>
    </section>
  );
}

function ResultRow({ match, a, b, onOpen }: { match: Match; a?: Title; b?: Title; onOpen: (id: string) => void }) {
  if (!a || !b) return null;
  const aWon = match.s > 0.5;
  const bWon = match.s < 0.5;
  // Football scorelines: a straight pick is 1–0, penalty wins are 1–1 with the shootout score.
  const onPens = match.method === 'penalties' && match.s !== 0.5;
  const scoreline = match.s === 0.5 || onPens ? '1–1' : aWon ? '1–0' : '0–1';
  const pensAgree = match.pens && (aWon ? match.pens[0] > match.pens[1] : match.pens[1] > match.pens[0]);
  const note = onPens ? (pensAgree ? `${match.pens![0]}–${match.pens![1]} pens` : 'on pens') : match.s === 0.5 ? 'Draw' : '';

  return (
    <li className="result">
      <button className={`result-side result-a${aWon ? ' is-winner' : ''}${bWon ? ' is-loser' : ''}`} onClick={() => onOpen(a.id)}>
        <span className="result-name">{a.title}</span>
        <Poster src={a.poster} />
      </button>
      <div className="result-score">
        <span className="display">{scoreline}</span>
        {note && <small>{note}</small>}
      </div>
      <button className={`result-side result-b${bWon ? ' is-winner' : ''}${aWon ? ' is-loser' : ''}`} onClick={() => onOpen(b.id)}>
        <Poster src={b.poster} />
        <span className="result-name">{b.title}</span>
      </button>
    </li>
  );
}
