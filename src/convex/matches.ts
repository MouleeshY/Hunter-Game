import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import {
  allTaggedBonus,
  hunterTagPoints,
  rankLeaderboard,
  survivalBonus,
} from "./rules/scoring";
import { matchEndState, pingSchedule } from "./rules/match";
import { validateTagScan } from "./rules/tags";
import { zoneProgress, zoneRadiusAtMinute } from "./rules/zone";
import type { LocationSnapshot, PlayerSnapshot } from "./rules/types";

/**
 * Server-side rules for a running match.
 *
 * Everything that decides whether a tag counts, whether a player is inside the
 * zone, and how many points are worth happens in `./rules/*` — pure functions
 * with unit tests. This module only reads state, calls those functions, and
 * writes the result. No rule is enforced on the phone.
 */

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

async function getPlayerByUser(
  ctx: MutationCtx | QueryCtx,
  matchId: Id<"matches">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("players")
    .withIndex("by_match_user", (q) =>
      q.eq("matchId", matchId).eq("userId", userId),
    )
    .first();
}

async function getPlayerByToken(
  ctx: MutationCtx | QueryCtx,
  matchId: Id<"matches">,
  qrToken: string,
) {
  return await ctx.db
    .query("players")
    .withIndex("by_match_qr", (q) =>
      q.eq("matchId", matchId).eq("qrToken", qrToken),
    )
    .first();
}

async function getPlayers(ctx: MutationCtx | QueryCtx, matchId: Id<"matches">) {
  return await ctx.db
    .query("players")
    .withIndex("by_match_role", (q) => q.eq("matchId", matchId))
    .collect();
}

async function getLatestLocation(
  ctx: MutationCtx | QueryCtx,
  matchId: Id<"matches">,
  playerId: Id<"players">,
) {
  return await ctx.db
    .query("locations")
    .withIndex("by_match_player_time", (q) =>
      q.eq("matchId", matchId).eq("playerId", playerId),
    )
    .order("desc")
    .first();
}

function snapshot(player: Doc<"players">): PlayerSnapshot {
  return {
    id: player._id,
    role: player.role,
    mode: player.mode,
    status: player.status,
    taggedAtMs: player.taggedAt ?? null,
  };
}

function locationOf(row: Doc<"locations"> | null): LocationSnapshot | null {
  if (!row) return null;
  return { lat: row.lat, lng: row.lng, recordedAtMs: row.recordedAt };
}

/** Players still taking part: untagged players and converted Hunters. */
function playersInPlay(players: Doc<"players">[]) {
  return players.filter((p) => p.status === "active" || p.status === "tagged");
}

/** Zone contraction (0 → 1) at a given moment of the match. */
function zoneProgressNow(
  match: Doc<"matches">,
  inPlayCount: number,
  nowMs: number,
): number {
  const startedAt = match.startedAt ?? nowMs;
  const minute = Math.max(0, Math.floor((nowMs - startedAt) / 60_000));
  const radius = zoneRadiusAtMinute({
    minute,
    activePlayerCount: inPlayCount,
    initialRadiusMetres: match.zone.initialRadiusMetres,
    config: match.config,
  });
  return zoneProgress(radius, match.zone.initialRadiusMetres);
}

/**
 * Recompute a player's total from the append-only ledger and refresh their
 * leaderboard row. Totals are always derived, never nudged.
 */
async function settlePlayer(
  ctx: MutationCtx,
  matchId: Id<"matches">,
  playerId: Id<"players">,
  at: number,
): Promise<number> {
  const events = await ctx.db
    .query("scoreEvents")
    .withIndex("by_match_player", (q) =>
      q.eq("matchId", matchId).eq("playerId", playerId),
    )
    .collect();

  const breakdown = { alive: 0, tags: 0, bonuses: 0, drains: 0 };
  for (const event of events) {
    if (event.kind === "shadow_alive") breakdown.alive += event.points;
    else if (event.kind === "tag") breakdown.tags += event.points;
    else if (event.kind === "zone_drain") breakdown.drains += event.points;
    else breakdown.bonuses += event.points;
  }
  const totalPoints =
    breakdown.alive + breakdown.tags + breakdown.bonuses + breakdown.drains;

  const player = await ctx.db.get(playerId);
  if (!player) return totalPoints;

  const existing = await ctx.db
    .query("leaderboard")
    .withIndex("by_match_player", (q) =>
      q.eq("matchId", matchId).eq("playerId", playerId),
    )
    .first();

  const row = {
    matchId,
    playerId,
    displayName: player.displayName,
    displayNameMode: player.displayNameMode,
    totalPoints,
    breakdown,
    updatedAt: at,
  };
  if (existing) await ctx.db.patch(existing._id, row);
  else await ctx.db.insert("leaderboard", row);

  await ctx.db.patch(playerId, { points: totalPoints });
  return totalPoints;
}

