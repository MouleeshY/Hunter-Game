/**
 * Stage 2 flow test: create → join → lock → start, run through the real service
 * layer against an in-memory repository set. This is what several browsers do,
 * minus the network: the same validation and the same rules code.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  confirmBriefing,
  createMatch,
  getLobby,
  joinMatch,
  setRosterLock,
  startMatch,
  claimInvite,
  previewInvite,
  rerollCentre,
  uploadPosition,
} from "./index";
import { beginHeadStart } from "./setup";
import { setReposForTests, type Repos } from "./providers";
import { RULES_CONFIG } from "../rules/config";
import { distanceMetres } from "../rules/zone";
import type { PlayerRow } from "./repos/playerRepo";
import type { MatchRow } from "./repos/matchRepo";
import type { InvigilatorRow } from "./repos/invigilatorRepo";
import type { LocationRow } from "./repos/locationRepo";
import type { LeaderboardRow } from "./repos/leaderboardRepo";
import type { ScoreEventRow } from "./repos/scoreRepo";
import type { ComplaintRow } from "./repos/complaintRepo";
import type { TagRow } from "./repos/tagRepo";
import type { AuditRow } from "./repos/auditRepo";
import type { MatchEventRow } from "./repos/eventRepo";

/* ------------------------------------------------------------------ *\n * In-memory repositories\n * ------------------------------------------------------------------ */

