import { Swords } from 'lucide-react';
import { ExportPanel } from '../components/ExportPanel';
import { Img } from '../components/Img';
import { LeagueTable } from '../components/LeagueTable';
import { TitleGrid } from '../components/TitleGrid';
import { leagueBySlug } from '../lib/catalog';
import { href } from '../lib/router';
import { useLeagueStats, useStore } from '../lib/store';

type Tab = 'table' | 'titles' | 'export';

export function LeaguePage({ slug, tab }: { slug: string; tab: Tab }) {
  const info = leagueBySlug(slug);
  if (!info) {
    return (
      <div className="wrap empty-state">
        <h1 className="display">No such league</h1>
        <a className="btn btn-gold" href={href.home()}>
          Back to the matchups
        </a>
      </div>
    );
  }
  return <League key={info.kind} slug={slug} tab={tab} />;
}

function League({ slug, tab }: { slug: string; tab: Tab }) {
  const info = leagueBySlug(slug)!;
  const { standings, index, titles, league, certainty, unseen } = useLeagueStats(info.kind);
  const setActive = useStore((s) => s.setActive);
  const leader = standings[0] ? index.get(standings[0].id) : undefined;
  const art = leader ?? titles[0];

  const tabs: [Tab, string][] = [
    ['table', 'Table'],
    ['titles', info.kind === 'game' ? 'Games' : info.kind === 'tv' ? 'Shows' : 'Films'],
    ['export', 'Export'],
  ];

  return (
    <>
      <section className="league-hero">
        <div className="league-hero-art">{art && <Img sources={[art.background, art.poster]} alt="" />}</div>
        <div className="wrap league-hero-inner">
          <h1 className="league-name display">{info.name}</h1>
          <p className="league-blurb">
            {info.blurb} Starting from the {info.source}.
          </p>
          {leader && (
            <p className="league-leader">
              Top of the table: <strong>{leader.title}</strong>
            </p>
          )}
          <dl className="league-stats">
            <div>
              <dt>In your table</dt>
              <dd className="display">{standings.length}</dd>
            </div>
            <div>
              <dt>Matchups</dt>
              <dd className="display">{league.matches.length}</dd>
            </div>
            <div>
              <dt>Settled</dt>
              <dd className="display">{standings.length ? `${Math.round(certainty * 100)}%` : '–'}</dd>
            </div>
            <div>
              <dt>Ruled out</dt>
              <dd className="display">{unseen}</dd>
            </div>
          </dl>
          <a className="btn btn-gold btn-lg" href={href.home()} onClick={() => setActive(info.kind)}>
            <Swords size={18} /> Play {info.name.toLowerCase()}
          </a>
        </div>
      </section>

      <div className="wrap">
        <nav className="tabs" aria-label={`${info.name} sections`}>
          {tabs.map(([key, label]) => (
            <a key={key} className="tab" href={href.league(slug, key)} aria-current={tab === key ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="tab-panel">
          {tab === 'table' && <LeagueTable info={info} />}
          {tab === 'titles' && <TitleGrid info={info} />}
          {tab === 'export' && <ExportPanel info={info} />}
        </div>
      </div>
    </>
  );
}
