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
  beginHeadStart,
  claimInvite,
  confirmBriefing,
  createMatch,
  extendSetup,
  getLobby,
  joinMatch,
  previewInvite,
  rerollCentre,
  setRosterLock,
  startMatch,
} from "../server/index";
import {
  abortMatch,
  endMatchEarly,
  pauseMatch,
  resumeMatch,
} from "../server/console";

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
    /** Setup presets (Stage 5, task 2). */
    defaultCaptureMode: v.optional(
      v.union(
        v.literal("spectator"),
        v.literal("hunter"),
        v.literal("helper"),
      ),
    ),
    proximityDetection: v.optional(v.boolean()),
    /** Optional, shown on the public result page (Stage 6). */
    title: v.optional(v.string()),
    clubName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await createMatch(ctx, {
      createdByUserId: userId,
      matchDurationMinutes: args.matchDurationMinutes,
      organiserLat: args.organiserLat,
      organiserLng: args.organiserLng,
      invigilatorNames: args.invigilatorNames,
      defaultCaptureMode: args.defaultCaptureMode,
      proximityDetection: args.proximityDetection,
      title: args.title,
      clubName: args.clubName,
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
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await joinMatch(ctx, {
      userId,
      roomCode: args.roomCode,
      callSign: args.callSign,
      displayName: args.displayName,
      displayNameMode: args.displayNameMode,
    });
  },
});

/** The rules briefing: "I understand", recorded once per player. */
export const acknowledgeBriefing = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await confirmBriefing(ctx, { matchId: args.matchId, userId });
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

/**
 * Opens the setup countdown (Stage 5 add-on): teams are drawn, the roster is
 * locked, and everyone walks to a starting position.
 */
export const startRoom = mutation({
  args: {
    matchId: v.id("matches"),
    /** The organiser's confirmed "start anyway" when briefings are missing. */
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await startMatch(ctx, {
      matchId: args.matchId,
      userId,
      force: args.force,
    });
  },
});

/** Organiser's "End match": the same settlement as a natural end. */
export const endRoom = mutation({
  args: { matchId: v.id("matches"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await endMatchEarly(ctx, {
      matchId: args.matchId,
      userId,
      reason: args.reason,
    });
  },
});

/** Emergency freeze: clock, zone shrink and drain all stop until resumed. */
export const pauseRoom = mutation({
  args: { matchId: v.id("matches"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await pauseMatch(ctx, {
      matchId: args.matchId,
      userId,
      reason: args.reason ?? "Paused by the organiser.",
    });
  },
});

export const resumeRoom = mutation({
  args: { matchId: v.id("matches"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await resumeMatch(ctx, {
      matchId: args.matchId,
      userId,
      reason: args.reason ?? "Resumed by the organiser.",
    });
  },
});

/**
 * The organiser's "start the head start" button at the end of setup. Refuses
 * (with the count) while players are still too close unless `force` is set.
 */
export const beginHeadStartRoom = mutation({
  args: {
    matchId: v.id("matches"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await beginHeadStart(ctx, {
      matchId: args.matchId,
      userId,
      force: args.force,
    });
  },
});

/** Push the setup countdown out by one minute (audited). */
export const extendSetupRoom = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await extendSetup(ctx, { matchId: args.matchId, userId });
  },
});

/**
 * "Abort match": no winner, no bonuses, points kept so far. Organiser or
 * invigilator, reason required.
 */
export const abortRoom = mutation({
  args: { matchId: v.id("matches"), reason: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await abortMatch(ctx, {
      matchId: args.matchId,
      userId,
      reason: args.reason,
    });
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