function memoryRepos(): Repos {
  const matches = new Map<string, MatchRow>();
  const players = new Map<string, PlayerRow>();
  const invigilators = new Map<string, InvigilatorRow>();
  const locations = new Map<string, LocationRow>();
  const leaderboard = new Map<string, LeaderboardRow>();
  const scores: ScoreEventRow[] = [];
  const complaints = new Map<string, ComplaintRow>();
  const tags: TagRow[] = [];
  const audit: AuditRow[] = [];
  const events: MatchEventRow[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  const repos: Repos = {
    matches: {
      findById: async (_ctx, id) => matches.get(id) ?? null,
      listEndedBefore: async (_ctx, endedBeforeMs) =>
        [...matches.values()].filter(
          (m) => m.status === "ended" && (m.endedAt ?? Infinity) < endedBeforeMs,
        ),
      findByRoomCode: async (_ctx, roomCode) =>
        [...matches.values()].find((m) => m.roomCode === roomCode) ?? null,
      listRunning: async () =>
        [...matches.values()].filter(
          (m) =>
            m.status === "setup" ||
            m.status === "headstart" ||
            m.status === "live",
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
          setupStartedAt: null,
          setupEndsAt: null,
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
        if (patch.setupStartedAt !== undefined) {
          row.setupStartedAt = patch.setupStartedAt;
        }
        if (patch.setupEndsAt !== undefined) row.setupEndsAt = patch.setupEndsAt;
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
        tags.push({
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
      patch: async () => undefined,
      listByMatch: async (_ctx, matchId) =>
        tags.filter((t) => t.matchId === matchId),
    },
    complaints: {
      create: async (_ctx, input) => {
        const row: ComplaintRow = {
          id: nextId("complaint"),
          matchId: input.matchId,
          complainantId: input.complainantId,
          accusedId: input.accusedId,
          note: input.note,
          createdAt: Date.now(),
          responseDueAt:
            Date.now() + input.configComplaintResponseMinutes * 60_000,
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
        scores.push({
          ...input,
          id: nextId("score"),
        });
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
        audit.push({
          ...input,
          id,
          targetId: input.targetId ?? null,
          targetLabel: input.targetLabel ?? null,
          reason: input.reason ?? null,
          detail: input.detail ?? null,
        });
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
          distanceMetres: input.distanceMetres ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        });
        return id;
      },
      listByMatch: async (_ctx, matchId) =>
        events
          .filter((e) => e.matchId === matchId)
          .sort((a, b) => a.at - b.at),
      listByMatchAndKind: async (_ctx, matchId, kind) =>
        events
          .filter((e) => e.matchId === matchId && e.kind === kind)
          .sort((a, b) => a.at - b.at),
      existsByRef: async (_ctx, matchId, refId) =>
        events.some((e) => e.matchId === matchId && e.refId === refId),
    },
  };

  return repos;
}

/* ------------------------------------------------------------------ *\n * Flow\n * ------------------------------------------------------------------ */

const ORGANISER = { lat: 51.5074, lng: -0.1278 };

beforeEach(() => {
  setReposForTests(memoryRepos());
});

afterAll(() => {
  setReposForTests(null);
});

async function createRoom(invigilators = ["Ines", "Kwame"]) {
  return await createMatch(null, {
    createdByUserId: "user-organiser",
    matchDurationMinutes: 90,
    organiserLat: ORGANISER.lat,
    organiserLng: ORGANISER.lng,
    invigilatorNames: invigilators,
  });
}

async function joinPlayers(roomCode: string, count: number, offset = 0) {
  const joined = [];
  for (let i = 0; i < count; i += 1) {
    const index = i + offset;
    const row = await joinMatch(null, {
      userId: `user-${index}`,
      roomCode,
      callSign: `Runner ${index}`,
      displayName: `Runner ${index}`,
      displayNameMode: index % 2 === 0 ? "nickname" : "real",
    });
    // Everyone confirms the rules briefing as they join, so the organiser can
    // start without forcing it.
    await confirmBriefing(null, {
      matchId: row.matchId,
      userId: `user-${index}`,
    });
    joined.push(row);
  }
  return joined;
}

/** Start the setup countdown and then the head start itself. */
async function startHeadStart(matchId: string, seed?: number) {
  await startMatch(null, {
    matchId,
    userId: "user-organiser",
    seed,
  });
  return await beginHeadStart(null, { matchId, userId: "user-organiser" });
}

describe("create a room", () => {
  it("gives a five-character code and names 2 invigilators with invites", async () => {
    const created = await createRoom();
    expect(created.roomCode).toHaveLength(RULES_CONFIG.roomCodeLength);
    expect(created.invigilators).toHaveLength(2);
    for (const invigilator of created.invigilators) {
      expect(invigilator.inviteCode).toHaveLength(RULES_CONFIG.inviteCodeLength);
    }
    expect(created.invigilators[0].inviteCode).not.toBe(
      created.invigilators[1].inviteCode,
    );
  });

  it("picks the centre within 500 m of the organiser", async () => {
    for (let i = 0; i < 25; i += 1) {
      const created = await createRoom();
      const distance = distanceMetres(
        { lat: created.zone.centreLat, lng: created.zone.centreLng },
        ORGANISER,
      );
      expect(distance).toBeLessThanOrEqual(RULES_CONFIG.centrePickDistanceMetres);
    }
  });

  it("refuses a match length outside the configured range", async () => {
    await expect(
      createMatch(null, {
        createdByUserId: "user-organiser",
        matchDurationMinutes: 30,
        organiserLat: ORGANISER.lat,
        organiserLng: ORGANISER.lng,
        invigilatorNames: ["Ines", "Kwame"],
      }),
    ).rejects.toThrow(/between 60 and 180/);
  });

  it("refuses the wrong number of invigilators", async () => {
    await expect(createRoom(["Only one"])).rejects.toThrow(/2 and 3/);
  });

  it("re-rolls the centre but stays within 500 m of the organiser", async () => {
    const created = await createRoom();
    const rerolled = await rerollCentre(null, {
      matchId: created.matchId,
      organiserUserId: "user-organiser",
    });
    const distance = distanceMetres(
      { lat: rerolled.centreLat, lng: rerolled.centreLng },
      ORGANISER,
    );
    expect(distance).toBeLessThanOrEqual(RULES_CONFIG.centrePickDistanceMetres);
  });

  it("refuses a re-roll from anyone but the organiser, or after the start", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);
    await expect(
      rerollCentre(null, {
        matchId: created.matchId,
        organiserUserId: "user-0",
      }),
    ).rejects.toThrow(/organiser/);

    await startMatch(null, {
      matchId: created.matchId,
      userId: "user-organiser",
      seed: 3,
    });
    await expect(
      rerollCentre(null, {
        matchId: created.matchId,
        organiserUserId: "user-organiser",
      }),
    ).rejects.toThrow(/fixed once the match starts/);
  });
});

describe("join a room", () => {
  it("joins with a code, a call sign and a leaderboard name choice", async () => {
    const created = await createRoom();
    const joined = await joinPlayers(created.roomCode, 4);
    expect(joined).toHaveLength(4);

    const lobby = await getLobby(null, {
      userId: "user-0",
      roomCode: created.roomCode,
    });
    expect(lobby.playerCount).toBe(4);
    expect(lobby.status).toBe("lobby");
    expect(lobby.players.map((p) => p.callSign)).toContain("Runner 0");
    expect(lobby.me.callSign).toBe("Runner 0");
    expect(lobby.me.displayNameMode).toBe("nickname");
  });

  it("refuses a bad code and a duplicate call sign", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 1);

    await expect(
      joinMatch(null, {
        userId: "user-other",
        roomCode: "ZZZZZ",
        callSign: "Ghost",
        displayName: "Ghost",
        displayNameMode: "nickname",
      }),
    ).rejects.toThrow(/No room/);

    await expect(
      joinMatch(null, {
        userId: "user-other",
        roomCode: created.roomCode,
        callSign: "runner 0",
        displayName: "Ghost",
        displayNameMode: "nickname",
      }),
    ).rejects.toThrow(/call sign is taken/);
  });

  it("accepts up to the soft cap and refuses beyond it", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, RULES_CONFIG.softCapPlayers);
    await expect(joinPlayers(created.roomCode, 1, 100)).rejects.toThrow(/full/);
  });
});

