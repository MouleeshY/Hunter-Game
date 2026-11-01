/**
 * The in-match leaderboard read.
 *
 * It used to live inside `src/convex/matches.ts`; it is a service now so the
 * HTTP API can serve it without copying the ranking logic. Ties share a rank
 * (`rankLeaderboard` in `src/rules`) and only the display name chosen for this
 * match is ever returned.
 */
import { rankLeaderboard } from "../rules";
import { getRepos } from "./providers";
import type { RepoContext } from "./repos";
import type { LeaderboardBreakdown } from "./repos/leaderboardRepo";

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  totalPoints: number;
  breakdown: LeaderboardBreakdown;
}

export interface LeaderboardView {
  status: string;
  winner: "hunters" | "shadows" | null;
  entries: LeaderboardEntry[];
}

export async function getLeaderboardView(
  ctx: RepoContext,
  input: { matchId: string },
): Promise<LeaderboardView> {
  const repos = getRepos();
  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found");

  const rows = await repos.leaderboard.listByMatch(ctx, match.id);
  const byId = new Map(rows.map((row) => [row.playerId, row]));

  const ranked = rankLeaderboard(
    rows.map((row) => ({
      playerId: row.playerId,
      displayName: row.displayName,
      totalPoints: row.totalPoints,
    })),
  );

  return {
    status: match.status,
    winner: match.winner,
    entries: ranked.map((entry) => {
      const row = byId.get(entry.playerId);
      return {
        rank: entry.rank,
        displayName: entry.displayName,
        totalPoints: entry.totalPoints,
        breakdown: row?.breakdown ?? {
          alive: 0,
          tags: 0,
          bonuses: 0,
          drains: 0,
        },
      };
    }),
  };
}
