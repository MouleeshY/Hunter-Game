/**
 * Stage 5 and the two add-on conditions, driven through the real services on top
 * of the in-memory repositories.
 *
 *   - briefing gate before the start, and the audited forced start
 *   - rejoin as the same player, with no duplicate row
 *   - the setup countdown: separation, "no location", extend, force-start
 *   - pause freezing tag scans and complaints while uploads keep running
 *   - the two-view visibility matrix (Spectator / Helper get the Hunter view)
 *   - anchors already built in Stage 4 for abort, end of match and the feed
 *   - proximity detection: bands only, radius edges, large-zone-only, cooldown,
 *     stale and flagged readings, and never a position
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  abortMatch,
  beginHeadStart,
  checkSeparation,
  claimInvite,
  confirmBriefing,
  createMatch,
  endMatch,
  extendSetup,
  fileComplaint,
  getConsoleView,
  getLobby,
  getMapView,
  joinMatch,
  pauseMatch,
  raiseHelpAlert,
  resumeMatch,
  startMatch,
  uploadPosition,
} from "./index";
import { forceTag } from "./console";
import { runMatchTick } from "./scheduler";
import { getRepos, setReposForTests } from "./providers";
import { memoryRepos } from "./testSupport/memoryRepos";
import {
  detectionVerdict,
  distanceMetres,
  requiredSeparation,
  RULES_CONFIG,
  separationViolations,
  visibilityFor,
  type DetectionSample,
  type MatchConfig,
  type Role,
  type SeparationSample,
} from "../rules";

const ORGANISER = "user-organiser";
const INVIGILATOR = "user-invigilator";
const COORD = { lat: 51.5074, lng: -0.1278 };
const MINUTE = 60_000;
/** ~150 m of latitude and longitude at this latitude. */
const LAT_STEP = 0.00135;
const LNG_STEP = 0.00216;

beforeEach(() => {
  setReposForTests(memoryRepos());
});

afterAll(() => {
  setReposForTests(null);
});

// ---- fixtures ---------------------------------------------------------------

async function createRoom(
  playerCount: number,
  options: { detection?: boolean } = {},
) {
  const created = await createMatch(null, {
    createdByUserId: ORGANISER,
    matchDurationMinutes: 90,
    organiserLat: COORD.lat,
    organiserLng: COORD.lng,
    invigilatorNames: ["Ines", "Kwame"],
    proximityDetection: options.detection,
  });

  for (let i = 0; i < playerCount; i += 1) {
    await joinMatch(null, {
      userId: `user-${i}`,
      roomCode: created.roomCode,
      callSign: `P${i}`,
      displayName: `Player ${i}`,
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: `user-${i}` });
  }

  return created;
}

/** A centred grid whose neighbouring slots are ~150 m apart. */
function gridSlot(
  centre: { lat: number; lng: number },
  index: number,
  total: number,
): { lat: number; lng: number } {
  const columns = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / columns);
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    lat: centre.lat + (row - (rows - 1) / 2) * LAT_STEP,
    lng: centre.lng + (col - (columns - 1) / 2) * LNG_STEP,
  };
}

/** Every player reports from their own slot — the setup's happy path. */
async function spreadOut(
  created: { matchId: string; zone: { centreLat: number; centreLng: number } },
  playerCount: number,
  nowMs: number = Date.now(),
  skip: number[] = [],
): Promise<void> {
  const centre = {
    lat: created.zone.centreLat,
    lng: created.zone.centreLng,
  };
  for (let i = 0; i < playerCount; i += 1) {
    if (skip.includes(i)) continue;
    const slot = gridSlot(centre, i, playerCount);
    await uploadPosition(null, {
      matchId: created.matchId,
      userId: `user-${i}`,
      lat: slot.lat,
      lng: slot.lng,
      accuracyMetres: 5,
      nowMs,
    });
  }
}

/**
 * Move a head-started match onto the live clock. The services read the wall
 * clock, so the stored start time is moved into the past rather than the tests
 * pretending the future has happened.
 */
async function makeLive(matchId: string, minutesIn = 6): Promise<number> {
  const repos = getRepos();
  const match = await repos.matches.findById(null, matchId);
  const startedAt = Date.now() - minutesIn * MINUTE;
  await repos.matches.patch(null, matchId, {
    status: "live",
    startedAt,
    endsAt: startedAt + match!.config.matchDurationMinutes * MINUTE,
  });
  return startedAt;
}

