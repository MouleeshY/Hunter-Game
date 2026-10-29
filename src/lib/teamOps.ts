/**
 * Re-export the pure team ops module through `src/lib` so the rules engine and
 * scoring code can import it without pulling in Convex.
 */

export {
  teamConfigForCount,
  assignTeams,
  randomZoneCentre,
} from "../server/teamOps";
export type { TeamConfig } from "../server/teamOps";
