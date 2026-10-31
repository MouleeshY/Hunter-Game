/**
 * In-memory repositories for tests: same interfaces as the Convex provider, so
 * server services can be driven end to end without a deployment.
 */
import type { Repos } from "../providers";
import type { PlayerRow } from "../repos/playerRepo";
import type { MatchRow } from "../repos/matchRepo";
import type { InvigilatorRow } from "../repos/invigilatorRepo";
import type { LocationRow } from "../repos/locationRepo";
import type { LeaderboardRow } from "../repos/leaderboardRepo";
import type { ScoreEventRow } from "../repos/scoreRepo";
import type { ComplaintRow } from "../repos/complaintRepo";
import type { TagRow } from "../repos/tagRepo";
import type { AuditRow } from "../repos/auditRepo";
import type { MatchEventRow } from "../repos/eventRepo";

export function memoryRepos(): Repos {
  const matches = new Map<string, MatchRow>();
  const players = new Map<string, PlayerRow>();
  const invigilators = new Map<string, InvigilatorRow>();
  const locations = new Map<string, LocationRow>();
  const leaderboard = new Map<string, LeaderboardRow>();
  const scores: ScoreEventRow[] = [];
  const complaints = new Map<string, ComplaintRow>();
  const tags = new Map<string, TagRow>();
  const audit: AuditRow[] = [];
  const events: MatchEventRow[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  return {
    matches: {
      findById: async (_ctx, id) => matches.get(id) ?? null,
      findByRoomCode: async (_ctx, roomCode) =>
        [...matches.values()].find((m) => m.roomCode === roomCode) ?? null,
      listEndedBefore: async (_ctx, endedBeforeMs) =>
        [...matches.values()].filter(
          (m) => m.status === "ended" && (m.endedAt ?? Infinity) < endedBeforeMs,
        ),
      listRunning: async () =>
        [...matches.values()].filter(
          (m) => m.status === "headstart" || m.status === "live",
        ),
      create: async (_ctx, input) => {
        const row: MatchRow = {
          id: nextId("match"),
          roomCode: input.roomCode,
          status: input.status,
          config: input.config,
          createdAt: Date.now(),
          startedAt: null,
          endsAt: null,
          eventWindowEndsAt: Date.now() + input.eventWindowMinutesMax * 60_000,
          rosterLocked: false,
          createdByUserId: input.createdByUserId,
          zoneCentre: input.zoneCentre,
          organiserPosition: input.organiserPosition,
          lastPingAt: null,
          pausedAt: null,
          pausedTotalMs: 0,
          pauseReason: null,
          aliveUpToMinute: -1,
          initialRadiusMetres: input.initialRadiusMetres,
          winner: null,
          endedAt: null,
          endReason: null,
        };
        matches.set(row.id, row);
        return row;
      },
      patch: async (_ctx, id, patch) => {
        const row = matches.get(id);
        if (!row) throw new Error(`match ${id} not found`);
        if (patch.status !== undefined) row.status = patch.status;
        if (patch.startedAt !== undefined) row.startedAt = patch.startedAt;
        if (patch.endsAt !== undefined) row.endsAt = patch.endsAt;
        if (patch.lastPingAt !== undefined) row.lastPingAt = patch.lastPingAt;
        if (patch.pausedAt !== undefined) row.pausedAt = patch.pausedAt;
        if (patch.pausedTotalMs !== undefined) {
          row.pausedTotalMs = patch.pausedTotalMs;
        }
        if (patch.pauseReason !== undefined) row.pauseReason = patch.pauseReason;
        if (patch.aliveUpToMinute !== undefined) {
          row.aliveUpToMinute = patch.aliveUpToMinute;
        }
        if (patch.rosterLocked !== undefined) row.rosterLocked = patch.rosterLocked;
        if (patch.winner !== undefined) row.winner = patch.winner;
        if (patch.endReason !== undefined) row.endReason = patch.endReason;
        if (patch.endedAt !== undefined) row.endedAt = patch.endedAt;
        if (patch.zoneCentre !== undefined) row.zoneCentre = patch.zoneCentre;
        if (patch.initialRadiusMetres !== undefined) {
          row.initialRadiusMetres = patch.initialRadiusMetres;
        }
      },
    },
    players: {
      findById: async (_ctx, id) => players.get(id) ?? null,
      findByMatchAndUser: async (_ctx, matchId, userId) =>
        [...players.values()].find(
          (p) => p.matchId === matchId && p.userId === userId,
        ) ?? null,
      findByMatchAndToken: async (_ctx, matchId, qrToken) =>
        [...players.values()].find(
          (p) => p.matchId === matchId && p.qrToken === qrToken,
        ) ?? null,
      listByMatch: async (_ctx, matchId) =>
        [...players.values()].filter((p) => p.matchId === matchId),
      create: async (_ctx, input) => {
        const row: PlayerRow = {
          id: nextId("player"),
          matchId: input.matchId,
          userId: input.userId,
          role: input.role,
          mode: input.mode,
          status: input.status,
          callSign: input.callSign,
          displayName: input.displayName,
          displayNameMode: input.displayNameMode,
          qrToken: input.qrToken,
          points: 0,
          joinedAt: input.joinedAt,
          taggedAt: null,
          taggedById: null,
          captureChosenAt: null,
          briefedAt: null,
          outsideSince: null,
          outsideSecondsTotal: 0,
          chargedDrainTicks: 0,
          warnedAt: null,
        };
        players.set(row.id, row);
        return row;
      },
      patch: async (_ctx, id, patch) => {
        const row = players.get(id);
        if (!row) throw new Error(`player ${id} not found`);
        Object.assign(row, patch);
      },
      patchOutZoneState: async (_ctx, id, state) => {
        const row = players.get(id);
        if (!row) throw new Error(`player ${id} not found`);
        if (state.outsideSince !== undefined) row.outsideSince = state.outsideSince;
        if (state.outsideSecondsTotal !== undefined) {
          row.outsideSecondsTotal = state.outsideSecondsTotal;
        }
        if (state.chargedDrainTicks !== undefined) {
          row.chargedDrainTicks = state.chargedDrainTicks;
        }
        if (state.warnedAt !== undefined) row.warnedAt = state.warnedAt;
        if (state.status !== undefined) row.status = state.status;
      },
    },
    locations: {
      latestByPlayer: async (_ctx, matchId, playerId) => {
        const rows = [...locations.values()]
          .filter((l) => l.matchId === matchId && l.playerId === playerId)
          .sort((a, b) => b.recordedAtMs - a.recordedAtMs);
        return rows[0] ?? null;
      },
      latestByPlayerBefore: async (_ctx, matchId, playerId, atMs) => {
        const rows = [...locations.values()]
          .filter(
            (l) =>
              l.matchId === matchId &&
              l.playerId === playerId &&
              l.recordedAtMs <= atMs,
          )
          .sort((a, b) => b.recordedAtMs - a.recordedAtMs);
        return rows[0] ?? null;
      },
      latestSnapshotByPlayers: async (_ctx, matchId, playerIds) => {
        const map = new Map<string, LocationRow>();
        for (const playerId of playerIds) {
          const rows = [...locations.values()]
            .filter((l) => l.matchId === matchId && l.playerId === playerId)
            .sort((a, b) => b.recordedAtMs - a.recordedAtMs);
          if (rows[0]) map.set(playerId, rows[0]);
        }
        return map;
      },
      insert: async (_ctx, input) => {
        const row: LocationRow = {
          id: nextId("loc"),
          matchId: input.matchId,
          playerId: input.playerId,
          lat: input.lat,
          lng: input.lng,
          accuracyMetres: input.accuracyMetres,
          recordedAtMs: input.recordedAt,
          pingIndex: input.pingIndex,
          suspicious: input.suspicious ?? false,
          suspiciousReason: input.suspiciousReason ?? null,
        };
        locations.set(row.id, row);
        return row;
      },
      deleteForMatch: async (_ctx, matchId) => {
        let deleted = 0;
        for (const [id, row] of locations) {
          if (row.matchId === matchId) {
            locations.delete(id);
            deleted += 1;
          }
        }
        return deleted;
      },
    },
    tags: {
      insert: async (_ctx, input) => {
        const id = nextId("tag");
        tags.set(id, {
          id,
          matchId: input.matchId,
          hunterId: input.hunterId,
          shadowId: input.shadowId,
          status: input.status,
          rejectionCode: input.rejectionCode ?? null,
          distanceMetres: input.distanceMetres ?? null,
          assistedById: input.assistedById ?? null,
          captureMode: input.captureMode ?? null,
          forced: input.forced ?? false,
          forcedByUserId: input.forcedByUserId ?? null,
          scoredPoints: input.scoredPoints,
          at: input.at,
        });
        return id;
      },
      patch: async (_ctx, id, patch) => {
        const row = tags.get(id);
        if (!row) throw new Error(`tag ${id} not found`);
        if (patch.captureMode !== undefined) {
          row.captureMode = patch.captureMode;
        }
      },
      listByMatch: async (_ctx, matchId) =>
        [...tags.values()].filter((t) => t.matchId === matchId),
    },
    complaints: {
      create: async (_ctx, input) => {
        const at = input.nowMs ?? Date.now();
        const row: ComplaintRow = {
          id: nextId("complaint"),
          matchId: input.matchId,
          complainantId: input.complainantId,
          accusedId: input.accusedId,
          note: input.note,
          createdAt: at,
          responseDueAt:
            at + input.configComplaintResponseMinutes * 60_000,
          status: "open",
          resolvedByUserId: null,
          resolvedAt: null,
          resolutionNote: null,
        };
        complaints.set(row.id, row);
        return row;
      },
      listOpenByMatch: async (_ctx, matchId) =>
        [...complaints.values()].filter(
          (c) => c.matchId === matchId && c.status === "open",
        ),
      listByMatch: async (_ctx, matchId) =>
        [...complaints.values()].filter((c) => c.matchId === matchId),
      patch: async (_ctx, id, patch) => {
        const row = complaints.get(id);
        if (!row) throw new Error(`complaint ${id} not found`);
        if (patch.status !== undefined) row.status = patch.status;
        if (patch.resolvedByUserId !== undefined) {
          row.resolvedByUserId = patch.resolvedByUserId;
        }
        if (patch.resolvedAt !== undefined) row.resolvedAt = patch.resolvedAt;
        if (patch.resolutionNote !== undefined) {
          row.resolutionNote = patch.resolutionNote;
        }
      },
    },
    invigilators: {
      findById: async (_ctx, id) => invigilators.get(id) ?? null,
      findByInviteCode: async (_ctx, inviteCode) =>
        [...invigilators.values()].find((i) => i.inviteCode === inviteCode) ??
        null,
      findByMatchAndUser: async (_ctx, matchId, userId) =>
        [...invigilators.values()].find(
          (i) => i.matchId === matchId && i.userId === userId,
        ) ?? null,
      listByMatch: async (_ctx, matchId) =>
        [...invigilators.values()].filter((i) => i.matchId === matchId),
      create: async (_ctx, input) => {
        const row: InvigilatorRow = {
          id: nextId("invigilator"),
          matchId: input.matchId,
          userId: null,
          displayName: input.displayName,
          inviteCode: input.inviteCode,
          active: true,
          addedAt: input.addedAt,
        };
        invigilators.set(row.id, row);
        return row;
      },
      claim: async (_ctx, id, userId) => {
        const row = invigilators.get(id);
        if (!row) throw new Error(`invigilator ${id} not found`);
        row.userId = userId;
      },
      patchActive: async (_ctx, id, active) => {
        const row = invigilators.get(id);
        if (!row) throw new Error(`invigilator ${id} not found`);
        row.active = active;
      },
    },
    scores: {
      insert: async (_ctx, input) => {
        scores.push({ ...input, id: nextId("score") });
      },
      listByPlayer: async (_ctx, matchId, playerId) =>
        scores.filter((s) => s.matchId === matchId && s.playerId === playerId),
      listByMatch: async (_ctx, matchId) =>
        scores.filter((s) => s.matchId === matchId),
      existsByRef: async (_ctx, matchId, playerId, kind, refId) =>
        scores.some(
          (s) =>
            s.matchId === matchId &&
            s.playerId === playerId &&
            s.kind === kind &&
            s.refId === refId,
        ),
    },
    leaderboard: {
      upsert: async (_ctx, input) => {
        const existing = [...leaderboard.values()].find(
          (r) => r.matchId === input.matchId && r.playerId === input.playerId,
        );
        const row: LeaderboardRow = {
          id: existing?.id ?? nextId("leaderboard"),
          matchId: input.matchId,
          playerId: input.playerId,
          displayName: input.displayName,
          displayNameMode: input.displayNameMode,
          totalPoints: input.totalPoints,
          breakdown: input.breakdown,
          updatedAt: input.at,
        };
        leaderboard.set(row.id, row);
      },
      listByMatch: async (_ctx, matchId) =>
        [...leaderboard.values()].filter((r) => r.matchId === matchId),
    },
    audit: {
      append: async (_ctx, input) => {
        const id = nextId("audit");
        audit.push({ ...input, id, targetId: input.targetId ?? null, targetLabel: input.targetLabel ?? null, reason: input.reason ?? null, detail: input.detail ?? null });
        return id;
      },
      listByMatch: async (_ctx, matchId) =>
        audit.filter((a) => a.matchId === matchId),
    },
    events: {
      append: async (_ctx, input) => {
        const id = nextId("event");
        events.push({
          id,
          matchId: input.matchId,
          at: input.at,
          kind: input.kind,
          playerId: input.playerId ?? null,
          actorId: input.actorId ?? null,
          detail: input.detail ?? null,
          refId: input.refId ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        });
        return id;
      },
      listByMatch: async (_ctx, matchId) =>
        events
          .filter((e) => e.matchId === matchId)
          .sort((a, b) => a.at - b.at),
      existsByRef: async (_ctx, matchId, refId) =>
        events.some((e) => e.matchId === matchId && e.refId === refId),
    },
  };
}
