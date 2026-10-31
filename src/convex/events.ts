/**
 * The live match feed and player alerts.
 *
 * The feed never carries a position, and while the match is running it never
 * says who caught whom — names appear only once the match has ended. Proximity
 * alerts are returned separately and only to the two players involved, and even
 * then as a rough band: never a coordinate, a name or a direction.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getRepos } from "../server/providers";
import { raiseHelpAlert } from "../server/events";

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

export const feed = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const repos = getRepos();
    const match = await repos.matches.findById(ctx, args.matchId);
    if (!match) throw new Error("Match not found.");

    const [players, invigilator] = await Promise.all([
      repos.players.listByMatch(ctx, match.id),
      repos.invigilators.findByMatchAndUser(ctx, match.id, userId),
    ]);
    const me = players.find((player) => player.userId === userId) ?? null;
    if (!me && invigilator === null) {
      throw new Error("You are not in this match.");
    }

    const events = await repos.events.listByMatch(ctx, match.id);
    const callSign = new Map(
      players.map((player) => [player.id, player.callSign]),
    );
    const ended = match.status === "ended";

    const items: FeedItem[] = [];
    const alerts: FeedAlert[] = [];

    for (const event of events) {
      if (event.kind === "help") continue; // console only
      if (event.kind === "detection") {
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

      const who = (id: string | null) =>
        (id && callSign.get(id)) || "Someone";

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
      serverNowMs: Date.now(),
    };
  },
});

/** "I need help": sends the phone's position to every invigilator. */
export const help = mutation({
  args: {
    matchId: v.id("matches"),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    accuracyMetres: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    return await raiseHelpAlert(ctx, {
      matchId: args.matchId,
      userId,
      lat: args.lat ?? null,
      lng: args.lng ?? null,
      accuracyMetres: args.accuracyMetres ?? null,
    });
  },
});
