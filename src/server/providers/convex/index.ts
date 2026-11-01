/**
 * Convex implementation of the swappable data-access layer.
 *
 * This is the only module that reads or writes Convex documents for game data.
 * The repository interfaces in `src/server/repos` stay database-agnostic; this
 * file casts the opaque `RepoContext` to a Convex context exactly once, in
 * `ctxOf`, and then works with the generated `Doc`/`Id` types.
 */
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../convex/_generated/server";
import type { RepoContext } from "../../repos/context";
import type {
  LatLng,
  MatchConfig,
  MatchRepository,
  MatchRow,
  MatchStatus,
} from "../../repos/matchRepo";
import type { PlayerRepository, PlayerRow } from "../../repos/playerRepo";
import type { LocationRepository, LocationRow } from "../../repos/locationRepo";
import type { TagRepository } from "../../repos/tagRepo";
import type {
  ComplaintRepository,
  ComplaintRow,
} from "../../repos/complaintRepo";
import type {
  InvigilatorRepository,
  InvigilatorRow,
} from "../../repos/invigilatorRepo";
import type { ScoreEventRow, ScoreRepository } from "../../repos/scoreRepo";
import type {
  LeaderboardRepository,
  LeaderboardRow,
} from "../../repos/leaderboardRepo";
import type { AuditRepository, AuditRow } from "../../repos/auditRepo";
import type {
  MatchEventRepository,
  MatchEventRow,
  MatchEventKind,
} from "../../repos/eventRepo";

// ---- opaque context --------------------------------------------------------

type ConvexCtx = QueryCtx | MutationCtx;

function ctxOf(context: RepoContext): ConvexCtx {
  // The Convex mutations and queries pass their own ctx here; the provider is
  // selected by DATA_PROVIDER, so only Convex hands us a Convex context.
  return context as ConvexCtx;
}

function reader(context: RepoContext): QueryCtx["db"] {
  return ctxOf(context).db;
}

function writer(context: RepoContext): MutationCtx["db"] {
  return (context as MutationCtx).db;
}

// ---- matchers --------------------------------------------------------------

function matchRow(m: Doc<"matches">): MatchRow {
  return {
    id: m._id,
    roomCode: m.roomCode,
    publicSlug: m.publicSlug ?? null,
    title: m.title ?? null,
    clubName: m.clubName ?? null,
    published: m.published ?? null,
    status: m.status,
    config: m.config,
    createdAt: m.createdAt,
    startedAt: m.startedAt ?? null,
    endsAt: m.endsAt ?? null,
    eventWindowEndsAt: m.eventWindowEndsAt ?? null,
    rosterLocked: m.rosterLocked,
    createdByUserId: m.createdBy ?? null,
    zoneCentre: { lat: m.zone.centreLat, lng: m.zone.centreLng },
    lastPingAt: m.lastPingAt ?? null,
    setupStartedAt: m.setupStartedAt ?? null,
    setupEndsAt: m.setupEndsAt ?? null,
    pausedAt: m.pausedAt ?? null,
    pausedTotalMs: m.pausedTotalMs ?? 0,
    pauseReason: m.pauseReason ?? null,
    aliveUpToMinute: m.aliveUpToMinute ?? -1,
    organiserPosition: m.organiserPosition ?? null,
    initialRadiusMetres: m.zone.initialRadiusMetres,
    winner: m.winner ?? null,
    endedAt: m.endedAt ?? null,
    endReason: m.endReason ?? null,
  };
}

function playerRow(p: Doc<"players">): PlayerRow {
  return {
    id: p._id,
    matchId: p.matchId,
    userId: p.userId,
    role: p.role,
    mode: p.mode,
    status: p.status,
    callSign: p.callSign,
    displayName: p.displayName,
    displayNameMode: p.displayNameMode,
    qrToken: p.qrToken,
    points: p.points,
    joinedAt: p.joinedAt,
    taggedAt: p.taggedAt ?? null,
    taggedById: p.taggedById ?? null,
    captureChosenAt: p.captureChosenAt ?? null,
    briefedAt: p.briefedAt ?? null,
    outsideSince: p.zoneBreach.outsideSince ?? null,
    outsideSecondsTotal: p.zoneBreach.outsideSecondsTotal ?? 0,
    chargedDrainTicks: p.zoneBreach.chargedDrainTicks,
    warnedAt: p.zoneBreach.warnedAt ?? null,
  };
}

