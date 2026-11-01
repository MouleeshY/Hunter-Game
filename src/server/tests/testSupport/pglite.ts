/**
 * An in-process Postgres for the tests.
 *
 * PGlite runs a real Postgres inside the process (WebAssembly, no Docker, no
 * network), so the contract tests and the flow tests run against the same SQL
 * Supabase will run — migrations included.
 *
 * One PGlite instance is a single Postgres connection. The adapter below
 * serialises whole transactions on it, so two concurrent service calls take
 * turns instead of blocking on a row lock. What the tests still prove is the
 * outcome that matters (a colliding second request is refused, no award is
 * written twice) and that the locking SQL is actually issued.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPostgresProvider,
  type Db,
  type DbConnection,
  type PostgresProvider,
} from "../../providers/postgres";

/** A PGlite connection as the `Db` abstraction sees it. */
export function pgliteDb(db: PGlite): Db {
  const conn: DbConnection = {
    query: async <T,>(text: string, params: unknown[] = []) => {
      const result = await db.query(text, params);
      return result.rows as T[];
    },
    exec: async (text: string) => {
      await db.exec(text);
    },
  };

  // One connection: transactions must not interleave.
  let tail: Promise<unknown> = Promise.resolve();
  const acquire = async (): Promise<() => void> => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = tail;
    tail = tail.then(() => held);
    await previous;
    return release;
  };

  return {
    ...conn,
    transaction: async <T,>(fn: (c: DbConnection) => Promise<T>) => {
      const release = await acquire();
      try {
        await conn.exec("begin");
        const result = await fn(conn);
        await conn.exec("commit");
        return result;
      } catch (cause) {
        try {
          await conn.exec("rollback");
        } catch {
          // nothing useful to do: the instance is about to be discarded
        }
        throw cause;
      } finally {
        release();
      }
    },
    close: async () => {
      await db.close();
    },
  };
}

export function migrationsDir(): string {
  return fileURLToPath(new URL("../../../../supabase/migrations", import.meta.url));
}

/**
 * The migration files PGlite can run: everything except the pg_cron / pg_net
 * schedule, which is Supabase-only (see `stage7a.test.ts` for how it is
 * covered instead).
 */
export function migrationFiles(): string[] {
  return readdirSync(migrationsDir())
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => !file.includes("cron"))
    .sort()
    .map((file) => join(migrationsDir(), file));
}

export async function applyMigrations(db: Db): Promise<string[]> {
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(file, "utf8"));
    applied.push(file);
  }
  return applied;
}

export interface TestDatabase {
  db: Db;
  provider: PostgresProvider;
  /** Run one statement through the pool, outside any transaction. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * A fresh database with the real migrations applied, wired to the same provider
 * the API uses.
 */
export async function createPostgresTestDatabase(): Promise<TestDatabase> {
  const pglite = new PGlite();
  await pglite.waitReady;
  const db = pgliteDb(pglite);
  await applyMigrations(db);
  return {
    db,
    provider: createPostgresProvider(db),
    query: <T,>(text: string, params: unknown[] = []) =>
      db.query<T>(text, params),
    close: () => db.close(),
  };
}
