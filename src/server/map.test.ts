/**
 * Stage 3 server tests: who can see which position, spoof checks, the
 * out-of-zone drain and position-history cleanup.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  createMatch,
  claimInvite,
  confirmBriefing,
  getMapView,
  joinMatch,
  startMatch,
  uploadPosition,
} from "./index";
import { beginHeadStart } from "./setup";
import { getRepos, setReposForTests } from "./providers";
import { memoryRepos } from "./testSupport/memoryRepos";
import { purgeExpiredPositions } from "./positionService";
import { RULES_CONFIG } from "../rules/config";
import type { PlayerRow } from "./repos/playerRepo";
import type { MatchRow } from "./repos/matchRepo";

const T0 = 1_700_000_000_000; // fixed clock: match start
const MIN = 60_000;
const ORGANISER = { lat: 51.5074, lng: -0.1278 };
const METRES_PER_DEGREE = 111_194.9266;

beforeEach(() => {
  setReposForTests(memoryRepos());
});

afterAll(() => {
  setReposForTests(null);
});

interface Fixture {
  match: MatchRow;
  players: PlayerRow[];
  hunter: PlayerRow;
  shadows: PlayerRow[];
  hunterCallSign: string;
}

/** Create a room, join four players, start it, and move the clock to kickoff. */
async function setupMatch(): Promise<Fixture> {
  const created = await createMatch(null, {
    createdByUserId: "user-organiser",
    matchDurationMinutes: 90,
    organiserLat: ORGANISER.lat,
    organiserLng: ORGANISER.lng,
    invigilatorNames: ["Ines", "Kwame"],
  });

  for (let i = 0; i < 4; i += 1) {
    await joinMatch(null, {
      userId: `user-${i}`,
      roomCode: created.roomCode,
      callSign: `Runner ${i}`,
      displayName: `Runner ${i}`,
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, {
      matchId: created.matchId,
      userId: `user-${i}`,
    });
  }

  await startMatch(null, {
    matchId: created.matchId,
    userId: "user-organiser",
    seed: 4242,
  });
  // No phone has uploaded a position in this fixture, so the setup can never
  // clear on its own: the organiser force-starts it, as a real one would.
  await beginHeadStart(null, {
    matchId: created.matchId,
    userId: "user-organiser",
    force: true,
  });

  // Rewrite the clock so the match started at T0.
  const repos = getRepos();
  await repos.matches.patch(null, created.matchId, {
    startedAt: T0,
    endsAt: T0 + 90 * MIN,
  });

  const match = await repos.matches.findById(null, created.matchId);
  const players = await repos.players.listByMatch(null, created.matchId);
  const hunter = players.find((p) => p.role === "hunter")!;
  const shadows = players.filter((p) => p.role === "shadow");

  return {
    match: match!,
    players,
    hunter,
    shadows,
    hunterCallSign: hunter.callSign,
  };
}

function atMetres(metres: number, base = ORGANISER): { lat: number; lng: number } {
  return { lat: base.lat + metres / METRES_PER_DEGREE, lng: base.lng };
}

async function upload(
  matchId: string,
  player: PlayerRow,
  nowMs: number,
  point = ORGANISER,
  accuracyMetres: number | null = 8,
) {
  return await uploadPosition(null, {
    matchId,
    userId: player.userId,
    lat: point.lat,
    lng: point.lng,
    accuracyMetres,
    nowMs,
  });
}

/* ------------------------------------------------------------------ *
 * Visibility\n * ------------------------------------------------------------------ */

describe("what a hunter may see", () => {
  it("never returns a live Shadow position", async () => {
    const { match, hunter, shadows } = await setupMatch();
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };

    for (const player of [hunter, ...shadows]) {
      await upload(match.id, player, T0 + 5 * MIN + 10_000, centre);
    }

    const view = await getMapView(null, {
      matchId: match.id,
      userId: hunter.userId,
      nowMs: T0 + 5 * MIN + 11_000,
    });

    const shadowMarkers = view.markers.filter((m) => m.role === "shadow");
    for (const marker of shadowMarkers) {
      expect(marker.kind).toBe("ping");
    }
    expect(
      view.markers.some((m) => m.role === "shadow" && m.kind === "live"),
    ).toBe(false);
    // The teammate is live.
    expect(
      view.markers.some((m) => m.playerId === hunter.id && m.kind === "live"),
    ).toBe(true);
  });

  it("shows a Shadow only at the ping, with its age", async () => {
    const { match, hunter, shadows } = await setupMatch();
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };
    const shadow = shadows[0];

    await upload(match.id, shadow, T0 + 5 * MIN + 10_000, centre);
    // A later upload advances the ping window to 8 minutes.
    await upload(match.id, shadow, T0 + 8 * MIN + 10_000, atMetres(5));
    await upload(match.id, hunter, T0 + 8 * MIN + 20_000, centre);

    const view = await getMapView(null, {
      matchId: match.id,
      userId: hunter.userId,
      nowMs: T0 + 8 * MIN + 30_000,
    });

    const ghost = view.markers.find(
      (m) => m.playerId === shadow.id && m.kind === "ping",
    );
    expect(ghost).toBeDefined();
    // The ghost is the position from before the last ping, not the newest one.
    expect(ghost!.atMs).toBe(T0 + 5 * MIN + 10_000);
    expect(ghost!.ageMs).toBeGreaterThan(3 * MIN);
    expect(ghost!.lat).toBeCloseTo(centre.lat, 6);
  });

  it("refuses a viewer who is not in the match", async () => {
    const { match } = await setupMatch();
    await expect(
      getMapView(null, {
        matchId: match.id,
        userId: "user-stranger",
        nowMs: T0 + 6 * MIN,
      }),
    ).rejects.toThrow(/not in this match/);
  });
});