function locationRow(l: Doc<"locations">): LocationRow {
  return {
    id: l._id,
    matchId: l.matchId,
    playerId: l.playerId,
    lat: l.lat,
    lng: l.lng,
    accuracyMetres: l.accuracyMetres ?? null,
    recordedAtMs: l.recordedAt,
    pingIndex: l.pingIndex,
    suspicious: l.suspicious ?? false,
    suspiciousReason: l.suspiciousReason ?? null,
  };
}

function complaintRow(c: Doc<"complaints">): ComplaintRow {
  return {
    id: c._id,
    matchId: c.matchId,
    complainantId: c.complainantId,
    accusedId: c.accusedId,
    note: c.note ?? null,
    createdAt: c.createdAt,
    responseDueAt: c.responseDueAt,
    status: c.status,
    resolvedByUserId: c.resolvedBy ?? null,
    resolvedAt: c.resolvedAt ?? null,
    resolutionNote: c.resolutionNote ?? null,
  };
}

function invigilatorRow(i: Doc<"invigilators">): InvigilatorRow {
  return {
    id: i._id,
    matchId: i.matchId,
    userId: i.userId ?? null,
    displayName: i.displayName,
    inviteCode: i.inviteCode,
    active: i.active,
    addedAt: i.addedAt,
  };
}

function scoreRow(e: Doc<"scoreEvents">): ScoreEventRow {
  return {
    id: e._id,
    matchId: e.matchId,
    playerId: e.playerId,
    kind: e.kind,
    points: e.points,
    at: e.at,
    source: e.source,
    refId: e.refId ?? null,
  };
}

function leaderboardRow(r: Doc<"leaderboard">): LeaderboardRow {
  return {
    id: r._id,
    matchId: r.matchId,
    playerId: r.playerId,
    displayName: r.displayName,
    displayNameMode: r.displayNameMode,
    totalPoints: r.totalPoints,
    breakdown: r.breakdown,
    updatedAt: r.updatedAt,
  };
}

// ---- MatchRepository -------------------------------------------------------

