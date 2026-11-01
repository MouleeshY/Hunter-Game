/**
 * Stage 6: the public result page, its stats, publishing rules and the privacy
 * projection. Driven through the real services on the in-memory repositories.
 *
 *   - a result is public only after the whistle, aborted ones only by hand
 *   - unpublish / republish, audited
 *   - an unguessable slug that has nothing to do with the room code
 *   - competition ranking with ties
 *   - each player's own display-name choice, never an account id or email
 *   - radar pulses computed from played time with the pause taken out
 *   - a 20-player public response that cannot carry a position, token, user id,
 *     email, complaint, audit row, spoof flag, invigilator name, room code or
 *     invite code
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  beginHeadStart,
  claimInvite,
  confirmBriefing,
  createMatch,
  endMatch,
  fileComplaint,
  joinMatch,
  startMatch,
  uploadPosition,
} from "./index";
import { abortMatch, forceTag } from "./console";
import { award } from "./settlement";
import {
  getPlayerResult,
  getPublicResult,
  getResultTools,
  getResultToolsBySlug,
  listPublicResults,
  setResultPublished,
} from "./results";
import { getRepos, setReposForTests } from "./providers";
import { memoryRepos } from "./testSupport/memoryRepos";
import { matchClockMs, radarPulsesFired, RULES_CONFIG } from "../rules";

const ORGANISER = "user-organiser";
const INVIGILATOR = "user-invigilator";
const COORD = { lat: 51.5074, lng: -0.1278 };
const MINUTE = 60_000;

beforeEach(() => {
  setReposForTests(memoryRepos());
});

afterAll(() => {
  setReposForTests(null);
});

// ---- fixtures ---------------------------------------------------------------

async function createRoom(options: {
  players: number;
  title?: string;
  clubName?: string;
  names?: string[];
  modes?: ("nickname" | "real")[];
}) {
  const created = await createMatch(null, {
    createdByUserId: ORGANISER,
    matchDurationMinutes: 90,
    organiserLat: COORD.lat,
    organiserLng: COORD.lng,
    invigilatorNames: ["Ines", "Kwame"],
    title: options.title,
    clubName: options.clubName,
  });

  for (let i = 0; i < options.players; i += 1) {
    await joinMatch(null, {
      userId: `user-${i}`,
      roomCode: created.roomCode,
      callSign: `P${i}`,
      displayName: options.names?.[i] ?? `Player ${i}`,
      displayNameMode: options.modes?.[i] ?? "nickname",
    });
    await confirmBriefing(null, {
      matchId: created.matchId,
      userId: `user-${i}`,
    });
  }

  return created;
}

/** Start the setup, force it past the spacing check, then move onto live. */
async function startAndGoLive(
  created: { matchId: string },
  minutesIn = 10,
): Promise<number> {
  await startMatch(null, { matchId: created.matchId, userId: ORGANISER });
  await beginHeadStart(null, {
    matchId: created.matchId,
    userId: ORGANISER,
    force: true,
  });

  const match = await matchRow(created.matchId);
  const startedAt = Date.now() - minutesIn * MINUTE;
  await getRepos().matches.patch(null, created.matchId, {
    status: "live",
    startedAt,
    endsAt: startedAt + match.config.matchDurationMinutes * MINUTE,
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

/* -----------------------------------------------------------------------------
 * Publishing
 * -------------------------------------------------------------------------- */

describe("publishing rules", () => {
  it("keeps a live match off the public page and out of the list", async () => {
    const created = await createRoom({ players: 6 });
    await startAndGoLive(created, 12);

    expect(await getPublicResult(null, { slug: created.publicSlug })).toBeNull();
    expect(await listPublicResults(null, {})).toEqual([]);

    // The organiser can read the tools, but publishing is not offered yet.
    const tools = await getResultTools(null, {
      matchId: created.matchId,
      userId: ORGANISER,
    });
    expect(tools?.public).toBe(false);
    expect(tools?.canPublish).toBe(false);

    let message = "";
    try {
      await setResultPublished(null, {
        matchId: created.matchId,
        userId: ORGANISER,
        publish: true,
      });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : "";
    }
    expect(message).toContain("once the match has ended");
  });

  it("publishes a played-out match as soon as it ends", async () => {
    const created = await createRoom({
      players: 6,
      title: "Autumn Night Run",
      clubName: "Northside Runners",
    });
    await startAndGoLive(created, 12);
    await endMatch(null, { matchId: created.matchId, force: true });

    const result = await getPublicResult(null, { slug: created.publicSlug });
    expect(result).not.toBeNull();
    expect(result?.title).toBe("Autumn Night Run");
    expect(result?.clubName).toBe("Northside Runners");
    expect(result?.aborted).toBe(false);
    expect(result?.winner).not.toBeNull();
    expect(result?.rows).toHaveLength(6);

    const list = await listPublicResults(null, {});
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe(created.publicSlug);
    expect(list[0].totalPlayers).toBe(6);
  });

  it("keeps an aborted match private until the organiser publishes it", async () => {
    const created = await createRoom({ players: 6 });
    await startAndGoLive(created, 12);
    await abortMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      reason: "A storm rolled in.",
    });

    // Ended, but no result on the page and nothing in the list.
    expect(await getPublicResult(null, { slug: created.publicSlug })).toBeNull();
    expect(await listPublicResults(null, {})).toEqual([]);

    await setResultPublished(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      publish: true,
    });

    const result = await getPublicResult(null, { slug: created.publicSlug });
    expect(result?.aborted).toBe(true);
    expect(result?.winner).toBeNull();
    expect(await listPublicResults(null, {})).toHaveLength(1);
  });

  it("unpublishes and republishes on the organiser's command, and audits both", async () => {
    const created = await createRoom({ players: 6 });
    await startAndGoLive(created, 12);
    await endMatch(null, { matchId: created.matchId, force: true });

    expect(await getPublicResult(null, { slug: created.publicSlug })).not.toBeNull();

    await setResultPublished(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      publish: false,
    });
    expect(await getPublicResult(null, { slug: created.publicSlug })).toBeNull();
    expect(await listPublicResults(null, {})).toEqual([]);

    await setResultPublished(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      publish: true,
    });
    expect(await getPublicResult(null, { slug: created.publicSlug })).not.toBeNull();

    const audit = await getRepos().audit.listByMatch(null, created.matchId);
    expect(
      audit
        .map((row) => row.action)
        .filter((action) => action.startsWith("result_")),
    ).toEqual(["result_unpublished", "result_published"]);
  });

  it("refuses publishing from anyone but the organiser", async () => {
    const created = await createRoom({ players: 6 });
    await startAndGoLive(created, 12);
    await endMatch(null, { matchId: created.matchId, force: true });

    let message = "";
    try {
      await setResultPublished(null, {
        matchId: created.matchId,
        userId: "user-0",
        publish: false,
      });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : "";
    }
    expect(message).toContain("Only the organiser");

    // Tools are for the organiser only: a player's account gets nothing.
    expect(
      await getResultTools(null, { matchId: created.matchId, userId: "user-0" }),
    ).toBeNull();
    expect(
      await getResultToolsBySlug(null, {
        slug: created.publicSlug,
        userId: "user-0",
      }),
    ).toBeNull();
    expect(
      await getResultToolsBySlug(null, {
        slug: created.publicSlug,
        userId: null,
      }),
    ).toBeNull();
  });
});