async function matchRow(matchId: string) {
  const match = await getRepos().matches.findById(null, matchId);
  if (!match) throw new Error("match missing");
  return match;
}

async function playerRows(matchId: string) {
  return await getRepos().players.listByMatch(null, matchId);
}

// ---- pure-rule fixtures -----------------------------------------------------

function separationSample(
  playerId: string,
  role: Role,
  lat: number,
  lng: number,
  extra: Partial<SeparationSample> = {},
): SeparationSample {
  return {
    playerId,
    role,
    lat,
    lng,
    accuracyMetres: 5,
    recordedAtMs: Date.now(),
    suspicious: false,
    ...extra,
  };
}

function detectionSample(
  playerId: string,
  role: Role,
  lat: number,
  lng: number,
  extra: Partial<DetectionSample> = {},
): DetectionSample {
  return {
    playerId,
    role,
    lat,
    lng,
    accuracyMetres: 5,
    recordedAtMs: Date.now(),
    inPlay: true,
    suspicious: false,
    ...extra,
  };
}

function leadConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...RULES_CONFIG, ...overrides };
}

// -----------------------------------------------------------------------------
// Briefing gate
// -----------------------------------------------------------------------------

describe("the rules briefing gate", () => {
  it("keeps the start blocked until every player has confirmed", async () => {
    const created = await createMatch(null, {
      createdByUserId: ORGANISER,
      matchDurationMinutes: 90,
      organiserLat: COORD.lat,
      organiserLng: COORD.lng,
      invigilatorNames: ["Ines", "Kwame"],
    });
    for (let i = 0; i < 3; i += 1) {
      await joinMatch(null, {
        userId: `user-${i}`,
        roomCode: created.roomCode,
        callSign: `P${i}`,
        displayName: `Player ${i}`,
        displayNameMode: "nickname",
      });
      await confirmBriefing(null, { matchId: created.matchId, userId: `user-${i}` });
    }
    await joinMatch(null, {
      userId: "user-3",
      roomCode: created.roomCode,
      callSign: "P3",
      displayName: "Player 3",
      displayNameMode: "nickname",
    });

    const lobby = await getLobby(null, {
      userId: ORGANISER,
      roomCode: created.roomCode,
    });
    expect(lobby.canStart).toBe(false);
    expect(lobby.pendingBriefings).toBe(1);
    expect(lobby.startBlockedReason).toContain("not confirmed");

    await expect(
      startMatch(null, { matchId: created.matchId, userId: ORGANISER }),
    ).rejects.toThrow(/not confirmed/);
  });

  it("lets the organiser start once everyone is briefed", async () => {
    const created = await createRoom(4);
    const lobby = await getLobby(null, {
      userId: ORGANISER,
      roomCode: created.roomCode,
    });
    expect(lobby.canStart).toBe(true);
    expect(lobby.pendingBriefings).toBe(0);

    const started = await startMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
    });
    expect(started.status).toBe("setup");
    expect(started.startedAt).toBeNull();
  });

  it("records an audited forced start that names who was missing", async () => {
    const created = await createRoom(3);
    await joinMatch(null, {
      userId: "latecomer",
      roomCode: created.roomCode,
      callSign: "LATE",
      displayName: "Late",
      displayNameMode: "nickname",
    });

    const started = await startMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    expect(started.status).toBe("setup");
    expect(started.hunters + started.shadows).toBe(4);

    const audit = await getRepos().audit.listByMatch(null, created.matchId);
    const forced = audit.find((row) => row.action === "started_without_briefing");
    expect(forced).toBeDefined();
    expect(forced!.detail).toContain("LATE");
  });
});

// -----------------------------------------------------------------------------
// Rejoin
// -----------------------------------------------------------------------------

describe("rejoin", () => {
  it("returns the same player instead of a duplicate row", async () => {
    const created = await createRoom(4);
    const before = await playerRows(created.matchId);

    const again = await joinMatch(null, {
      userId: "user-1",
      roomCode: created.roomCode,
      callSign: "P1",
      displayName: "Player 1 again",
      displayNameMode: "nickname",
    });
    expect(again.rejoined).toBe(true);
    expect(again.playerId).toBe(before.find((p) => p.userId === "user-1")!.id);
    expect(await playerRows(created.matchId)).toHaveLength(4);
  });

  it("works after the roster is locked and the match is running", async () => {
    const created = await createRoom(4);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    const players = await playerRows(created.matchId);

    const again = await joinMatch(null, {
      userId: "user-0",
      roomCode: created.roomCode,
      callSign: "P0",
      displayName: "Player 0",
      displayNameMode: "nickname",
    });
    expect(again.playerId).toBe(players.find((p) => p.userId === "user-0")!.id);
    expect(await playerRows(created.matchId)).toHaveLength(4);
  });
});

