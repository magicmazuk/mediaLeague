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

/**
 * Hosted Postgres URLs (Neon's included) carry libpq-only options such as
 * `channel_binding` that postgres.js would forward to the server as startup
 * parameters, which poolers reject. Strip them and turn `sslmode` into the
 * driver's own `ssl` option.
 */
export function connectionOptions(url: string) {
  const u = new URL(url);
  const sslmode = u.searchParams.get('sslmode');
  for (const key of ['sslmode', 'channel_binding', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation']) u.searchParams.delete(key);
  const ssl = sslmode && sslmode !== 'disable' && sslmode !== 'allow' && sslmode !== 'prefer' ? ('require' as const) : false;
  return { url: u.toString(), ssl };
}

/** A Db backed by postgres.js: the driver used on Vercel. */
export function postgresDb(url: string): Db & { end: () => Promise<void> } {
  // One connection per function instance; `prepare: false` keeps it compatible with pooled (PgBouncer) URLs.
  const options = connectionOptions(url);
  const sql = postgres(options.url, { ssl: options.ssl, max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {} });
  return {
    query: async <T,>(text: string, params: unknown[] = []) =>
      (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[],
    end: () => sql.end(),
  };
}

export function getDb(): Db | null {
  if (instance !== undefined) return instance;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  return (instance = url ? postgresDb(url) : null);
}

/** Used by the local dev server and tests to plug in PGlite. */
export function setDb(db: Db | null) {
  instance = db;
}
