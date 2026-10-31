/**
 * Score ledger settlement.
 *
 * Every score event is append-only; a player's total is always recomputed from
 * the ledger and mirrored onto the leaderboard. Both tag scoring and out-of-zone
 * drains go through here, and everything is written through repositories.
 */
import { getRepos } from "./providers";
import type { RepoContext, ScoreKind } from "./repos";

export async function settlePlayer(
  ctx: RepoContext,
  matchId: string,
  playerId: string,
  at: number,
): Promise<number> {
  const repos = getRepos();
  const [events, player] = await Promise.all([
    repos.scores.listByPlayer(ctx, matchId, playerId),
    repos.players.findById(ctx, playerId),
  ]);

  const breakdown = { alive: 0, tags: 0, bonuses: 0, drains: 0 };
  for (const event of events) {
    if (event.kind === "shadow_alive") breakdown.alive += event.points;
    else if (event.kind === "tag") breakdown.tags += event.points;
    else if (event.kind === "zone_drain") breakdown.drains += event.points;
    else breakdown.bonuses += event.points;
  }
  const totalPoints =
    breakdown.alive + breakdown.tags + breakdown.bonuses + breakdown.drains;

  if (!player) return totalPoints;

  await repos.leaderboard.upsert(ctx, {
    matchId,
    playerId,
    displayName: player.displayName,
    displayNameMode: player.displayNameMode,
    totalPoints,
    breakdown,
    at,
  });
  await repos.players.patch(ctx, playerId, { points: totalPoints });
  return totalPoints;
}

export async function award(
  ctx: RepoContext,
  args: {
    matchId: string;
    playerId: string;
    kind: ScoreKind;
    points: number;
    at: number;
    source?: "system" | "invigilator";
    refId?: string;
  },
): Promise<void> {
  await getRepos().scores.insert(ctx, {
    matchId: args.matchId,
    playerId: args.playerId,
    kind: args.kind,
    points: args.points,
    at: args.at,
    source: args.source ?? "system",
    refId: args.refId ?? null,
  });
  await settlePlayer(ctx, args.matchId, args.playerId, args.at);
}