// -----------------------------------------------------------------------------
// Setup period
// -----------------------------------------------------------------------------

describe("the setup period", () => {
  it("accepts uploads with the clock and the scoring stopped", async () => {
    const created = await createRoom(4);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await spreadOut(created, 4);

    const match = await matchRow(created.matchId);
    expect(match.startedAt).toBeNull();

    const view = await getMapView(null, {
      matchId: created.matchId,
      userId: "user-0",
    });
    expect(view.status).toBe("setup");
    expect(view.setup.active).toBe(true);
    expect(view.setup.separation).not.toBeNull();
    expect(view.setup.separation!.waiting).toBe(false);
    expect(view.me.points).toBe(0);
    expect(view.summary.tags).toBe(0);
  });

  it("turns a player's ring red with a distance, never a name", async () => {
    const created = await createRoom(4);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await spreadOut(created, 4, Date.now(), [3]);
    // Player 3 stands on player 0's spot.
    const slot = gridSlot(
      { lat: created.zone.centreLat, lng: created.zone.centreLng },
      0,
      4,
    );
    await uploadPosition(null, {
      matchId: created.matchId,
      userId: "user-3",
      lat: slot.lat,
      lng: slot.lng,
      accuracyMetres: 5,
    });

    const view = await getMapView(null, {
      matchId: created.matchId,
      userId: "user-3",
    });
    expect(view.setup.separation!.ok).toBe(false);
    expect(view.setup.separation!.distanceMetres).toBe(0);
    // Nobody's call sign is attached to the ring.
    expect(JSON.stringify(view.setup.separation)).not.toContain("P0");
  });

  it("gives the organiser the list of who is too close and who has no location", async () => {
    const created = await createRoom(4);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await spreadOut(created, 4, Date.now(), [2, 3]);

    const check = await checkSeparation(null, { matchId: created.matchId });
    expect(check.ok).toBe(false);
    expect(check.waiting).toEqual(["P2", "P3"]);

    const view = await getMapView(null, {
      matchId: created.matchId,
      userId: ORGANISER,
    });
    expect(view.setup.waiting).toEqual(["P2", "P3"]);
    expect(view.staff!.playerCount).toBe(4);
  });

  it("is clear at 4, 20 and 40 players once everyone is spread out", async () => {
    for (const count of [4, 20, 40]) {
      setReposForTests(memoryRepos());
      const created = await createRoom(count);
      await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
      await spreadOut(created, count);

      const check = await checkSeparation(null, { matchId: created.matchId });
      expect({ count, ok: check.ok }).toEqual({ count, ok: true });
      expect(check.violations).toEqual([]);
      expect(check.waiting).toEqual([]);

      const forced = await beginHeadStart(null, {
        matchId: created.matchId,
        userId: ORGANISER,
      });
      expect(forced.forced).toBe(false);
      expect(forced.status).toBe("headstart");
    }
  });

  it("requires 100 m between a Hunter and a Shadow and 25 m between teammates", async () => {
    const config = leadConfig();
    expect(requiredSeparation("hunter", "shadow", config)).toBe(100);
    expect(requiredSeparation("shadow", "shadow", config)).toBe(25);

    const now = Date.now();
    const crossTeam = separationViolations({
      samples: [
        separationSample("h", "hunter", COORD.lat, COORD.lng),
        separationSample("s", "shadow", COORD.lat + 0.00054, COORD.lng), // ~60 m
      ],
      nowMs: now,
      config,
    });
    expect(crossTeam).toHaveLength(1);
    expect(crossTeam[0].requiredMetres).toBe(100);

    const teamMates = separationViolations({
      samples: [
        separationSample("s1", "shadow", COORD.lat, COORD.lng),
        separationSample("s2", "shadow", COORD.lat - 0.00018, COORD.lng), // ~20 m
      ],
      nowMs: now,
      config,
    });
    expect(teamMates).toHaveLength(1);
    expect(teamMates[0].requiredMetres).toBe(25);
  });

  it("refuses the head start while a pair is too close, then audits the forced one", async () => {
    const created = await createRoom(4);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await spreadOut(created, 4, Date.now(), [3]);
    const slot = gridSlot(
      { lat: created.zone.centreLat, lng: created.zone.centreLng },
      0,
      4,
    );
    await uploadPosition(null, {
      matchId: created.matchId,
      userId: "user-3",
      lat: slot.lat,
      lng: slot.lng,
      accuracyMetres: 5,
    });

    await expect(
      beginHeadStart(null, { matchId: created.matchId, userId: ORGANISER }),
    ).rejects.toThrow(/too close/);

    const forced = await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    expect(forced.forced).toBe(true);
    expect(forced.violations).toBeGreaterThan(0);

    const audit = await getRepos().audit.listByMatch(null, created.matchId);
    const row = audit.find((entry) => entry.action === "started_head_start_forced");
    expect(row).toBeDefined();
    expect(row!.detail).toContain("too-close");
  });

  it("treats a player with no position as not ready", async () => {
    const created = await createRoom(4);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await spreadOut(created, 4, Date.now(), [2]);

    await expect(
      beginHeadStart(null, { matchId: created.matchId, userId: ORGANISER }),
    ).rejects.toThrow(/no location/);

    const forced = await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    expect(forced.status).toBe("headstart");
    expect(forced.violations).toBe(0);

    const audit = await getRepos().audit.listByMatch(null, created.matchId);
    const row = audit.find((entry) => entry.action === "started_head_start_forced");
    expect(row!.detail).toContain("No location: P2");
  });

  it("extends by one minute at a time, audits each one, and stops at the cap", async () => {
    const created = await createRoom(4);
    const started = await startMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
    });

    const first = await extendSetup(null, {
      matchId: created.matchId,
      userId: ORGANISER,
    });
    expect(first.setupEndsAt - started.setupEndsAt!).toBe(60_000);

    let guard = 0;
    while (guard < 20) {
      guard += 1;
      try {
        await extendSetup(null, { matchId: created.matchId, userId: ORGANISER });
      } catch (cause) {
        expect((cause as Error).message).toContain("cannot be extended");
        break;
      }
    }
    const capped = await matchRow(created.matchId);
    expect(capped.setupEndsAt! - capped.setupStartedAt!).toBe(
      RULES_CONFIG.setupMaxDurationSeconds * 1000,
    );

    const audit = await getRepos().audit.listByMatch(null, created.matchId);
    const extensions = audit.filter((entry) => entry.action === "setup_extended");
    // 180 s of countdown, then one audited minute at a time up to 600 s.
    expect(extensions.length).toBe(
      (RULES_CONFIG.setupMaxDurationSeconds - RULES_CONFIG.setupDurationSeconds) /
        RULES_CONFIG.setupExtensionSeconds,
    );
  });

  it("advances on its own only when everyone is clear and located", async () => {
    // Clear and located: the tick moves the match into the head start.
    const clearRoom = await createRoom(4);
    await startMatch(null, { matchId: clearRoom.matchId, userId: ORGANISER });
    const clearMatch = await matchRow(clearRoom.matchId);
    const endsAt = clearMatch.setupEndsAt!;
    await spreadOut(clearRoom, 4, endsAt + 1000);
    const advanceTick = await runMatchTick(null, endsAt + 1000);
    expect(advanceTick.advanced).toBe(1);
    expect((await matchRow(clearRoom.matchId)).status).toBe("headstart");

    // One player has no location: nothing advances.
    setReposForTests(memoryRepos());
    const missingRoom = await createRoom(4);
    await startMatch(null, { matchId: missingRoom.matchId, userId: ORGANISER });
    const missingEndsAt = (await matchRow(missingRoom.matchId)).setupEndsAt!;
    await spreadOut(missingRoom, 4, missingEndsAt + 1000, [1]);
    const missingTick = await runMatchTick(null, missingEndsAt + 1000);
    expect(missingTick.advanced).toBe(0);
    expect((await matchRow(missingRoom.matchId)).status).toBe("setup");

    // Two players standing together: nothing advances either.
    setReposForTests(memoryRepos());
    const closeRoom = await createRoom(4);
    await startMatch(null, { matchId: closeRoom.matchId, userId: ORGANISER });
    const closeEndsAt = (await matchRow(closeRoom.matchId)).setupEndsAt!;
    await spreadOut(closeRoom, 4, closeEndsAt + 1000, [3]);
    const slot = gridSlot(
      { lat: closeRoom.zone.centreLat, lng: closeRoom.zone.centreLng },
      0,
      4,
    );
    await uploadPosition(null, {
      matchId: closeRoom.matchId,
      userId: "user-3",
      lat: slot.lat,
      lng: slot.lng,
      accuracyMetres: 5,
      nowMs: closeEndsAt + 1000,
    });
    const closeTick = await runMatchTick(null, closeEndsAt + 1000);
    expect(closeTick.advanced).toBe(0);
    expect((await matchRow(closeRoom.matchId)).status).toBe("setup");
  });
});