async function award(
  ctx: MutationCtx,
  args: {
    matchId: Id<"matches">;
    playerId: Id<"players">;
    kind: "tag" | "all_tagged_bonus" | "survival_bonus";
    points: number;
    at: number;
    refId?: string;
  },
) {
  await ctx.db.insert("scoreEvents", {
    matchId: args.matchId,
    playerId: args.playerId,
    kind: args.kind,
    points: args.points,
    at: args.at,
    source: "system",
    refId: args.refId,
  });
  await settlePlayer(ctx, args.matchId, args.playerId, args.at);
}

/**
 * "All Shadows tagged: 150 bonus per Hunter."
 * Awarded to Hunters still in play who were never tagged themselves — a
 * captured Shadow who switched sides stopped scoring when they were caught.
 */
function isEligibleHunter(player: Doc<"players">): boolean {
  return (
    player.role === "hunter" &&
    player.status === "active" &&
    player.taggedAt === undefined
  );
}

/* ------------------------------------------------------------------ *
 * Location ping
 * ------------------------------------------------------------------ */

export const recordPing = mutation({
  args: {
    matchId: v.id("matches"),
    lat: v.number(),
    lng: v.number(),
    accuracyMetres: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const match = await ctx.db.get(args.matchId);
    if (!match) throw new Error("Match not found");
    if (match.status !== "active") throw new Error("Match is not running");

    const player = await getPlayerByUser(ctx, args.matchId, userId);
    if (!player) throw new Error("You are not in this match");

    if (!Number.isFinite(args.lat) || args.lat < -90 || args.lat > 90) {
      throw new Error("Latitude out of range");
    }
    if (!Number.isFinite(args.lng) || args.lng < -180 || args.lng > 180) {
      throw new Error("Longitude out of range");
    }

    const last = await getLatestLocation(ctx, args.matchId, player._id);
    const schedule = pingSchedule({
      startedAtMs: match.startedAt ?? null,
      lastPingAtMs: last?.recordedAt ?? null,
      nowMs: now,
      config: match.config,
    });

    if (!schedule.allowed) {
      return {
        ok: false as const,
        reason: schedule.reason,
        nextAllowedAtMs: schedule.nextAllowedAtMs,
        pingIndex: last?.pingIndex ?? 0,
      };
    }

    const pingIndex = last ? last.pingIndex + 1 : 0;
    await ctx.db.insert("locations", {
      matchId: args.matchId,
      playerId: player._id,
      lat: args.lat,
      lng: args.lng,
      accuracyMetres: args.accuracyMetres,
      recordedAt: now,
      pingIndex,
    });

    return {
      ok: true as const,
      reason: null,
      nextAllowedAtMs: now + match.config.pingIntervalMinutes * 60_000,
      pingIndex,
    };
  },
});

/* ------------------------------------------------------------------ *
 * Tag scan
 * ------------------------------------------------------------------ */

