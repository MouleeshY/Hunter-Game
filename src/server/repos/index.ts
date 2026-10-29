/**
 * Swappable data-access layer for Shadow Hunt.
 *
 * Every read and write the server does goes through one of these repositories.
 * The rules engine (`src/rules`) is independent of them: it takes and returns
 * plain values. Only this directory and `src/server/providers` know which
 * database is in use.
 *
 * Switch the backend with one env setting:
 *   DATA_PROVIDER=convex   → src/server/providers/convex
 *   DATA_PROVIDER=supabase → src/server/providers/supabase (future)
 */
export * from "./context";
export * from "./matchRepo";
export * from "./playerRepo";
export * from "./locationRepo";
export * from "./tagRepo";
export * from "./complaintRepo";
export * from "./invigilatorRepo";
export * from "./scoreRepo";
export * from "./leaderboardRepo";
