/**
 * Swappable data-access layer for Shadow Hunt.
 *
 * Every read and write the server does goes through one of these repositories.
 * The rules engine (`src/rules`) is independent of them: it takes and returns
 * plain values. Only this directory and `src/server/providers` know which
 * database is in use.
 *
 * Switch the backend with one env setting:
 *   DATA_PROVIDER=convex   → src/server/providers/convex  (default)
 *   DATA_PROVIDER=supabase → src/server/providers/postgres
 *
 * `Repos` is the interface both providers implement, so the shared services in
 * `src/server` compile against one shape whichever database is selected.
 */
import type { UserRepository } from "./userRepo";
import type { MatchRepository } from "./matchRepo";
import type { PlayerRepository } from "./playerRepo";
import type { LocationRepository } from "./locationRepo";
import type { TagRepository } from "./tagRepo";
import type { ComplaintRepository } from "./complaintRepo";
import type { InvigilatorRepository } from "./invigilatorRepo";
import type { ScoreRepository } from "./scoreRepo";
import type { LeaderboardRepository } from "./leaderboardRepo";
import type { AuditRepository } from "./auditRepo";
import type { MatchEventRepository } from "./eventRepo";

export interface Repos {
  users: UserRepository;
  matches: MatchRepository;
  players: PlayerRepository;
  locations: LocationRepository;
  tags: TagRepository;
  complaints: ComplaintRepository;
  invigilators: InvigilatorRepository;
  scores: ScoreRepository;
  leaderboard: LeaderboardRepository;
  audit: AuditRepository;
  events: MatchEventRepository;
}

export * from "./context";
export * from "./userRepo";
export * from "./matchRepo";
export * from "./playerRepo";
export * from "./locationRepo";
export * from "./tagRepo";
export * from "./complaintRepo";
export * from "./invigilatorRepo";
export * from "./scoreRepo";
export * from "./leaderboardRepo";
export * from "./auditRepo";
export * from "./eventRepo";