export const matchRepo: MatchRepository = {
  findById: async (ctx, id) => {
    const doc = await reader(ctx).get(id as Id<"matches">);
    return doc ? matchRow(doc) : null;
  },

  findByRoomCode: async (ctx, roomCode) => {
    const doc = await reader(ctx)
      .query("matches")
      .withIndex("by_room_code", (q) => q.eq("roomCode", roomCode))
      .first();
    return doc ? matchRow(doc) : null;
  },

  findByPublicSlug: async (ctx, slug) => {
    const doc = await reader(ctx)
      .query("matches")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .first();
    return doc ? matchRow(doc) : null;
  },

  listEnded: async (ctx) => {
    const docs = await reader(ctx)
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "ended"))
      .collect();
    return docs
      .map(matchRow)
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  },

  listEndedBefore: async (ctx, endedBeforeMs) => {
    const docs = await reader(ctx)
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "ended"))
      .collect();
    return docs
      .filter((doc) => (doc.endedAt ?? Infinity) < endedBeforeMs)
      .map(matchRow);
  },

  listRunning: async (ctx) => {
    const [setup, headstart, live] = await Promise.all([
      reader(ctx)
        .query("matches")
        .withIndex("by_status", (q) => q.eq("status", "setup"))
        .collect(),
      reader(ctx)
        .query("matches")
        .withIndex("by_status", (q) => q.eq("status", "headstart"))
        .collect(),
      reader(ctx)
        .query("matches")
        .withIndex("by_status", (q) => q.eq("status", "live"))
        .collect(),
    ]);
    return [...setup, ...headstart, ...live].map(matchRow);
  },

  create: async (ctx, input) => {
    const db = writer(ctx);
    const createdAt = Date.now();
    const id = await db.insert("matches", {
      roomCode: input.roomCode,
      publicSlug: input.publicSlug,
      title: input.title ?? undefined,
      clubName: input.clubName ?? undefined,
      status: input.status,
      config: input.config,
      createdAt,
      eventWindowEndsAt: createdAt + input.eventWindowMinutesMax * 60_000,
      rosterLocked: false,
      createdBy:
        input.createdByUserId === null
          ? undefined
          : (input.createdByUserId as Id<"users">),
      zone: {
        centreLat: input.zoneCentre.lat,
        centreLng: input.zoneCentre.lng,
        initialRadiusMetres: input.initialRadiusMetres,
      },
      organiserPosition: {
        lat: input.organiserPosition.lat,
        lng: input.organiserPosition.lng,
      },
    });
    const doc = await db.get(id);
    if (!doc) throw new Error("Match insert did not persist.");
    return matchRow(doc);
  },

  patch: async (ctx, id, patch) => {
    const db = writer(ctx);
    const doc = await db.get(id as Id<"matches">);
    if (!doc) throw new Error(`Match ${id} not found.`);

    const next: {
      status?: MatchStatus;
      startedAt?: number;
      endsAt?: number;
      lastPingAt?: number;
      setupStartedAt?: number;
      setupEndsAt?: number;
      pausedAt?: number;
      pausedTotalMs?: number;
      pauseReason?: string;
      aliveUpToMinute?: number;
      winner?: "hunters" | "shadows";
      endedAt?: number;
      endReason?: NonNullable<MatchRow["endReason"]>;
      rosterLocked?: boolean;
      title?: string;
      clubName?: string;
      published?: boolean;
      zone?: { centreLat: number; centreLng: number; initialRadiusMetres: number };
    } = {};

    if (patch.status !== undefined) next.status = patch.status;
    if (patch.startedAt !== undefined && patch.startedAt !== null) {
      next.startedAt = patch.startedAt;
    }
    if (patch.endsAt !== undefined && patch.endsAt !== null) {
      next.endsAt = patch.endsAt;
    }
    if (patch.lastPingAt !== undefined && patch.lastPingAt !== null) {
      next.lastPingAt = patch.lastPingAt;
    }
    if (patch.setupStartedAt !== undefined) {
      next.setupStartedAt = patch.setupStartedAt ?? undefined;
    }
    if (patch.setupEndsAt !== undefined) {
      next.setupEndsAt = patch.setupEndsAt ?? undefined;
    }
    if (patch.winner !== undefined && patch.winner !== null) {
      next.winner = patch.winner;
    }
    if (patch.endedAt !== undefined && patch.endedAt !== null) {
      next.endedAt = patch.endedAt;
    }
    if (patch.endReason !== undefined) {
      next.endReason = patch.endReason ?? undefined;
    }
    if (patch.rosterLocked !== undefined) {
      next.rosterLocked = patch.rosterLocked;
    }
    if (patch.pausedAt !== undefined) {
      next.pausedAt = patch.pausedAt ?? undefined;
    }
    if (patch.pausedTotalMs !== undefined && patch.pausedTotalMs !== null) {
      next.pausedTotalMs = patch.pausedTotalMs;
    }
    if (patch.pauseReason !== undefined) {
      next.pauseReason = patch.pauseReason ?? undefined;
    }
    if (patch.aliveUpToMinute !== undefined && patch.aliveUpToMinute !== null) {
      next.aliveUpToMinute = patch.aliveUpToMinute;
    }
    if (patch.title !== undefined) next.title = patch.title ?? undefined;
    if (patch.clubName !== undefined) next.clubName = patch.clubName ?? undefined;
    if (patch.published !== undefined) {
      next.published = patch.published ?? undefined;
    }
    if (patch.zoneCentre !== undefined || patch.initialRadiusMetres !== undefined) {
      next.zone = {
        centreLat: patch.zoneCentre?.lat ?? doc.zone.centreLat,
        centreLng: patch.zoneCentre?.lng ?? doc.zone.centreLng,
        initialRadiusMetres:
          patch.initialRadiusMetres ?? doc.zone.initialRadiusMetres,
      };
    }

    await db.patch(id as Id<"matches">, next);
  },
};

// ---- PlayerRepository ------------------------------------------------------

