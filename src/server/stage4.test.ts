/**
 * Stage 4: the minute tick, auto-settlement, complaints, forced tags, removals,
 * pause and console authorization — run against the in-memory repositories so
 * the whole path is exercised without a deployment.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  claimInvite,
  createMatch,
  getLobby,
  joinMatch,
  startMatch,
} from "./index";
import { getRepos, setReposForTests } from "./providers";
import { memoryRepos } from "./testSupport/memoryRepos";
import { runMatchTick } from "./scheduler";
import { endMatch } from "./matchEnd";
import {
  dismissComplaint,
  forceTag,
  getConsoleView,
  pauseMatch,
  removePlayer,
  resumeMatch,
  statusAfterCapture,
} from "./console";
import { fileComplaint } from "./complaints";
import {
  complaintIsOverdue,
  complaintPolicy,
  matchClockNow,
  validateTagScan,
  RULES_CONFIG,
} from "../rules";
import type { MatchRow } from "./repos/matchRepo";

const ORGANISER = "user-organiser";
const COORD = { lat: 51.5074, lng: -0.1278 };

beforeEach(() => {
  setReposForTests(memoryRepos());
});

afterAll(() => {
  setReposForTests(null);
});

const MINUTE = 60_000;

async function setupMatch(playerCount = 6, durationMinutes = 90) {
  const created = await createMatch(null, {
    createdByUserId: ORGANISER,
    matchDurationMinutes: durationMinutes,
    organiserLat: COORD.lat,
    organiserLng: COORD.lng,
    invigilatorNames: ["Ines", "Kwame"],
  });

  for (let i = 0; i < playerCount; i += 1) {
    await joinMatch(null, {
      userId: `user-${i}`,
      roomCode: created.roomCode,
      callSign: `Player${i}`,
      displayName: `Player ${i}`,
      displayNameMode: "nickname",
    });
  }

  const started = await startMatch(null, {
    matchId: created.matchId,
    userId: ORGANISER,
    seed: 11,
  });

  return { created, started };
}

async function matchRow(matchId: string): Promise<MatchRow> {
  const match = await getRepos().matches.findById(null, matchId);
  if (!match) throw new Error("match missing");
  return match;
}

async function attachInvigilator(matchId: string, inviteCode: string) {
  await claimInvite(null, { userId: "user-invigilator", inviteCode });
  return "user-invigilator";
}

function baseSnapshot(overrides: Partial<Parameters<typeof validateTagScan>[0]> = {}) {
  return {
    nowMs: Date.now(),
    match: { status: "live" as const, startedAtMs: 0, endsAtMs: Date.now() + 10_000_000 },
    scanner: null,
    target: null,
    scannerLocation: null,
    targetLocation: null,
    config: RULES_CONFIG,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * Part A — the minute tick
 * ------------------------------------------------------------------ */

