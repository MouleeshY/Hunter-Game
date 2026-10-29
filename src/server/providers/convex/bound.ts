/** Convex-bound implementation of the Shadow Hunt data-access layer.

 * This module is the Convex provider. It imports the generated Convex server API
 * directly and implements every repository interface from `src/server/repos/` on
 * top of it. It is selected by `DATA_PROVIDER=convex` (the default when the env
 * is unset for local development).
 */
import { internalMutation, internalQuery } from "../../../../convex/_generated/server";
import type { Id } from "../../../../convex/_generated/dataModel";

import type {
  MatchRow,
  MatchRepository,
  MatchStatus,
  MatchConfig,
  ZoneSnapshot,
  LatLng,
} from "../../repos/matchRepo";
import type { PlayerRow, PlayerRepository } from "../../repos/playerRepo";
import type { LocationRow, Location, LocationRepository } from "../../repos/locationRepo";
import type { TagRow, TagRepository } from "../../repos/tagRepo";
import type { ComplaintRow, ComplaintRepository } from "../../repos/complaintRepo";
import type { InvigilatorRow, InvigilatorRepository } from "../../repos/invigilatorRepo";
import type { ScoreEventRow, ScoreRepository } from "../../repos/scoreRepo";
import type { LeaderboardRow, LeaderboardRepository } from "../../repos/leaderboardRepo";

// ---- tiny helpers -----------------------------------------------------------

function s(id: Id<any> | null | undefined): string | null {
  return id == null ? null : String(id);
}

function sNonEmpty(id: Id<any>): string {
  return String(id);
}

function n(date: Date): number {
  return date.getTime();
}

// ---- MatchRepository -------------------------------------------------------

export const matchRepo: MatchRepository = {
  findById: async (id) => {
    const doc = await internalQuery("matches:byId")(id as Id<"matches">);
    return doc ? convexMatchToRow(doc) : null;
  },
  create: async (input) => {
    const createdAt = n(new Date());
    const eventWindowEndsAt = createdAt + input.eventWindowMinutesMax * 60_000;
    const doc = await internalMutation("matches:upsert")({
      _id: undefined,
      status: input.status,
      config: input.config,
      createdAt,
      startedAt: null,
      endsAt: null,
      eventWindowEndsAt,
      rosterLocked: false,
      createdBy: input.createdByUserId == null
        ? undefined
        : (input.createdByUserId as Id<"users">),
      zone: {
        centreLat: input.zoneCentre.lat,
        centreLng: input.zoneCentre.lng,
        initialRadiusMetres: input.initialRadiusMetres,
      },
      winner: null,
      endedAt: null,
    });
    return convexMatchToRow(doc);
  },
  patch: async (id, patch) => {
    const current = await internalQuery("matches:byId")(id as Id<"matches">);
    if (!current) throw new Error(`match ${id} not found`);
    const next: any = { ...current };
    if (patch.status != null) next.status = patch.status;
    if (patch.startedAt != null) next.startedAt = patch.startedAt;
    if (patch.endsAt != null) next.endsAt = patch.endsAt;
    if (patch.winner != null) next.winner = patch.winner;
    if (patch.endedAt != null) next.endedAt = patch.endedAt;
    if (patch.rosterLocked != null) next.rosterLocked = patch.rosterLocked;
    await internalMutation("matches:upsert")(next as any);
  },
};

function convexMatchToRow(m: any): MatchRow {
  return {
    id: sNonEmpty(m._id),
    status: m.status as MatchStatus,
    config: m.config as MatchConfig,
    createdAt: m.createdAt,
    startedAt: m.startedAt,
    endsAt: m.endsAt,
    eventWindowEndsAt: m.eventWindowEndsAt,
    rosterLocked: m.rosterLocked,
    createdByUserId: s(m.createdBy),
    zoneCentre: { lat: m.zone.centreLat, lng: m.zone.centreLng },
    initialRadiusMetres: m.zone.initialRadiusMetres,
    winner: m.winner,
    endedAt: m.endedAt,
  };
}

// ---- PlayerRepository ------------------------------------------------------

