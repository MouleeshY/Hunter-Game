/**
 * Match rules on the server: position uploads, tag scans, the capture choice,
 * settling and the public leaderboard.
 *
 * Every database read and write goes through a repository from
 * `src/server/repos`. Every decision (proximity, freshness, scoring, end
 * conditions) comes from the pure functions in `shadow-hunt-rules`
 * (`src/rules`). This module only resolves auth, calls those and writes.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  distanceMetres,
  hunterTagPoints,
  matchEndState,
  rankLeaderboard,
  validateTagScan,
  zoneProgress,
  zoneRadiusAtMinute,
  type LocationSnapshot,
  type PlayerSnapshot,
} from "shadow-hunt-rules";
import { getRepos } from "../server/providers";
import type { LocationRow, PlayerRow } from "../server/repos";
import { award } from "../server/settlement";
import { activeShadows, endMatch } from "../server/matchEnd";
import { statusAfterCapture } from "../server/console";
import { uploadPosition as uploadPositionService } from "../server/positionService";

const repos = () => getRepos();

function playerSnapshot(player: PlayerRow): PlayerSnapshot {
  return {
    id: player.id,
    role: player.role,
    mode: player.mode,
    status: player.status,
    taggedAtMs: player.taggedAt,
  };
}

function locationSnapshot(row: LocationRow): LocationSnapshot {
  return {
    lat: row.lat,
    lng: row.lng,
    recordedAtMs: row.recordedAtMs,
    accuracyMetres: row.accuracyMetres,
    pingIndex: row.pingIndex,
    suspicious: row.suspicious,
  };
}

/** Zone contraction (0 → 1) at a given moment of the match. */
function zoneProgressNow(
  match: {
    startedAt: number | null;
    initialRadiusMetres: number;
    config: Parameters<typeof zoneRadiusAtMinute>[0]["config"];
  },
  inPlayCount: number,
  nowMs: number,
): number {
  const startedAt = match.startedAt ?? nowMs;
  const minute = Math.max(0, Math.floor((nowMs - startedAt) / 60_000));
  const radius = zoneRadiusAtMinute({
    minute,
    activePlayerCount: inPlayCount,
    initialRadiusMetres: match.initialRadiusMetres,
    config: match.config,
  });
  return zoneProgress(radius, match.initialRadiusMetres);
}

/**
 * The spoof check a scan reading gets, same numbers as the upload path: an
 * impossible accuracy, or a jump faster than a person can move.
 */
function spoofReason(args: {
  previous: LocationRow | null;
  lat: number;
  lng: number;
  accuracyMetres: number | null;
  nowMs: number;
  config: {
    impossibleAccuracyMetres: number;
    maxSpeedMetresPerSecond: number;
  };
}): string | null {
  const { previous, accuracyMetres, config } = args;
  if (
    accuracyMetres !== null &&
    (accuracyMetres < 0 || accuracyMetres > config.impossibleAccuracyMetres)
  ) {
    return "impossible_accuracy";
  }
  if (previous) {
    const seconds = (args.nowMs - previous.recordedAtMs) / 1000;
    if (seconds > 0) {
      const speed =
        distanceMetres(previous, { lat: args.lat, lng: args.lng }) / seconds;
      if (speed > config.maxSpeedMetresPerSecond) return "impossible_speed";
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Position upload
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Tag scan
 * ------------------------------------------------------------------ */

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
    const now = Date.now();
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const match = await repos().matches.findById(ctx, args.matchId);
    if (!match) throw new Error("Match not found");

    const scanner = await repos().players.findByMatchAndUser(
      ctx,
      match.id,
      userId,
    );
    if (!scanner) throw new Error("You are not in this match");

    // The scan carries a fresh reading; store it so the 30 s freshness rule can
    // be applied to both sides.
    if (!Number.isFinite(args.scannerLat) || !Number.isFinite(args.scannerLng)) {
      throw new Error("A current GPS reading is needed to scan.");
    }

    // Nothing happens while the match is frozen: no tags, no scoring.
    if (match.pausedAt !== null) {
      return {
        ok: false as const,
        code: "match_not_active" as const,
        distanceMetres: null,
        points: 0,
        matchEnded: false,
        winner: null,
      };
    }

    const previous = await repos().locations.latestByPlayer(
      ctx,
      match.id,
      scanner.id,
    );
    const scannerReason = spoofReason({
      previous,
      lat: args.scannerLat,
      lng: args.scannerLng,
      accuracyMetres: args.scannerAccuracyMetres ?? null,
      nowMs: now,
      config: match.config,
    });
    const stored = await repos().locations.insert(ctx, {
      matchId: match.id,
      playerId: scanner.id,
      lat: args.scannerLat,
      lng: args.scannerLng,
      accuracyMetres: args.scannerAccuracyMetres ?? null,
      pingIndex: (previous?.pingIndex ?? -1) + 1,
      recordedAt: now,
      suspicious: scannerReason !== null,
      suspiciousReason: scannerReason,
    });

    const target = await repos().players.findByMatchAndToken(
      ctx,
      match.id,
      args.scannedToken,
    );
    const targetLocation = target
      ? await repos().locations.latestByPlayer(ctx, match.id, target.id)
      : null;

    const verdict = validateTagScan({
      nowMs: now,
      match: {
        status: match.status,
        startedAtMs: match.startedAt,
        endsAtMs: match.endsAt,
      },
      scanner: playerSnapshot(scanner),
      target: target ? playerSnapshot(target) : null,
      scannerLocation: locationSnapshot(stored),
      targetLocation: targetLocation ? locationSnapshot(targetLocation) : null,
      config: match.config,
    });

    if (!verdict.ok) {
      // A failed or wrong scan costs the Hunter nothing: no points move and no
      // state changes. The row exists only for an invigilator to audit.
      if (target) {
        await repos().tags.insert(ctx, {
          matchId: match.id,
          hunterId: scanner.id,
          shadowId: target.id,
          status: "rejected",
          rejectionCode: verdict.code,
          distanceMetres: verdict.distanceMetres ?? null,
          scoredPoints: 0,
          at: now,
        });
      }
      return {
        ok: false as const,
        code: verdict.code,
        distanceMetres: verdict.distanceMetres ?? null,
        points: 0,
        matchEnded: false,
        winner: null,
      };
    }

    const players = await repos().players.listByMatch(ctx, match.id);
    const inPlay = players.filter(
      (player) => player.status === "active" || player.status === "tagged",
    );
    const progress = zoneProgressNow(match, inPlay.length, now);
    const points = verdict.scores
      ? hunterTagPoints({ zoneProgress01: progress, config: match.config })
      : 0;

    /* Who helped: a converted Hunter or a Helper may assist, never a stranger. */
    let assistedById: string | null = null;
    if (args.assistedByPlayerId) {
      const helper = players.find(
        (player) => player.id === args.assistedByPlayerId,
      );
      if (
        helper &&
        helper.id !== scanner.id &&
        helper.taggedAt !== null &&
        (helper.mode === "hunter" || helper.mode === "helper")
      ) {
        assistedById = helper.id;
      }
    }

    const tagId = await repos().tags.insert(ctx, {
      matchId: match.id,
      hunterId: scanner.id,
      shadowId: target!.id,
      status: "accepted",
      distanceMetres: verdict.distanceMetres,
      assistedById,
      // The mode chosen before the match is the default offered at capture.
      captureMode: target!.mode,
      forced: false,
      scoredPoints: points,
      at: now,
    });

    /* The Shadow stops scoring and takes the preset mode until they choose. */
    await repos().players.patch(ctx, target!.id, {
      status: statusAfterCapture(target!.mode),
      taggedAt: now,
      taggedById: scanner.id,
      captureChosenAt: null,
    });

    if (points > 0) {
      await award(ctx, {
        matchId: match.id,
        playerId: scanner.id,
        kind: "tag",
        points,
        at: now,
        refId: tagId,
      });
    }

    /* End conditions: Hunters win when no Shadow remains active. */
    const remaining = players.map((player) =>
      player.id === target!.id
        ? {
            ...player,
            status: statusAfterCapture(target!.mode),
            taggedAt: now,
          }
        : player,
    );
    const end = matchEndState({
      totalShadows: remaining.filter((p) => p.role === "shadow").length,
      activeShadows: activeShadows(remaining).length,
      nowMs: now,
      endsAtMs: match.endsAt,
    });

    let matchEnded = false;
    if (end.ended && end.winner === "hunters") {
      const settled = await endMatch(ctx, {
        matchId: match.id,
        nowMs: now,
        refId: tagId,
      });
      matchEnded = settled.ended;
    }

    return {
      ok: true as const,
      code: null,
      distanceMetres: verdict.distanceMetres,
      points,
      matchEnded,
      winner: end.ended ? end.winner : null,
      /** The choice the tagged player is offered next. */
      captureMode: target!.mode,
    };
  },
});

