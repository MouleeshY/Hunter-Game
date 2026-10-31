/**
 * The live match feed and the "I need help" alert.
 *
 * Everything here writes through the repositories. Events never carry a
 * position except `help`, whose coordinates are only ever read back by the
 * invigilator console (`getConsoleView`) — never by other players.
 */
import { getRepos } from "./providers";
import type { MatchEventKind, RepoContext } from "./repos";

/** Append one line to the match's feed. */
export async function recordEvent(
  ctx: RepoContext,
  input: {
    matchId: string;
    at: number;
    kind: MatchEventKind;
    playerId?: string | null;
    actorId?: string | null;
    detail?: string | null;
    refId?: string | null;
  },
): Promise<void> {
  await getRepos().events.append(ctx, input);
}

/**
 * A player taps "I need help". The alert carries their current position and
 * appears in the console for every invigilator of the match.
 *
 * Refused only if the player is not in the match; it works during the head
 * start and while paused, because that is exactly when help may be needed.
 */
export async function raiseHelpAlert(
  ctx: RepoContext,
  input: {
    matchId: string;
    userId: string;
    lat?: number | null;
    lng?: number | null;
    accuracyMetres?: number | null;
    nowMs?: number;
  },
): Promise<{ id: string; at: number }> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  if (match.status === "ended") {
    throw new Error("That match has already ended.");
  }

  const player = await repos.players.findByMatchAndUser(
    ctx,
    match.id,
    input.userId,
  );
  if (!player) throw new Error("You are not in this match.");

  // Fall back to the last stored position when the phone has no fresh fix.
  let lat = typeof input.lat === "number" ? input.lat : null;
  let lng = typeof input.lng === "number" ? input.lng : null;
  if (lat === null || lng === null) {
    const latest = await repos.locations.latestByPlayer(ctx, match.id, player.id);
    lat = latest?.lat ?? null;
    lng = latest?.lng ?? null;
  }

  const id = await repos.events.append(ctx, {
    matchId: match.id,
    at: now,
    kind: "help",
    playerId: player.id,
    detail: player.callSign,
    lat,
    lng,
  });
  return { id, at: now };
}
