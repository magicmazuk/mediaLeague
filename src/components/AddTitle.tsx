import { useEffect, useState } from 'react';
import { LoaderCircle, Plus, Search } from 'lucide-react';
import type { LeagueInfo } from '../lib/catalog';
import { searchTitles, type SearchHit } from '../lib/lookup';
import { useLeagueStats, useStore } from '../lib/store';
import { useUi } from '../lib/ui';
import { Poster } from './Poster';
import { Modal } from './Modal';

/** Search a public API for something that isn't in the starting list and add it to the league. */
export function AddTitle({ info }: { info: LeagueInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Plus size={16} /> Add a {info.noun[0]}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label={`Add a ${info.noun[0]}`} className="modal-add">
        <AddTitleSearch info={info} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function AddTitleSearch({ info, onDone }: { info: LeagueInfo; onDone: () => void }) {
  const { index } = useLeagueStats(info.kind);
  const addCustom = useStore((s) => s.addCustom);
  const toast = useUi((s) => s.toast);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setBusy(true);
      setError('');
      try {
        setHits(await searchTitles(info.kind, q, ctrl.signal));
      } catch (e) {
        if (!ctrl.signal.aborted) setError('Search is unavailable right now. Check your connection and try again.');
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
      setBusy(false);
    };
  }, [query, info.kind]);

  const add = async (hit: SearchHit) => {
    setAdding(hit.id);
    try {
      const title = await hit.load();
      addCustom(info.kind, title);
      toast(`${title.title} joined your ${info.name.toLowerCase()} league.`);
      onDone();
    } catch {
      setError(`Couldn't load details for ${hit.title}. Try again in a moment.`);
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="add-title">
      <h2 className="add-title-head display">Add a {info.noun[0]}</h2>
      <p className="muted">Search for anything that isn't in the {info.source}.</p>
      <label className="search-field">
        {busy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
        <span className="sr-only">Search</span>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${info.noun[1]}`} />
      </label>
      {error && <p className="form-error">{error}</p>}
      {hits && hits.length === 0 && !busy && <p className="muted">No matches for “{query.trim()}”.</p>}
      {hits && hits.length > 0 && (
        <ul className="add-results">
          {hits.map((h) => {
            const already = index.has(h.id);
            return (
              <li key={h.id}>
                <Poster src={h.poster} />
                <div>
                  <p className="add-result-title">{h.title}</p>
                  <p className="muted">{h.subtitle}</p>
                </div>
                <button className="btn btn-ghost" onClick={() => add(h)} disabled={!!adding}>
                  {adding === h.id ? <LoaderCircle size={16} className="spin" /> : already ? 'Mark seen' : 'Add'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
