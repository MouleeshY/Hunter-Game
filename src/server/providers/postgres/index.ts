/**
 * The Postgres / Supabase provider.
 *
 * Selected by `DATA_PROVIDER=supabase`. It implements the same repository
 * interfaces as the Convex provider, so no shared service, rule or test learns
 * that the database changed.
 *
 * Connections
 *   - `DATABASE_URL` is the Supabase pooler connection string. Server-only: it
 *     is never read by the browser bundle and must never be prefixed `VITE_`.
 *   - the anon key is not used here at all. The browser talks to the API (or to
 *     a Broadcast channel), never to the tables. RLS in
 *     `supabase/migrations/*_rls.sql` is what makes that true.
 *
 * Transactions
 *   - `read(fn)` runs a service against a plain connection.
 *   - `transaction(fn)` runs it inside ONE database transaction with row locks
 *     (`select … for update`) on the rows two requests could collide on. Every
 *     mutating API route uses it; Convex got the same guarantee for free.
 *
 * Nothing here is imported by the Convex bundle: only `./postgres/repos` (the
 * repository objects) reaches `src/convex`. The `postgres` driver needs Node
 * builtins, which Convex's runtime does not have.
 */
import { postgresDb, type Db, type DbConnection } from "./db";
import { repos } from "./repos";
import type { PgContext } from "./repos";
import type { RepoContext } from "../../repos/context";
import type { Repos } from "../../repos";

export type { PgContext } from "./repos";
export { postgresDb } from "./db";
export type { Db, DbConnection } from "./db";
export { repos };

/** Every repository, implemented on Postgres. */
export type PostgresRepos = Repos;

export interface PostgresProvider {
  repos: Repos;
  /** Run a read-only service. */
  read<T>(fn: (ctx: RepoContext) => Promise<T>): Promise<T>;
  /** Run a mutating service in ONE transaction, with row locks enabled. */
  transaction<T>(fn: (ctx: RepoContext) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPostgresProvider(db: Db): PostgresProvider {
  return {
    repos,
    read: async (fn) => {
      const ctx: PgContext = { conn: db, write: false };
      return fn(ctx);
    },
    transaction: (fn) =>
      db.transaction((conn: DbConnection) => fn({ conn, write: true })),
    close: () => db.close(),
  };
}

let cached: PostgresProvider | null = null;
let defaultUrl: string | undefined;

/** The provider for this process, connected with the server-only DATABASE_URL. */
export function getPostgresProvider(url?: string): PostgresProvider {
  const target =
    url ??
    defaultUrl ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.["DATABASE_URL"];
  if (!target) {
    throw new Error(
      "DATA_PROVIDER=supabase needs DATABASE_URL (the Supabase pooler connection string).",
    );
  }
  if (cached !== null && defaultUrl === target) return cached;
  defaultUrl = target;
  cached = createPostgresProvider(postgresDb(target));
  return cached;
}

/** Tests and scripts: point the provider at a different database. */
export function setPostgresProviderForTests(next: PostgresProvider | null): void {
  cached = next;
  defaultUrl = next === null ? undefined : defaultUrl;
}