// -----------------------------------------------------------------------------
// Pause
// -----------------------------------------------------------------------------

describe("a paused match", () => {
  it("refuses tag scans and complaints while uploads keep running", async () => {
    const created = await createRoom(6);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId);

    const players = await playerRows(created.matchId);
    const hunter = players.find((p) => p.role === "hunter")!;
    const shadow = players.find((p) => p.role === "shadow")!;
    const slot = gridSlot(
      { lat: created.zone.centreLat, lng: created.zone.centreLng },
      0,
      6,
    );

    await pauseMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      reason: "Thick fog.",
    });

    await expect(
      fileComplaint(null, {
        matchId: created.matchId,
        userId: hunter.userId,
        accusedId: shadow.id,
        incidentAtMs: Date.now(),
      }),
    ).rejects.toThrow(/paused/);

    // Uploads are the one thing that keeps running: the phone keeps reporting
    // so the map is warm when the match resumes.
    const upload = await uploadPosition(null, {
      matchId: created.matchId,
      userId: hunter.userId,
      lat: slot.lat,
      lng: slot.lng,
      accuracyMetres: 5,
    });
    expect(upload.stored).toBe(true);

    await resumeMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      reason: "Fog cleared.",
    });
    const complaint = await fileComplaint(null, {
      matchId: created.matchId,
      userId: hunter.userId,
      accusedId: shadow.id,
      incidentAtMs: Date.now(),
    });
    expect(complaint.status).toBe("open");
  });
});