export const playerRepo: PlayerRepository = {
  findById: async (ctx, id) => {
    const doc = await reader(ctx).get(id as Id<"players">);
    return doc ? playerRow(doc) : null;
  },

  findByMatchAndUser: async (ctx, matchId, userId) => {
    const doc = await reader(ctx)
      .query("players")
      .withIndex("by_match_user", (q) =>
        q.eq("matchId", matchId as Id<"matches">).eq("userId", userId as Id<"users">),
      )
      .first();
    return doc ? playerRow(doc) : null;
  },

  findByMatchAndToken: async (ctx, matchId, qrToken) => {
    const doc = await reader(ctx)
      .query("players")
      .withIndex("by_match_qr", (q) =>
        q.eq("matchId", matchId as Id<"matches">).eq("qrToken", qrToken),
      )
      .first();
    return doc ? playerRow(doc) : null;
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("players")
      .withIndex("by_match_user", (q) => q.eq("matchId", matchId as Id<"matches">))
      .collect();
    return docs.map(playerRow);
  },

  create: async (ctx, input) => {
    const db = writer(ctx);
    const id = await db.insert("players", {
      matchId: input.matchId as Id<"matches">,
      userId: input.userId as Id<"users">,
      role: input.role,
      mode: input.mode,
      status: input.status,
      callSign: input.callSign,
      displayName: input.displayName,
      displayNameMode: input.displayNameMode,
      qrToken: input.qrToken,
      points: 0,
      joinedAt: input.joinedAt,
      zoneBreach: { chargedDrainTicks: 0 },
    });
    const doc = await db.get(id);
    if (!doc) throw new Error("Player insert did not persist.");
    return playerRow(doc);
  },

  patch: async (ctx, id, patch) => {
    const db = writer(ctx);
    const doc = await db.get(id as Id<"players">);
    if (!doc) throw new Error(`Player ${id} not found.`);

    const next: {
      role?: PlayerRow["role"];
      mode?: PlayerRow["mode"];
      status?: PlayerRow["status"];
      points?: number;
      taggedAt?: number;
      taggedById?: Id<"players">;
      captureChosenAt?: number;
      briefedAt?: number;
    } = {};

    if (patch.role !== undefined) next.role = patch.role;
    if (patch.mode !== undefined) next.mode = patch.mode;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.points !== undefined) next.points = patch.points;
    if (patch.taggedAt !== undefined && patch.taggedAt !== null) {
      next.taggedAt = patch.taggedAt;
    }
    if (patch.taggedById !== undefined && patch.taggedById !== null) {
      next.taggedById = patch.taggedById as Id<"players">;
    }
    if (patch.captureChosenAt !== undefined) {
      next.captureChosenAt = patch.captureChosenAt ?? undefined;
    }
    if (patch.briefedAt !== undefined) {
      next.briefedAt = patch.briefedAt ?? undefined;
    }

    await db.patch(id as Id<"players">, next);
  },

  patchOutZoneState: async (ctx, id, state) => {
    const db = writer(ctx);
    const doc = await db.get(id as Id<"players">);
    if (!doc) throw new Error(`Player ${id} not found.`);

    const zoneBreach = {
      ...doc.zoneBreach,
      ...(state.outsideSince !== undefined
        ? { outsideSince: state.outsideSince ?? undefined }
        : {}),
      ...(state.outsideSecondsTotal !== undefined
        ? { outsideSecondsTotal: state.outsideSecondsTotal }
        : {}),
      ...(state.chargedDrainTicks !== undefined
        ? { chargedDrainTicks: state.chargedDrainTicks }
        : {}),
      ...(state.warnedAt !== undefined
        ? { warnedAt: state.warnedAt ?? undefined }
        : {}),
    };

    await db.patch(id as Id<"players">, {
      zoneBreach,
      ...(state.status !== undefined ? { status: state.status } : {}),
    });
  },
};

// ---- LocationRepository ----------------------------------------------------

