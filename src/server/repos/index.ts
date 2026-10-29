/**
 * Swappable data-access layer for Shadow Hunt.
 *
 * Every read and write the server does goes through one of these repositories.
 * The rules engine (src/rules) is deliberately independent of it; it takes and
 * returns plain values. Only this directory and the providers directory know
 * which database is in use.
 *
 * Switch the backend with one env setting:
 *   DATA_PROVIDER=convex   → src/server/providers/convex
 *   DATA_PROVIDER=supabase → src/server/providers/supabase (future)
 *
 * When both are absent for local development, fall back to the Convex provider.
 */

export * from "./matchRepo";
export * from "./playerRepo";
export * from "./locationRepo";
export * from "./tagRepo";
export * from "./complaintRepo";
export * from "./invigilatorRepo";
export * from "./scoreRepo";
export * from "./leaderboardRepo";