export const playerRepo: PlayerRepository = {
  findByMatchAndUser: async (matchId, userId) => {
    const row = await internalQuery("players:byMatchAndUser")(
      matchId as Id<"matches">,
      userId as Id<"users">,
    );
    return row ? convexPlayerToRow(row) : null;
  },
  findByMatchAndToken: async (matchId, token) => {
    const row = await internalQuery("players:byMatchAndToken")(
      matchId as Id<"matches">,
      token,
    );
    return row ? convexPlayerToRow(row) : null;
  },
  listByMatch: async (matchId) => {
    const rows = await internalQuery("players:byMatch")(matchId as Id<"matches">);
    return rows.map(convexPlayerToRow);
  },
  listActiveByMatch: async (matchId) => {
    const rows = await internalQuery("players:byMatch")(matchId as Id<"matches">);
    const inPlay = rows.filter(
      (r) =>
        r.role === "hunter" ||
        (r.role === "shadow" && (r.taggedAt != null || r.mode === "hunter")),
    );
    return inPlay.map(convexPlayerToRow);
  },
  create: async (input) => {
    const doc = await internalMutation("players:upsert")({
      _id: undefined,
      matchId: input.matchId as Id<"matches">,
      userId: input.userId as Id<"users">,
      role: input.role,
      mode: input.mode,
      status: input.status,
      displayName: input.displayName,
      displayNameMode: input.displayNameMode,
      qrToken: input.qrToken,
      points: 0,
      joinedAt: input.joinedAt,
      taggedAt: undefined,
      taggedById: undefined,
      zoneBreach: {
        outsideSince: undefined,
        chargedDrainTicks: 0,
        warnedAt: undefined,
      },
    });
    return convexPlayerToRow(doc);
  },
  patch: async (id, patch) => {
    const current = await internalQuery("players:byId")(id as Id<"players">);
    if (!current) throw new Error(`player ${id} not found`);
    const next: any = { ...current };
    if (patch.role != null) next.role = patch.role;
    if (patch.mode != null) next.mode = patch.mode;
    if (patch.status != null) next.status = patch.status;
    if (patch.displayName != null) next.displayName = patch.displayName;
    if (patch.displayNameMode != null) next.displayNameMode = patch.displayNameMode;
    if (patch.qrToken != null) next.qrToken = patch.qrToken;
    if (patch.points != null) next.points = patch.points;
    if (patch.joinedAt != null) next.joinedAt = patch.joinedAt;
    if (patch.taggedAt != null) next.taggedAt = patch.taggedAt == null ? undefined : patch.taggedAt;
    if (patch.taggedById != null) next.taggedById = patch.taggedById == null ? undefined : (patch.taggedById as Id<"players">);
    if (patch.outsideSince != null) next.zoneBreach.outsideSince = patch.outsideSince == null ? undefined : patch.outsideSince;
    if (patch.outsideSecondsTotal != null) next.zoneBreach.outsideSecondsTotal = patch.outsideSecondsTotal;
    if (patch.chargedDrainTicks != null) next.zoneBreach.chargedDrainTicks = patch.chargedDrainTicks;
    if (patch.warnedAt != null) next.zoneBreach.warnedAt = patch.warnedAt == null ? undefined : patch.warnedAt;
    await internalMutation("players:upsert")(next as any);
  },
  patchOutZoneState: async (id, state) => {
    const current = await internalQuery("players:byId")(id as Id<"players">);
    if (!current) throw new Error(`player ${id} not found`);
    const next: any = { ...current };
    next.zoneBreach = { ...current.zoneBreach };
    if (state.outsideSince != null) next.zoneBreach.outsideSince = state.outsideSince == null ? undefined : state.outsideSince;
    if (state.outsideSecondsTotal != null) next.zoneBreach.outsideSecondsTotal = state.outsideSecondsTotal;
    if (state.chargedDrainTicks != null) next.zoneBreach.chargedDrainTicks = state.chargedDrainTicks;
    if (state.warnedAt != null) next.zoneBreach.warnedAt = state.warnedAt == null ? undefined : state.warnedAt;
    if (state.status != null) next.status = state.status;
    await internalMutation("players:upsert")(next as any);
  },
};

function convexPlayerToRow(p: any): PlayerRow {
  return {
    id: sNonEmpty(p._id),
    matchId: sNonEmpty(p.matchId) as any,
    userId: sNonEmpty(p.userId) as any,
    role: p.role,
    mode: p.mode,
    status: p.status,
    displayName: p.displayName,
    displayNameMode: p.displayNameMode,
    qrToken: p.qrToken,
    points: p.points,
    joinedAt: p.joinedAt,
    taggedAt: p.taggedAt,
    taggedById: s(p.taggedById) as any,
    outsideSince: p.zoneBreach == null ? null : p.zoneBreach.outsideSince,
    outsideSecondsTotal: p.zoneBreach == null ? 0 : p.zoneBreach.outsideSecondsTotal,
    chargedDrainTicks: p.zoneBreach == null ? 0 : p.zoneBreach.chargedDrainTicks,
    warnedAt: p.zoneBreach == null ? null : p.zoneBreach.warnedAt,
  };
}

