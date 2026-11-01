/**
 * The Postgres / Supabase provider.
 *
 * Selected by `DATA_PROVIDER=supabase`. It implements the same repository
 * interfaces as the Convex provider, so no shared service, rule or test learns
 * that the database changed.
 *
 * Connections
 *   - `DATABASE_URL` is the Supabase pooler connection string. It is
 *     server-only: it is never read by the browser bundle and must never be
 *     prefixed with `VITE_`.
 *   - the anon key is not used here at all. The browser talks to the API (or
 *     to a Broadcast channel), never to the tables. RLS in
 *     `supabase/migrations/*_rls.sql` is what makes that true.
 *
 * Transactions
 *   - `read(fn)` runs a service against a plain connection.
 *   - `transaction(fn)` runs it inside ONE database transaction with row locks
 *     (`select … for update`) on the rows that could otherwise be updated by a
 *     second request. Every mutating API route uses it.
 */
import { postgresDb, type Db, type DbConnection } from "./db";
import {
  auditRepo,
  complaintRepo,
  eventRepo,
  invigilatorRepo,
  leaderboardRepo,
  locationRepo,
  matchRepo,
  playerRepo,
  scoreRepo,
  tagRepo,
  userRepo,
} from "./repos";
import type { PgContext } from "./repos";
import type { RepoContext } from "../../repos/context";

export type { PgContext } from "./repos";
export { postgresDb } from "./db";
export type { Db, DbConnection } from "./db";

/** Every repository, implemented on Postgres. */
export const repos = {
  users: userRepo,
  matches: matchRepo,
  players: playerRepo,
  locations: locationRepo,
  tags: tagRepo,
  complaints: complaintRepo,
  invigilators: invigilatorRepo,
  scores: scoreRepo,
  leaderboard: leaderboardRepo,
  audit: auditRepo,
  events: eventRepo,
} as const;

export type Repos = typeof repos;

export interface PostgresProvider {
  repos: Repos;
  /** Run a read-only service. */
  read<T>(fn: (ctx: RepoContext) => Promise<T>): Promise<T>;
  /** Run a mutating service in one transaction, with row locks enabled. */
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
    transaction: (fn) => db.transaction((conn: DbConnection) => fn({ conn, write: true })),
    close: () => db.close(),
  };
}

let cached: PostgresProvider | null = null;

/** The provider for this process, connected with the server-only DATABASE_URL. */
export function getPostgresProvider(): PostgresProvider {
  if (cached !== null) return cached;

  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const url = env?.["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATA_PROVIDER=supabase needs DATABASE_URL (the Supabase pooler connection string).",
    );
  }
  cached = createPostgresProvider(postgresDb(url));
  return cached;
}

/** Tests and scripts: point the provider at a different database. */
export function setPostgresProviderForTests(next: PostgresProvider | null): void {
  cached = next;
}