describe("alive points", () => {
  it("pays each completed minute exactly once", async () => {
    const { created, started } = await setupMatch(6);
    const repos = getRepos();
    const when = started.startedAt + (RULES_CONFIG.headStartMinutes + 2) * MINUTE;

    await runMatchTick(null, when);
    const first = await repos.scores.listByMatch(null, created.matchId);
    const firstAlive = first.filter((e) => e.kind === "shadow_alive");
    expect(firstAlive.length).toBeGreaterThan(0);

    // Same instant again: nothing new is written.
    await runMatchTick(null, when);
    const second = await repos.scores.listByMatch(null, created.matchId);
    expect(second.filter((e) => e.kind === "shadow_alive").length).toBe(
      firstAlive.length,
    );

    // One minute later: exactly one more minute per active Shadow.
    await runMatchTick(null, when + MINUTE);
    const third = await repos.scores.listByMatch(null, created.matchId);
    const thirdAlive = third.filter((e) => e.kind === "shadow_alive");
    const shadows = (await repos.players.listByMatch(null, created.matchId)).filter(
      (p) => p.role === "shadow" && p.status === "active",
    );
    expect(thirdAlive.length).toBe(firstAlive.length + shadows.length);

    // The ledger carries a unique ref per minute per player.
    const refs = new Set(thirdAlive.map((e) => `${e.playerId}:${e.refId}`));
    expect(refs.size).toBe(thirdAlive.length);
  });

  it("stops paying a Shadow once they are tagged", async () => {
    const { created, started } = await setupMatch(6);
    const repos = getRepos();
    const when = started.startedAt + (RULES_CONFIG.headStartMinutes + 2) * MINUTE;
    await runMatchTick(null, when);

    const shadows = (await repos.players.listByMatch(null, created.matchId)).filter(
      (p) => p.role === "shadow" && p.status === "active",
    );
    const victim = shadows[0];
    const paidBefore = (
      await repos.scores.listByMatch(null, created.matchId)
    ).filter(
      (e) => e.kind === "shadow_alive" && e.playerId === victim.id,
    ).length;
    await repos.players.patch(null, victim.id, {
      status: "spectator",
      taggedAt: when,
    });

    await runMatchTick(null, when + MINUTE);
    const paidAfter = (
      await repos.scores.listByMatch(null, created.matchId)
    ).filter(
      (e) => e.kind === "shadow_alive" && e.playerId === victim.id,
    ).length;
    expect(paidAfter).toBe(paidBefore);
  });
});

describe("auto settlement", () => {
  it("ends the match when the timer runs out and pays the survival bonus", async () => {
    const { created, started } = await setupMatch(6);
    const repos = getRepos();
    const endsAt = started.startedAt + 10 * MINUTE;
    await repos.matches.patch(null, created.matchId, { endsAt });

    await runMatchTick(null, endsAt + 1000);

    const match = await matchRow(created.matchId);
    expect(match.status).toBe("ended");
    expect(match.winner).toBe("shadows");

    const events = await repos.scores.listByMatch(null, created.matchId);
    const survival = events.filter((e) => e.kind === "survival_bonus");
    const activeShadows = (await repos.players.listByMatch(null, created.matchId)).filter(
      (p) => p.role === "shadow" && p.status === "active",
    );
    expect(survival.length).toBe(activeShadows.length);

    // Running the tick again changes nothing.
    await runMatchTick(null, endsAt + 2 * MINUTE);
    const again = await repos.scores.listByMatch(null, created.matchId);
    expect(
      again.filter((e) => e.kind === "survival_bonus").length,
    ).toBe(survival.length);
  });

  it("ends the match when no Shadow is active any more", async () => {
    const { created } = await setupMatch(6);
    const repos = getRepos();
    const players = await repos.players.listByMatch(null, created.matchId);
    for (const player of players) {
      if (player.role === "shadow") {
        await repos.players.patch(null, player.id, {
          status: "removed",
          taggedAt: Date.now(),
        });
      }
    }

    await runMatchTick(null, Date.now() + 20 * MINUTE);

    const match = await matchRow(created.matchId);
    expect(match.status).toBe("ended");
    expect(match.winner).toBe("hunters");

    const events = await repos.scores.listByMatch(null, created.matchId);
    const bonus = events.filter((e) => e.kind === "all_tagged_bonus");
    const hunters = players.filter((p) => p.role === "hunter");
    expect(bonus.length).toBe(hunters.length);
  });

  it("gives no survival bonus to a removed Shadow", async () => {
    const { created, started } = await setupMatch(6);
    const repos = getRepos();
    const players = await repos.players.listByMatch(null, created.matchId);
    const victim = players.find((p) => p.role === "shadow")!;
    await repos.players.patch(null, victim.id, { status: "removed" });

    const endsAt = started.startedAt + 10 * MINUTE;
    await repos.matches.patch(null, created.matchId, { endsAt });
    await runMatchTick(null, endsAt + 1000);

    const events = await repos.scores.listByMatch(null, created.matchId);
    expect(
      events.filter(
        (e) => e.kind === "survival_bonus" && e.playerId === victim.id,
      ).length,
    ).toBe(0);
  });

  it("settles only once when the organiser ends it early", async () => {
    const { created } = await setupMatch(6);
    const first = await endMatch(null, {
      matchId: created.matchId,
      force: true,
    });
    expect(first.alreadySettled).toBe(false);
    // Shadows are still in play, so they are the ones who survived.
    expect(first.winner).toBe("shadows");

    const second = await endMatch(null, {
      matchId: created.matchId,
      force: true,
    });
    expect(second.alreadySettled).toBe(true);

    const events = await getRepos().scores.listByMatch(null, created.matchId);
    const bonus = events.filter((e) => e.kind === "survival_bonus");
    const survivors = (
      await getRepos().players.listByMatch(null, created.matchId)
    ).filter((p) => p.role === "shadow" && p.status === "active");
    expect(bonus.length).toBe(survivors.length);
    expect((await matchRow(created.matchId)).status).toBe("ended");
  });
});