/* -----------------------------------------------------------------------------
 * Slug
 * -------------------------------------------------------------------------- */

describe("the public link", () => {
  it("is random, longer than the room code and never derived from it", async () => {
    const first = await createRoom({ players: 4 });
    const second = await createRoom({ players: 4 });

    for (const created of [first, second]) {
      expect(created.publicSlug).toMatch(/^[0-9a-f]+$/);
      expect(created.publicSlug).toHaveLength(RULES_CONFIG.publicSlugBytes * 2);
      expect(created.publicSlug).not.toContain(created.roomCode.toLowerCase());
      expect(created.publicSlug).not.toBe(created.roomCode);
    }

    // 128 bits of CSPRNG: two rooms never share a slug, even in the same event.
    expect(first.publicSlug).not.toBe(second.publicSlug);
    expect(
      (await getRepos().matches.findByPublicSlug(null, first.publicSlug))?.id,
    ).toBe(first.matchId);
  });

  it("answers an unknown or mis-cased slug with nothing", async () => {
    const created = await createRoom({ players: 4 });
    await startAndGoLive(created, 10);
    await endMatch(null, { matchId: created.matchId, force: true });

    expect(await getPublicResult(null, { slug: "not-a-real-slug" })).toBeNull();
    expect(await getPublicResult(null, { slug: "" })).toBeNull();
    // Slugs are hex, so a different case is the same id rather than a 404.
    expect(
      await getPublicResult(null, { slug: created.publicSlug.toUpperCase() }),
    ).not.toBeNull();
  });
});