export const submitTagScan = mutation({
  args: {
    matchId: v.id("matches"),
    scannedToken: v.string(),
    /** Converted Hunter who helped with this capture. Noted at capture time. */
    assistedByPlayerId: v.optional(v.id("players")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const match = await ctx.db.get(args.matchId);
    if (!match) throw new Error("Match not found");

    const scanner = await getPlayerByUser(ctx, args.matchId, userId);
    if (!scanner) throw new Error("You are not in this match");

    const target = await getPlayerByToken(ctx, args.matchId, args.scannedToken);

    const [scannerLocation, targetLocation] = await Promise.all([
      getLatestLocation(ctx, args.matchId, scanner._id),
      target ? getLatestLocation(ctx, args.matchId, target._id) : null,
    ]);

    const verdict = validateTagScan({
      nowMs: now,
      match: {
        status: match.status,
        startedAtMs: match.startedAt ?? null,
        endsAtMs: match.endsAt ?? null,
      },
      scanner: snapshot(scanner),
      target: target ? snapshot(target) : null,
      scannerLocation: locationOf(scannerLocation),
      targetLocation: locationOf(targetLocation),
      config: match.config,
    });

    if (!verdict.ok) {
      // A failed or wrong scan costs the Hunter nothing: no points move, no
      // state changes. The row exists only so an invigilator can audit a
      // dispute about someone else's code.
      if (target) {
        await ctx.db.insert("tags", {
          matchId: args.matchId,
          hunterId: scanner._id,
          shadowId: target._id,
          status: "rejected",
          rejectionCode: verdict.code,
          distanceMetres: verdict.distanceMetres,
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
      };
    }

    const players = await getPlayers(ctx, args.matchId);
    const progress = zoneProgressNow(match, playersInPlay(players).length, now);
    const points = verdict.scores
      ? hunterTagPoints({ zoneProgress01: progress, config: match.config })
      : 0;

    /* Who helped: only a converted Hunter can assist a Hunter. */
    let assistedById: Id<"players"> | undefined;
    if (args.assistedByPlayerId) {
      const helper = players.find((p) => p._id === args.assistedByPlayerId);
      if (
        helper &&
        helper._id !== scanner._id &&
        helper.taggedAt !== undefined &&
        helper.mode === "hunter"
      ) {
        assistedById = helper._id;
      }
    }

    const tagId = await ctx.db.insert("tags", {
      matchId: args.matchId,
      hunterId: scanner._id,
      shadowId: target!._id,
      status: "accepted",
      distanceMetres: verdict.distanceMetres,
      assistedById,
      scoredPoints: points,
      at: now,
    });

    /* The Shadow stops scoring and takes the mode chosen before the match. */
    await ctx.db.patch(target!._id, {
      status: target!.mode === "hunter" ? "tagged" : "spectator",
      taggedAt: now,
      taggedById: scanner._id,
    });

    if (points > 0) {
      await award(ctx, {
        matchId: args.matchId,
        playerId: scanner._id,
        kind: "tag",
        points,
        at: now,
        refId: tagId,
      });
    }

    /* End conditions. */
    const totalShadows = players.filter((p) => p.role === "shadow").length;
    const taggedShadows = players.filter(
      (p) =>
        p.role === "shadow" &&
        (p._id === target!._id || p.taggedAt !== undefined),
    ).length;
    const end = matchEndState({
      totalShadows,
      taggedShadows,
      nowMs: now,
      endsAtMs: match.endsAt ?? null,
    });

    let matchEnded = false;
    if (end.ended && end.winner === "hunters") {
      const bonus = allTaggedBonus(match.config);
      for (const p of players) {
        if (isEligibleHunter(p)) {
          await award(ctx, {
            matchId: args.matchId,
            playerId: p._id,
            kind: "all_tagged_bonus",
            points: bonus,
            at: now,
            refId: tagId,
          });
        }
      }
      await ctx.db.patch(match._id, {
        status: "ended",
        winner: "hunters",
        endedAt: now,
      });
      matchEnded = true;
    }

    return {
      ok: true as const,
      code: null,
      distanceMetres: verdict.distanceMetres,
      points,
      matchEnded,
      winner: end.winner,
    };
  },
});

/* ------------------------------------------------------------------ *
 * Settle the match once an end condition is true
 * ------------------------------------------------------------------ */

export const settleMatch = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const match = await ctx.db.get(args.matchId);
    if (!match) throw new Error("Match not found");
    if (match.status === "ended") {
      return {
        ended: true,
        winner: match.winner ?? null,
        alreadySettled: true,
      };
    }

    const players = await getPlayers(ctx, args.matchId);
    const totalShadows = players.filter((p) => p.role === "shadow").length;
    const taggedShadows = players.filter(
      (p) => p.role === "shadow" && p.taggedAt !== undefined,
    ).length;

    const end = matchEndState({
      totalShadows,
      taggedShadows,
      nowMs: now,
      endsAtMs: match.endsAt ?? null,
    });
    if (!end.ended) throw new Error("The match has not ended yet");

    if (end.winner === "hunters") {
      const bonus = allTaggedBonus(match.config);
      for (const p of players) {
        if (isEligibleHunter(p)) {
          await award(ctx, {
            matchId: args.matchId,
            playerId: p._id,
            kind: "all_tagged_bonus",
            points: bonus,
            at: now,
          });
        }
      }
    } else {
      const bonus = survivalBonus(match.config);
      for (const p of players) {
        if (
          p.role === "shadow" &&
          p.status === "active" &&
          p.taggedAt === undefined
        ) {
          await award(ctx, {
            matchId: args.matchId,
            playerId: p._id,
            kind: "survival_bonus",
            points: bonus,
            at: now,
          });
        }
      }
    }

    await ctx.db.patch(match._id, {
      status: "ended",
      winner: end.winner,
      endedAt: now,
    });

    return { ended: true, winner: end.winner, alreadySettled: false };
  },
});

/* ------------------------------------------------------------------ *
 * Public leaderboard — names and points only, never positions
 * ------------------------------------------------------------------ */

export const getLeaderboard = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) throw new Error("Match not found");

    const rows = await ctx.db
      .query("leaderboard")
      .withIndex("by_match_points", (q) => q.eq("matchId", args.matchId))
      .collect();

    const byId = new Map(rows.map((r) => [r.playerId, r]));
    const ranked = rankLeaderboard(
      rows.map((r) => ({
        playerId: r.playerId as string,
        displayName: r.displayName,
        totalPoints: r.totalPoints,
      })),
    );

    return {
      status: match.status,
      winner: match.winner ?? null,
      entries: ranked.map((entry) => {
        const row = byId.get(entry.playerId as Id<"players">);
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