describe("lock and start", () => {
  it("refuses joins once the roster is locked, and allows them again after unlock", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);

    await setRosterLock(null, {
      matchId: created.matchId,
      userId: "user-organiser",
      locked: true,
    });
    await expect(joinPlayers(created.roomCode, 1, 50)).rejects.toThrow(/locked/);

    await setRosterLock(null, {
      matchId: created.matchId,
      userId: "user-organiser",
      locked: false,
    });
    await expect(joinPlayers(created.roomCode, 1, 60)).resolves.toHaveLength(1);
  });

  it("refuses to start below the minimum", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 3);
    await expect(
      startMatch(null, { matchId: created.matchId, userId: "user-organiser" }),
    ).rejects.toThrow(/At least 4/);
  });

  it("refuses to start unless the organiser asks", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);
    await expect(
      startMatch(null, { matchId: created.matchId, userId: "user-1" }),
    ).rejects.toThrow(/organiser/);
  });

  it("starts at 4 players: setup first, then the head start", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);
    const setup = await startMatch(null, {
      matchId: created.matchId,
      userId: "user-organiser",
      seed: 12345,
    });

    // Stage 5 add-on: the roster is locked into a setup countdown first.
    expect(setup.status).toBe("setup");
    expect(setup.setupEndsAt).not.toBeNull();
    expect(setup.startedAt).toBeNull();
    expect(setup.hunters + setup.shadows).toBe(4);
    expect(setup.hunters).toBeGreaterThanOrEqual(1);
    expect(setup.shadows).toBeGreaterThanOrEqual(1);

    const started = await beginHeadStart(null, {
      matchId: created.matchId,
      userId: "user-organiser",
    });
    expect(started.status).toBe("headstart");
    expect(started.headStartEndsAt! - started.startedAt!).toBe(
      RULES_CONFIG.headStartMinutes * 60_000,
    );

    const lobby = await getLobby(null, {
      userId: "user-0",
      roomCode: created.roomCode,
    });
    expect(lobby.status).toBe("headstart");
    expect(lobby.playerCount).toBe(4);
  });

  it("refuses a join after the match has started", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);
    await startMatch(null, {
      matchId: created.matchId,
      userId: "user-organiser",
      seed: 99,
    });
    await expect(joinPlayers(created.roomCode, 1, 70)).rejects.toThrow(
      /already started/,
    );
  });

  it("starts at 20 and 40 players, keeping at least one of each team", async () => {
    for (const [index, playerCount] of [20, 40].entries()) {
      setReposForTests(memoryRepos());
      const created = await createRoom();
      await joinPlayers(created.roomCode, playerCount);
      const started = await startMatch(null, {
        matchId: created.matchId,
        userId: "user-organiser",
        seed: 1000 + index,
      });
      expect(started.hunters + started.shadows).toBe(playerCount);
      expect(started.hunters).toBeGreaterThanOrEqual(1);
      expect(started.shadows).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("invigilators", () => {
  it("are attached through their invite and are not players", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);
    const invite = created.invigilators[0].inviteCode;

    const preview = await previewInvite(null, invite);
    expect(preview.roomCode).toBe(created.roomCode);
    expect(preview.displayName).toBe("Ines");

    await claimInvite(null, { userId: "user-invigilator", inviteCode: invite });

    const lobby = await getLobby(null, {
      userId: "user-invigilator",
      roomCode: created.roomCode,
    });
    expect(lobby.me.isInvigilator).toBe(true);
    expect(lobby.me.playerId).toBeNull();
    expect(lobby.playerCount).toBe(4);
  });

  it("only shows invite codes to the organiser", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);

    const asOrganiser = await getLobby(null, {
      userId: "user-organiser",
      roomCode: created.roomCode,
    });
    expect(asOrganiser.invigilators[0].inviteCode).not.toBeNull();

    const asPlayer = await getLobby(null, {
      userId: "user-0",
      roomCode: created.roomCode,
    });
    expect(asPlayer.invigilators[0].inviteCode).toBeNull();
  });

  it("refuses an unknown invite code", async () => {
    await expect(previewInvite(null, "ZZZZZZ")).rejects.toThrow(/not valid/);
  });
});

