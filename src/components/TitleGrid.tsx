import { useDeferredValue, useMemo, useState } from 'react';
import { Check, EyeOff, Search } from 'lucide-react';
import { yearLabel, type LeagueInfo } from '../lib/catalog';
import { useLeagueStats, useStore } from '../lib/store';
import { useUi } from '../lib/ui';
import { AddTitle } from './AddTitle';
import { Poster } from './Poster';

type Filter = 'all' | 'unmarked' | 'seen' | 'unseen';

export function TitleGrid({ info }: { info: LeagueInfo }) {
  const { titles, league, standings } = useLeagueStats(info.kind);
  const setStatus = useStore((s) => s.setStatus);
  const showTitle = useUi((s) => s.showTitle);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());

  const played = useMemo(() => new Set(standings.map((s) => s.id)), [standings]);
  const statusOf = (id: string) => (league.status[id] === 'unseen' ? 'unseen' : league.status[id] === 'seen' || played.has(id) ? 'seen' : 'unmarked');

  const counts = { all: titles.length, unmarked: 0, seen: 0, unseen: 0 };
  for (const t of titles) counts[statusOf(t.id)]++;

  const visible = titles.filter((t) => (filter === 'all' || statusOf(t.id) === filter) && (!q || t.title.toLowerCase().includes(q)));

  const filters: [Filter, string][] = [
    ['all', 'All'],
    ['unmarked', 'Not marked'],
    ['seen', info.kind === 'game' ? 'Played' : 'Seen'],
    ['unseen', info.kind === 'game' ? 'Not played' : 'Not seen'],
  ];
  const seenWord = info.kind === 'game' ? 'played' : 'seen';

  return (
    <div className="titles">
      <div className="titles-intro">
        <p>
          Mark what you've {seenWord} to speed things up: {seenWord} {info.noun[1]} get matched first, and anything marked not {seenWord} never comes up.
          You can also do this mid-match with the not {seenWord} button.
        </p>
        <AddTitle info={info} />
      </div>

      <div className="titles-toolbar">
        <div className="chips" role="radiogroup" aria-label="Filter">
          {filters.map(([key, label]) => (
            <button key={key} role="radio" aria-checked={filter === key} className="chip" onClick={() => setFilter(key)}>
              {label} <span className="chip-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <label className="search-field titles-search">
          <Search size={16} />
          <span className="sr-only">Filter {info.noun[1]}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter ${info.noun[1]}`} />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="muted titles-none">Nothing matches. Try another filter.</p>
      ) : (
        <ul className="title-grid">
          {visible.map((t) => {
            const st = statusOf(t.id);
            return (
              <li key={t.id} className={`title-card is-${st}`}>
                <button className="title-card-poster" onClick={() => showTitle(info.kind, t.id)} aria-label={`About ${t.title}`}>
                  <Poster src={t.poster} loading="lazy" fallbackText={t.title} />
                  {st !== 'unmarked' && (
                    <span className="title-card-badge">{st === 'seen' ? <Check size={14} strokeWidth={3} /> : <EyeOff size={14} />}</span>
                  )}
                </button>
                <p className="title-card-name">{t.title}</p>
                <p className="title-card-year">{yearLabel(t)}</p>
                <div className="title-card-actions">
                  <button
                    className="seen-toggle"
                    aria-pressed={st === 'seen'}
                    onClick={() => setStatus(info.kind, t.id, league.status[t.id] === 'seen' ? null : 'seen')}
                    disabled={played.has(t.id) && st === 'seen'}
                    title={played.has(t.id) ? 'Already in your table' : undefined}
                  >
                    <Check size={14} /> {info.kind === 'game' ? 'Played' : 'Seen'}
                  </button>
                  <button
                    className="seen-toggle is-no"
                    aria-pressed={st === 'unseen'}
                    onClick={() => setStatus(info.kind, t.id, st === 'unseen' ? null : 'unseen')}
                  >
                    <EyeOff size={14} /> Not {seenWord}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
