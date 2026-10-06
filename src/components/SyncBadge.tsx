import { useEffect, useState } from 'react';
import { CloudAlert, CloudCheck, CloudOff, CloudUpload, LoaderCircle, LogIn } from 'lucide-react';
import { showLinkPrompt, syncNow, useSync } from '../lib/sync';

function ago(ts: number | null) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

/** Re-render every half minute so "synced 3 minutes ago" stays true. */
function useTick() {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setN((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
}

/** One sentence describing where your data lives right now. */
export function SyncStatus() {
  const { mode, phase, lastSynced, pending, unlinked } = useSync();
  useTick();
  if (mode === 'checking') return <>Checking for your account…</>;
  if (mode === 'local') return <>Saved in this browser only. Download a backup to keep it safe or move it to another device.</>;
  if (unlinked) return <>Your account is connected, but this device's {unlinked.results} results aren't in it yet.</>;
  if (phase === 'signed-out') return <>You've been signed out. Reload to sign in again; nothing on this device has been lost.</>;
  if (phase === 'offline') return <>You're offline. {pending ? `${pending} change${pending === 1 ? '' : 's'} will sync` : 'Changes will sync'} when you're back online.</>;
  if (phase === 'error') return <>The last sync didn't go through. It will retry automatically{pending ? `; ${pending} change${pending === 1 ? ' is' : 's are'} waiting` : ''}.</>;
  if (phase === 'syncing') return <>Syncing with your account…</>;
  return <>Synced with your account{lastSynced ? ` ${ago(lastSynced)}` : ''}. Votes from any signed-in device end up in the same leagues.</>;
}

/** Small status pill in the top bar. Hidden when there's no account to sync with. */
export function SyncBadge() {
  const { mode, phase, unlinked } = useSync();
  useTick();
  if (mode !== 'cloud') return null;

  if (unlinked) {
    return (
      <button className="sync-badge is-warn" onClick={() => showLinkPrompt(true)} title="This device's results aren't in your account yet">
        <CloudUpload size={16} /> <span>Not synced</span>
      </button>
    );
  }
  const view = {
    idle: { icon: <CloudCheck size={16} />, label: 'Synced', cls: '', title: 'Your votes are saved to your account' },
    syncing: { icon: <LoaderCircle size={16} className="spin" />, label: 'Syncing', cls: '', title: 'Syncing with your account' },
    offline: { icon: <CloudOff size={16} />, label: 'Offline', cls: 'is-warn', title: "You're offline. Votes will sync when you reconnect." },
    error: { icon: <CloudAlert size={16} />, label: 'Sync failed', cls: 'is-warn', title: 'Tap to try again' },
    'signed-out': { icon: <LogIn size={16} />, label: 'Sign in', cls: 'is-warn', title: 'Your session ended. Tap to sign in again.' },
  }[phase];
  return (
    <button
      className={`sync-badge ${view.cls}`}
      title={view.title}
      onClick={() => (phase === 'signed-out' ? window.location.reload() : void syncNow())}
    >
      {view.icon} <span>{view.label}</span>
    </button>
  );
}
