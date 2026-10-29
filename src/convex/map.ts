/**
 * Map queries.
 *
 * The client sends only a match id. The server resolves who is asking, what
 * role they have, and returns only the positions they are allowed to see — a
 * Hunter never receives a live Shadow position, even if the client asks.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { getMapView } from "../server/positionService";

export const view = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to see the map.");
    return await getMapView(ctx, { matchId: args.matchId, userId });
  },
});
