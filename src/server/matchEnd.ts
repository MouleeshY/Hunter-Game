/**
 * Ending a match — one place, so the bonuses are applied exactly once no
 * matter who notices the end first (a tag, the minute tick, or the organiser).
 *
 * Winners come from the pure `matchEndState` rule in `src/rules`. Everything
 * here writes through the repositories.
 */
import { matchEndState, survivalBonus, allTaggedBonus, type MatchEndReason } from "../rules";
import { getRepos } from "./providers";
import { award } from "./settlement";
import type { PlayerRow, RepoContext } from "./repos";

export interface EndResult {
  ended: boolean;
  winner: "hunters" | "shadows" | null;
  alreadySettled: boolean;
}

/** Shadows still in play: assigned the team, untagged, not out of the match. */
export function activeShadows(players: PlayerRow[]): PlayerRow[] {
  return players.filter(
    (player) =>
      player.role === "shadow" &&
      player.status === "active" &&
      player.taggedAt === null,
  );
}

/**
 * "150 bonus per Hunter" goes to every original Hunter who was not removed by
 * an invigilator. A Shadow who turned Hunter after being tagged is not an
 * original Hunter and receives nothing.
 */
export function isEligibleHunter(player: PlayerRow): boolean {
  return (
    player.role === "hunter" &&
    player.status === "active" &&
    player.taggedAt === null
  );
}

/**
 * Settle on the timer: the client's "the clock ran out" call.
 *
 * A match that has not ended yet is refused, so a phone with a wrong clock can
 * never cut a match short. Settling twice is a no-op.
 */
export async function settleOnTimer(
  ctx: RepoContext,
  input: { matchId: string },
): Promise<EndResult> {
  const match = await getRepos().matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found");
  if (match.status === "ended") {
    return { ended: true, winner: match.winner, alreadySettled: true };
  }

  const result = await endMatch(ctx, { matchId: match.id });
  if (!result.ended) throw new Error("The match has not ended yet");
  return {
    ended: true,
    winner: result.winner,
    alreadySettled: result.alreadySettled,
  };
}

/**
 * Settle a match that has ended.
 *
 * `force` is the organiser's "End match" button: the same bonuses, but without
 * waiting for the clock. With Shadows still in play they were surviving, so the
 * Shadows win; with none left the Hunters had already won.
 */
export async function endMatch(
  ctx: RepoContext,
  input: {
    matchId: string;
    nowMs?: number;
    force?: boolean;
    /** Ref of the tag that ended the match, recorded on the bonus ledger. */
    refId?: string;
  },
): Promise<EndResult> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  if (match.status === "ended") {
    return { ended: true, winner: match.winner, alreadySettled: true };
  }

  const players = await repos.players.listByMatch(ctx, match.id);
  const totalShadows = players.filter((p) => p.role === "shadow").length;
  const detected = matchEndState({
    totalShadows,
    activeShadows: activeShadows(players).length,
    nowMs: now,
    endsAtMs: match.endsAt,
  });

  let winner: "hunters" | "shadows";
  let endReason: MatchEndReason;
  if (detected.ended) {
    winner = detected.winner;
    endReason = detected.reason;
  } else if (input.force) {
    winner = activeShadows(players).length > 0 ? "shadows" : "hunters";
    endReason = "staff_end";
  } else {
    return { ended: false, winner: null, alreadySettled: false };
  }

  if (winner === "hunters") {
    const bonus = allTaggedBonus(match.config);
    for (const player of players) {
      if (isEligibleHunter(player)) {
        await award(ctx, {
          matchId: match.id,
          playerId: player.id,
          kind: "all_tagged_bonus",
          points: bonus,
          at: now,
          refId: input.refId,
        });
      }
    }
  } else {
    // Removed, tagged and eliminated Shadows get nothing: only an active,
    // untagged Shadow receives the survival bonus.
    const bonus = survivalBonus(match.config);
    for (const player of activeShadows(players)) {
      await award(ctx, {
        matchId: match.id,
        playerId: player.id,
        kind: "survival_bonus",
        points: bonus,
        at: now,
        refId: input.refId,
      });
    }
  }

  await repos.matches.patch(ctx, match.id, {
    status: "ended",
    winner,
    endReason,
    endedAt: now,
  });

  return { ended: true, winner, alreadySettled: false };
}