export const locationRepo: LocationRepository = {
  latestByPlayer: async (ctx, matchId, playerId) => {
    const doc = await reader(ctx)
      .query("locations")
      .withIndex("by_match_player_time", (q) =>
        q
          .eq("matchId", matchId as Id<"matches">)
          .eq("playerId", playerId as Id<"players">),
      )
      .order("desc")
      .first();
    return doc ? locationRow(doc) : null;
  },

  latestByPlayerBefore: async (ctx, matchId, playerId, atMs) => {
    const docs = await reader(ctx)
      .query("locations")
      .withIndex("by_match_player_time", (q) =>
        q
          .eq("matchId", matchId as Id<"matches">)
          .eq("playerId", playerId as Id<"players">)
          .lte("recordedAt", atMs),
      )
      .order("desc")
      .first();
    return docs ? locationRow(docs) : null;
  },

  latestSnapshotByPlayers: async (ctx, matchId, playerIds) => {
    const map = new Map<
      string,
      { lat: number; lng: number; recordedAtMs: number; accuracyMetres: number | null; pingIndex: number }
    >();
    for (const playerId of playerIds) {
      const doc = await reader(ctx)
        .query("locations")
        .withIndex("by_match_player_time", (q) =>
          q
            .eq("matchId", matchId as Id<"matches">)
            .eq("playerId", playerId as Id<"players">),
        )
        .order("desc")
        .first();
      if (doc) map.set(playerId, locationRow(doc));
    }
    return map;
  },

  insert: async (ctx, input) => {
    const db = writer(ctx);
    const id = await db.insert("locations", {
      matchId: input.matchId as Id<"matches">,
      playerId: input.playerId as Id<"players">,
      lat: input.lat,
      lng: input.lng,
      accuracyMetres: input.accuracyMetres ?? undefined,
      recordedAt: input.recordedAt,
      pingIndex: input.pingIndex,
      suspicious: input.suspicious ?? false,
      suspiciousReason: input.suspiciousReason ?? undefined,
    });
    const doc = await db.get(id);
    if (!doc) throw new Error("Location insert did not persist.");
    return locationRow(doc);
  },

  deleteForMatch: async (ctx, matchId) => {
    const db = writer(ctx);
    const docs = await db
      .query("locations")
      .withIndex("by_match_player_time", (q) =>
        q.eq("matchId", matchId as Id<"matches">),
      )
      .collect();
    for (const doc of docs) {
      await db.delete(doc._id);
    }
    return docs.length;
  },
};

// ---- TagRepository ---------------------------------------------------------

export const tagRepo: TagRepository = {
  insert: async (ctx, input) => {
    const id = await writer(ctx).insert("tags", {
      matchId: input.matchId as Id<"matches">,
      hunterId: input.hunterId as Id<"players">,
      shadowId: input.shadowId as Id<"players">,
      status: input.status,
      rejectionCode: input.rejectionCode ?? undefined,
      distanceMetres: input.distanceMetres ?? undefined,
      assistedById:
        input.assistedById === null || input.assistedById === undefined
          ? undefined
          : (input.assistedById as Id<"players">),
      scoredPoints: input.scoredPoints,
      at: input.at,
      captureMode: input.captureMode ?? undefined,
      forced: input.forced ?? false,
      forcedBy: input.forcedByUserId
        ? (input.forcedByUserId as Id<"users">)
        : undefined,
    });
    return id;
  },

  patch: async (ctx, id, patch) => {
    const db = writer(ctx);
    const next: { captureMode?: PlayerRow["mode"] } = {};
    if (patch.captureMode !== undefined) next.captureMode = patch.captureMode;
    await db.patch(id as Id<"tags">, next);
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("tags")
      .withIndex("by_match", (q) => q.eq("matchId", matchId as Id<"matches">))
      .collect();
    return docs.map((t) => ({
      id: t._id,
      matchId: t.matchId,
      hunterId: t.hunterId,
      shadowId: t.shadowId,
      status: t.status,
      rejectionCode: t.rejectionCode ?? null,
      distanceMetres: t.distanceMetres ?? null,
      assistedById: t.assistedById ?? null,
      captureMode: t.captureMode ?? null,
      forced: t.forced ?? false,
      forcedByUserId: t.forcedBy ?? null,
      scoredPoints: t.scoredPoints,
      at: t.at,
    }));
  },
};

// ---- ComplaintRepository ---------------------------------------------------

export const complaintRepo: ComplaintRepository = {
  create: async (ctx, input) => {
    const db = writer(ctx);
    const at = input.nowMs ?? Date.now();
    const id = await db.insert("complaints", {
      matchId: input.matchId as Id<"matches">,
      complainantId: input.complainantId as Id<"players">,
      accusedId: input.accusedId as Id<"players">,
      note: input.note ?? undefined,
      createdAt: at,
      responseDueAt: at + input.configComplaintResponseMinutes * 60_000,
      status: "open",
    });
    const doc = await db.get(id);
    if (!doc) throw new Error("Complaint insert did not persist.");
    return complaintRow(doc);
  },

  listOpenByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("complaints")
      .withIndex("by_match_status", (q) =>
        q.eq("matchId", matchId as Id<"matches">).eq("status", "open"),
      )
      .collect();
    return docs.map(complaintRow);
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("complaints")
      .withIndex("by_match_status", (q) =>
        q.eq("matchId", matchId as Id<"matches">),
      )
      .collect();
    return docs.map(complaintRow);
  },

  patch: async (ctx, id, patch) => {
    const db = writer(ctx);
    const doc = await db.get(id as Id<"complaints">);
    if (!doc) throw new Error(`Complaint ${id} not found.`);

    const next: {
      status?: ComplaintRow["status"];
      resolvedBy?: Id<"users">;
      resolvedAt?: number;
      resolutionNote?: string;
    } = {};
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.resolvedByUserId !== undefined) {
      next.resolvedBy = patch.resolvedByUserId as Id<"users">;
    }
    if (patch.resolvedAt !== undefined) next.resolvedAt = patch.resolvedAt;
    if (patch.resolutionNote !== undefined) {
      next.resolutionNote = patch.resolutionNote;
    }
    await db.patch(id as Id<"complaints">, next);
  },
};

