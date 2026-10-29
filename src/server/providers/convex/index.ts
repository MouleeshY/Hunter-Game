/**
 * Convex implementation of the swappable data-access layer.
 *
 * This module is the only place (apart from `src/convex/matches.ts` itself) that
 * imports from the generated Convex API. The repository interfaces above are
 * database-agnostic; this file maps them to Convex reads/writes.
 *
 * Selected by DATA_PROVIDER=convex. When DATA_PROVIDER is absent for local
 * development, Convex is the default because this project currently only runs
 * on Convex.
 */

import { v } from "convex/values";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  internalMutation,
  internalQuery,
} from "../../../convex/_generated/server";
import { ulid } from "ulid";
import type {
  MatchRow,
  MatchRepository,
  MatchConfig,
  MatchStatus,
  ZoneSnapshot,
  LatLng,
} from "../../repos/matchRepo";
import type { PlayerRow, PlayerRepository } from "../../repos/playerRepo";
import type {
  LocationRow,
  Location,
  LocationRepository,
} from "../../repos/locationRepo";
import type { TagRow, TagRepository } from "../../repos/tagRepo";
import type {
  ComplaintRow,
  ComplaintRepository,
} from "../../repos/complaintRepo";
import type {
  InvigilatorRow,
  InvigilatorRepository,
} from "../../repos/invigilatorRepo";
import type { ScoreEventRow, ScoreRepository } from "../../repos/scoreRepo";
import type {
  LeaderboardRow,
  LeaderboardRepository,
} from "../../repos/leaderboardRepo";

// ---- tiny Convex → plain id helpers -----------------------------------------

function s(id: Id<any> | null | undefined): string | null {
  return id == null ? null : String(id);
}

function sNonEmpty(id: Id<any>): string {
  return String(id);
}

function n(date: Date): number {
  return date.getTime();
}

// ---- MatchRepository --------------------------------------------------------

export const matchRepo: MatchRepository = {
  findById: async (id) => {
    const m = await readMatch(id);
    return m ? convexMatchToRow(m) : null;
  },
  create: async (input) => {
    const createdAt = n(new Date());
    const startedAt = null;
    const endsAt = null;
    const rosterLocked = false;
    const winner = null;
    const endedAt = null;
    const eventWindowEndsAt = createdAt + input.eventWindowMinutesMax * 60_000;

    const doc = await writeMatch({
      status: input.status,
      config: input.config,
      createdAt,
      startedAt,
      endsAt,
      eventWindowEndsAt,
      rosterLocked,
      createdBy:
        input.createdByUserId == null
          ? undefined
          : (input.createdByUserId as Id<"users">),
      zone: {
        centreLat: input.zoneCentre.lat,
        centreLng: input.zoneCentre.lng,
        initialRadiusMetres: input.initialRadiusMetres,
      },
      winner,
      endedAt,
    });
    return convexMatchToRow(doc);
  },
  patch: async (id, patch) => {
    const current = await readMatch(id);
    if (!current) throw new Error(`match ${id} not found`);
    const next: any = { ...current };
    if (patch.status != null) next.status = patch.status;
    if (patch.startedAt != null) next.startedAt = patch.startedAt;
    if (patch.endsAt != null) next.endsAt = patch.endsAt;
    if (patch.winner != null) next.winner = patch.winner;
    if (patch.endedAt != null) next.endedAt = patch.endedAt;
    if (patch.rosterLocked != null) next.rosterLocked = patch.rosterLocked;
    // Convex needs an existing id; writeMatch updates a stored doc by id.
    await writeMatch(next as any);
  },
};

