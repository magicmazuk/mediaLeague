import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Gamepad2, Search, Swords, Trophy, Tv } from 'lucide-react';
import { BASE_TITLES, LEAGUES, yearLabel } from '../lib/catalog';
import { href, type Route } from '../lib/router';
import { useStore } from '../lib/store';
import { useUi } from '../lib/ui';
import type { LeagueKind, Title } from '../lib/types';
import { Poster } from './Poster';
import { SyncBadge } from './SyncBadge';

const ICONS: Record<LeagueKind, typeof Tv> = { movie: Clapperboard, tv: Tv, game: Gamepad2 };

export function TopNav({ route }: { route: Route }) {
  const current = (slug?: string) => (route.name === 'league' ? route.slug === slug : !slug) || undefined;
  return (
    <>
      <header className="topnav">
        <div className="wrap topnav-inner">
          <a className="brand" href={href.home()}>
            <Trophy className="brand-mark" size={28} strokeWidth={2.2} />
            <span className="brand-name">The Media League</span>
          </a>
          <nav className="navlinks" aria-label="Main">
            <a className="navlink" href={href.home()} aria-current={current() && 'page'}>
              Play
            </a>
            {LEAGUES.map((l) => (
              <a key={l.slug} className="navlink" href={href.league(l.slug)} aria-current={current(l.slug) && 'page'}>
                {l.name}
              </a>
            ))}
          </nav>
          <SyncBadge />
          <SearchBox />
        </div>
      </header>
      <nav className="tabbar" aria-label="Main">
        <a href={href.home()} aria-current={current() && 'page'}>
          <Swords size={20} /> Play
        </a>
        {LEAGUES.map((l) => {
          const Icon = ICONS[l.kind];
          return (
            <a key={l.slug} href={href.league(l.slug)} aria-current={current(l.slug) && 'page'}>
              <Icon size={20} /> {l.name}
            </a>
          );
        })}
      </nav>
    </>
  );
}

function SearchBox() {
  const leagues = useStore((s) => s.leagues);
  const showTitle = useUi((s) => s.showTitle);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const all = useMemo(() => {
    const list: Title[] = [];
    for (const l of LEAGUES) list.push(...BASE_TITLES[l.kind], ...leagues[l.kind].custom);
    return list;
  }, [leagues]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 2) return [];
    const scored = all
      .map((t) => {
        const name = t.title.toLowerCase();
        const i = name.indexOf(q);
        return { t, score: i === 0 ? 0 : i > 0 ? 1 : -1 };
      })
      .filter((r) => r.score >= 0);
    scored.sort((a, b) => a.score - b.score || a.t.rank - b.t.rank);
    return scored.slice(0, 8).map((r) => r.t);
  }, [q, all]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (t: Title) => {
    showTitle(t.kind, t.id);
    setQuery('');
    setOpen(false);
  };
  const leagueName = (k: LeagueKind) => LEAGUES.find((l) => l.kind === k)!.name;

  return (
    <div className="search" ref={box}>
      <label className="search-field">
        <Search size={16} />
        <span className="sr-only">Search titles</span>
        <input
          value={query}
          placeholder="Search titles"
          role="combobox"
          aria-expanded={open && q.length >= 2}
          aria-controls="search-results"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
            else if (e.key === 'Enter' && results[cursor]) choose(results[cursor]);
            else if (e.key === 'Escape') setOpen(false);
            else return;
            e.preventDefault();
          }}
        />
      </label>
      {open && q.length >= 2 && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length === 0 ? (
            <p className="search-empty">Nothing called “{query.trim()}” in your leagues.</p>
          ) : (
            results.map((t, i) => (
              <button key={`${t.kind}-${t.id}`} role="option" aria-selected={i === cursor} className="search-item" onClick={() => choose(t)} onMouseEnter={() => setCursor(i)}>
                <Poster src={t.poster} />
                <span>
                  <span className="search-item-title">{t.title}</span>
                  <br />
                  <span className="search-item-sub">
                    {yearLabel(t)} in {leagueName(t.kind)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