/* ------------------------------------------------------------------ *
 * Part A — flagged positions
 * ------------------------------------------------------------------ */

describe("tag validation", () => {
  it("rejects a scan when either position is flagged", () => {
    const now = Date.now();
    const scanner = {
      id: "s1",
      role: "hunter" as const,
      mode: "spectator" as const,
      status: "active" as const,
      taggedAtMs: null,
    };
    const target = {
      id: "t1",
      role: "shadow" as const,
      mode: "spectator" as const,
      status: "active" as const,
      taggedAtMs: null,
    };
    const here = {
      lat: 51.5,
      lng: -0.12,
      recordedAtMs: now,
      accuracyMetres: 8,
      pingIndex: 1,
    };

    const clean = validateTagScan(
      baseSnapshot({
        nowMs: now,
        scanner,
        target,
        scannerLocation: { ...here, suspicious: false },
        targetLocation: { ...here, suspicious: true },
      }),
    );
    expect(clean.ok).toBe(false);
    if (!clean.ok) expect(clean.code).toBe("flagged_location");

    const alsoClean = validateTagScan(
      baseSnapshot({
        nowMs: now,
        scanner,
        target,
        scannerLocation: { ...here, suspicious: true },
        targetLocation: { ...here, suspicious: false },
      }),
    );
    expect(alsoClean.ok).toBe(false);
    if (!alsoClean.ok) expect(alsoClean.code).toBe("flagged_location");

    const accepted = validateTagScan(
      baseSnapshot({
        nowMs: now,
        scanner,
        target,
        scannerLocation: { ...here, suspicious: false },
        targetLocation: { ...here, suspicious: false },
      }),
    );
    expect(accepted.ok).toBe(true);
  });

  it("still refuses stale or distant readings", () => {
    const now = Date.now();
    const scanner = {
      id: "s1",
      role: "hunter" as const,
      mode: "spectator" as const,
      status: "active" as const,
      taggedAtMs: null,
    };
    const target = {
      id: "t1",
      role: "shadow" as const,
      mode: "spectator" as const,
      status: "active" as const,
      taggedAtMs: null,
    };

    const stale = validateTagScan(
      baseSnapshot({
        nowMs: now,
        scanner,
        target,
        scannerLocation: {
          lat: 51.5,
          lng: -0.12,
          recordedAtMs: now - 45_000,
          accuracyMetres: 8,
          pingIndex: 1,
        },
        targetLocation: {
          lat: 51.5,
          lng: -0.12,
          recordedAtMs: now,
          accuracyMetres: 8,
          pingIndex: 1,
        },
      }),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("stale_location");
  });
});

/* ------------------------------------------------------------------ *
 * Complaint rules
 * ------------------------------------------------------------------ */

describe("complaint rules", () => {
  const hunter = { id: "h1", role: "hunter" as const, status: "active" as const };
  const shadow = { id: "s1", role: "shadow" as const, status: "active" as const };

  function policy(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    return complaintPolicy({
      nowMs: now,
      incidentAtMs: now,
      matchActive: true,
      complainant: hunter,
      target: shadow,
      existing: [],
      config: RULES_CONFIG,
      ...overrides,
    } as Parameters<typeof complaintPolicy>[0]);
  }

  it("accepts a fresh complaint", () => {
    expect(policy().ok).toBe(true);
  });

  it("refuses a complaint filed outside the window", () => {
    const now = Date.now();
    const verdict = policy({
      nowMs: now,
      incidentAtMs: now - (RULES_CONFIG.complaintFilingWindowMinutes + 1) * MINUTE,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("window_expired");
  });

  it("refuses a second open complaint for the same pair", () => {
    const now = Date.now();
    const verdict = policy({
      existing: [
        {
          complainantId: "h1",
          accusedId: "s1",
          status: "open",
          createdAtMs: now - MINUTE,
        },
      ],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("duplicate_open");
  });

  it("allows the same pair again once the first was resolved", () => {
    const now = Date.now();
    const verdict = policy({
      existing: [
        {
          complainantId: "h1",
          accusedId: "s1",
          status: "dismissed",
          createdAtMs: now - MINUTE,
        },
      ],
    });
    expect(verdict.ok).toBe(true);
  });

  it("rate limits one Hunter", () => {
    const now = Date.now();
    const existing = [1, 2, 3].map((index) => ({
      complainantId: "h1",
      accusedId: `other-${index}`,
      status: "dismissed" as const,
      createdAtMs: now - MINUTE,
    }));
    const verdict = policy({ existing });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("rate_limited");
  });

  it("marks an unanswered complaint overdue", () => {
    const now = Date.now();
    expect(
      complaintIsOverdue({
        nowMs: now + 1,
        responseDueAtMs: now,
        status: "open",
      }),
    ).toBe(true);
    expect(
      complaintIsOverdue({
        nowMs: now - 1,
        responseDueAtMs: now,
        status: "open",
      }),
    ).toBe(false);
    expect(
      complaintIsOverdue({
        nowMs: now + 10,
        responseDueAtMs: now,
        status: "dismissed",
      }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Console: authorization, forced tags, removals, pause
 * ------------------------------------------------------------------ */

describe("invigilator console", () => {
  it("refuses a non-invigilator for reads and for every action", async () => {
    const { created } = await setupMatch(6);

    await expect(
      getConsoleView(null, { matchId: created.matchId, userId: "stranger" }),
    ).rejects.toThrow(/invigilator/i);

    await expect(
      forceTag(null, {
        matchId: created.matchId,
        hunterId: "x",
        shadowId: "y",
        userId: "stranger",
        reason: "nope",
      }),
    ).rejects.toThrow(/invigilator/i);

    await expect(
      removePlayer(null, {
        matchId: created.matchId,
        playerId: "x",
        userId: "stranger",
        reason: "nope",
      }),
    ).rejects.toThrow(/invigilator/i);

    await expect(
      dismissComplaint(null, {
        matchId: created.matchId,
        complaintId: "c",
        userId: "stranger",
        reason: "nope",
      }),
    ).rejects.toThrow(/invigilator/i);
  });

  it("lets an invigilator read the console and shows both parties", async () => {
    const { created } = await setupMatch(6);
    const invite = created.invigilators[0].inviteCode;
    const userId = await attachInvigilator(created.matchId, invite);

    const view = await getConsoleView(null, {
      matchId: created.matchId,
      userId,
    });
    expect(view.players.length).toBe(6);
    expect(view.roomCode).toBe(created.roomCode);
    expect(view.complaints).toEqual([]);
    expect(view.audit).toEqual([]);
  });

  it("forces a tag that scores like a normal one and writes an audit row", async () => {
    const { created } = await setupMatch(6);
    const invite = created.invigilators[0].inviteCode;
    const userId = await attachInvigilator(created.matchId, invite);

    const players = await getRepos().players.listByMatch(null, created.matchId);
    const hunter = players.find((p) => p.role === "hunter")!;
    const shadow = players.find((p) => p.role === "shadow")!;

    const result = await forceTag(null, {
      matchId: created.matchId,
      hunterId: hunter.id,
      shadowId: shadow.id,
      userId,
      reason: "Refused to show the code.",
    });
    expect(result.points).toBeGreaterThan(0);

    const tags = await getRepos().tags.listByMatch(null, created.matchId);
    expect(tags.length).toBe(1);
    expect(tags[0].forced).toBe(true);
    expect(tags[0].scoredPoints).toBe(result.points);
    expect(tags[0].captureMode).toBe(shadow.mode);

    const tagged = await getRepos().players.findById(null, shadow.id);
    expect(tagged?.status).toBe("spectator");
    expect(tagged?.taggedAt).not.toBeNull();

    const events = await getRepos().scores.listByMatch(null, created.matchId);
    expect(
      events.filter(
        (e) => e.kind === "tag" && e.playerId === hunter.id,
      ).length,
    ).toBe(1);

    const view = await getConsoleView(null, {
      matchId: created.matchId,
      userId,
    });
    expect(view.audit.length).toBe(1);
    expect(view.audit[0].action).toBe("forced_tag");
    expect(view.audit[0].actorName).toBe(created.invigilators[0].displayName);
    expect(view.audit[0].reason).toBe("Refused to show the code.");
  });

  it("removes a player, logs it, and ends the match when no Shadow is left", async () => {
    const { created } = await setupMatch(6);
    const invite = created.invigilators[0].inviteCode;
    const userId = await attachInvigilator(created.matchId, invite);

    const players = await getRepos().players.listByMatch(null, created.matchId);
    const shadows = players.filter((p) => p.role === "shadow");
    expect(shadows.length).toBeGreaterThan(1);

    for (const shadow of shadows.slice(1)) {
      await removePlayer(null, {
        matchId: created.matchId,
        playerId: shadow.id,
        userId,
        reason: "Non-cooperating.",
      });
    }
    expect(
      (await getRepos().players.findById(null, shadows[1].id))?.status,
    ).toBe("removed");

    const match = await matchRow(created.matchId);
    expect(match.status).not.toBe("ended");

    await removePlayer(null, {
      matchId: created.matchId,
      playerId: shadows[0].id,
      userId,
      reason: "Last Shadow removed.",
    });

    const ended = await matchRow(created.matchId);
    expect(ended.status).toBe("ended");
    expect(ended.winner).toBe("hunters");

    const events = await getRepos().scores.listByMatch(null, created.matchId);
    expect(
      events.filter(
        (e) => e.kind === "survival_bonus" && e.playerId === shadows[0].id,
      ).length,
    ).toBe(0);

    const view = await getConsoleView(null, {
      matchId: created.matchId,
      userId,
    });
    expect(view.audit.filter((a) => a.action === "player_removed").length).toBe(
      shadows.length,
    );
  });

  it("freezes the clock while paused and runs again after resume", async () => {
    const { created, started } = await setupMatch(6);
    const repos = getRepos();

    await pauseMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      reason: "Traffic.",
    });

    const paused = await matchRow(created.matchId);
    expect(paused.pausedAt).not.toBeNull();

    const during = started.startedAt + (RULES_CONFIG.headStartMinutes + 3) * MINUTE;
    await runMatchTick(null, during);
    expect((await matchRow(created.matchId)).aliveUpToMinute).toBe(-1);

    const resumed = await resumeMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      reason: "Clear.",
    });
    expect(resumed.pausedTotalMs).toBeGreaterThanOrEqual(0);

    await runMatchTick(null, during);
    expect((await matchRow(created.matchId)).aliveUpToMinute).toBeGreaterThan(-1);

    // The pure clock helper skips paused time entirely.
    expect(
      matchClockNow({ nowMs: 1_000_000, pausedAtMs: 500_000, pausedTotalMs: 0 }),
    ).toBe(500_000);
    expect(
      matchClockNow({ nowMs: 1_000_000, pausedAtMs: null, pausedTotalMs: 250_000 }),
    ).toBe(750_000);
    expect(repos).toBeDefined();
  });

  it("refuses a pause from anyone who is not staff", async () => {
    const { created } = await setupMatch(6);
    await expect(
      pauseMatch(null, {
        matchId: created.matchId,
        userId: "player-0",
        reason: "cheating",
      }),
    ).rejects.toThrow(/organiser|invigilator/i);
  });
});

/* ------------------------------------------------------------------ *
 * Complaint filing through the service
 * ------------------------------------------------------------------ */

describe("filing a complaint", () => {
  it("files against an active Shadow and refuses a second filing", async () => {
    const { created, started } = await setupMatch(6);
    const when = started.startedAt + (RULES_CONFIG.headStartMinutes + 1) * MINUTE;
    const repos = getRepos();

    // Make the match live from the clock's point of view.
    await repos.matches.patch(null, created.matchId, { status: "live" });

    const players = await repos.players.listByMatch(null, created.matchId);
    const hunter = players.find((p) => p.role === "hunter")!;
    const shadow = players.find((p) => p.role === "shadow")!;

    const complaint = await fileComplaint(null, {
      matchId: created.matchId,
      userId: hunter.userId,
      accusedId: shadow.id,
      note: "Would not show the code.",
      nowMs: when,
    });
    expect(complaint.status).toBe("open");
    expect(complaint.responseDueAt - complaint.createdAt).toBe(
      RULES_CONFIG.complaintResponseMinutes * MINUTE,
    );

    await expect(
      fileComplaint(null, {
        matchId: created.matchId,
        userId: hunter.userId,
        accusedId: shadow.id,
        nowMs: when,
      }),
    ).rejects.toThrow(/already/i);

    // A Hunter cannot report another Hunter.
    const otherHunter = players.find(
      (p) => p.role === "hunter" && p.id !== hunter.id,
    )!;
    await expect(
      fileComplaint(null, {
        matchId: created.matchId,
        userId: hunter.userId,
        accusedId: otherHunter.id,
        nowMs: when,
      }),
    ).rejects.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * Capture choices
 * ------------------------------------------------------------------ */

describe("capture modes", () => {
  it("maps each choice onto a status", () => {
    expect(statusAfterCapture("spectator")).toBe("spectator");
    expect(statusAfterCapture("hunter")).toBe("tagged");
    expect(statusAfterCapture("helper")).toBe("tagged");
  });

  it("only a converted Hunter may scan, and never scores after capture", () => {
    const now = Date.now();
    const captured = (mode: "hunter" | "helper") => ({
      id: "c1",
      role: "shadow" as const,
      mode,
      status: "tagged" as const,
      taggedAtMs: now - 1000,
    });
    const target = {
      id: "t1",
      role: "shadow" as const,
      mode: "spectator" as const,
      status: "active" as const,
      taggedAtMs: null,
    };
    const here = {
      lat: 51.5,
      lng: -0.12,
      recordedAtMs: now,
      accuracyMetres: 8,
      pingIndex: 1,
    };

    // A Helper is not a Hunter and cannot land a tag at all.
    const asHelper = validateTagScan(
      baseSnapshot({
        nowMs: now,
        scanner: captured("helper"),
        target,
        scannerLocation: here,
        targetLocation: here,
      }),
    );
    expect(asHelper.ok).toBe(false);
    if (!asHelper.ok) expect(asHelper.code).toBe("scanner_not_hunter");

    // A converted Hunter can tag, but earns nothing for it.
    const asConverted = validateTagScan(
      baseSnapshot({
        nowMs: now,
        scanner: captured("hunter"),
        target,
        scannerLocation: here,
        targetLocation: here,
      }),
    );
    expect(asConverted.ok).toBe(true);
    if (asConverted.ok) expect(asConverted.scores).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Lobby still exposes the player's own QR and nothing else
 * ------------------------------------------------------------------ */

describe("personal card", () => {
  it("returns the player's own QR token to them only", async () => {
    const { created } = await setupMatch(4);
    const lobby = await getLobby(null, {
      userId: "user-0",
      roomCode: created.roomCode,
    });
    expect(lobby.me.qrToken).toMatch(/^SH-/);

    const other = await getLobby(null, {
      userId: "user-1",
      roomCode: created.roomCode,
    });
    expect(other.me.qrToken).not.toBe(lobby.me.qrToken);
    expect(other.me.playerId).not.toBe(lobby.me.playerId);
  });
});
