import { create } from 'zustand';
import { onOp, opsFromData, type Op } from './ops';
import { leagueData, useStore } from './store';
import type { LeagueKind } from './types';
import { KINDS, sanitizeLeagueData } from './validate';

/**
 * Keeps this device in step with your account when the deployment has a database.
 *
 * Every change is applied locally first (so the app is instant and works offline),
 * queued, and sent to the server shortly after. Whenever the app comes back into
 * view it sends anything queued and then pulls the full state, so votes cast on
 * your phone show up on your laptop. A device's existing results only join the
 * account when you say so (see `uploadThisDevice`).
 */

export type SyncMode = 'checking' | 'local' | 'cloud';
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out';

export interface LocalSummary {
  results: number;
  marks: number;
  titles: number;
  byLeague: Record<LeagueKind, number>;
}

interface SyncState {
  mode: SyncMode;
  phase: SyncPhase;
  lastSynced: number | null;
  pending: number;
  /** This device has results that aren't in the account yet. */
  unlinked: LocalSummary | null;
  promptOpen: boolean;
  canSignOut: boolean;
}

const QUEUE_KEY = 'media-league-sync-queue';
const META_KEY = 'media-league-sync';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the queue still lives in memory for this session */
  }
}

let queue: Op[] = read<Op[]>(QUEUE_KEY, []);
let linked = read<{ linked?: boolean }>(META_KEY, {}).linked === true;

export const useSync = create<SyncState>(() => ({
  mode: 'checking',
  phase: 'idle',
  lastSynced: null,
  pending: queue.length,
  unlinked: null,
  promptOpen: false,
  canSignOut: false,
}));

const saveQueue = () => {
  write(QUEUE_KEY, queue);
  useSync.setState({ pending: queue.length });
};
const setLinked = () => {
  linked = true;
  write(META_KEY, { linked: true });
};

// Queue changes while we find out whether there's an account, and whenever this device is syncing.
onOp((op) => {
  const { mode } = useSync.getState();
  if (mode === 'checking' || (mode === 'cloud' && linked)) {
    queue.push(op);
    saveQueue();
    if (mode === 'cloud') scheduleFlush();
  }
});

// One network operation at a time, so a pull can never race a push.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

class SignedOutError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new SignedOutError();
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function flush(keepalive = false) {
  while (queue.length) {
    const batch = queue.slice(0, keepalive ? 40 : 250);
    await api('/api/ops', { method: 'POST', body: JSON.stringify({ ops: batch }), keepalive });
    queue.splice(0, batch.length);
    saveQueue();
  }
}

async function pull() {
  const { leagues } = await api<{ leagues: Record<string, unknown> }>('/api/state');
  const store = useStore.getState();
  for (const kind of KINDS) store.replaceData(kind, sanitizeLeagueData(kind, leagues?.[kind]), queue);
}

function fail(error: unknown) {
  if (error instanceof SignedOutError) useSync.setState({ phase: 'signed-out' });
  else useSync.setState({ phase: navigator.onLine === false ? 'offline' : 'error' });
}

const done = () => useSync.setState({ phase: 'idle', lastSynced: Date.now() });

/** Send anything queued, then bring in changes from other devices. */
export const syncNow = () =>
  exclusive(async () => {
    if (useSync.getState().mode !== 'cloud' || !linked) return;
    useSync.setState({ phase: 'syncing' });
    try {
      await flush();
      await pull();
      done();
    } catch (error) {
      fail(error);
    }
  });

let flushTimer: number | undefined;
function scheduleFlush() {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(
    () =>
      exclusive(async () => {
        try {
          await flush();
          done();
        } catch (error) {
          fail(error);
        }
      }),
    800,
  );
}

function summarizeLocal(): LocalSummary {
  const { leagues } = useStore.getState();
  const byLeague = Object.fromEntries(KINDS.map((k) => [k, leagues[k].matches.length])) as Record<LeagueKind, number>;
  return {
    results: KINDS.reduce((n, k) => n + leagues[k].matches.length, 0),
    marks: KINDS.reduce((n, k) => n + Object.keys(leagues[k].status).length, 0),
    titles: KINDS.reduce((n, k) => n + leagues[k].custom.length, 0),
    byLeague,
  };
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
    else if (linked && queue.length) void exclusive(() => flush(true)).catch(fail);
  });
  window.addEventListener('online', () => void syncNow());
  window.setInterval(() => document.visibilityState === 'visible' && void syncNow(), 120_000);
}

let started = false;

/** Works out whether this deployment has an account to sync with, and starts syncing if so. */
export async function startSync() {
  if (started) return;
  started = true;
  let session: { cloud: boolean; passwordProtected: boolean };
  try {
    session = await api('/api/session');
  } catch (error) {
    if (error instanceof SignedOutError) return useSync.setState({ mode: linked ? 'cloud' : 'local', phase: 'signed-out' });
    if (linked) {
      // Probably offline: keep queueing and catch up when the connection returns.
      useSync.setState({ mode: 'cloud', phase: 'offline' });
      return listen();
    }
    queue = [];
    saveQueue();
    return useSync.setState({ mode: 'local' });
  }

  useSync.setState({ canSignOut: session.passwordProtected });
  if (!session.cloud) {
    queue = [];
    saveQueue();
    return useSync.setState({ mode: 'local' });
  }

  useSync.setState({ mode: 'cloud' });
  listen();
  if (linked) return syncNow();

  // First time this device meets the account. Anything changed while we were
  // checking is already in its local data, which the upload below covers.
  queue = [];
  saveQueue();
  const summary = summarizeLocal();
  if (summary.results + summary.marks + summary.titles === 0) {
    setLinked();
    return syncNow();
  }
  useSync.setState({ unlinked: summary, promptOpen: true });
}

/** Adds this device's results, seen marks and added titles to the account, merging with what's there. */
export async function uploadThisDevice() {
  const { leagues } = useStore.getState();
  const ops = KINDS.flatMap((kind) => opsFromData(kind, leagueData(leagues[kind])));
  queue = [...ops, ...queue];
  saveQueue();
  setLinked();
  useSync.setState({ unlinked: null, promptOpen: false });
  await syncNow();
  return { results: ops.filter((o) => o.op === 'match.add').length, ok: useSync.getState().phase === 'idle' };
}

/** Replaces this device's data with the account's. Only after the user has confirmed. */
export async function replaceWithAccount() {
  queue = [];
  saveQueue();
  setLinked();
  useSync.setState({ unlinked: null, promptOpen: false });
  await syncNow();
}

export const showLinkPrompt = (open: boolean) => useSync.setState({ promptOpen: open });

export async function signOut() {
  try {
    await exclusive(() => flush());
  } catch {
    /* anything unsent stays queued on this device */
  }
  await fetch('/api/logout', { method: 'POST' }).catch(() => undefined);
  window.location.reload();
}
