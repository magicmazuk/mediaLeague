import { useState } from 'react';
import { CloudUpload, Download } from 'lucide-react';
import { downloadBackup } from '../lib/export';
import { useStore } from '../lib/store';
import { replaceWithAccount, showLinkPrompt, uploadThisDevice, useSync } from '../lib/sync';
import { useUi } from '../lib/ui';
import { Modal } from './Modal';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Shown the first time a device with existing votes meets your account: add its
 * results to the account (the usual answer), or replace them with the account's.
 */
export function LinkDevicePrompt() {
  const { unlinked, promptOpen } = useSync();
  const leagues = useStore((s) => s.leagues);
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  if (!unlinked) return null;

  const close = () => {
    setConfirmReplace(false);
    showLinkPrompt(false);
  };
  const parts = [
    unlinked.byLeague.movie && plural(unlinked.byLeague.movie, 'film result'),
    unlinked.byLeague.tv && plural(unlinked.byLeague.tv, 'TV result'),
    unlinked.byLeague.game && plural(unlinked.byLeague.game, 'game result'),
  ].filter(Boolean);

  const upload = async () => {
    setBusy(true);
    const { results, ok } = await uploadThisDevice();
    setBusy(false);
    toast(ok ? `Added ${plural(results, 'result')} to your account.` : `Saved ${plural(results, 'result')} to send. They'll upload as soon as the connection allows.`);
  };

  return (
    <Modal open={promptOpen} onClose={close} label="Add this device's votes to your account" className="modal-link">
      <div className="link-device">
        <CloudUpload className="link-device-icon" size={34} strokeWidth={1.6} />
        {!confirmReplace ? (
          <>
            <h2 className="display">Add this device's votes to your account?</h2>
            <p>
              This browser has {plural(unlinked.results, 'result')}
              {parts.length > 0 && ` (${parts.join(', ')})`}
              {unlinked.marks > 0 && `, ${plural(unlinked.marks, 'seen mark')}`}
              {unlinked.titles > 0 && ` and ${plural(unlinked.titles, 'added title')}`} that aren't in your account yet. Adding them merges them with anything
              already there; nothing is duplicated.
            </p>
            <div className="link-device-actions">
              <button className="btn btn-gold btn-lg" onClick={upload} disabled={busy} autoFocus>
                <CloudUpload size={18} /> {busy ? 'Adding…' : 'Add them to my account'}
              </button>
              <button className="btn btn-ghost" onClick={() => downloadBackup(leagues)}>
                <Download size={16} /> Download a copy first
              </button>
              <button className="btn btn-quiet" onClick={close}>
                Not now
              </button>
            </div>
            <button className="link-device-alt" onClick={() => setConfirmReplace(true)}>
              Use my account's data on this device instead
            </button>
          </>
        ) : (
          <>
            <h2 className="display">Replace this device's votes?</h2>
            <p>
              This removes the {plural(unlinked.results, 'result')} stored in this browser and shows your account's leagues instead. Download a copy first if you might
              want them back.
            </p>
            <div className="link-device-actions">
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await replaceWithAccount();
                  setBusy(false);
                  toast("Showing your account's leagues on this device.");
                }}
              >
                Replace with my account's data
              </button>
              <button className="btn btn-ghost" onClick={() => downloadBackup(leagues)}>
                <Download size={16} /> Download a copy
              </button>
              <button className="btn btn-quiet" onClick={() => setConfirmReplace(false)}>
                Go back
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
