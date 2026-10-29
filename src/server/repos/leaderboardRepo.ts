export interface LeaderboardRow {
  id: string;
  matchId: string;
  playerId: string;
  displayName: string;
  displayNameMode: "nickname" | "real";
  totalPoints: number;
  breakdown: {
    alive: number;
    tags: number;
    bonuses: number;
    drains: number;
  };
  updatedAt: number;
}

export interface LeaderboardRepository {
  upsert(input: {
    matchId: string;
    playerId: string;
    displayName: string;
    displayNameMode: "nickname" | "real";
    totalPoints: number;
    breakdown: {
      alive: number;
      tags: number;
      bonuses: number;
      drains: number;
    };
    at: number;
  }): Promise<void>;
  listByMatch(matchId: string): Promise<LeaderboardRow[]>;
}