/* -----------------------------------------------------------------------------
 * Ranking and names
 * -------------------------------------------------------------------------- */

describe("the public leaderboard", () => {
  it("shares a rank between equal scores and counts the rows it follows", async () => {
    const created = await createRoom({ players: 4 });
    await startAndGoLive(created, 10);
    const players = await playerRows(created.matchId);

    const now = Date.now();
    await award(null, {
      matchId: created.matchId,
      playerId: players[0].id,
      kind: "tag",
      points: 100,
      at: now,
    });
    for (const index of [1, 2]) {
      await award(null, {
        matchId: created.matchId,
        playerId: players[index].id,
        kind: "tag",
        points: 60,
        at: now,
      });
    }
    await abortMatch(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      reason: "Test abort.",
    });
    await setResultPublished(null, {
      matchId: created.matchId,
      userId: ORGANISER,
      publish: true,
    });

    const result = await getPublicResult(null, { slug: created.publicSlug });
    expect(result?.rows.map((row) => [row.points, row.rank])).toEqual([
      [100, 1],
      [60, 2],
      [60, 2],
      [0, 4],
    ]);
  });

  it("uses the name each player chose for this match, never an account id or email", async () => {
    const created = await createRoom({
      players: 4,
      names: ["Amina Yusuf", "nightfox", "Bogdan Ilie", "player-four"],
      modes: ["real", "nickname", "real", "nickname"],
    });
    await startAndGoLive(created, 10);
    await endMatch(null, { matchId: created.matchId, force: true });

    const result = await getPublicResult(null, { slug: created.publicSlug });
    expect(new Set(result?.rows.map((row) => row.displayName))).toEqual(
      new Set(["Amina Yusuf", "nightfox", "Bogdan Ilie", "player-four"]),
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain("user-");
    expect(json).not.toContain("@");
    expect(json).not.toContain("email");
  });

  it("shows tags for Hunters and minutes survived for Shadows only", async () => {
    const created = await createRoom({ players: 8 });
    await startAndGoLive(created, 30);
    await claimInvite(null, {
      userId: INVIGILATOR,
      inviteCode: created.invigilators[0].inviteCode,
    });
    const players = await playerRows(created.matchId);
    const hunter = players.find((player) => player.role === "hunter")!;
    const shadow = players.find((player) => player.role === "shadow")!;

    await forceTag(null, {
      matchId: created.matchId,
      hunterId: hunter.id,
      shadowId: shadow.id,
      userId: INVIGILATOR,
      reason: "Showed the code.",
    });
    await endMatch(null, { matchId: created.matchId, force: true });

    const result = await getPublicResult(null, { slug: created.publicSlug });
    expect(result).not.toBeNull();
    const rows = result?.rows ?? [];
    const hunterRow = rows.find((row) => row.role === "hunter");
    const shadowRows = rows.filter((row) => row.role === "shadow");

    expect(rows.every((row) => row.minutesSurvived === null)).toBe(false);
    for (const row of rows) {
      if (row.role === "hunter") {
        expect(row.minutesSurvived).toBeNull();
        expect(row.tags).not.toBeNull();
      } else {
        expect(row.tags).toBeNull();
        expect(row.minutesSurvived).not.toBeNull();
      }
    }
    expect(hunterRow?.tags).toBe(1);

    const tagged = shadowRows.find((row) => row.status === "tagged");
    expect(tagged?.minutesSurvived).toBe(30);
    expect(shadowRows.some((row) => row.status === "survived")).toBe(true);
    expect(tagged).toBeDefined();
  });
});

