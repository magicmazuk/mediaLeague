import type { Db } from './db.js';
import type { Op } from '../src/lib/ops.js';
import type { LeagueKind, Match, SeenStatus, Title } from '../src/lib/types.js';
import { KINDS, sanitizeTitle, type LeagueData } from '../src/lib/validate.js';

// Tables are prefixed so the app can share a database with other projects.
const SCHEMA = [
  `create table if not exists ml_matches (
     id text primary key,
     league text not null,
     a text not null,
     b text not null,
     s double precision not null,
     at double precision not null,
     method text not null,
     pens_a integer,
     pens_b integer,
     deleted_at double precision
   )`,
  `create index if not exists ml_matches_league on ml_matches (league)`,
  `create table if not exists ml_status (
     league text not null,
     title_id text not null,
     status text,
     updated_at double precision not null,
     primary key (league, title_id)
   )`,
  `create table if not exists ml_custom (
     league text not null,
     id text not null,
     data jsonb not null,
     added_at double precision not null,
     primary key (league, id)
   )`,
  `create table if not exists ml_auth_failures (ip text not null, at double precision not null)`,
];

const ready = new WeakMap<Db, Promise<void>>();
export function ensureSchema(db: Db) {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const statement of SCHEMA) await db.query(statement);
    })();
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

/*
 * JSON goes in as text and is cast in SQL (`$1::text::jsonb`). Binding it as jsonb
 * directly makes postgres.js JSON-encode the already-encoded string, so Postgres
 * receives a string scalar instead of an array of rows.
 */

/**
 * Applies a batch of operations. Every operation is idempotent: re-sending a
 * batch after a dropped connection changes nothing. Consecutive results and seen
 * marks are written in bulk so uploading a phone's worth of votes is quick.
 */
export async function applyOps(db: Db, ops: Op[]) {
  await ensureSchema(db);
  for (let i = 0; i < ops.length; ) {
    const kind = ops[i].op;
    let j = i;
    while (j < ops.length && ops[j].op === kind && (kind === 'match.add' || kind === 'status.set')) j++;
    if (j === i) j = i + 1;
    const run = ops.slice(i, j);
    i = j;

    if (kind === 'match.add') {
      const rows = (run as Extract<Op, { op: 'match.add' }>[]).map(({ league, match: m }) => ({
        id: m.id,
        league,
        a: m.a,
        b: m.b,
        s: m.s,
        at: m.at,
        method: m.method,
        pens_a: m.pens?.[0] ?? null,
        pens_b: m.pens?.[1] ?? null,
      }));
      await db.query(
        `insert into ml_matches (id, league, a, b, s, at, method, pens_a, pens_b)
         select id, league, a, b, s, at, method, pens_a, pens_b
         from jsonb_to_recordset($1::text::jsonb) as x(id text, league text, a text, b text, s float8, at float8, method text, pens_a int, pens_b int)
         on conflict (id) do nothing`,
        [JSON.stringify(rows)],
      );
    } else if (kind === 'status.set') {
      // Last write wins per title; within a batch, keep only the latest change for each.
      const latest = new Map<string, { league: string; title_id: string; status: SeenStatus | null; updated_at: number }>();
      for (const op of run as Extract<Op, { op: 'status.set' }>[]) {
        latest.set(`${op.league}|${op.titleId}`, { league: op.league, title_id: op.titleId, status: op.status, updated_at: op.at });
      }
      await db.query(
        `insert into ml_status (league, title_id, status, updated_at)
         select league, title_id, status, updated_at
         from jsonb_to_recordset($1::text::jsonb) as x(league text, title_id text, status text, updated_at float8)
         on conflict (league, title_id) do update
           set status = excluded.status, updated_at = excluded.updated_at
           where ml_status.updated_at <= excluded.updated_at`,
        [JSON.stringify([...latest.values()])],
      );
    } else {
      const op = run[0];
      if (op.op === 'match.remove') {
        // Tombstone, so a result undone on one device never comes back from another.
        await db.query(
          `insert into ml_matches (id, league, a, b, s, at, method, deleted_at)
           values ($1, $2, '', '', 0, $3, 'tombstone', $3)
           on conflict (id) do update set deleted_at = coalesce(ml_matches.deleted_at, excluded.deleted_at)`,
          [op.id, op.league, op.at],
        );
      } else if (op.op === 'custom.add') {
        await db.query(
          `insert into ml_custom (league, id, data, added_at) values ($1, $2, $3::text::jsonb, $4)
           on conflict (league, id) do update set data = excluded.data`,
          [op.league, op.title.id, JSON.stringify(op.title), op.at],
        );
      } else if (op.op === 'league.reset') {
        await db.query(`update ml_matches set deleted_at = $2 where league = $1 and deleted_at is null and at <= $2`, [op.league, op.at]);
        await db.query(`delete from ml_status where league = $1 and updated_at <= $2`, [op.league, op.at]);
        await db.query(`delete from ml_custom where league = $1 and added_at <= $2`, [op.league, op.at]);
      }
    }
  }
}

export type CloudState = Record<LeagueKind, LeagueData>;

export async function readState(db: Db): Promise<CloudState> {
  await ensureSchema(db);
  const [matches, statuses, customs] = await Promise.all([
    db.query<{ id: string; league: LeagueKind; a: string; b: string; s: number; at: number; method: Match['method']; pens_a: number | null; pens_b: number | null }>(
      `select id, league, a, b, s, at, method, pens_a, pens_b from ml_matches
       where deleted_at is null and method <> 'tombstone' order by at, id`,
    ),
    db.query<{ league: LeagueKind; title_id: string; status: SeenStatus }>(`select league, title_id, status from ml_status where status is not null`),
    db.query<{ league: LeagueKind; data: unknown }>(`select league, data from ml_custom order by added_at`),
  ]);

  const state = Object.fromEntries(KINDS.map((k) => [k, { matches: [], status: {}, custom: [] }])) as unknown as CloudState;
  for (const r of matches) {
    if (!state[r.league]) continue;
    const m: Match = { id: r.id, a: r.a, b: r.b, s: Number(r.s), at: Number(r.at), method: r.method };
    if (r.pens_a != null && r.pens_b != null) m.pens = [r.pens_a, r.pens_b];
    state[r.league].matches.push(m);
  }
  for (const r of statuses) if (state[r.league]) state[r.league].status[r.title_id] = r.status;
  for (const r of customs) {
    const t: Title | null = state[r.league] ? sanitizeTitle(typeof r.data === 'string' ? JSON.parse(r.data) : r.data, r.league) : null;
    if (t) state[r.league].custom.push(t);
  }
  return state;
}

const LOCKOUT_WINDOW = 15 * 60_000;
const LOCKOUT_ATTEMPTS = 10;

/** Too many wrong passwords from one address recently? */
export async function isLockedOut(db: Db, ip: string, now = Date.now()) {
  await ensureSchema(db);
  const [row] = await db.query<{ n: number }>(`select count(*)::int as n from ml_auth_failures where ip = $1 and at > $2`, [ip, now - LOCKOUT_WINDOW]);
  return Number(row?.n ?? 0) >= LOCKOUT_ATTEMPTS;
}

export async function recordFailedLogin(db: Db, ip: string, now = Date.now()) {
  await ensureSchema(db);
  await db.query(`insert into ml_auth_failures (ip, at) values ($1, $2)`, [ip, now]);
  await db.query(`delete from ml_auth_failures where at < $1`, [now - 24 * 3600_000]);
}