// -----------------------------------------------------------------------------
// Visibility
// -----------------------------------------------------------------------------

describe("who sees what", () => {
  it("gives Spectators, Helpers and caught players the Hunter view", async () => {
    const spectators = [
      { role: "shadow" as Role, status: "spectator" as const, mode: "spectator" as const },
      { role: "shadow" as Role, status: "tagged" as const, mode: "helper" as const },
      { role: "shadow" as Role, status: "eliminated" as const, mode: "spectator" as const },
    ];
    for (const viewer of spectators) {
      const asViewer = { kind: "player" as const, playerId: "me", ...viewer };
      expect(
        visibilityFor(asViewer, { playerId: "h1", role: "hunter", status: "active" }),
      ).toBe("live");
      expect(
        visibilityFor(asViewer, { playerId: "s1", role: "shadow", status: "active" }),
      ).toBe("ping");
    }
  });

  it("never shows a Hunter to an active Shadow, and shows every player to staff", async () => {
    const shadow = {
      kind: "player" as const,
      playerId: "me",
      role: "shadow" as const,
      status: "active" as const,
    };
    expect(
      visibilityFor(shadow, { playerId: "h1", role: "hunter", status: "active" }),
    ).toBeNull();
    expect(
      visibilityFor(shadow, { playerId: "s2", role: "shadow", status: "active" }),
    ).toBe("live");
    expect(
      visibilityFor({ kind: "invigilator" }, {
        playerId: "s2",
        role: "shadow",
        status: "active",
      }),
    ).toBe("live");
  });

  it("shows a Spectator Hunters live and no free Shadow before the first ping", async () => {
    const created = await createRoom(6);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId, 6);
    await spreadOut(created, 6);

    const players = await playerRows(created.matchId);
    const spectator = players.find((p) => p.role === "shadow")!;
    await getRepos().players.patch(null, spectator.id, {
      status: "spectator",
      mode: "spectator",
    });

    const view = await getMapView(null, {
      matchId: created.matchId,
      userId: spectator.userId,
    });
    const hunterMarkers = view.markers.filter((marker) => marker.role === "hunter");
    expect(hunterMarkers.length).toBeGreaterThan(0);
    expect(hunterMarkers.every((marker) => marker.kind === "live")).toBe(true);
    // A free Shadow is only ever a ping ghost for this viewer, never live.
    const otherShadows = view.markers.filter(
      (marker) => marker.role === "shadow" && marker.playerId !== spectator.id,
    );
    expect(otherShadows.every((marker) => marker.kind === "ping")).toBe(true);
    expect(view.me.points).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Abort and the end of the match
// -----------------------------------------------------------------------------

describe("ending a match", () => {
  it("aborts with no winner and no bonuses, keeping the points earned", async () => {
    const created = await createRoom(6);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId);

    await claimInvite(null, {
      userId: INVIGILATOR,
      inviteCode: created.invigilators[0].inviteCode,
    });
    const players = await playerRows(created.matchId);
    const hunter = players.find((p) => p.role === "hunter")!;
    const shadow = players.find((p) => p.role === "shadow")!;
    const tagged = await forceTag(null, {
      matchId: created.matchId,
      hunterId: hunter.id,
      shadowId: shadow.id,
      userId: INVIGILATOR,
      reason: "Refused to show the code.",
    });
    expect(tagged.points).toBeGreaterThan(0);

    await expect(
      abortMatch(null, {
        matchId: created.matchId,
        userId: ORGANISER,
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/);

    const aborted = await abortMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      reason: "Lightning over the park.",
    });
    expect(aborted.aborted).toBe(true);

    const match = await matchRow(created.matchId);
    expect(match.winner).toBeNull();
    expect(match.endReason).toBe("aborted");

    const scores = await getRepos().scores.listByMatch(null, created.matchId);
    expect(scores.some((row) => row.kind === "all_tagged_bonus")).toBe(false);
    expect(scores.some((row) => row.kind === "survival_bonus")).toBe(false);
    const kept = scores
      .filter((row) => row.playerId === hunter.id)
      .reduce((total, row) => total + row.points, 0);
    expect(kept).toBe(tagged.points);

    const audit = await getRepos().audit.listByMatch(null, created.matchId);
    expect(audit.some((row) => row.action === "match_aborted")).toBe(true);
  });

  it("freezes the result and stops uploads at the end", async () => {
    const created = await createRoom(6);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId);
    await spreadOut(created, 6);

    const ended = await endMatch(null, {
      matchId: created.matchId,
      force: true,
    });
    expect(ended.ended).toBe(true);
    expect(ended.winner).toBe("shadows");

    const slot = gridSlot(
      { lat: created.zone.centreLat, lng: created.zone.centreLng },
      0,
      6,
    );
    const late = await uploadPosition(null, {
      matchId: created.matchId,
      userId: "user-0",
      lat: slot.lat,
      lng: slot.lng,
      accuracyMetres: 5,
    });
    expect(late.stored).toBe(false);
    expect(late.reason).toBe("not_live");

    const view = await getMapView(null, {
      matchId: created.matchId,
      userId: "user-0",
    });
    expect(view.status).toBe("ended");
    expect(view.winner).toBe("shadows");
    expect(view.endReason).not.toBeNull();
  });

  it("sends an 'I need help' alert with the position to the console only", async () => {
    const created = await createRoom(6);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId);
    await claimInvite(null, {
      userId: INVIGILATOR,
      inviteCode: created.invigilators[0].inviteCode,
    });

    await raiseHelpAlert(null, {
      matchId: created.matchId,
      userId: "user-0",
      lat: COORD.lat + 0.001,
      lng: COORD.lng - 0.001,
      accuracyMetres: 8,
    });

    const consoleView = await getConsoleView(null, {
      matchId: created.matchId,
      userId: INVIGILATOR,
    });
    expect(consoleView.helpAlerts).toHaveLength(1);
    expect(consoleView.helpAlerts[0].lat).not.toBeNull();
    expect(consoleView.helpAlerts[0].callSign).toBe("P0");

    const events = await getRepos().events.listByMatchAndKind(
      null,
      created.matchId,
      "help",
    );
    expect(events).toHaveLength(1);
    expect(events[0].lat).not.toBeNull();
  });

  it("writes tag and detection feed rows without positions or names", async () => {
    const created = await createRoom(6);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId);
    await claimInvite(null, {
      userId: INVIGILATOR,
      inviteCode: created.invigilators[0].inviteCode,
    });

    const players = await playerRows(created.matchId);
    const hunter = players.find((p) => p.role === "hunter")!;
    const shadow = players.find((p) => p.role === "shadow")!;
    await forceTag(null, {
      matchId: created.matchId,
      hunterId: hunter.id,
      shadowId: shadow.id,
      userId: INVIGILATOR,
      reason: "Refused to show the code.",
    });

    const events = await getRepos().events.listByMatch(null, created.matchId);
    const tag = events.find((event) => event.kind === "tag")!;
    // Who caught whom is only rendered by the feed once the match has ended;
    // the raw row carries ids, a generic detail, never names, never a position.
    expect(tag.detail).toBe("Forced by an invigilator.");
    expect(tag.lat).toBeNull();
    expect(tag.lng).toBeNull();
    expect(tag.playerId).toBe(shadow.id);
    expect(tag.actorId).toBe(hunter.id);
    expect(JSON.stringify(tag)).not.toContain("P0");
  });
});