/* ------------------------------------------------------------------ *
 * Capture choice
 * ------------------------------------------------------------------ */

/**
 * The tagged Shadow decides what happens next: Spectator, join the Hunters, or
 * Helper (helps a Hunter, plays for fun, earns nothing). The organiser's preset
 * arrives as the default; this records the moment they actually chose.
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
    const now = Date.now();
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const player = await repos().players.findByMatchAndUser(
      ctx,
      args.matchId,
      userId,
    );
    if (!player) throw new Error("You are not in this match.");
    if (player.taggedAt === null) {
      throw new Error("Only a captured Shadow picks a mode.");
    }

    await repos().players.patch(ctx, player.id, {
      mode: args.mode,
      status: statusAfterCapture(args.mode),
      captureChosenAt: now,
    });
    return { mode: args.mode };
  },
});

/* ------------------------------------------------------------------ *
 * Settle on the timer
 * ------------------------------------------------------------------ */

export const settleMatch = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const match = await repos().matches.findById(ctx, args.matchId);
    if (!match) throw new Error("Match not found");
    if (match.status === "ended") {
      return { ended: true, winner: match.winner, alreadySettled: true };
    }

    const result = await endMatch(ctx, { matchId: match.id });
    if (!result.ended) throw new Error("The match has not ended yet");
    return {
      ended: true,
      winner: result.winner,
      alreadySettled: result.alreadySettled,
    };
  },
});

/* ------------------------------------------------------------------ *
 * Public leaderboard
 * ------------------------------------------------------------------ */

export const getLeaderboard = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const match = await repos().matches.findById(ctx, args.matchId);
    if (!match) throw new Error("Match not found");

    const rows = await repos().leaderboard.listByMatch(ctx, match.id);
    const byId = new Map(rows.map((row) => [row.playerId, row]));

    const ranked = rankLeaderboard(
      rows.map((row) => ({
        playerId: row.playerId,
        displayName: row.displayName,
        totalPoints: row.totalPoints,
      })),
    );

    return {
      status: match.status,
      winner: match.winner,
      entries: ranked.map((entry) => {
        const row = byId.get(entry.playerId);
        return {
          rank: entry.rank,
          displayName: entry.displayName,
          totalPoints: entry.totalPoints,
          breakdown: row?.breakdown ?? {
            alive: 0,
            tags: 0,
            bonuses: 0,
            drains: 0,
          },
        };
      }),
    };
  },
});

export type MatchId = Id<"matches">;