describe("position uploads are separate from the ping", () => {
  it("refuses uploads during the head start", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);
    await startHeadStart(created.matchId, 7);

    const upload = await uploadPosition(null, {
      matchId: created.matchId,
      userId: "user-0",
      lat: ORGANISER.lat,
      lng: ORGANISER.lng,
      accuracyMetres: 8,
    });
    expect(upload.stored).toBe(false);
    expect(upload.reason).toBe("not_started");
  });

  it("stores uploads every few seconds once live", async () => {
    const created = await createRoom();
    await joinPlayers(created.roomCode, 4);
    const started = await startHeadStart(created.matchId, 8);

    // Pretend the five-minute head start has just ended.
    const repos = (await import("./providers")).getRepos();
    await repos.matches.patch(null, created.matchId, {
      startedAt: Date.now() - RULES_CONFIG.headStartMinutes * 60_000 - 1_000,
    });

    const first = await uploadPosition(null, {
      matchId: created.matchId,
      userId: "user-0",
      lat: ORGANISER.lat,
      lng: ORGANISER.lng,
      accuracyMetres: 8,
    });
    expect(first.stored).toBe(true);

    const tooSoon = await uploadPosition(null, {
      matchId: created.matchId,
      userId: "user-0",
      lat: ORGANISER.lat,
      lng: ORGANISER.lng,
      accuracyMetres: 8,
    });
    expect(tooSoon.stored).toBe(false);
    expect(tooSoon.reason).toBe("too_soon");

    const after = await uploadPosition(null, {
      matchId: created.matchId,
      userId: "user-0",
      lat: ORGANISER.lat,
      lng: ORGANISER.lng,
      accuracyMetres: 8,
    });
    // Still within a few seconds, but nowhere near the 3 minute ping interval.
    expect(after.reason).toBe("too_soon");
    expect(after.nextAllowedAtMs).toBeLessThanOrEqual(
      Date.now() + RULES_CONFIG.uploadIntervalSeconds * 1000,
    );
  });
});