// ---- LocationRepository ---------------------------------------------------

export const locationRepo: LocationRepository = {
  latestByPlayer: async (matchId, playerId) => {
    const row = await internalQuery("locations:byMatchAndPlayer")(
      matchId as Id<"matches">,
      playerId as Id<"players">,
    );
    return row ? convexLocationToRow(row) : null;
  },
  latestSnapshotByPlayers: async (matchId, playerIds) => {
    const map = new Map<string, Location>();
    for (const pid of playerIds) {
      const row = await internalQuery("locations:byMatchAndPlayer")(
        matchId as Id<"matches">,
        pid as Id<"players">,
      );
      if (row)
        map.set(pid, { lat: row.lat, lng: row.lng, recordedAtMs: row.recordedAt });
    }
    return map;
  },
  insert: async (input) => {
    const row = await internalMutation("locations:upsert")({
      _id: undefined,
      matchId: input.matchId as Id<"matches">,
      playerId: input.playerId as Id<"players">,
      lat: input.lat,
      lng: input.lng,
      accuracyMetres: input.accuracyMetres,
      recordedAt: n(new Date()),
      pingIndex: 0,
    });
    return convexLocationToRow(row);
  },
  insertPing: async (input) => {
    const row = await internalMutation("locations:upsert")({
      _id: undefined,
      matchId: input.matchId as Id<"matches">,
      playerId: input.playerId as Id<"players">,
      lat: input.lat,
      lng: input.lng,
      accuracyMetres: null,
      recordedAt: input.recordedAt,
      pingIndex: input.pingIndex,
    });
    return convexLocationToRow(row);
  },
};

function convexLocationToRow(l: any): LocationRow {
  return {
    id: sNonEmpty(l._id),
    matchId: sNonEmpty(l.matchId) as any,
    playerId: sNonEmpty(l.playerId) as any,
    lat: l.lat,
    lng: l.lng,
    accuracyMetres: l.accuracyMetres,
    recordedAt: l.recordedAt,
    pingIndex: l.pingIndex,
  };
}

// ---- TagRepository --------------------------------------------------------

export const tagRepo: TagRepository = {
  insert: async (input) => {
    const doc = await internalMutation("tags:insert")({
      _id: undefined,
      matchId: input.matchId as Id<"matches">,
      hunterId: input.hunterId as Id<"players">,
      shadowId: input.shadowId as Id<"players">,
      status: input.status,
      rejectionCode: input.rejectionCode,
      distanceMetres: input.distanceMetres,
      assistedById: input.assistedById == null ? undefined : (input.assistedById as Id<"players">),
      scoredPoints: input.scoredPoints,
      at: input.at,
    });
    return sNonEmpty(doc._id);
  },
};

// ---- ComplaintRepository --------------------------------------------------

export const complaintRepo: ComplaintRepository = {
  create: async (input) => {
    const at = n(new Date());
    const doc = await internalMutation("complaints:upsert")({
      _id: undefined,
      matchId: input.matchId as Id<"matches">,
      complainantId: input.complainantId as Id<"players">,
      accusedId: input.accusedId as Id<"players">,
      note: input.note,
      createdAt: at,
      responseDueAt: at + input.configComplaintResponseMinutes * 60_000,
      status: "open",
      resolvedByUserId: undefined,
      resolvedAt: undefined,
      resolutionNote: undefined,
    });
    return convexComplaintToRow(doc);
  },
  listOpenByMatch: async (matchId) => {
    const rows = await internalQuery("complaints:openByMatch")(matchId as Id<"matches">);
    return rows.map(convexComplaintToRow);
  },
  patch: async (id, patch) => {
    const current = await internalQuery("complaints:byId")(id as any);
    if (!current) throw new Error(`complaint ${id} not found`);
    const next: any = { ...current };
    if (patch.status != null) next.status = patch.status;
    if (patch.resolvedByUserId != null) next.resolvedByUserId = patch.resolvedByUserId == null ? undefined : (patch.resolvedByUserId as Id<"users">);
    if (patch.resolvedAt != null) next.resolvedAt = patch.resolvedAt == null ? undefined : patch.resolvedAt;
    if (patch.resolutionNote != null) next.resolutionNote = patch.resolutionNote;
    await internalMutation("complaints:upsert")(next as any);
  },
};

