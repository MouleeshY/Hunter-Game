/**
 * Provider selection.
 *
 * The rules engine and the repositories never learn which database is in use;
 * this module is the single place that reads `DATA_PROVIDER`.
 *
 *   DATA_PROVIDER=convex   → src/server/providers/convex (default)
 *   DATA_PROVIDER=supabase → src/server/providers/postgres
 *
 * Only the Postgres *repository objects* are imported here. The Postgres
 * connection (and the `postgres` driver, which needs Node builtins) lives in
 * `./postgres` and is imported by the API and the tests — never by the Convex
 * bundle, which runs on a runtime without `fs`/`net`/`tls`.
 *
 * The env read is guarded so the same module can be imported from the browser
 * bundle (where `process` is absent) without crashing.
 */
import { repos as convexRepos } from "./convex";
import { repos as postgresRepos } from "./postgres/repos";
import type { Repos } from "../repos";

export type { Repos };

export type Provider = "convex" | "supabase";

export function selectProvider(): Provider {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const raw = (env?.["DATA_PROVIDER"] ?? "convex").trim().toLowerCase();
  if (raw === "convex") return "convex";
  if (raw === "supabase") return "supabase";
  throw new Error(
    `Unknown DATA_PROVIDER value: ${raw}. Expected "convex" or "supabase".`,
  );
}

let override: Repos | null = null;

/** Test-only seam: run the server against an in-memory repository set. */
export function setReposForTests(next: Repos | null): void {
  override = next;
}

/** The repositories for the selected provider. */
export function getRepos(): Repos {
  if (override !== null) return override;
  const provider = selectProvider();
  if (provider === "supabase") return postgresRepos;
  return convexRepos;
}
