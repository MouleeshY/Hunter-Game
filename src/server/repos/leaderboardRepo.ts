import type { DisplayNameMode } from "../../rules/types";
import type { RepoContext } from "./context";

export interface LeaderboardBreakdown {
  alive: number;
  tags: number;
  bonuses: number;
  drains: number;
}

export interface LeaderboardRow {
  id: string;
  matchId: string;
  playerId: string;
  displayName: string;
  displayNameMode: DisplayNameMode;
  totalPoints: number;
  breakdown: LeaderboardBreakdown;
  updatedAt: number;
}

export interface LeaderboardRepository {
  upsert(
    ctx: RepoContext,
    input: {
      matchId: string;
      playerId: string;
      displayName: string;
      displayNameMode: DisplayNameMode;
      totalPoints: number;
      breakdown: LeaderboardBreakdown;
      at: number;
    },
  ): Promise<void>;
  listByMatch(ctx: RepoContext, matchId: string): Promise<LeaderboardRow[]>;
}
