/**
 * Match rules on the server: position uploads, tag scans, the capture choice,
 * settling and the public leaderboard.
 *
 * This module only resolves auth and shapes arguments now. The work lives in
 * `src/server` (`positionService`, `tagScan`, `matchEnd`, `leaderboard`), so the
 * same implementation serves Convex and the Supabase HTTP API in `/api`. Every
 * database read and write goes through a repository, and every decision
 * (proximity, freshness, scoring, end conditions) comes from `src/rules`.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { uploadPosition as uploadPositionService } from "../server/positionService";
import {
  chooseCaptureMode as chooseCaptureModeService,
  submitTagScan as submitTagScanService,
} from "../server/tagScan";
import { settleOnTimer } from "../server/matchEnd";
import { getLeaderboardView } from "../server/leaderboard";

/**
 * Phones upload their position every few seconds (`uploadIntervalSeconds`).
 * The 3-minute ping only controls what Hunters are shown of Shadows; it does
 * not limit uploads.
 */
export const uploadPosition = mutation({
  args: {
    matchId: v.id("matches"),
    lat: v.number(),
    lng: v.number(),
    accuracyMetres: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    return await uploadPositionService(ctx, {
      matchId: args.matchId,
      userId,
      lat: args.lat,
      lng: args.lng,
      accuracyMetres: args.accuracyMetres ?? null,
    });
  },
});

export const submitTagScan = mutation({
  args: {
    matchId: v.id("matches"),
    scannedToken: v.string(),
    /** The Hunter's current GPS reading, sent with the scan. */
    scannerLat: v.number(),
    scannerLng: v.number(),
    scannerAccuracyMetres: v.optional(v.number()),
    /** Converted Hunter who helped with this capture. Noted at capture time. */
    assistedByPlayerId: v.optional(v.id("players")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    return await submitTagScanService(ctx, {
      matchId: args.matchId,
      userId,
      scannedToken: args.scannedToken,
      scannerLat: args.scannerLat,
      scannerLng: args.scannerLng,
      scannerAccuracyMetres: args.scannerAccuracyMetres ?? null,
      assistedByPlayerId: args.assistedByPlayerId ?? null,
    });
  },
});

/**
 * The tagged Shadow decides what happens next: Spectator, join the Hunters, or
 * Helper (helps a Hunter, plays for fun, earns nothing).
 */
export const chooseCaptureMode = mutation({
  args: {
    matchId: v.id("matches"),
    mode: v.union(
      v.literal("spectator"),
      v.literal("hunter"),
      v.literal("helper"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    return await chooseCaptureModeService(ctx, {
      matchId: args.matchId,
      userId,
      mode: args.mode,
    });
  },
});

export const settleMatch = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    return await settleOnTimer(ctx, { matchId: args.matchId });
  },
});

export const getLeaderboard = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    return await getLeaderboardView(ctx, { matchId: args.matchId });
  },
});