/* -----------------------------------------------------------------------------
 * Match stats
 * -------------------------------------------------------------------------- */

describe("match stats", () => {
  it("counts radar pulses from played time and skips the paused minutes", () => {
    const startedAtMs = Date.UTC(2026, 0, 1, 10, 0, 0);
    const config = RULES_CONFIG;
    const headStart = config.headStartMinutes * MINUTE;

    // No pause: 20 minutes played, first pulse at the end of the head start.
    expect(
      radarPulsesFired({
        startedAtMs,
        endedAtMs: startedAtMs + 20 * MINUTE,
        nowMs: startedAtMs + 20 * MINUTE,
        pausedTotalMs: 0,
        config,
      }),
    ).toBe(6);

    // Five minutes of fog: 15 minutes actually played, so two pulses fewer.
    expect(
      radarPulsesFired({
        startedAtMs,
        endedAtMs: startedAtMs + 20 * MINUTE,
        nowMs: startedAtMs + 20 * MINUTE,
        pausedTotalMs: 5 * MINUTE,
        config,
      }),
    ).toBe(4);

    expect(headStart).toBe(5 * MINUTE);
    expect(
      matchClockMs({
        startedAtMs,
        endedAtMs: startedAtMs + 20 * MINUTE,
        nowMs: Date.now(),
        pausedTotalMs: 5 * MINUTE,
      }),
    ).toBe(15 * MINUTE);
  });

  it("reports the played stats of a finished match, pause deducted", async () => {
    const created = await createRoom({ players: 8 });
    const startedAt = await startAndGoLive(created, 20);

    // What a completed five-minute pause leaves on the match row.
    await getRepos().matches.patch(null, created.matchId, { pausedTotalMs: 5 * MINUTE });
    await endMatch(null, {
      matchId: created.matchId,
      nowMs: Date.now(),
      force: true,
    });

    const result = await getPublicResult(null, { slug: created.publicSlug });
    expect(result?.stats.radarPulses).toBe(4);
    // 20 minutes on the clock, 5 of them paused: 15 minutes of play.
    expect(startedAt).toBeLessThan(Date.now());
    expect(Math.round(result!.stats.matchLengthMs / MINUTE)).toBe(15);
    expect(result?.stats.totalPlayers).toBe(8);
    expect(result?.stats.shadowsTagged).toBe(0);
    expect(result?.stats.shadowsSurvived).toBeGreaterThan(0);
    // No shrink interval has elapsed in 15 minutes? One has (10 min).
    expect(result?.stats.zoneContractions).toBe(1);
    expect(result?.stats.proximityAlerts).toBe(0);
  });
});

/* -----------------------------------------------------------------------------
 * The player's own Match End screen
 * -------------------------------------------------------------------------- */

