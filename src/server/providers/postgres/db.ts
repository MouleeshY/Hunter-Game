/**
 * The tiny database surface the Postgres repositories use.
 *
 * Two adapters implement it:
 *
 *   postgresDb(url)  → the `postgres` driver against Supabase's pooler
 *                      (server-only DATABASE_URL)
 *   pgliteDb(db)     → @electric-sql/pglite, in-process, for the tests
 *
 * Everything above this file speaks the repository interfaces in
 * `src/server/repos`; nothing above it knows which adapter is running.
 */
import postgres from "postgres";

export type QueryRow = Record<string, unknown>;

export interface DbConnection {
  /** Run one parameterised statement and return its rows. */
  query<T = QueryRow>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run one or more statements with no parameters (migrations, DDL). */
  exec(text: string): Promise<void>;
}

export interface Db extends DbConnection {
  /**
   * Run `fn` inside ONE database transaction on a reserved connection.
   * Anything thrown rolls the whole thing back.
   */
  transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function connectionOf(
  run: (text: string, params: unknown[]) => Promise<unknown[]>,
  exec: (text: string) => Promise<void>,
): DbConnection {
  return {
    query: async <T,>(text: string, params: unknown[] = []) =>
      (await run(text, params)) as T[],
    exec,
  };
}

/** The production adapter: `postgres` against the Supabase pooler. */
export function postgresDb(url: string): Db {
  // `prepare: false` is required by the transaction-mode pooler (port 6543),
  // which cannot keep a named prepared statement between transactions.
  const sql = postgres(url, { prepare: false, max: 10 });
  const rowsOf = async (text: string, params: unknown[]) =>
    (await sql.unsafe(text, params as never[])) as unknown as unknown[];

  const root = connectionOf(rowsOf, async (text) => {
    await sql.unsafe(text);
  });

  return {
    ...root,
    async transaction<T>(fn: (conn: DbConnection) => Promise<T>) {
      const reserved = await sql.reserve();
      const reservedRows = async (text: string, params: unknown[]) =>
        (await reserved.unsafe(text, params as never[])) as unknown as unknown[];

      try {
        await reserved.unsafe("begin");
        const result = await fn(
          connectionOf(reservedRows, async (text) => {
            await reserved.unsafe(text);
          }),
        );
        await reserved.unsafe("commit");
        return result;
      } catch (cause) {
        try {
          await reserved.unsafe("rollback");
        } catch {
          // The connection is already unusable; releasing it is enough.
        }
        throw cause;
      } finally {
        reserved.release();
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