// ---- InvigilatorRepository -------------------------------------------------

export const invigilatorRepo: InvigilatorRepository = {
  findById: async (ctx, id) => {
    const doc = await reader(ctx).get(id as Id<"invigilators">);
    return doc ? invigilatorRow(doc) : null;
  },

  findByInviteCode: async (ctx, inviteCode) => {
    const doc = await reader(ctx)
      .query("invigilators")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", inviteCode))
      .first();
    return doc ? invigilatorRow(doc) : null;
  },

  findByMatchAndUser: async (ctx, matchId, userId) => {
    const doc = await reader(ctx)
      .query("invigilators")
      .withIndex("by_match_user", (q) =>
        q.eq("matchId", matchId as Id<"matches">).eq("userId", userId as Id<"users">),
      )
      .first();
    return doc ? invigilatorRow(doc) : null;
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("invigilators")
      .withIndex("by_match", (q) => q.eq("matchId", matchId as Id<"matches">))
      .collect();
    return docs.map(invigilatorRow);
  },

  create: async (ctx, input) => {
    const db = writer(ctx);
    const id = await db.insert("invigilators", {
      matchId: input.matchId as Id<"matches">,
      displayName: input.displayName,
      inviteCode: input.inviteCode,
      active: true,
      addedAt: input.addedAt,
    });
    const doc = await db.get(id);
    if (!doc) throw new Error("Invigilator insert did not persist.");
    return invigilatorRow(doc);
  },

  claim: async (ctx, id, userId) => {
    await writer(ctx).patch(id as Id<"invigilators">, {
      userId: userId as Id<"users">,
    });
  },

  patchActive: async (ctx, id, active) => {
    await writer(ctx).patch(id as Id<"invigilators">, { active });
  },
};

// ---- ScoreRepository -------------------------------------------------------

export const scoreRepo: ScoreRepository = {
  insert: async (ctx, input) => {
    await writer(ctx).insert("scoreEvents", {
      matchId: input.matchId as Id<"matches">,
      playerId: input.playerId as Id<"players">,
      kind: input.kind,
      points: input.points,
      at: input.at,
      source: input.source,
      refId: input.refId ?? undefined,
    });
  },

  listByPlayer: async (ctx, matchId, playerId) => {
    const docs = await reader(ctx)
      .query("scoreEvents")
      .withIndex("by_match_player", (q) =>
        q
          .eq("matchId", matchId as Id<"matches">)
          .eq("playerId", playerId as Id<"players">),
      )
      .collect();
    return docs.map(scoreRow);
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("scoreEvents")
      .withIndex("by_match", (q) =>
        q.eq("matchId", matchId as Id<"matches">),
      )
      .collect();
    return docs.map(scoreRow);
  },

  existsByRef: async (ctx, matchId, playerId, kind, refId) => {
    const docs = await reader(ctx)
      .query("scoreEvents")
      .withIndex("by_match_player", (q) =>
        q
          .eq("matchId", matchId as Id<"matches">)
          .eq("playerId", playerId as Id<"players">),
      )
      .collect();
    return docs.some((doc) => doc.kind === kind && doc.refId === refId);
  },
};

// ---- LeaderboardRepository -------------------------------------------------