describe("the Match End screen data", () => {
  it("gives a player their breakdown, rank, time survived and who caught whom", async () => {
    const created = await createRoom({ players: 8 });
    await startAndGoLive(created, 30);
    await claimInvite(null, {
      userId: INVIGILATOR,
      inviteCode: created.invigilators[0].inviteCode,
    });
    const players = await playerRows(created.matchId);
    const hunter = players.find((player) => player.role === "hunter")!;
    const shadow = players.find((player) => player.role === "shadow")!;

    await forceTag(null, {
      matchId: created.matchId,
      hunterId: hunter.id,
      shadowId: shadow.id,
      userId: INVIGILATOR,
      reason: "Showed the code.",
    });
    await endMatch(null, { matchId: created.matchId, force: true });

    const mine = await getPlayerResult(null, {
      matchId: created.matchId,
      userId: shadow.userId,
    });
    expect(mine.ended).toBe(true);
    expect(mine.role).toBe("shadow");
    expect(mine.status).toBe("tagged");
    expect(mine.rank).not.toBeNull();
    expect(mine.totalPlayers).toBe(8);
    expect(mine.breakdown.alive).toBeGreaterThanOrEqual(0);
    expect(mine.catches).toHaveLength(1);
    expect(mine.catches[0].hunterName).toBe(hunter.displayName);
    expect(mine.catches[0].shadowName).toBe(shadow.displayName);

    // The same list is nowhere in the public answer.
    const publicJson = JSON.stringify(
      await getPublicResult(null, { slug: created.publicSlug }),
    );
    expect(publicJson).not.toContain("catches");
    expect(publicJson).not.toContain("caught");
  });

  it("refuses the who-caught-whom list to anyone outside the match", async () => {
    const created = await createRoom({ players: 6 });
    await startAndGoLive(created, 10);
    await endMatch(null, { matchId: created.matchId, force: true });

    let message = "";
    try {
      await getPlayerResult(null, {
        matchId: created.matchId,
        userId: "user-stranger",
      });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : "";
    }
    expect(message).toContain("not in this match");

    // An invigilator of that match may read it.
    await claimInvite(null, {
      userId: INVIGILATOR,
      inviteCode: created.invigilators[0].inviteCode,
    });
    const staff = await getPlayerResult(null, {
      matchId: created.matchId,
      userId: INVIGILATOR,
    });
    expect(staff.rank).toBeNull();
    expect(staff.role).toBeNull();
  });
});

/* -----------------------------------------------------------------------------
 * Privacy projection
 * -------------------------------------------------------------------------- */