function convexComplaintToRow(c: any): ComplaintRow {
  return {
    id: sNonEmpty(c._id),
    matchId: sNonEmpty(c.matchId) as any,
    complainantId: sNonEmpty(c.complainantId) as any,
    accusedId: sNonEmpty(c.accusedId) as any,
    note: c.note,
    createdAt: c.createdAt,
    responseDueAt: c.responseDueAt,
    status: c.status,
    resolvedByUserId: s(c.resolvedByUserId) as any,
    resolvedAt: c.resolvedAt,
    resolutionNote: c.resolutionNote,
  };
}

// ---- InvigilatorRepository ------------------------------------------------

export const invigilatorRepo: InvigilatorRepository = {
  findByMatchAndUser: async (matchId, userId) => {
    const row = await internalQuery("invigilators:byMatchAndUser")(
      matchId as Id<"matches">,
      userId as Id<"users">,
    );
    return row ? convexInvigilatorToRow(row) : null;
  },
  listByMatch: async (matchId) => {
    const rows = await internalQuery("invigilators:byMatch")(matchId as Id<"matches">);
    return rows.map(convexInvigilatorToRow);
  },
  create: async (input) => {
    const doc = await internalMutation("invigilators:upsert")({
      _id: undefined,
      matchId: input.matchId as Id<"matches">,
      userId: input.userId,
      displayName: input.displayName,
      active: true,
      addedAt: n(new Date()),
    });
    return convexInvigilatorToRow(doc);
  },
  patchActive: async (id, active) => {
    const row = await internalQuery("invigilators:byId")(id as any);
    if (!row) throw new Error(`invigilator ${id} not found`);
    await internalMutation("invigilators:upsert")({ ...row, active });
  },
};

function convexInvigilatorToRow(r: any): InvigilatorRow {
  return {
    id: sNonEmpty(r._id),
    matchId: sNonEmpty(r.matchId) as any,
    userId: r.userId as any,
    displayName: r.displayName,
    active: r.active,
    addedAt: r.addedAt,
  };
}

// ---- ScoreRepository ------------------------------------------------------

export const scoreRepo: ScoreRepository = {
  insert: async (input) => {
    await internalMutation("scoreEvents:insert")({
      _id: undefined,
      matchId: input.matchId as Id<"matches">,
      playerId: input.playerId as Id<"players">,
      kind: input.kind,
      points: input.points,
      at: input.at,
      source: input.source,
      refId: input.refId,
    });
  },
  listByPlayer: async (matchId, playerId) => {
    const rows = await internalQuery("scoreEvents:byMatchAndPlayer")(
      matchId as Id<"matches">,
      playerId as Id<"players">,
    );
    return rows.map(convexScoreEventToRow);
  },
};

function convexScoreEventToRow(e: any): ScoreEventRow {
  return {
    id: sNonEmpty(e._id),
    matchId: sNonEmpty(e.matchId) as any,
    playerId: sNonEmpty(e.playerId) as any,
    kind: e.kind,
    points: e.points,
    at: e.at,
    source: e.source,
    refId: e.refId,
  };
}

// ---- LeaderboardRepository ------------------------------------------------

export const leaderboardRepo: LeaderboardRepository = {
  upsert: async (input) => {
    const existing = await internalQuery("leaderboard:byMatchAndPlayer")(
      input.matchId,
      input.playerId,
    );
    if (existing) {
      await internalMutation("leaderboard:upsert")({
        ...existing,
        displayName: input.displayName,
        displayNameMode: input.displayNameMode,
        totalPoints: input.totalPoints,
        breakdown: input.breakdown,
        updatedAt: input.at,
      });
    } else {
      await internalMutation("leaderboard:upsert")({
        _id: undefined,
        matchId: input.matchId,
        playerId: input.playerId,
        displayName: input.displayName,
        displayNameMode: input.displayNameMode,
        totalPoints: input.totalPoints,
        breakdown: input.breakdown,
        updatedAt: input.at,
      });
    }
  },
  listByMatch: async (matchId) => {
    const rows = await internalQuery("leaderboard:byMatch")(matchId);
    return rows.map(convexLeaderboardRowToRow);
  },
};

function convexLeaderboardRowToRow(l: any): LeaderboardRow {
  return {
    id: sNonEmpty(l._id),
    matchId: sNonEmpty(l.matchId) as any,
    playerId: sNonEmpty(l.playerId) as any,
    displayName: l.displayName,
    displayNameMode: l.displayNameMode,
    totalPoints: l.totalPoints,
    breakdown: l.breakdown,
    updatedAt: l.updatedAt,
  };
}
