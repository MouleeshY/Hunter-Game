/**
 * Rooms and lobby.
 *
 * These functions only resolve auth and shape arguments; all validation and
 * database access happens in `src/server` behind the repositories.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  claimInvite,
  createMatch,
  getLobby,
  joinMatch,
  previewInvite,
  rerollCentre,
  setRosterLock,
  startMatch,
} from "../server/index";

async function requireUserId(
  ctx: Parameters<typeof getAuthUserId>[0],
): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in to continue.");
  return userId;
}

export const createRoom = mutation({
  args: {
    matchDurationMinutes: v.number(),
    organiserLat: v.number(),
    organiserLng: v.number(),
    invigilatorNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await createMatch(ctx, {
      createdByUserId: userId,
      matchDurationMinutes: args.matchDurationMinutes,
      organiserLat: args.organiserLat,
      organiserLng: args.organiserLng,
      invigilatorNames: args.invigilatorNames,
    });
  },
});

export const rerollCentreHandler = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await rerollCentre(ctx, {
      matchId: args.matchId,
      organiserUserId: userId,
    });
  },
});

export const joinRoom = mutation({
  args: {
    roomCode: v.string(),
    callSign: v.string(),
    displayName: v.string(),
    displayNameMode: v.union(v.literal("nickname"), v.literal("real")),
    playerMode: v.optional(
      v.union(v.literal("spectator"), v.literal("hunter")),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await joinMatch(ctx, {
      userId,
      roomCode: args.roomCode,
      callSign: args.callSign,
      displayName: args.displayName,
      displayNameMode: args.displayNameMode,
      playerMode: args.playerMode ?? "spectator",
    });
  },
});

export const lobby = query({
  args: { roomCode: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await getLobby(ctx, { userId, roomCode: args.roomCode });
  },
});

export const lockRoster = mutation({
  args: { matchId: v.id("matches"), locked: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await setRosterLock(ctx, {
      matchId: args.matchId,
      userId,
      locked: args.locked,
    });
  },
});

export const startRoom = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await startMatch(ctx, { matchId: args.matchId, userId });
  },
});

export const invitePreview = query({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    return await previewInvite(ctx, args.inviteCode);
  },
});

export const acceptInvite = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await claimInvite(ctx, { userId, inviteCode: args.inviteCode });
  },
});
