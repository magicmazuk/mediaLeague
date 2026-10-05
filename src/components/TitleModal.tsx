import { Check, ExternalLink, EyeOff, X } from 'lucide-react';
import { leagueInfo, yearLabel } from '../lib/catalog';
import { outcome } from '../lib/rating';
import { useLeagueStats, useStore } from '../lib/store';
import { useUi } from '../lib/ui';
import type { LeagueKind } from '../lib/types';
import { Form } from './LeagueTable';
import { Img } from './Img';
import { Poster } from './Poster';
import { Modal } from './Modal';

export function TitleModal() {
  const open = useUi((s) => s.openTitle);
  const close = useUi((s) => s.closeTitle);
  return (
    <Modal open={!!open} onClose={close} label="Title details" className="modal-title">
      {open && <TitleDetails kind={open.kind} id={open.id} onClose={close} />}
    </Modal>
  );
}

const LINK_LABELS = { imdb: 'IMDb', letterboxd: 'Letterboxd', wikipedia: 'Wikipedia', steam: 'Steam' } as const;

function TitleDetails({ kind, id, onClose }: { kind: LeagueKind; id: string; onClose: () => void }) {
  const { index, standings, league } = useLeagueStats(kind);
  const setStatus = useStore((s) => s.setStatus);
  const info = leagueInfo(kind);
  const t = index.get(id);
  if (!t) return null;

  const standing = standings.find((s) => s.id === id);
  const status = league.status[id];
  const history = league.matches
    .filter((m) => m.a === id || m.b === id)
    .slice(-8)
    .reverse()
    .map((m) => {
      const mine = m.a === id ? m.s : 1 - m.s;
      const other = index.get(m.a === id ? m.b : m.a);
      return { o: outcome(mine), other, pens: m.method === 'penalties' && mine !== 0.5, at: m.at };
    });
  const seenWord = kind === 'game' ? 'played' : 'seen';
  const sourceLabel = `#${t.rank} on the ${info.source}`;

  return (
    <article className="title-details">
      <div className="title-hero">
        <Img className="title-hero-art" sources={[t.background, t.poster]} alt="" />
        <button className="icon-btn title-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="title-main">
        <Poster className="title-poster" src={t.poster} fallbackText={t.title} />
        <div className="title-info">
          <h2 className="title-name display">{t.title}</h2>
          <p className="title-facts">
            <span>{yearLabel(t)}</span>
            {t.genres.length > 0 && <span>{t.genres.join(', ')}</span>}
            {t.meta && <span>{t.meta}</span>}
          </p>
          {t.credit && (
            <p className="title-credit">
              <span className="muted">{t.creditLabel}</span> {t.credit}
            </p>
          )}
          {t.summary && <p className="title-summary">{t.summary}</p>}
          <p className="title-source muted">
            {t.custom ? 'Added by you' : sourceLabel}
            {t.score ? ` · IMDb ${t.score.toFixed(1)}` : ''}
          </p>
        </div>
      </div>

      <section className="title-record">
        {standing ? (
          <>
            <dl className="record-stats">
              <div>
                <dt>Position</dt>
                <dd className="display">{standing.position}</dd>
              </div>
              <div>
                <dt>Record</dt>
                <dd className="display">
                  {standing.won}–{standing.drawn}–{standing.lost}
                </dd>
              </div>
              <div>
                <dt>Rating</dt>
                <dd className="display">{standing.rating}</dd>
              </div>
              <div>
                <dt>Form</dt>
                <dd>
                  <Form form={standing.form} />
                </dd>
              </div>
            </dl>
            <ul className="history">
              {history.map((h, i) => (
                <li key={i}>
                  <span className={`form-pip form-${h.o}`}>{h.o}</span>
                  <span>
                    {h.o === 'W' ? 'Beat' : h.o === 'L' ? 'Lost to' : 'Drew with'} <strong>{h.other?.title ?? 'a removed title'}</strong>
                    {h.pens && <span className="muted"> on penalties</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">
            {status === 'unseen' ? `Marked as not ${seenWord}, so it won't come up in matchups.` : `Not in your table yet. It'll appear once it has played a matchup.`}
          </p>
        )}
      </section>

      <footer className="title-actions">
        <div className="title-seen">
          <button className="seen-toggle" aria-pressed={status === 'seen'} onClick={() => setStatus(kind, id, status === 'seen' ? null : 'seen')}>
            <Check size={14} /> {kind === 'game' ? 'Played' : 'Seen'}
          </button>
          <button className="seen-toggle is-no" aria-pressed={status === 'unseen'} onClick={() => setStatus(kind, id, status === 'unseen' ? null : 'unseen')}>
            <EyeOff size={14} /> Not {seenWord}
          </button>
        </div>
        <div className="title-links">
          {(Object.keys(LINK_LABELS) as (keyof typeof LINK_LABELS)[])
            .filter((k) => t.links[k])
            .map((k) => (
              <a key={k} className="btn btn-quiet" href={t.links[k]} target="_blank" rel="noreferrer">
                {LINK_LABELS[k]} <ExternalLink size={14} />
              </a>
            ))}
        </div>
      </footer>
    </article>
  );
}