function convexMatchToRow(m: any): MatchRow {
  return {
    id: sNonEmpty(m._id),
    status: m.status,
    config: m.config,
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

let _readMatch: (id: Id<"matches">) => Promise<any | null>;
let _writeMatch: (doc: any) => Promise<any>;

// Lazy-bound at call time so this module can be imported without a running
// Convex context; the bound functions come from the Convex provider export.
export function bindConvexMatchFns(
  read: (id: Id<"matches">) => Promise<any | null>,
  write: (doc: any) => Promise<any>,
) {
  _readMatch = read;
  _writeMatch = write;
}

async function readMatch(id: string): Promise<any | null> {
  return _readMatch(id as Id<"matches">);
}

async function writeMatch(doc: any): Promise<any> {
  return _writeMatch(doc);
}

// ---- PlayerRepository -------------------------------------------------------

export const playerRepo: PlayerRepository = {
  findByMatchAndUser: async (matchId, userId) => {
    const row = await readPlayerByMatchAndUser(matchId, userId);
    return row ? convexPlayerToRow(row) : null;
  },
  findByMatchAndToken: async (matchId, token) => {
    const row = await readPlayerByMatchAndToken(matchId, token);
    return row ? convexPlayerToRow(row) : null;
  },
  listByMatch: async (matchId) => {
    const rows = await readPlayersByMatch(matchId);
    return rows.map(convexPlayerToRow);
  },
  listActiveByMatch: async (matchId) => {
    const rows = await readPlayersByMatch(matchId);
    const inPlay = rows.filter(
      (r) =>
        r.role === "hunter" ||
        (r.role === "shadow" && (r.taggedAt != null || r.mode === "hunter")),
    );
    return inPlay.map(convexPlayerToRow);
  },
  create: async (input) => {
    const doc = await writePlayer({
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
    const current = await readPlayer(id);
    if (!current) throw new Error(`player ${id} not found`);
    const next: any = { ...current };
    if (patch.role != null) next.role = patch.role;
    if (patch.mode != null) next.mode = patch.mode;
    if (patch.status != null) next.status = patch.status;
    if (patch.displayName != null) next.displayName = patch.displayName;
    if (patch.displayNameMode != null)
      next.displayNameMode = patch.displayNameMode;
    if (patch.qrToken != null) next.qrToken = patch.qrToken;
    if (patch.points != null) next.points = patch.points;
    if (patch.joinedAt != null) next.joinedAt = patch.joinedAt;
    if (patch.taggedAt != null)
      next.taggedAt = patch.taggedAt == null ? undefined : patch.taggedAt;
    if (patch.taggedById != null)
      next.taggedById =
        patch.taggedById == null
          ? undefined
          : (patch.taggedById as Id<"players">);
    if (patch.outsideSince != null)
      next.zoneBreach.outsideSince =
        patch.outsideSince == null ? undefined : patch.outsideSince;
    if (patch.outsideSecondsTotal != null)
      next.zoneBreach.outsideSecondsTotal = patch.outsideSecondsTotal;
    if (patch.chargedDrainTicks != null)
      next.zoneBreach.chargedDrainTicks = patch.chargedDrainTicks;
    if (patch.warnedAt != null)
      next.zoneBreach.warnedAt =
        patch.warnedAt == null ? undefined : patch.warnedAt;
    await writePlayer(next as any);
  },
  patchOutZoneState: async (id, state) => {
    const current = await readPlayer(id);
    if (!current) throw new Error(`player ${id} not found`);
    const next: any = { ...current };
    next.zoneBreach = { ...current.zoneBreach };
    if (state.outsideSince != null)
      next.zoneBreach.outsideSince =
        state.outsideSince == null ? undefined : state.outsideSince;
    if (state.outsideSecondsTotal != null)
      next.zoneBreach.outsideSecondsTotal = state.outsideSecondsTotal;
    if (state.chargedDrainTicks != null)
      next.zoneBreach.chargedDrainTicks = state.chargedDrainTicks;
    if (state.warnedAt != null)
      next.zoneBreach.warnedAt =
        state.warnedAt == null ? undefined : state.warnedAt;
    if (state.status != null) next.status = state.status;
    await writePlayer(next as any);
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
    outsideSecondsTotal:
      p.zoneBreach == null ? 0 : p.zoneBreach.outsideSecondsTotal,
    chargedDrainTicks:
      p.zoneBreach == null ? 0 : p.zoneBreach.chargedDrainTicks,
    warnedAt: p.zoneBreach == null ? null : p.zoneBreach.warnedAt,
  };
}

let _readPlayer: (id: Id<"players">) => Promise<any | null>;
let _readPlayerByMatchAndUser: (
  matchId: Id<"matches">,
  userId: Id<"users">,
) => Promise<any | null>;
let _readPlayerByMatchAndToken: (
  matchId: Id<"matches">,
  token: string,
) => Promise<any | null>;
let _readPlayersByMatch: (matchId: Id<"matches">) => Promise<any[]>;
let _writePlayer: (doc: any) => Promise<any>;

export function bindConvexPlayerFns(
  read: (id: Id<"players">) => Promise<any | null>,
  readByMatchAndUser: (
    matchId: Id<"matches">,
    userId: Id<"users">,
  ) => Promise<any | null>,
  readByMatchAndToken: (
    matchId: Id<"matches">,
    token: string,
  ) => Promise<any | null>,
  listByMatch: (matchId: Id<"matches">) => Promise<any[]>,
  write: (doc: any) => Promise<any>,
) {
  _readPlayer = read;
  _readPlayerByMatchAndUser = readByMatchAndUser;
  _readPlayerByMatchAndToken = readByMatchAndToken;
  _readPlayersByMatch = listByMatch;
  _writePlayer = write;
}

async function readPlayer(id: string): Promise<any | null> {
  return _readPlayer(id as Id<"players">);
}

async function readPlayerByMatchAndUser(
  matchId: string,
  userId: string,
): Promise<any | null> {
  return _readPlayerByMatchAndUser(
    matchId as Id<"matches">,
    userId as Id<"users">,
  );
}

async function readPlayerByMatchAndToken(
  matchId: string,
  token: string,
): Promise<any | null> {
  return _readPlayerByMatchAndToken(matchId as Id<"matches">, token);
}

async function readPlayersByMatch(matchId: string): Promise<any[]> {
  return _readPlayersByMatch(matchId as Id<"matches">);
}

async function writePlayer(doc: any): Promise<any> {
  return _writePlayer(doc);
}

// ---- LocationRepository -----------------------------------------------------

export const locationRepo: LocationRepository = {
  latestByPlayer: async (matchId, playerId) => {
    const row = await readLatestLocation(matchId, playerId);
    return row ? convexLocationToRow(row) : null;
  },
  latestSnapshotByPlayers: async (matchId, playerIds) => {
    const map = new Map<string, Location>();
    for (const pid of playerIds) {
      const row = await readLatestLocation(matchId, pid);
      if (row)
        map.set(pid, {
          lat: row.lat,
          lng: row.lng,
          recordedAtMs: row.recordedAt,
        });
    }
    return map;
  },
  insert: async (input) => {
    const row = await writeLocation({
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
    const row = await writeLocation({
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

let _readLatestLocation: (
  matchId: Id<"matches">,
  playerId: Id<"players">,
) => Promise<any | null>;
let _writeLocation: (doc: any) => Promise<any>;

export function bindConvexLocationFns(
  read: (
    matchId: Id<"matches">,
    playerId: Id<"players">,
  ) => Promise<any | null>,
  write: (doc: any) => Promise<any>,
) {
  _readLatestLocation = read;
  _writeLocation = write;
}

async function readLatestLocation(
  matchId: string,
  playerId: string,
): Promise<any | null> {
  return _readLatestLocation(
    matchId as Id<"matches">,
    playerId as Id<"players">,
  );
}

async function writeLocation(doc: any): Promise<any> {
  return _writeLocation(doc);
}

// ---- TagRepository ----------------------------------------------------------

export const tagRepo: TagRepository = {
  insert: async (input) => {
    const doc = await writeTag({
      matchId: input.matchId as Id<"matches">,
      hunterId: input.hunterId as Id<"players">,
      shadowId: input.shadowId as Id<"players">,
      status: input.status,
      rejectionCode: input.rejectionCode,
      distanceMetres: input.distanceMetres,
      assistedById:
        input.assistedById == null
          ? undefined
          : (input.assistedById as Id<"players">),
      scoredPoints: input.scoredPoints,
      at: input.at,
    });
    return sNonEmpty(doc._id);
  },
};

let _writeTag: (doc: any) => Promise<any>;

export function bindConvexTagFns(write: (doc: any) => Promise<any>) {
  _writeTag = write;
}

// ---- ComplaintRepository ----------------------------------------------------

export const complaintRepo: ComplaintRepository = {
  create: async (input) => {
    const at = n(new Date());
    const doc = await writeComplaint({
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
    const rows = await readOpenComplaintsByMatch(matchId);
    return rows.map(convexComplaintToRow);
  },
  patch: async (id, patch) => {
    const current = await readComplaint(id);
    if (!current) throw new Error(`complaint ${id} not found`);
    const next: any = { ...current };
    if (patch.status != null) next.status = patch.status;
    if (patch.resolvedByUserId != null)
      next.resolvedByUserId =
        patch.resolvedByUserId == null
          ? undefined
          : (patch.resolvedByUserId as Id<"users">);
    if (patch.resolvedAt != null)
      next.resolvedAt = patch.resolvedAt == null ? undefined : patch.resolvedAt;
    if (patch.resolutionNote != null)
      next.resolutionNote = patch.resolutionNote;
    await writeComplaint(next as any);
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

let _readOpenComplaintsByMatch: (matchId: Id<"matches">) => Promise<any[]>;
let _readComplaint: (id: any) => Promise<any | null>;
let _writeComplaint: (doc: any) => Promise<any>;

export function bindConvexComplaintFns(
  listOpen: (matchId: Id<"matches">) => Promise<any[]>,
  read: (id: any) => Promise<any | null>,
  write: (doc: any) => Promise<any>,
) {
  _readOpenComplaintsByMatch = listOpen;
  _readComplaint = read;
  _writeComplaint = write;
}

// ---- InvigilatorRepository --------------------------------------------------

export const invigilatorRepo: InvigilatorRepository = {
  findByMatchAndUser: async (matchId, userId) => {
    const row = await readInvigilatorByMatchAndUser(matchId, userId);
    return row ? convexInvigilatorToRow(row) : null;
  },
  listByMatch: async (matchId) => {
    const rows = await readInvigilatorsByMatch(matchId);
    return rows.map(convexInvigilatorToRow);
  },
  create: async (input) => {
    const doc = await writeInvigilator({
      matchId: input.matchId as Id<"matches">,
      userId: input.userId,
      displayName: input.displayName,
      active: true,
      addedAt: n(new Date()),
    });
    return convexInvigilatorToRow(doc);
  },
  patchActive: async (id, active) => {
    const row = await readInvigilator(id);
    if (!row) throw new Error(`invigilator ${id} not found`);
    await writeInvigilator({ ...row, active });
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

let _readInvigilatorByMatchAndUser: (
  matchId: Id<"matches">,
  userId: Id<"users">,
) => Promise<any | null>;
let _readInvigilatorsByMatch: (matchId: Id<"matches">) => Promise<any[]>;
let _readInvigilator: (id: any) => Promise<any | null>;
let _writeInvigilator: (doc: any) => Promise<any>;

export function bindConvexInvigilatorFns(
  findByMatchAndUser: (
    matchId: Id<"matches">,
    userId: Id<"users">,
  ) => Promise<any | null>,
  listByMatch: (matchId: Id<"matches">) => Promise<any[]>,
  readById: (id: any) => Promise<any | null>,
  write: (doc: any) => Promise<any>,
) {
  _readInvigilatorByMatchAndUser = findByMatchAndUser;
  _readInvigilatorsByMatch = listByMatch;
  _readInvigilator = readById;
  _writeInvigilator = write;
}

// ---- ScoreRepository --------------------------------------------------------

export const scoreRepo: ScoreRepository = {
  insert: async (input) => {
    await writeScoreEvent({
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
    const rows = await readScoreEventsByMatchAndPlayer(matchId, playerId);
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

let _writeScoreEvent: (doc: any) => Promise<any>;
let _readScoreEventsByMatchAndPlayer: (
  matchId: Id<"matches">,
  playerId: Id<"players">,
) => Promise<any[]>;

export function bindConvexScoreFns(
  write: (doc: any) => Promise<any>,
  listByPlayer: (
    matchId: Id<"matches">,
    playerId: Id<"players">,
  ) => Promise<any[]>,
) {
  _writeScoreEvent = write;
  _readScoreEventsByMatchAndPlayer = listByPlayer;
}

// ---- LeaderboardRepository --------------------------------------------------

export const leaderboardRepo: LeaderboardRepository = {
  upsert: async (input) => {
    const existing = await readLeaderboardByMatchAndPlayer(
      input.matchId,
      input.playerId,
    );
    if (existing) {
      await writeLeaderboard({
        ...existing,
        displayName: input.displayName,
        displayNameMode: input.displayNameMode,
        totalPoints: input.totalPoints,
        breakdown: input.breakdown,
        updatedAt: input.at,
      });
    } else {
      await writeLeaderboard({
        id: ulid(),
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
    const rows = await readLeaderboardByMatch(matchId);
    return rows.map(convexLeaderboardToRow);
  },
};

function convexLeaderboardToRow(r: any): LeaderboardRow {
  return {
    id: sNonEmpty(r._id),
    matchId: sNonEmpty(r.matchId) as any,
    playerId: sNonEmpty(r.playerId) as any,
    displayName: r.displayName,
    displayNameMode: r.displayNameMode,
    totalPoints: r.totalPoints,
    breakdown: r.breakdown,
    updatedAt: r.updatedAt,
  };
}

let _readLeaderboardByMatchAndPlayer: (
  matchId: Id<"matches">,
  playerId: string,
) => Promise<any | null>;
let _readLeaderboardByMatch: (matchId: Id<"matches">) => Promise<any[]>;
let _writeLeaderboard: (doc: any) => Promise<any>;

export function bindConvexLeaderboardFns(
  byMatchAndPlayer: (
    matchId: Id<"matches">,
    playerId: string,
  ) => Promise<any | null>,
  byMatch: (matchId: Id<"matches">) => Promise<any[]>,
  write: (doc: any) => Promise<any>,
) {
  _readLeaderboardByMatchAndPlayer = byMatchAndPlayer;
  _readLeaderboardByMatch = byMatch;
  _writeLeaderboard = write;
}

// ---- public API surface ----------------------------------------------------

/** The set of repositories used by the server. In the Convex provider these are
 *   bound once at boot time from the generated Convex API. */
export const repos = {
  matches: matchRepo,
  players: playerRepo,
  locations: locationRepo,
  tags: tagRepo,
  complaints: complaintRepo,
  invigilators: invigilatorRepo,
  scores: scoreRepo,
  leaderboard: leaderboardRepo,
} as const;
