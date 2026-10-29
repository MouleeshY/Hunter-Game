/**
 * Match rules on the server: position uploads, tag scans, settling and the
 * public leaderboard.
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
  allTaggedBonus,
  hunterTagPoints,
  matchEndState,
  rankLeaderboard,
  survivalBonus,
  validateTagScan,
  zoneProgress,
  zoneRadiusAtMinute,
  type LocationSnapshot,
  type PlayerSnapshot,
} from "shadow-hunt-rules";
import { getRepos } from "../server/providers";
import type { PlayerRow } from "../server/repos";
import { award } from "../server/settlement";
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

function locationSnapshot(row: {
  lat: number;
  lng: number;
  recordedAtMs: number;
  accuracyMetres: number | null;
  pingIndex: number;
}): LocationSnapshot {
  return {
    lat: row.lat,
    lng: row.lng,
    recordedAtMs: row.recordedAtMs,
    accuracyMetres: row.accuracyMetres,
    pingIndex: row.pingIndex,
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
 * "150 bonus per Hunter" applies to every original Hunter who was not removed
 * by an invigilator. A Shadow who turned Hunter after being tagged is not an
 * original Hunter and receives nothing.
 */
function isEligibleHunter(player: PlayerRow): boolean {
  return (
    player.role === "hunter" &&
    player.status === "active" &&
    player.taggedAt === null
  );
}

function activeShadows(players: PlayerRow[]): PlayerRow[] {
  return players.filter(
    (player) =>
      player.role === "shadow" &&
      player.status === "active" &&
      player.taggedAt === null,
  );
}

/* ------------------------------------------------------------------ *\n * Position upload\n * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *\n * Tag scan\n * ------------------------------------------------------------------ */

export const submitTagScan = mutation({
  args: {
    matchId: v.id("matches"),
    scannedToken: v.string(),
    /** The Hunter's current GPS reading, sent with the scan. */
    scannerLat: v.number(),
    scannerLng: v.number(),
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
    const stored = await repos().locations.insert(ctx, {
      matchId: match.id,
      playerId: scanner.id,
      lat: args.scannerLat,
      lng: args.scannerLng,
      accuracyMetres: null,
      pingIndex: 0,
      recordedAt: now,
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

    /* Who helped: only a converted Hunter can assist. */
    let assistedById: string | null = null;
    if (args.assistedByPlayerId) {
      const helper = players.find(
        (player) => player.id === args.assistedByPlayerId,
      );
      if (
        helper &&
        helper.id !== scanner.id &&
        helper.taggedAt !== null &&
        helper.mode === "hunter"
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
      scoredPoints: points,
      at: now,
    });

    /* The Shadow stops scoring and takes the mode chosen before the match. */
    await repos().players.patch(ctx, target!.id, {
      status: target!.mode === "hunter" ? "tagged" : "spectator",
      taggedAt: now,
      taggedById: scanner.id,
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
        ? { ...player, status: "tagged" as const, taggedAt: now }
        : player,
    );
    const totalShadows = remaining.filter((p) => p.role === "shadow").length;
    const end = matchEndState({
      totalShadows,
      activeShadows: activeShadows(remaining).length,
      nowMs: now,
      endsAtMs: match.endsAt,
    });

    let matchEnded = false;
    if (end.ended && end.winner === "hunters") {
      const bonus = allTaggedBonus(match.config);
      for (const player of players) {
        if (isEligibleHunter(player)) {
          await award(ctx, {
            matchId: match.id,
            playerId: player.id,
            kind: "all_tagged_bonus",
            points: bonus,
            at: now,
            refId: tagId,
          });
        }
      }
      await repos().matches.patch(ctx, match.id, {
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

/* ------------------------------------------------------------------ *\n * Settle on the timer\n * ------------------------------------------------------------------ */

export const settleMatch = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const match = await repos().matches.findById(ctx, args.matchId);
    if (!match) throw new Error("Match not found");
    if (match.status === "ended") {
      return {
        ended: true,
        winner: match.winner,
        alreadySettled: true,
      };
    }

    const players = await repos().players.listByMatch(ctx, match.id);
    const totalShadows = players.filter((p) => p.role === "shadow").length;
    const end = matchEndState({
      totalShadows,
      activeShadows: activeShadows(players).length,
      nowMs: now,
      endsAtMs: match.endsAt,
    });
    if (!end.ended) throw new Error("The match has not ended yet");

    if (end.winner === "hunters") {
      const bonus = allTaggedBonus(match.config);
      for (const player of players) {
        if (isEligibleHunter(player)) {
          await award(ctx, {
            matchId: match.id,
            playerId: player.id,
            kind: "all_tagged_bonus",
            points: bonus,
            at: now,
          });
        }
      }
    } else {
      // Removed, tagged and eliminated Shadows get nothing: only an active,
      // untagged Shadow receives the survival bonus.
      const bonus = survivalBonus(match.config);
      for (const player of activeShadows(players)) {
        await award(ctx, {
          matchId: match.id,
          playerId: player.id,
          kind: "survival_bonus",
          points: bonus,
          at: now,
        });
      }
    }

    await repos().matches.patch(ctx, match.id, {
      status: "ended",
      winner: end.winner,
      endedAt: now,
    });

    return { ended: true, winner: end.winner, alreadySettled: false };
  },
});

/* ------------------------------------------------------------------ *\n * Public leaderboard\n * ------------------------------------------------------------------ */

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
