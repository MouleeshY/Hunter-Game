/**
 * The live match feed and the "I need help" alert.
 *
 * Everything here writes through the repositories. Events never carry a
 * position except `help`, whose coordinates are only ever read back by the
 * invigilator console (`getConsoleView`) — never by other players.
 */
import { getRepos } from "./providers";
import type { MatchEventKind, RepoContext } from "./repos";

/** Newest lines kept on a phone screen. */
const FEED_LIMIT = 40;

export interface FeedItem {
  id: string;
  at: number;
  kind: string;
  text: string;
}

export interface FeedAlert {
  id: string;
  at: number;
  /** The other side's team: a Hunter is warned about a Shadow and back. */
  from: "hunter" | "shadow";
  /** "under 25 m" / "under 50 m" — never the exact distance. */
  band: string;
}

export interface FeedView {
  status: string;
  ended: boolean;
  items: FeedItem[];
  alerts: FeedAlert[];
  serverNowMs: number;
}

/**
 * What one player's phone shows: the match feed plus their own proximity
 * alerts.
 *
 * The feed never carries a position, and while the match is running it never
 * says who caught whom — names appear only once the match has ended. Proximity
 * alerts are returned separately and only to the two players involved, and even
 * then as a rough band: never a coordinate, a name or a direction.
 */
export async function getFeedView(
  ctx: RepoContext,
  input: { matchId: string; userId: string; nowMs?: number },
): Promise<FeedView> {
  const repos = getRepos();

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");

  const [players, invigilator, events] = await Promise.all([
    repos.players.listByMatch(ctx, match.id),
    repos.invigilators.findByMatchAndUser(ctx, match.id, input.userId),
    repos.events.listByMatch(ctx, match.id),
  ]);

  const me = players.find((player) => player.userId === input.userId) ?? null;
  if (!me && invigilator === null) {
    throw new Error("You are not in this match.");
  }

  const callSign = new Map(players.map((player) => [player.id, player.callSign]));
  const ended = match.status === "ended";

  const items: FeedItem[] = [];
  const alerts: FeedAlert[] = [];

  for (const event of events) {
    if (event.kind === "help") continue; // console only
    if (event.kind === "detection") {
      // Only the Hunter and the Shadow it is about. Everyone else, staff
      // included, gets nothing from this row.
      if (!me) continue;
      if (event.playerId !== me.id && event.actorId !== me.id) continue;
      alerts.push({
        id: event.id,
        at: event.at,
        from: event.playerId === me.id ? "shadow" : "hunter",
        band: event.detail ?? "close by",
      });
      continue;
    }

    const who = (id: string | null) => (id && callSign.get(id)) || "Someone";

    let text = event.detail ?? "";
    if (event.kind === "tag") {
      // Names only once the match is over (Stage 5, task 6).
      text = ended
        ? `${who(event.actorId)} caught ${who(event.playerId)}.`
        : "A Shadow was caught.";
    } else if (event.kind === "elimination") {
      text = `${who(event.playerId)} is out — too long outside the area.`;
    } else if (event.kind === "removal") {
      text = `${who(event.playerId)} was removed from the match.`;
    } else if (event.kind === "pause") {
      text = event.detail ? `Match paused — ${event.detail}` : "Match paused.";
    } else if (event.kind === "resume") {
      text = "The match is running again.";
    } else if (event.kind === "phase") {
      text = event.detail ?? "";
    } else if (event.kind === "shrink") {
      text = event.detail ?? "The play area has shrunk.";
    }

    if (!text) continue;
    items.push({ id: event.id, at: event.at, kind: event.kind, text });
  }

  return {
    status: match.status,
    ended,
    items: items.slice(-FEED_LIMIT),
    alerts,
    serverNowMs: input.nowMs ?? Date.now(),
  };
}

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
