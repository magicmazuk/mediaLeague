import postgres from 'postgres';

/**
 * The smallest database surface the app needs. On Vercel this is Postgres via
 * DATABASE_URL (Neon from the Vercel Marketplace sets it, as do most Postgres
 * hosts). Locally and in tests it's PGlite, an in-process Postgres.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

let instance: Db | null | undefined;

export function getDb(): Db | null {
  if (instance !== undefined) return instance;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) return (instance = null);
  // One connection per function instance; `prepare: false` keeps it compatible with pooled (PgBouncer) URLs.
  const sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false });
  instance = {
    query: async <T,>(text: string, params: unknown[] = []) =>
      (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[],
  };
  return instance;
}

/** Used by the local dev server and tests to plug in PGlite. */
export function setDb(db: Db | null) {
  instance = db;
}