// -----------------------------------------------------------------------------
// Proximity detection (add-on condition 2)
// -----------------------------------------------------------------------------

describe("proximity detection", () => {
  const base = {
    nowMs: Date.now(),
    status: "live" as const,
    paused: false,
    zoneRadiusMetres: 800,
    lastAlertAtMs: null,
  };

  it("alerts inside the radius, not a metre beyond, and only in bands", () => {
    const config = leadConfig();
    const hunter = detectionSample("h", "hunter", COORD.lat, COORD.lng);
    const inside = detectionSample("s", "shadow", COORD.lat + 0.0004, COORD.lng);
    const outside = detectionSample("s", "shadow", COORD.lat + 0.0005, COORD.lng);
    expect(distanceMetres(hunter, inside)).toBeLessThanOrEqual(
      config.detectionRadiusMetres,
    );
    expect(distanceMetres(hunter, outside)).toBeGreaterThan(
      config.detectionRadiusMetres,
    );

    const near = detectionVerdict({ ...base, hunter, shadow: inside, config });
    expect(near.alert).toBe(true);
    expect(near.distanceMetres).toBe(Math.round(distanceMetres(hunter, inside)));
    expect(near.band).toBe("under 50 m");

    const far = detectionVerdict({ ...base, hunter, shadow: outside, config });
    expect(far.alert).toBe(false);
    expect(far.reason).toBe("too_far");

    const veryClose = detectionVerdict({
      ...base,
      hunter,
      shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng), // ~11 m
      config,
    });
    expect(veryClose.band).toBe("under 25 m");
  });

  it("runs only in a large enough zone, and never when the match switched it off", () => {
    const wide = detectionVerdict({
      ...base,
      zoneRadiusMetres: RULES_CONFIG.detectionMinZoneRadiusMetres,
      hunter: detectionSample("h", "hunter", COORD.lat, COORD.lng),
      shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng),
      config: leadConfig(),
    });
    expect(wide.alert).toBe(true);

    const tight = detectionVerdict({
      ...base,
      zoneRadiusMetres: RULES_CONFIG.detectionMinZoneRadiusMetres - 1,
      hunter: detectionSample("h", "hunter", COORD.lat, COORD.lng),
      shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng),
      config: leadConfig(),
    });
    expect(tight.alert).toBe(false);
    expect(tight.reason).toBe("zone_small");

    const off = detectionVerdict({
      ...base,
      hunter: detectionSample("h", "hunter", COORD.lat, COORD.lng),
      shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng),
      config: leadConfig({ proximityDetectionEnabled: false }),
    });
    expect(off.alert).toBe(false);
    expect(off.reason).toBe("disabled");

    // The zone floor for the shrink schedule is a different number.
    expect(RULES_CONFIG.minZoneRadiusMetres).toBe(100);
    expect(RULES_CONFIG.detectionMinZoneRadiusMetres).toBe(400);
  });

  it("stays quiet during the head start, while paused, and after a tag", () => {
    const args = {
      ...base,
      hunter: detectionSample("h", "hunter", COORD.lat, COORD.lng),
      shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng),
      config: leadConfig(),
    };
    expect(detectionVerdict({ ...args, status: "headstart" }).reason).toBe(
      "not_live",
    );
    expect(detectionVerdict({ ...args, paused: true }).reason).toBe("paused");
    expect(
      detectionVerdict({
        ...args,
        shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng, {
          inPlay: false,
        }),
      }).reason,
    ).toBe("wrong_parties");
  });

  it("holds the cooldown for one Hunter/Shadow pair", () => {
    const now = Date.now();
    const args = {
      ...base,
      nowMs: now,
      hunter: detectionSample("h", "hunter", COORD.lat, COORD.lng),
      shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng),
      config: leadConfig(),
    };
    expect(
      detectionVerdict({ ...args, lastAlertAtMs: now - 30_000 }).reason,
    ).toBe("cooldown");
    expect(
      detectionVerdict({ ...args, lastAlertAtMs: now - 61_000 }).alert,
    ).toBe(true);
  });

  it("ignores stale, flagged and inaccurate readings", () => {
    const now = Date.now();
    const args = {
      ...base,
      nowMs: now,
      hunter: detectionSample("h", "hunter", COORD.lat, COORD.lng),
      shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng),
      config: leadConfig(),
    };
    expect(
      detectionVerdict({
        ...args,
        shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng, {
          recordedAtMs: now - 31_000,
        }),
      }).reason,
    ).toBe("stale_position");
    expect(
      detectionVerdict({
        ...args,
        hunter: detectionSample("h", "hunter", COORD.lat, COORD.lng, {
          suspicious: true,
        }),
      }).reason,
    ).toBe("flagged_position");
    expect(
      detectionVerdict({
        ...args,
        shadow: detectionSample("s", "shadow", COORD.lat + 0.0001, COORD.lng, {
          accuracyMetres: 60,
        }),
      }).reason,
    ).toBe("accuracy");
  });

  it("warns both sides during a live match without points, a tag or a position", async () => {
    const created = await createRoom(6);
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId);

    const players = await playerRows(created.matchId);
    const hunter = players.find((p) => p.role === "hunter")!;
    const shadow = players.find((p) => p.role === "shadow")!;
    const spot = { lat: created.zone.centreLat, lng: created.zone.centreLng };

    await uploadPosition(null, {
      matchId: created.matchId,
      userId: shadow.userId,
      lat: spot.lat,
      lng: spot.lng,
      accuracyMetres: 5,
    });
    await uploadPosition(null, {
      matchId: created.matchId,
      userId: hunter.userId,
      lat: spot.lat + 0.0002,
      lng: spot.lng,
      accuracyMetres: 5,
    });

    const alerts = await getRepos().events.listByMatchAndKind(
      null,
      created.matchId,
      "detection",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].playerId).toBe(hunter.id);
    expect(alerts[0].actorId).toBe(shadow.id);
    expect(alerts[0].detail).toBe("under 25 m");
    expect(alerts[0].lat).toBeNull();
    expect(alerts[0].lng).toBeNull();
    expect(alerts[0].distanceMetres).not.toBeNull();

    // No points and no tag: a warning and nothing else.
    const scores = await getRepos().scores.listByMatch(null, created.matchId);
    expect(scores).toHaveLength(0);
    expect(await getRepos().tags.listByMatch(null, created.matchId)).toHaveLength(0);
    expect(shadow.status).toBe("active");

    // The pair does not buzz again inside the cooldown.
    await uploadPosition(null, {
      matchId: created.matchId,
      userId: hunter.userId,
      lat: spot.lat + 0.0002,
      lng: spot.lng,
      accuracyMetres: 5,
      nowMs: Date.now() + 10_000,
    });
    expect(
      await getRepos().events.listByMatchAndKind(null, created.matchId, "detection"),
    ).toHaveLength(1);
  });

  it("can be switched off for the whole match at setup", async () => {
    const created = await createRoom(6, { detection: false });
    await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
    await beginHeadStart(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      force: true,
    });
    await makeLive(created.matchId);

    const players = await playerRows(created.matchId);
    const hunter = players.find((p) => p.role === "hunter")!;
    const shadow = players.find((p) => p.role === "shadow")!;
    const spot = { lat: created.zone.centreLat, lng: created.zone.centreLng };

    await uploadPosition(null, {
      matchId: created.matchId,
      userId: shadow.userId,
      lat: spot.lat,
      lng: spot.lng,
      accuracyMetres: 5,
    });
    await uploadPosition(null, {
      matchId: created.matchId,
      userId: hunter.userId,
      lat: spot.lat + 0.0002,
      lng: spot.lng,
      accuracyMetres: 5,
    });

    expect(
      await getRepos().events.listByMatchAndKind(null, created.matchId, "detection"),
    ).toHaveLength(0);
  });
});
