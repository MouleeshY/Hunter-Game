/**
 * Provider selection.
 *
 * The rules engine and the repositories never learn which database is in use;
 * this module is the single place that reads `DATA_PROVIDER`.
 *
 *   DATA_PROVIDER=convex   → src/server/providers/convex (implemented)
 *   DATA_PROVIDER=supabase → src/server/providers/supabase (not wired yet)
 *
 * Absent or unset falls back to Convex, because that is the only provider that
 * exists today. The env read is guarded so the same module can be imported from
 * the browser bundle (where `process` is absent) without crashing.
 */
import { repos as convexRepos, type Repos } from "./convex";

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
  if (provider === "supabase") {
    throw new Error(
      "DATA_PROVIDER=supabase is not wired yet. Set DATA_PROVIDER=convex to run on Convex.",
    );
  }
  return convexRepos;
}
