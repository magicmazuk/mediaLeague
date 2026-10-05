import { ArrowDown, ArrowUp } from 'lucide-react';
import { yearLabel, type LeagueInfo } from '../lib/catalog';
import { useLeagueStats, useStore } from '../lib/store';
import { useUi } from '../lib/ui';
import type { Standing } from '../lib/types';
import { Poster } from './Poster';

const TOP_ZONE = 10;
const RELEGATION = 3;

export function LeagueTable({ info }: { info: LeagueInfo }) {
  const { standings, index, certainty, matchupsToSettle } = useLeagueStats(info.kind);
  const showTitle = useUi((s) => s.showTitle);
  const setActive = useStore((s) => s.setActive);
  const showRelegation = standings.length >= 15;

  if (standings.length === 0) {
    return (
      <div className="empty-state">
        <h2 className="display">No table yet</h2>
        <p className="muted">Play a few matchups and your table will start to take shape. Every pick moves it.</p>
        <a className="btn btn-gold btn-lg" href="#/" onClick={() => setActive(info.kind)}>
          Start playing
        </a>
      </div>
    );
  }

  const pct = Math.round(certainty * 100);
  return (
    <div className="table-wrap">
      <div className="settle">
        <div className="settle-text">
          <p>
            <strong>Your table is {pct}% settled.</strong>{' '}
            {matchupsToSettle > 0
              ? `Roughly ${matchupsToSettle} more matchup${matchupsToSettle === 1 ? '' : 's'} would firm up every placing.`
              : 'Every placing is backed by plenty of results.'}
          </p>
          <p className="muted">Titles marked provisional have too few results to trust their spot yet.</p>
        </div>
        <div className="settle-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Table settled">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      <table className="league-table">
        <thead>
          <tr>
            <th className="col-pos" scope="col">
              <abbr title="Position">Pos</abbr>
            </th>
            <th className="col-title" scope="col">
              {info.noun[0][0].toUpperCase() + info.noun[0].slice(1)}
            </th>
            <th scope="col">
              <abbr title="Played">P</abbr>
            </th>
            <th scope="col">
              <abbr title="Won">W</abbr>
            </th>
            <th scope="col" className="hide-sm">
              <abbr title="Drawn">D</abbr>
            </th>
            <th scope="col" className="hide-sm">
              <abbr title="Lost">L</abbr>
            </th>
            <th scope="col" className="col-form hide-xs">
              Form
            </th>
            <th scope="col" className="col-rating hide-sm">
              Rating
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => {
            const t = index.get(s.id);
            if (!t) return null;
            const zone = s.position <= TOP_ZONE ? 'is-top' : showRelegation && s.position > standings.length - RELEGATION ? 'is-relegation' : '';
            return (
              <tr key={s.id} className={zone} onClick={() => showTitle(info.kind, s.id)}>
                <td className="col-pos">
                  <span className="pos">{s.position}</span>
                  <Movement s={s} />
                </td>
                <td className="col-title">
                  <button className="row-title" onClick={() => showTitle(info.kind, s.id)}>
                    <Poster src={t.poster} loading="lazy" />
                    <span>
                      <span className="row-name">{t.title}</span>
                      <span className="row-sub">
                        {yearLabel(t)}
                        {s.certainty < 0.35 && <span className="tag">Provisional</span>}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="num">{s.played}</td>
                <td className="num">{s.won}</td>
                <td className="num hide-sm">{s.drawn}</td>
                <td className="num hide-sm">{s.lost}</td>
                <td className="col-form hide-xs">
                  <Form form={s.form} />
                </td>
                <td className="col-rating hide-sm">
                  <span className="rating">{s.rating}</span>
                  <span className="certainty" title={`${Math.round(s.certainty * 100)}% settled`}>
                    <span style={{ width: `${Math.round(s.certainty * 100)}%` }} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="table-legend">
        <li className="legend-top">Top {TOP_ZONE}: your all-time greats</li>
        {showRelegation && <li className="legend-rel">Relegation zone: in danger of dropping out</li>}
        <li>Arrows show movement since the start of this matchday</li>
      </ul>
    </div>
  );
}

function Movement({ s }: { s: Standing }) {
  if (s.movement === null) return <span className="move move-new">New</span>;
  if (s.movement === 0) return <span className="move move-same" aria-label="No change" />;
  const up = s.movement > 0;
  return (
    <span className={`move ${up ? 'move-up' : 'move-down'}`} aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(s.movement)}`}>
      {up ? <ArrowUp size={12} strokeWidth={3} /> : <ArrowDown size={12} strokeWidth={3} />}
      {Math.abs(s.movement)}
    </span>
  );
}

export function Form({ form }: { form: Standing['form'] }) {
  return (
    <span className="form" aria-label={`Form, oldest first: ${form.join(' ')}`}>
      {form.map((f, i) => (
        <span key={i} className={`form-pip form-${f}`}>
          {f}
        </span>
      ))}
    </span>
  );
}
