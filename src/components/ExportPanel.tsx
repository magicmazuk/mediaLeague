import { useRef, useState } from 'react';
import { Download, ExternalLink, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import type { LeagueInfo } from '../lib/catalog';
import { download, leagueTableCsv, letterboxdListCsv, letterboxdRatingsCsv } from '../lib/export';
import { useLeagueStats, useStore } from '../lib/store';
import { useUi } from '../lib/ui';

const today = () => new Date().toISOString().slice(0, 10);

export function ExportPanel({ info }: { info: LeagueInfo }) {
  const { standings, index } = useLeagueStats(info.kind);
  const lookup = (id: string) => index.get(id);
  const [floor, setFloor] = useState(2.5);
  const empty = standings.length === 0;
  const isFilm = info.kind === 'movie';

  return (
    <div className="exports">
      {isFilm && (
        <>
          <article className="export-card export-card-feature">
            <div className="export-card-head">
              <h3>Letterboxd ranked list</h3>
              <p>
                Your whole table, in order, ready to import as a Letterboxd list. Letterboxd keeps the file's order, so your number one stays number one.
              </p>
            </div>
            <ol className="export-steps">
              <li>Download the file below.</li>
              <li>
                On Letterboxd, start a{' '}
                <a href="https://letterboxd.com/list/new/" target="_blank" rel="noreferrer">
                  new list <ExternalLink size={12} />
                </a>{' '}
                and tick <em>Ranked list</em>.
              </li>
              <li>
                Choose <em>Import</em>, pick the file and save.
              </li>
            </ol>
            <button
              className="btn btn-gold"
              disabled={empty}
              onClick={() => download(`media-league-films-ranked-${today()}.csv`, letterboxdListCsv(standings, lookup))}
            >
              <Download size={16} /> Download ranked list ({standings.length} films)
            </button>
          </article>

          <article className="export-card">
            <div className="export-card-head">
              <h3>Letterboxd star ratings</h3>
              <p>
                Turns table positions into star ratings: your top film gets five stars, falling evenly to the lowest rating you choose.
              </p>
            </div>
            <label className="field">
              <span>Lowest rating</span>
              <select value={floor} onChange={(e) => setFloor(Number(e.target.value))}>
                {[1, 1.5, 2, 2.5, 3, 3.5].map((v) => (
                  <option key={v} value={v}>
                    {'★'.repeat(Math.floor(v))}
                    {v % 1 ? '½' : ''} ({v})
                  </option>
                ))}
              </select>
            </label>
            <p className="export-warning">
              <TriangleAlert size={16} />
              <span>
                Importing on{' '}
                <a href="https://letterboxd.com/import/" target="_blank" rel="noreferrer">
                  letterboxd.com/import
                </a>{' '}
                replaces any ratings you've already given these films.
              </span>
            </p>
            <button
              className="btn btn-ghost"
              disabled={empty}
              onClick={() => download(`media-league-films-ratings-${today()}.csv`, letterboxdRatingsCsv(standings, lookup, floor))}
            >
              <Download size={16} /> Download ratings
            </button>
          </article>
        </>
      )}

      <article className="export-card">
        <div className="export-card-head">
          <h3>League table spreadsheet</h3>
          <p>
            Position, record and rating for every {info.noun[0]} as a CSV for Excel, Google Sheets or Numbers.
            {!isFilm && ` Letterboxd only covers films, so this is the way to take your ${info.name.toLowerCase()} table elsewhere.`}
          </p>
        </div>
        <button
          className="btn btn-ghost"
          disabled={empty}
          onClick={() => download(`media-league-${info.slug}-table-${today()}.csv`, leagueTableCsv(standings, lookup))}
        >
          <Download size={16} /> Download CSV
        </button>
      </article>

      <BackupCard info={info} />
    </div>
  );
}

function BackupCard({ info }: { info: LeagueInfo }) {
  const leagues = useStore((s) => s.leagues);
  const importBackup = useStore((s) => s.importBackup);
  const resetLeague = useStore((s) => s.resetLeague);
  const toast = useUi((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const restore = async (file: File) => {
    try {
      importBackup(JSON.parse(await file.text()));
      toast('Backup restored.');
    } catch (e) {
      toast(e instanceof Error && e.message.includes('backup') ? e.message : 'That file could not be read as a Media League backup.');
    }
  };

  return (
    <article className="export-card">
      <div className="export-card-head">
        <h3>Backup and restore</h3>
        <p>Everything is saved in this browser. Download a backup to move your leagues to another device or keep them safe.</p>
      </div>
      <div className="export-row">
        <button
          className="btn btn-ghost"
          onClick={() =>
            download(`media-league-backup-${today()}.json`, JSON.stringify({ app: 'media-league', version: 1, leagues }, null, 1), 'application/json')
          }
        >
          <Download size={16} /> Download backup
        </button>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          <Upload size={16} /> Restore backup
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) restore(f);
            e.target.value = '';
          }}
        />
      </div>
      <div className="export-row danger-zone">
        {confirmReset ? (
          <>
            <p>Delete every {info.name.toLowerCase()} result and seen mark? This can't be undone.</p>
            <button
              className="btn btn-danger"
              onClick={() => {
                resetLeague(info.kind);
                setConfirmReset(false);
                toast(`${info.name} league reset.`);
              }}
            >
              Yes, reset {info.name.toLowerCase()}
            </button>
            <button className="btn btn-quiet" onClick={() => setConfirmReset(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button className="btn btn-quiet" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} /> Reset {info.name.toLowerCase()} league
          </button>
        )}
      </div>
    </article>
  );
}