describe("what a shadow may see", () => {
  it("sees teammates live and no Hunters at all", async () => {
    const { match, hunter, shadows } = await setupMatch();
    const repos = getRepos();
    const players = await repos.players.listByMatch(null, match.id);
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };
    for (const player of players) {
      await upload(match.id, player, T0 + 5 * MIN + 10_000, centre);
    }

    const view = await getMapView(null, {
      matchId: match.id,
      userId: shadows[0].userId,
      nowMs: T0 + 5 * MIN + 11_000,
    });

    expect(view.markers.some((m) => m.role === "hunter")).toBe(false);
    expect(
      view.markers.some((m) => m.playerId === shadows[1].id && m.kind === "live"),
    ).toBe(true);
    expect(hunter.callSign).toBeTruthy();
  });
});

describe("what a spectator may see", () => {
  it("gets the Hunter view: Hunters live, free Shadows at the ping", async () => {
    const { match, players, hunter } = await setupMatch();
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };
    for (const player of players) {
      await upload(match.id, player, T0 + 5 * MIN + 10_000, centre);
    }

    const repos = getRepos();
    const tagged = await repos.players.findById(null, players[3].id);
    await repos.players.patch(null, tagged!.id, { status: "spectator" });

    const view = await getMapView(null, {
      matchId: match.id,
      userId: tagged!.userId,
      nowMs: T0 + 6 * MIN + 20_000,
    });

    expect(view.markers.length).toBeGreaterThan(0);
    // Stage 5, decision 4: the 60-second delayed view is gone. A spectator
    // sees exactly what a Hunter sees.
    expect(
      view.markers.find((marker) => marker.playerId === hunter.id)?.kind,
    ).toBe("live");
    for (const marker of view.markers) {
      if (marker.playerId === tagged!.id) continue; // own position is live
      if (marker.role !== "shadow") continue;
      expect(marker.kind).toBe("ping");
      expect(marker.kind).not.toBe("live");
    }
    expect(hunter.id).toBeTruthy();
  });
});

describe("what an invigilator may see", () => {
  it("sees every player live", async () => {
    const { match, players } = await setupMatch();
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };
    for (const player of players) {
      await upload(match.id, player, T0 + 5 * MIN + 10_000, centre);
    }

    const repos = getRepos();
    const invite = await repos.invigilators.listByMatch(null, match.id);
    await claimInvite(null, {
      userId: "user-invigilator",
      inviteCode: invite[0].inviteCode,
    });

    const view = await getMapView(null, {
      matchId: match.id,
      userId: "user-invigilator",
      nowMs: T0 + 5 * MIN + 11_000,
    });

    expect(view.me.isInvigilator).toBe(true);
    expect(view.markers.length).toBe(players.length);
    for (const marker of view.markers) {
      expect(marker.kind).toBe("live");
    }
  });
});

/* ------------------------------------------------------------------ *
 * Spoofing\n * ------------------------------------------------------------------ */

describe("spoof check", () => {
  it("flags an impossible jump and keeps it out of the map", async () => {
    const { match, hunter, shadows } = await setupMatch();
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };
    const shadow = shadows[0];

    await upload(match.id, shadow, T0 + 5 * MIN + 10_000, centre);
    const jump = await upload(
      match.id,
      shadow,
      T0 + 5 * MIN + 17_000,
      atMetres(1_000),
    );

    expect(jump.stored).toBe(true);
    expect(jump.flagged).toBe(true);
    expect(jump.suspiciousReason).toBe("impossible_speed");

    const view = await getMapView(null, {
      matchId: match.id,
      userId: hunter.userId,
      nowMs: T0 + 5 * MIN + 18_000,
    });
    const marker = view.markers.find((m) => m.playerId === shadow.id);
    // The flagged reading is stored but never shown.
    if (marker) expect(marker.lat).toBeCloseTo(centre.lat, 6);
  });

  it("flags an impossible accuracy value", async () => {
    const { match, hunter } = await setupMatch();
    const result = await upload(
      match.id,
      hunter,
      T0 + 5 * MIN + 10_000,
      ORGANISER,
      RULES_CONFIG.impossibleAccuracyMetres + 1,
    );
    expect(result.flagged).toBe(true);
    expect(result.suspiciousReason).toBe("impossible_accuracy");
  });
});

