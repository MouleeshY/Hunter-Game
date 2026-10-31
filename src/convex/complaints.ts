/**
 * Complaints.
 *
 * The Hunter picks an active Shadow from a list — never a typed id — and the
 * server decides whether the filing is allowed (window, one open complaint per
 * pair, rate limit).
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fileComplaint } from "../server/complaints";
import { getRepos } from "../server/providers";

/** Active Shadows a Hunter may name in a complaint. No positions. */
export const complaintTargets = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const repos = getRepos();
    const [me, players, existing] = await Promise.all([
      repos.players.findByMatchAndUser(ctx, args.matchId, userId),
      repos.players.listByMatch(ctx, args.matchId),
      repos.complaints.listByMatch(ctx, args.matchId),
    ]);
    if (!me) throw new Error("You are not in this match.");

    const openByMe = new Set(
      existing
        .filter(
          (row) => row.complainantId === me.id && row.status === "open",
        )
        .map((row) => row.accusedId),
    );

    return {
      isHunter: me.role === "hunter",
      targets: players
        .filter(
          (player) =>
            player.role === "shadow" &&
            player.status === "active" &&
            player.taggedAt === null &&
            player.id !== me.id,
        )
        .map((player) => ({
          playerId: player.id,
          callSign: player.callSign,
          alreadyReported: openByMe.has(player.id),
        })),
      mine: existing
        .filter((row) => row.complainantId === me.id)
        .map((row) => ({
          id: row.id,
          accusedId: row.accusedId,
          status: row.status,
          createdAt: row.createdAt,
          responseDueAt: row.responseDueAt,
        })),
    };
  },
});

export const file = mutation({
  args: {
    matchId: v.id("matches"),
    accusedId: v.id("players"),
    note: v.optional(v.string()),
    incidentAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const complaint = await fileComplaint(ctx, {
      matchId: args.matchId,
      userId,
      accusedId: args.accusedId,
      note: args.note ?? null,
      incidentAtMs: args.incidentAtMs,
    });
    return { id: complaint.id, responseDueAt: complaint.responseDueAt };
  },
});
