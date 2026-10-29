/**
 * Provider selection.
 *
 * The data layer is swappable: the repository interfaces in `src/server/repos/`
 * are database-independent, and each provider implements them. This module picks
 * the active provider by the DATA_PROVIDER env var.
 *
 *   DATA_PROVIDER=convex   → src/server/providers/convex
 *   DATA_PROVIDER=supabase → src/server/providers/supabase (not yet wired)
 *
 * When DATA_PROVIDER is absent we fall back to Convex, because this project
 * currently only runs on Convex.
 */

export type Provider = "convex" | "supabase";

export function selectProvider(): Provider {
  const raw = (process.env["DATA_PROVIDER"] ?? "convex").trim().toLowerCase();
  if (raw === "convex") return "convex";
  if (raw === "supabase") return "supabase";
  throw new Error(`Unknown DATA_PROVIDER value: ${process.env["DATA_PROVIDER"] ?? "(unset)"}. Expected "convex" or "supabase".`);
}

/** Repo names that the server mutations and queries use. */
export const REPO_NAMES = [
  "matches",
  "players",
  "locations",
  "tags",
  "complaints",
  "invigilators",
  "scores",
  "leaderboard",
] as const;

export type RepoName = (typeof REPO_NAMES)[number];