/* ------------------------------------------------------------------ *
 * Zone\n * ------------------------------------------------------------------ */

describe("out of zone", () => {
  it("warns, then drains, then eliminates", async () => {
    const { match, shadows } = await setupMatch();
    const player = shadows[0];
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };

    // Inside first.
    const inside = await upload(
      match.id,
      player,
      T0 + 5 * MIN + 10_000,
      centre,
    );
    expect(inside.breach?.status).toBe("inside");

    // Step outside (a plausible walking speed): warning and grace.
    const outside = atMetres(400, centre);
    const exit = await upload(match.id, player, T0 + 5 * MIN + 50_000, outside);
    expect(exit.breach?.outside).toBe(true);
    expect(exit.breach?.status).toBe("grace");
    expect(exit.breach?.graceSecondsLeft).toBeGreaterThan(0);

    // 70 s outside: past the 60 s grace, one drain tick per 10 s.
    const draining = await upload(match.id, player, T0 + 7 * MIN, outside);
    expect(draining.breach?.status).toBe("draining");
    expect(draining.breach?.drainTicksApplied).toBeGreaterThanOrEqual(1);

    const repos = getRepos();
    const scored = await repos.scores.listByPlayer(null, match.id, player.id);
    const drains = scored.filter((event) => event.kind === "zone_drain");
    expect(drains.length).toBeGreaterThanOrEqual(1);
    expect(drains[0].points).toBeLessThan(0);

    // Three minutes outside in total: eliminated.
    const eliminated = await upload(match.id, player, T0 + 9 * MIN, outside);
    expect(eliminated.breach?.status).toBe("eliminated");
    const after = await repos.players.findById(null, player.id);
    expect(after!.status).toBe("eliminated");
  });

  it("clears the warning when the player comes back inside", async () => {
    const { match, shadows } = await setupMatch();
    const player = shadows[0];
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };
    await upload(match.id, player, T0 + 5 * MIN + 10_000, atMetres(400, centre));
    const back = await upload(match.id, player, T0 + 5 * MIN + 50_000, centre);
    expect(back.breach?.status).toBe("inside");
    const row = await getRepos().players.findById(null, player.id);
    expect(row!.outsideSince).toBeNull();
    expect(row!.chargedDrainTicks).toBe(0);
  });

  it("refuses uploads before the head start", async () => {
    const { match, shadows } = await setupMatch();
    const early = await upload(match.id, shadows[0], T0 + 60_000);
    expect(early.stored).toBe(false);
    expect(early.reason).toBe("not_started");
  });
});

/* ------------------------------------------------------------------ *
 * Retention\n * ------------------------------------------------------------------ */

describe("position history retention", () => {
  it("deletes positions 24 hours after the match ends and keeps scores", async () => {
    const { match, shadows } = await setupMatch();
    const repos = getRepos();
    const player = shadows[0];
    // Measure from the zone centre, not the organiser: the centre is random.
    const centre = { lat: match.zoneCentre.lat, lng: match.zoneCentre.lng };
    const outsidePoint = atMetres(400, centre);
    await upload(match.id, player, T0 + 5 * MIN + 10_000, outsidePoint);
    await upload(match.id, player, T0 + 5 * MIN + 90_000, outsidePoint);

    const before = await repos.locations.latestByPlayer(null, match.id, player.id);
    expect(before).not.toBeNull();
    const scoresBefore = await repos.scores.listByPlayer(null, match.id, player.id);
    expect(scoresBefore.length).toBeGreaterThan(0);

    await repos.matches.patch(null, match.id, {
      status: "ended",
      endedAt: T0 - 25 * 60 * 60 * 1000,
    });

    const purged = await purgeExpiredPositions(null, T0);
    expect(purged.matches).toBe(1);
    expect(purged.deleted).toBeGreaterThan(0);

    expect(
      await repos.locations.latestByPlayer(null, match.id, player.id),
    ).toBeNull();
    const scoresAfter = await repos.scores.listByPlayer(null, match.id, player.id);
    expect(scoresAfter.length).toBe(scoresBefore.length);
  });

  it("keeps recent matches' positions", async () => {
    const { match, shadows } = await setupMatch();
    const repos = getRepos();
    await upload(match.id, shadows[0], T0 + 5 * MIN + 10_000);
    await repos.matches.patch(null, match.id, {
      status: "ended",
      endedAt: T0,
    });
    const purged = await purgeExpiredPositions(null, T0 + 60 * 60 * 1000);
    expect(purged.matches).toBe(0);
    expect(purged.deleted).toBe(0);
  });
});