export const leaderboardRepo: LeaderboardRepository = {
  upsert: async (ctx, input) => {
    const db = writer(ctx);
    const existing = await db
      .query("leaderboard")
      .withIndex("by_match_player", (q) =>
        q
          .eq("matchId", input.matchId as Id<"matches">)
          .eq("playerId", input.playerId as Id<"players">),
      )
      .first();

    const row = {
      matchId: input.matchId as Id<"matches">,
      playerId: input.playerId as Id<"players">,
      displayName: input.displayName,
      displayNameMode: input.displayNameMode,
      totalPoints: input.totalPoints,
      breakdown: input.breakdown,
      updatedAt: input.at,
    };

    if (existing) await db.patch(existing._id, row);
    else await db.insert("leaderboard", row);
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("leaderboard")
      .withIndex("by_match_points", (q) =>
        q.eq("matchId", matchId as Id<"matches">),
      )
      .collect();
    return docs.map(leaderboardRow);
  },
};

/**
 * AuditRepository on Convex. Append-only: rows are inserted and never patched.
 */
function auditRow(a: Doc<"auditLog">): AuditRow {
  return {
    id: a._id,
    matchId: a.matchId,
    at: a.at,
    actorUserId: a.actorUserId,
    actorName: a.actorName,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId ?? null,
    targetLabel: a.targetLabel ?? null,
    reason: a.reason ?? null,
    detail: a.detail ?? null,
  };
}

export const auditRepo: AuditRepository = {
  append: async (ctx, input) => {
    return await writer(ctx).insert("auditLog", {
      matchId: input.matchId as Id<"matches">,
      at: input.at,
      actorUserId: input.actorUserId as Id<"users">,
      actorName: input.actorName,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? undefined,
      targetLabel: input.targetLabel ?? undefined,
      reason: input.reason ?? undefined,
      detail: input.detail ?? undefined,
    });
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("auditLog")
      .withIndex("by_match_time", (q) =>
        q.eq("matchId", matchId as Id<"matches">),
      )
      .collect();
    return docs.map(auditRow);
  },
};

/**
 * MatchEventRepository on Convex. Append-only: rows are inserted and never
 * patched or deleted.
 */
function eventRow(e: Doc<"matchEvents">): MatchEventRow {
  return {
    id: e._id,
    matchId: e.matchId,
    at: e.at,
    kind: e.kind,
    playerId: e.playerId ?? null,
    actorId: e.actorId ?? null,
    detail: e.detail ?? null,
    refId: e.refId ?? null,
    distanceMetres: e.distanceMetres ?? null,
    lat: e.lat ?? null,
    lng: e.lng ?? null,
  };
}

export const eventRepo: MatchEventRepository = {
  append: async (ctx, input) => {
    return await writer(ctx).insert("matchEvents", {
      matchId: input.matchId as Id<"matches">,
      at: input.at,
      kind: input.kind as MatchEventKind,
      playerId: input.playerId
        ? (input.playerId as Id<"players">)
        : undefined,
      actorId: input.actorId ? (input.actorId as Id<"players">) : undefined,
      detail: input.detail ?? undefined,
      refId: input.refId ?? undefined,
      distanceMetres: input.distanceMetres ?? undefined,
      lat: input.lat ?? undefined,
      lng: input.lng ?? undefined,
    });
  },

  listByMatch: async (ctx, matchId) => {
    const docs = await reader(ctx)
      .query("matchEvents")
      .withIndex("by_match_time", (q) =>
        q.eq("matchId", matchId as Id<"matches">),
      )
      .collect();
    return docs.map(eventRow);
  },

  listByMatchAndKind: async (ctx, matchId, kind) => {
    const docs = await reader(ctx)
      .query("matchEvents")
      .withIndex("by_match_kind", (q) =>
        q
          .eq("matchId", matchId as Id<"matches">)
          .eq("kind", kind as MatchEventKind),
      )
      .collect();
    return docs.map(eventRow);
  },

  existsByRef: async (ctx, matchId, refId) => {
    const doc = await reader(ctx)
      .query("matchEvents")
      .withIndex("by_match_ref", (q) =>
        q
          .eq("matchId", matchId as Id<"matches">)
          .eq("refId", refId),
      )
      .first();
    return doc !== null;
  },
};

/** Every repository the server uses, implemented on Convex. */
export const repos = {
  matches: matchRepo,
  players: playerRepo,
  locations: locationRepo,
  tags: tagRepo,
  complaints: complaintRepo,
  invigilators: invigilatorRepo,
  scores: scoreRepo,
  leaderboard: leaderboardRepo,
  audit: auditRepo,
  events: eventRepo,
} as const;

export type Repos = typeof repos;

export type { LatLng, MatchConfig };