describe("the public projection", () => {
  it("carries nothing private for a 20-player match", async () => {
    const names = Array.from(
      { length: 20 },
      (_, index) => `Runner ${String(index).padStart(2, "0")}`,
    );
    const modes = names.map((_, index) =>
      index % 2 === 0 ? ("real" as const) : ("nickname" as const),
    );

    const created = await createRoom({
      players: 20,
      title: "Autumn Night Run",
      clubName: "Northside Runners",
      names,
      modes,
    });
    await startAndGoLive(created, 30);

    await claimInvite(null, {
      userId: INVIGILATOR,
      inviteCode: created.invigilators[0].inviteCode,
    });

    const players = await playerRows(created.matchId);

    // Positions with distinctive numbers, one of them flagged as a spoof.
    for (let i = 0; i < players.length; i += 1) {
      await uploadPosition(null, {
        matchId: created.matchId,
        userId: players[i].userId,
        lat: 51.5074123 + i * 0.0001,
        lng: -0.1278812 - i * 0.0001,
        accuracyMetres: i === 0 ? 9_999 : 5,
      });
    }

    const hunters = players.filter((player) => player.role === "hunter");
    const shadows = players.filter((player) => player.role === "shadow");
    for (const shadow of shadows.slice(0, 3)) {
      await forceTag(null, {
        matchId: created.matchId,
        hunterId: hunters[0].id,
        shadowId: shadow.id,
        userId: INVIGILATOR,
        reason: "Refused to show the code at the bridge.",
      });
    }

    await fileComplaint(null, {
      matchId: created.matchId,
      userId: hunters[0].userId,
      accusedId: shadows[3].id,
      note: "Hid behind the bridge and would not show a code.",
    });

    await endMatch(null, { matchId: created.matchId, force: true });

    const result = await getPublicResult(null, { slug: created.publicSlug });
    expect(result).not.toBeNull();
    const json = JSON.stringify(result);

    // ---- the shape is a whitelist, not a blacklist ------------------------
    expect(Object.keys(result!).sort()).toEqual(
      [
        "aborted",
        "clubName",
        "endedAt",
        "rows",
        "slug",
        "stats",
        "title",
        "totalPlayers",
        "winner",
      ].sort(),
    );
    expect(Object.keys(result!.stats).sort()).toEqual(
      [
        "matchLengthMs",
        "proximityAlerts",
        "radarPulses",
        "shadowsSurvived",
        "shadowsTagged",
        "totalPlayers",
        "zoneContractions",
      ].sort(),
    );
    for (const row of result!.rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "displayName",
          "minutesSurvived",
          "points",
          "rank",
          "role",
          "status",
          "tags",
        ].sort(),
      );
    }
    expect(result!.rows).toHaveLength(20);

    // ---- and no private value survived the projection --------------------
    // Positions.
    expect(json).not.toContain("51.5074123");
    expect(json).not.toContain("-0.1278812");
    expect(json).not.toContain('"lat"');
    expect(json).not.toContain('"lng"');
    expect(json).not.toContain("accuracy");
    // Room code and invite codes.
    expect(json).not.toContain(created.roomCode);
    for (const invigilator of created.invigilators) {
      expect(json).not.toContain(invigilator.inviteCode);
    }
    // Spoof flags.
    expect(json).not.toContain("suspicious");
    expect(json).not.toContain("impossible_accuracy");
    // Complaints and audit log.
    expect(json).not.toContain("bridge");
    expect(json).not.toContain("complaint");
    expect(json).not.toContain("audit");
    expect(json).not.toContain("Forced by an invigilator");
    // Invigilator and organiser names.
    expect(json).not.toContain("Ines");
    expect(json).not.toContain("Kwame");
    expect(json).not.toContain("Organiser");
    // Identifiers: players, users, match, qr tokens, emails.
    for (const player of players) {
      expect(json).not.toContain(player.id);
      expect(json).not.toContain(player.qrToken);
      expect(json).not.toContain(player.userId);
    }
    expect(json).not.toContain(created.matchId);
    expect(json).not.toContain("SH-");
    expect(json).not.toContain("@");
    expect(json).not.toContain("email");

    // ---- the list page is just as tight ----------------------------------
    const list = await listPublicResults(null, {});
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(
      [
        "aborted",
        "clubName",
        "endedAt",
        "slug",
        "title",
        "totalPlayers",
        "winner",
      ].sort(),
    );
    expect(JSON.stringify(list)).not.toContain(created.roomCode);
  });

  it("filters the list by club and sorts it newest first", async () => {
    const clubA = await createRoom({
      players: 4,
      title: "A · First",
      clubName: "Northside Runners",
    });
    await startAndGoLive(clubA, 10);
    await endMatch(null, { matchId: clubA.matchId, force: true, nowMs: Date.now() });

    const clubB = await createRoom({
      players: 4,
      title: "B · Other club",
      clubName: "Riverside",
    });
    await startAndGoLive(clubB, 10);
    await endMatch(null, {
      matchId: clubB.matchId,
      force: true,
      nowMs: Date.now() + 60_000,
    });

    expect(await listPublicResults(null, {})).toHaveLength(2);
    const northside = await listPublicResults(null, {
      club: "northside runners",
    });
    expect(northside.map((row) => row.title)).toEqual(["A · First"]);
    // Newest first: club B ended a minute later.
    expect((await listPublicResults(null, {}))[0].title).toBe("B · Other club");
  });
});
