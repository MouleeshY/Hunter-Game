/**
 * Closure that binds the Convex generated API into the repository implementations.
 *
 * This file exists so the repository module itself stays a plain TypeScript
 * module that can be tested without a running Convex server. The server module
 * imports `bindConvexRepos` once at boot and passes the real Convex context.
 */

import { internalMutation, internalQuery } from "../../../../convex/_generated/server";
import {
  matchRepo,
  playerRepo,
  locationRepo,
  tagRepo,
  complaintRepo,
  invigilatorRepo,
  scoreRepo,
  leaderboardRepo,
} from "./index";

export function bindConvexRepos() {
  matchRepo.bindConvexMatchFns(readMatch, writeMatch);
  playerRepo.bindConvexPlayerFns(
    readPlayer,
    readPlayerByMatchAndUser,
    readPlayerByMatchAndToken,
    readPlayersByMatch,
    writePlayer,
  );
  locationRepo.bindConvexLocationFns(readLatestLocation, writeLocation);
  tagRepo.bindConvexTagFns(writeTag);
  complaintRepo.bindConvexComplaintFns(
    listOpenComplaintsByMatch,
    readComplaint,
    writeComplaint,
  );
  invigilatorRepo.bindConvexInvigilatorFns(
    readInvigilatorByMatchAndUser,
    readInvigilatorsByMatch,
    readInvigilatorById,
    writeInvigilator,
  );
  scoreRepo.bindConvexScoreFns(writeScoreEvent, listScoreEventsByPlayer);
  leaderboardRepo.bindConvexLeaderboardFns(
    readLeaderboardByMatchAndPlayer,
    readLeaderboardByMatch,
    writeLeaderboard,
  );
}

// ---- Internal Convex queries/mutations used by the provider ----------------

export const readMatch = internalQuery({
  args: { id: { types: { match: "matches" } } },
  handler: async (ctx, { id }) => {
    const m = await ctx.db.get(id);
    return m ?? null;
  },
});

export const writeMatch = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    // Convex cannot replace a doc by id; we re-insert. Keep it simple: if the
    // row exists, patch; otherwise insert. This should be replaced by a real
    // doc-id write when we wire Supabase or clean up Convex usage here.
    const existing = await ctx.db.get(doc._id);
    if (existing) {
      return await ctx.db.patch(doc._id, doc);
    }
    return await ctx.db.insert("matches", doc);
  },
});

export const readPlayer = internalQuery({
  args: { id: { types: { match: "players" } } },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const readPlayerByMatchAndUser = internalQuery({
  args: {
    matchId: { types: { match: "matches" } },
    userId: { types: { match: "users" } },
  },
  handler: async (ctx, { matchId, userId }) => {
    return await ctx.db
      .query("players")
      .withIndex("by_match_user", (q) => q.eq("matchId", matchId).eq("userId", userId))
      .first();
  },
});

export const readPlayerByMatchAndToken = internalQuery({
  args: { matchId: { types: { match: "matches" } }, token: { types: "string" } },
  handler: async (ctx, { matchId, token }) => {
    return await ctx.db
      .query("players")
      .withIndex("by_match_qr", (q) => q.eq("matchId", matchId).eq("qrToken", token))
      .first();
  },
});

export const readPlayersByMatch = internalQuery({
  args: { matchId: { types: { match: "matches" } } },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("players")
      .withIndex("by_match_role", (q) => q.eq("matchId", matchId))
      .collect();
  },
});

export const writePlayer = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    const existing = await ctx.db.get(doc._id);
    if (existing) return await ctx.db.patch(doc._id, doc);
    return await ctx.db.insert("players", doc);
  },
});

export const readLatestLocation = internalQuery({
  args: {
    matchId: { types: { match: "matches" } },
    playerId: { types: { match: "players" } },
  },
  handler: async (ctx, { matchId, playerId }) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_match_player_time", (q) =>
        q.eq("matchId", matchId).eq("playerId", playerId),
      )
      .order("desc")
      .first();
  },
});

export const writeLocation = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    const existing = await ctx.db.get(doc._id);
    if (existing) return await ctx.db.patch(doc._id, doc);
    return await ctx.db.insert("locations", doc);
  },
});

export const writeTag = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    const existing = await ctx.db.get(doc._id);
    if (existing) return await ctx.db.patch(doc._id, doc);
    return await ctx.db.insert("tags", doc);
  },
});

export const listOpenComplaintsByMatch = internalQuery({
  args: { matchId: { types: { match: "matches" } } },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("complaints")
      .withIndex("by_match_status", (q) => q.eq("matchId", matchId).eq("status", "open"))
      .collect();
  },
});

export const readComplaint = internalQuery({
  args: { id: { types: {} } },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const writeComplaint = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    const existing = await ctx.db.get(doc._id);
    if (existing) return await ctx.db.patch(doc._id, doc);
    return await ctx.db.insert("complaints", doc);
  },
});

export const readInvigilatorByMatchAndUser = internalQuery({
  args: {
    matchId: { types: { match: "matches" } },
    userId: { types: { match: "users" } },
  },
  handler: async (ctx, { matchId, userId }) => {
    return await ctx.db
      .query("invigilators")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();
  },
});

export const readInvigilatorsByMatch = internalQuery({
  args: { matchId: { types: { match: "matches" } } },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("invigilators")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
  },
});

export const readInvigilatorById = internalQuery({
  args: { id: { types: {} } },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const writeInvigilator = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    const existing = await ctx.db.get(doc._id);
    if (existing) return await ctx.db.patch(doc._id, doc);
    return await ctx.db.insert("invigilators", doc);
  },
});

export const writeScoreEvent = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    const existing = await ctx.db.get(doc._id);
    if (existing) return await ctx.db.patch(doc._id, doc);
    return await ctx.db.insert("scoreEvents", doc);
  },
});

export const listScoreEventsByPlayer = internalQuery({
  args: {
    matchId: { types: { match: "matches" } },
    playerId: { types: { match: "players" } },
  },
  handler: async (ctx, { matchId, playerId }) => {
    return await ctx.db
      .query("scoreEvents")
      .withIndex("by_match_player", (q) => q.eq("matchId", matchId).eq("playerId", playerId))
      .collect();
  },
});

export const readLeaderboardByMatchAndPlayer = internalQuery({
  args: {
    matchId: { types: { match: "matches" } },
    playerId: { types: "string" },
  },
  handler: async (ctx, { matchId, playerId }) => {
    return await ctx.db
      .query("leaderboard")
      .withIndex("by_match_player", (q) => q.eq("matchId", matchId).eq("playerId", playerId))
      .first();
  },
});

export const readLeaderboardByMatch = internalQuery({
  args: { matchId: { types: { match: "matches" } } },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("leaderboard")
      .withIndex("by_match_points", (q) => q.eq("matchId", matchId))
      .collect();
  },
});

export const writeLeaderboard = internalMutation({
  args: { doc: { types: {}, optional: false } },
  handler: async (ctx, { doc }) => {
    const existing = await ctx.db.get(doc._id);
    if (existing) return await ctx.db.patch(doc._id, doc);
    return await ctx.db.insert("leaderboard", doc);
  },
});
