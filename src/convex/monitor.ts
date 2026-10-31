/**
 * The invigilator console.
 *
 * The client sends a match id and an action; the server decides whether this
 * user is an invigilator for that match and only then reads or writes
 * anything. Positions and complaints never leave this endpoint for anyone
 * else.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  dismissComplaint,
  forceTag,
  getConsoleView,
  pauseMatch,
  removePlayer,
  resumeMatch,
  setPlayerMode,
  warnPlayer,
} from "../server/console";

async function userId(ctx: Parameters<typeof getAuthUserId>[0]): Promise<string> {
  const id = await getAuthUserId(ctx);
  if (id === null) throw new Error("Sign in first.");
  return id;
}

export const view = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    try {
      return await getConsoleView(ctx, {
        matchId: args.matchId,
        userId: user,
      });
    } catch (cause) {
      // A query cannot reject gracefully, so an outsider gets an empty view
      // rather than a crashed page. Anything else is a real failure.
      const message = cause instanceof Error ? cause.message : "";
      if (
        message.startsWith("Only an invigilator") ||
        message === "Match not found."
      ) {
        return null;
      }
      throw cause;
    }
  },
});

export const dismiss = mutation({
  args: {
    matchId: v.id("matches"),
    complaintId: v.id("complaints"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    await dismissComplaint(ctx, {
      matchId: args.matchId,
      complaintId: args.complaintId,
      userId: user,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const force = mutation({
  args: {
    matchId: v.id("matches"),
    hunterId: v.id("players"),
    shadowId: v.id("players"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    return await forceTag(ctx, {
      matchId: args.matchId,
      hunterId: args.hunterId,
      shadowId: args.shadowId,
      userId: user,
      reason: args.reason,
    });
  },
});

export const warn = mutation({
  args: {
    matchId: v.id("matches"),
    playerId: v.id("players"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    await warnPlayer(ctx, {
      matchId: args.matchId,
      playerId: args.playerId,
      userId: user,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const remove = mutation({
  args: {
    matchId: v.id("matches"),
    playerId: v.id("players"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    await removePlayer(ctx, {
      matchId: args.matchId,
      playerId: args.playerId,
      userId: user,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const changeMode = mutation({
  args: {
    matchId: v.id("matches"),
    playerId: v.id("players"),
    mode: v.union(
      v.literal("spectator"),
      v.literal("hunter"),
      v.literal("helper"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    await setPlayerMode(ctx, {
      matchId: args.matchId,
      playerId: args.playerId,
      mode: args.mode,
      userId: user,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const pause = mutation({
  args: { matchId: v.id("matches"), reason: v.string() },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    return await pauseMatch(ctx, {
      matchId: args.matchId,
      userId: user,
      reason: args.reason,
    });
  },
});

export const resume = mutation({
  args: { matchId: v.id("matches"), reason: v.string() },
  handler: async (ctx, args) => {
    const user = await userId(ctx);
    return await resumeMatch(ctx, {
      matchId: args.matchId,
      userId: user,
      reason: args.reason,
    });
  },
});
