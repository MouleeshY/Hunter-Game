/**
 * The live match feed and player alerts.
 *
 * The shape and the visibility rules live in `src/server/events.ts` so they can
 * be reached by tests; this module only resolves the signed-in user.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getFeedView, raiseHelpAlert } from "../server/events";

export const feed = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    return await getFeedView(ctx, { matchId: args.matchId, userId });
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
