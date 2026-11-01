/**
 * Complaints.
 *
 * The Hunter picks an active Shadow from a list — never a typed id — and the
 * server decides whether the filing is allowed (window, one open complaint per
 * pair, rate limit). Both the list and the decision live in
 * `src/server/complaints.ts`, so the HTTP API in `/api` serves the same thing.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fileComplaint, getComplaintTargets } from "../server/complaints";

/** Active Shadows a Hunter may name in a complaint. No positions. */
export const complaintTargets = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    return await getComplaintTargets(ctx, {
      matchId: args.matchId,
      userId,
    });
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
