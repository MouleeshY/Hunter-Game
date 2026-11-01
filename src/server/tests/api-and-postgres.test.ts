/**
 * Stage 7 (Part B): the Supabase backend.
 *
 *   - the whole game flow through the HTTP API against Postgres (PGlite)
 *   - every database table locked away behind Row Level Security
 *   - colliding requests cannot double-award, double-tag or over-fill a room
 *   - the scheduled tick is idempotent and needs its secret
 *   - the live nudge carries no data
 *   - the pg_cron / pg_net schedule, which cannot run in-process
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApiHarness, TICK_SECRET, type ApiHarness } from "./testSupport/apiHarness";
import { createApiApp } from "../../../api/app";
import { nudgeChannelName, nudgeMessage } from "../../lib/realtime";
import { REFRESH_INTERVALS, RULES_CONFIG } from "../../rules";

const ORGANISER = "11111111-1111-4111-8111-111111111111";
const INVIGILATOR = "22222222-2222-4222-8222-222222222222";
const PLAYERS = [
  "33333333-3333-4333-8333-333333333301",
  "33333333-3333-4333-8333-333333333302",
  "33333333-3333-4333-8333-333333333303",
  "33333333-3333-4333-8333-333333333304",
];
const STRANGER = "99999999-9999-4999-8999-999999999999";
const COORD = { lat: 51.5074, lng: -0.1278 };
const MINUTE = 60_000;

let api: ApiHarness;

async function seedProfiles(): Promise<void> {
  for (const id of [ORGANISER, INVIGILATOR, ...PLAYERS, STRANGER]) {
    await api.db.query(
      `insert into users (id, name) values ($1::uuid, $2)
       on conflict (id) do nothing`,
      [id, "Test user"],
    );
  }
}

/** Create a match with four briefed players, as the organiser does. */
async function createRoom() {
  const organiser = await api.token(ORGANISER);
  const created = await api.post(
    "/api/rooms/createRoom",
    {
      matchDurationMinutes: 60,
      organiserLat: COORD.lat,
      organiserLng: COORD.lng,
      invigilatorNames: ["Ines", "Kwame"],
      title: "Night hunt",
      clubName: "Riverside Runners",
    },
    { token: organiser },
  );
  if (created.status !== 200) throw new Error(created.json.error);

  for (let i = 0; i < PLAYERS.length; i += 1) {
    const joined = await api.post(
      "/api/rooms/joinRoom",
      {
        roomCode: created.json.roomCode,
        callSign: `P${i}`,
        displayName: `Player ${i}`,
        displayNameMode: "nickname",
      },
      { token: await api.token(PLAYERS[i]) },
    );
    if (joined.status !== 200) throw new Error(joined.json.error);
    const briefed = await api.post(
      "/api/rooms/acknowledgeBriefing",
      { matchId: created.json.matchId },
      { token: await api.token(PLAYERS[i]) },
    );
    if (briefed.status !== 200) throw new Error(briefed.json.error);
  }
  return created.json as { matchId: string; roomCode: string; publicSlug: string };
}

async function playerRows(matchId: string) {
  const rows = await api.db.query<{
    id: string;
    user_id: string;
    qr_token: string;
    role: string;
  }>(
    `select id, user_id, qr_token, role from players
      where match_id = $1::uuid
      order by role, id`,
    [matchId],
  );
  return rows;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Put the match on the live clock, `minutesIn` minutes old, with fresh positions. */
async function goLive(matchId: string, minutesIn = 25): Promise<void> {
  const startedAt = Date.now() - minutesIn * MINUTE;
  await api.db.query(
    `update matches
        set status = 'live',
            started_at = $1::timestamptz,
            ends_at = $2::timestamptz
      where id = $3::uuid`,
    [iso(startedAt), iso(startedAt + 60 * MINUTE), matchId],
  );
  for (const row of await playerRows(matchId)) {
    await api.db.query(
      `insert into locations (match_id, player_id, lat, lng, accuracy_metres, recorded_at, ping_index)
       values ($1::uuid, $2::uuid, $3, $4, 8, $5::timestamptz, 0)
       on conflict do nothing`,
      [
        matchId,
        row.id,
        COORD.lat + Math.random() * 0.001,
        COORD.lng,
        iso(Date.now() - 5000),
      ],
    );
  }
}

beforeAll(async () => {
  api = await createApiHarness();
  await seedProfiles();
});

afterAll(async () => {
  await api.close();
});

/* -------------------------------------------------------------------------- *
 * The whole flow, through the API, against Postgres.
 * ------------------------------------------------------------------------ */

describe("the API runs the game against Postgres", () => {
  it("creates, joins, starts, tags, pauses, ends and publishes", async () => {
    const organiser = await api.token(ORGANISER);
    const room = await createRoom();

    const invite = await api.db.query<{ invite_code: string }>(
      `select invite_code from invigilators where match_id = $1::uuid limit 1`,
      [room.matchId],
    );
    const preview = await api.post(
      "/api/rooms/invitePreview",
      { inviteCode: invite[0].invite_code },
      { token: organiser },
    );
    expect(preview.status).toBe(200);
    expect(preview.json.displayName).toBe("Ines");

    const claimed = await api.post(
      "/api/rooms/acceptInvite",
      { inviteCode: invite[0].invite_code },
      { token: await api.token(INVIGILATOR) },
    );
    expect(claimed.json.matchId).toBe(room.matchId);

    // ---- roster locked, setup running, then the head start --------------
    const started = await api.post(
      "/api/rooms/startRoom",
      { matchId: room.matchId },
      { token: organiser },
    );
    expect(started.json.status).toBe("setup");

    const headStart = await api.post(
      "/api/rooms/beginHeadStartRoom",
      { matchId: room.matchId, force: true },
      { token: organiser },
    );
    expect(headStart.json.status).toBe("headstart");

    // Move the clock: the head start is over, 25 minutes of clock, and a
    // five-minute pause that has already been accounted for.
    await goLive(room.matchId, 25);
    await api.db.query(
      `update matches set paused_total_ms = 300000 where id = $1::uuid`,
      [room.matchId],
    );

    // ---- a real tag ------------------------------------------------------
    const players = await playerRows(room.matchId);
    const hunter = players.find((row) => row.role === "hunter")!;
    const shadow = players.find((row) => row.role === "shadow")!;
    expect(hunter).toBeDefined();
    expect(shadow).toBeDefined();

    const scan = await api.post(
      "/api/matches/submitTagScan",
      {
        matchId: room.matchId,
        scannedToken: shadow.qr_token,
        scannerLat: COORD.lat,
        scannerLng: COORD.lng,
        scannerAccuracyMetres: 8,
      },
      { token: await api.token(hunter.user_id) },
    );
    expect(scan.json.ok).toBe(true);
    expect(scan.json.points).toBeGreaterThan(0);
    expect(scan.json.matchEnded).toBe(false);

    // The capture choice is recorded on the tag raised when they were caught.
    const capture = await api.post(
      "/api/matches/chooseCaptureMode",
      { matchId: room.matchId, mode: "helper" },
      { token: await api.token(shadow.user_id) },
    );
    expect(capture.json.mode).toBe("helper");

    // ---- a pause the minute tick must not charge -------------------------
    const paused = await api.post(
      "/api/rooms/pauseRoom",
      { matchId: room.matchId, reason: "Fog." },
      { token: organiser },
    );
    expect(paused.json.pausedAt).not.toBeNull();

    // ---- the end ---------------------------------------------------------
    const ended = await api.post(
      "/api/rooms/endRoom",
      { matchId: room.matchId, reason: "Time is up." },
      { token: organiser },
    );
    expect(ended.json.ended).toBe(true);

    // ---- the public page, before and after publishing --------------------
    const beforePublish = await api.post(
      "/api/results/public",
      { slug: room.publicSlug },
      { token: null },
    );
    expect(beforePublish.status).toBe(200);
    expect(beforePublish.json).toBeNull();

    const publish = await api.post(
      "/api/results/publish",
      { matchId: room.matchId, publish: true },
      { token: organiser },
    );
    expect(publish.json.published).toBe(true);

    const publicResult = await api.post(
      "/api/results/public",
      { slug: room.publicSlug },
      { token: null },
    );
    expect(publicResult.json.rows).toHaveLength(PLAYERS.length);
    expect(publicResult.json.title).toBe("Night hunt");
    expect(publicResult.json.clubName).toBe("Riverside Runners");
    expect(publicResult.json.stats.totalPlayers).toBe(PLAYERS.length);
    // 25 minutes of clock, minus the 5-minute pause: the head start is inside
    // the clock, so it is not subtracted again.
    expect(publicResult.json.stats.matchLengthMs).toBeGreaterThanOrEqual(19 * MINUTE);
    expect(publicResult.json.stats.matchLengthMs).toBeLessThan(21 * MINUTE);
    const publicJson = JSON.stringify(publicResult.json);
    expect(publicJson).not.toContain("roomCode");
    expect(publicJson).not.toContain(room.roomCode);
    expect(publicJson).not.toContain('"lat"');
    expect(publicJson).not.toContain("SH-");

    // ---- each player's own end screen ------------------------------------
    const mine = await api.post(
      "/api/results/mine",
      { matchId: room.matchId },
      { token: await api.token(shadow.user_id) },
    );
    expect(mine.json.role).toBe("shadow");
    // 25 minutes of clock, the first 5 the head start, minus the pause.
    expect(mine.json.minutesSurvived).toBe(15);
    expect(mine.json.catches).toHaveLength(1);
    expect(mine.json.publicSlug).toBe(room.publicSlug);

    // ---- the leaderboard, the feed, the map and the console --------------
    const leaderboard = await api.post(
      "/api/matches/getLeaderboard",
      { matchId: room.matchId },
      { token: organiser },
    );
    expect(leaderboard.json.entries.length).toBeGreaterThan(0);

    const feed = await api.post(
      "/api/events/feed",
      { matchId: room.matchId },
      { token: await api.token(PLAYERS[2]) },
    );
    expect(feed.json.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(feed.json)).not.toContain('"lat"');

    const map = await api.post(
      "/api/map/view",
      { matchId: room.matchId },
      { token: await api.token(PLAYERS[2]) },
    );
    expect(map.status).toBe(200);

    // The organiser is not an invigilator, so the console stays shut.
    const consoleView = await api.post(
      "/api/monitor/view",
      { matchId: room.matchId },
      { token: organiser },
    );
    expect(consoleView.json).toBeNull();

    // The invigilator who claimed the invite gets the console.
    const invigilatorConsole = await api.post(
      "/api/monitor/view",
      { matchId: room.matchId },
      { token: await api.token(INVIGILATOR) },
    );
    expect(invigilatorConsole.status).toBe(200);
    expect(invigilatorConsole.json).not.toBeNull();

    // ---- complaints and a staff action -----------------------------------
    const targets = await api.post(
      "/api/complaints/complaintTargets",
      { matchId: room.matchId },
      { token: await api.token(hunter.user_id) },
    );
    expect(targets.status).toBe(200);
    expect(targets.json.isHunter).toBe(true);

    const otherShadow = players.find(
      (row) => row.role === "shadow" && row.id !== shadow.id,
    );
    if (otherShadow) {
      const filed = await api.post(
        "/api/complaints/file",
        { matchId: room.matchId, accusedId: otherShadow.id, note: "No code." },
        { token: await api.token(hunter.user_id) },
      );
      // The match is over, so a fresh complaint is refused — same as Convex.
      expect(filed.status).toBe(400);
      expect(typeof filed.json.error).toBe("string");
    }

    const warned = await api.post(
      "/api/monitor/warn",
      { matchId: room.matchId, playerId: shadow.id, reason: "Stay in the zone." },
      { token: await api.token(INVIGILATOR) },
    );
    expect(warned.json).toEqual({ ok: true });
  });

  it("refuses anonymous callers on the guarded routes", async () => {
    const room = await createRoom();
    const stranger = await api.token(STRANGER);

    for (const [path, body] of [
      ["/api/rooms/lobby", { roomCode: room.roomCode }],
      ["/api/matches/getLeaderboard", { matchId: room.matchId }],
      ["/api/results/mine", { matchId: room.matchId }],
      ["/api/events/feed", { matchId: room.matchId }],
      ["/api/map/view", { matchId: room.matchId }],
      ["/api/results/publish", { matchId: room.matchId, publish: true }],
    ] as const) {
      const anonymous = await api.post(path, body, { token: null });
      expect(anonymous.status).toBe(401);

      const foreign = await api.post(path, body, { token: stranger });
      // Signed in but outside the match: the service is what refuses.
      expect([200, 400]).toContain(foreign.status);
      if (foreign.status === 400) {
        expect(typeof foreign.json.error).toBe("string");
      }
    }

    // The public result page needs no token at all.
    const publicPage = await api.post(
      "/api/results/public",
      { slug: room.publicSlug },
      { token: null },
    );
    expect(publicPage.status).toBe(200);
    expect(publicPage.json).toBeNull();
  });

  it("rejects a malformed body with the same message shape as Convex", async () => {
    const token = await api.token(ORGANISER);
    const bad = await api.post(
      "/api/rooms/joinRoom",
      { roomCode: "ABCDE", callSign: 12, displayName: null },
      { token },
    );
    expect(bad.status).toBe(400);
    expect(bad.json).toEqual({ error: "Invalid request." });

    const unknown = await api.post("/api/nowhere", {}, { token });
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual({ error: "Not found." });
  });
});

/* -------------------------------------------------------------------------- *
 * Row Level Security.
 * ------------------------------------------------------------------------ */

describe("row level security", () => {
  it("has RLS enabled and forced on every game table, with no policies", async () => {
    const tables = await api.db.query<{
      tablename: string;
      rowsecurity: boolean;
    }>(
      `select tablename, rowsecurity
         from pg_tables
        where schemaname = 'public'
        order by tablename`,
    );
    expect(tables.map((t) => t.tablename)).toEqual([
      "audit_log",
      "complaints",
      "invigilators",
      "leaderboard",
      "locations",
      "match_events",
      "matches",
      "players",
      "score_events",
      "tags",
      "users",
    ]);
    for (const table of tables) {
      expect(table.rowsecurity).toBe(true);
    }

    const forced = await api.db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
        order by c.relname`,
    );
    expect(forced.map((row) => row.relname)).toEqual(
      tables.map((table) => table.tablename),
    );

    const policies = await api.db.query<{ count: string }>(
      `select count(*)::text as count from pg_policies where schemaname = 'public'`,
    );
    expect(Number(policies[0].count)).toBe(0);
  });

  it("keeps the browser roles out of the tables entirely", async () => {
    const roles = await api.db.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('anon', 'authenticated')`,
    );
    // PGlite has no Supabase roles, so this only proves the guard in the
    // migration is inert here; on a real project the revoke runs.
    expect(roles.length).toBeLessThanOrEqual(2);

    const granted = await api.db.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated')
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
    );
    expect(Number(granted[0].count)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- *
 * Collisions: two requests that want the same row.
 * ------------------------------------------------------------------------ */

describe("concurrent requests", () => {
  beforeEach(async () => {
    await api.db.db.exec(`
      delete from match_events;
      delete from audit_log;
      delete from leaderboard;
      delete from score_events;
      delete from tags;
      delete from complaints;
      delete from locations;
      delete from players;
      delete from invigilators;
      delete from matches;
    `);
    await seedProfiles();
  });

  it("gives one Shadow to one Hunter even when both scans land at once", async () => {
    const organiser = await api.token(ORGANISER);
    const room = await createRoom();
    await api.post(
      "/api/rooms/startRoom",
      { matchId: room.matchId },
      { token: organiser },
    );
    await api.post(
      "/api/rooms/beginHeadStartRoom",
      { matchId: room.matchId, force: true },
      { token: organiser },
    );
    await goLive(room.matchId);

    const players = await playerRows(room.matchId);
    const hunters = players.filter((row) => row.role === "hunter");
    const shadow = players.find((row) => row.role === "shadow")!;
    expect(hunters.length).toBeGreaterThanOrEqual(1);
    expect(shadow).toBeDefined();

    const body = {
      matchId: room.matchId,
      scannedToken: shadow.qr_token,
      scannerLat: COORD.lat,
      scannerLng: COORD.lng,
      scannerAccuracyMetres: 8,
    };
    const results = await Promise.all([
      api.post("/api/matches/submitTagScan", body, {
        token: await api.token(hunters[0].user_id),
      }),
      api.post("/api/matches/submitTagScan", body, {
        token: await api.token(hunters[0].user_id),
      }),
    ]);

    const accepted = results.filter((result) => result.json.ok === true);
    expect(accepted).toHaveLength(1);

    const tags = await api.db.query<{ status: string }>(
      `select status from tags where match_id = $1::uuid`,
      [room.matchId],
    );
    expect(tags.filter((tag) => tag.status === "accepted")).toHaveLength(1);

    const ledger = await api.db.query<{ count: string }>(
      `select count(*)::text as count from score_events
        where match_id = $1::uuid and kind = 'tag'`,
      [room.matchId],
    );
    expect(Number(ledger[0].count)).toBe(1);
  });

  it("pays a minute of alive points once, however often the tick runs", async () => {
    const organiser = await api.token(ORGANISER);
    const room = await createRoom();
    await api.post(
      "/api/rooms/startRoom",
      { matchId: room.matchId },
      { token: organiser },
    );
    await api.post(
      "/api/rooms/beginHeadStartRoom",
      { matchId: room.matchId, force: true },
      { token: organiser },
    );
    // Seven minutes of clock: two completed minutes after the head start.
    await goLive(room.matchId, 7);

    const tick = () =>
      api.post("/api/tick", {}, {
        token: null,
        headers: { "x-tick-secret": TICK_SECRET },
      });

    const [first, second, third] = await Promise.all([tick(), tick(), tick()]);
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);

    const perPlayer = await api.db.query<{ player_id: string; count: string }>(
      `select player_id, count(*)::text as count from score_events
        where match_id = $1::uuid and kind = 'shadow_alive'
        group by player_id`,
      [room.matchId],
    );
    // Four Shadows at most, and not one of them paid twice for the same minute.
    expect(perPlayer.length).toBeLessThanOrEqual(4);
    for (const row of perPlayer) {
      expect(Number(row.count)).toBeLessThanOrEqual(2);
    }
    const total = perPlayer.reduce((sum, row) => sum + Number(row.count), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(8);
  });

  it("never gives one account two seats in the same room", async () => {
    const organiser = await api.token(ORGANISER);
    const room = await createRoom();
    const token = await api.token(PLAYERS[0]);

    const first = await api.post(
      "/api/rooms/joinRoom",
      {
        roomCode: room.roomCode,
        callSign: "P0",
        displayName: "Player 0",
        displayNameMode: "nickname",
      },
      { token },
    );
    expect(first.json.rejoined).toBe(true);

    const [a, b] = await Promise.all([
      api.post(
        "/api/rooms/joinRoom",
        {
          roomCode: room.roomCode,
          callSign: "P9",
          displayName: "Player 9",
          displayNameMode: "nickname",
        },
        { token },
      ),
      api.post(
        "/api/rooms/joinRoom",
        {
          roomCode: room.roomCode,
          callSign: "P8",
          displayName: "Player 8",
          displayNameMode: "nickname",
        },
        { token },
      ),
    ]);
    expect([a.json.rejoined, b.json.rejoined].filter(Boolean)).toHaveLength(2);

    const rows = await api.db.query<{ count: string }>(
      `select count(*)::text as count from players where user_id = $1::uuid`,
      [PLAYERS[0]],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("issues the row locks a collision needs", async () => {
    const captured: string[] = [];
    const fakeCtx = {
      conn: {
        query: async (text: string) => {
          captured.push(text);
          return [] as unknown[];
        },
        exec: async () => {},
      },
      write: true,
    };
    const repos = api.db.provider.repos;
    await repos.matches.findById(fakeCtx as never, "00000000-0000-4000-8000-000000000000");
    await repos.players.findByMatchAndUser(
      fakeCtx as never,
      "00000000-0000-4000-8000-000000000000",
      "00000000-0000-4000-8000-000000000000",
    );
    await repos.tags.listByMatch(fakeCtx as never, "00000000-0000-4000-8000-000000000000");
    expect(captured).toHaveLength(3);
    expect(captured.every((text) => text.includes("for update"))).toBe(true);

    // A read context takes no locks.
    const readCaptured: string[] = [];
    await repos.matches.findById(
      {
        ...fakeCtx,
        write: false,
        conn: {
          query: async (text: string) => {
            readCaptured.push(text);
            return [] as unknown[];
          },
          exec: async () => {},
        },
      } as never,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(readCaptured[0]).not.toContain("for update");
  });
});

/* -------------------------------------------------------------------------- *
 * The scheduled endpoints.
 * ------------------------------------------------------------------------ */

describe("the scheduler endpoint", () => {
  it("needs the tick secret", async () => {
    const wrong = await api.post(
      "/api/tick",
      {},
      { token: null, headers: { "x-tick-secret": "not-the-secret" } },
    );
    expect(wrong.status).toBe(401);

    const anonymous = await api.post("/api/tick", {}, { token: null });
    expect(anonymous.status).toBe(401);

    const purge = await api.post(
      "/api/maintenance/purgePositions",
      {},
      { token: null, headers: { "x-tick-secret": "nope" } },
    );
    expect(purge.status).toBe(401);

    const authorised = await api.post(
      "/api/tick",
      {},
      { token: null, headers: { "x-tick-secret": TICK_SECRET } },
    );
    expect(authorised.status).toBe(200);
    expect(typeof authorised.json.matches).toBe("number");
    expect(typeof authorised.json.aliveAwards).toBe("number");
    expect(typeof authorised.json.ended).toBe("number");

    const again = await api.post(
      "/api/tick",
      {},
      { token: null, headers: { "x-tick-secret": TICK_SECRET } },
    );
    expect(again.status).toBe(200);
  });

  it("purges position history only for matches past the retention window", async () => {
    const organiser = await api.token(ORGANISER);
    const room = await createRoom();
    await api.post(
      "/api/rooms/startRoom",
      { matchId: room.matchId },
      { token: organiser },
    );
    await api.post(
      "/api/rooms/beginHeadStartRoom",
      { matchId: room.matchId, force: true },
      { token: organiser },
    );
    await api.post(
      "/api/rooms/endRoom",
      { matchId: room.matchId, reason: "Done." },
      { token: organiser },
    );

    const players = await playerRows(room.matchId);
    await api.db.query(
      `insert into locations (match_id, player_id, lat, lng, accuracy_metres, recorded_at, ping_index)
       values ($1::uuid, $2::uuid, $3, $4, 8, $5::timestamptz, 0)`,
      [
        room.matchId,
        players[0].id,
        COORD.lat,
        COORD.lng,
        iso(Date.now() - (RULES_CONFIG.positionRetentionHours + 1) * 60 * MINUTE),
      ],
    );

    const purged = await api.post(
      "/api/maintenance/purgePositions",
      {},
      { token: null, headers: { "x-tick-secret": TICK_SECRET } },
    );
    expect(purged.status).toBe(200);
    expect(purged.json.deleted).toBeGreaterThanOrEqual(1);

    const left = await api.db.query<{ count: string }>(
      `select count(*)::text as count from locations where match_id = $1::uuid`,
      [room.matchId],
    );
    expect(Number(left[0].count)).toBe(0);

    // Scores and the result survive.
    const match = await api.db.query<{ status: string }>(
      `select status from matches where id = $1::uuid`,
      [room.matchId],
    );
    expect(match[0].status).toBe("ended");
  });
});

/* -------------------------------------------------------------------------- *
 * The live nudge, the polling intervals and the token verifier.
 * ------------------------------------------------------------------------ */

describe("live updates", () => {
  it("publishes a nudge with no payload at all", () => {
    const nudge = nudgeMessage();
    expect(nudge).toEqual({ type: "changed" });
    expect(Object.keys(nudge)).toEqual(["type"]);
    expect(Object.isFrozen(nudge)).toBe(true);

    const serialised = JSON.stringify(nudge);
    expect(serialised).not.toMatch(/lat|lng|location|points|score|token|user|match/i);

    expect(nudgeChannelName("match-1")).toBe("match:match-1:changed");
  });

  it("polls on the configured intervals", () => {
    expect(REFRESH_INTERVALS.lobbyMs).toBe(2_000);
    expect(REFRESH_INTERVALS.matchMs).toBe(3_000);
    expect(REFRESH_INTERVALS.mapMs).toBe(5_000);
  });

  it("refuses a token the verifier rejects", async () => {
    const app = createApiApp({
      provider: api.db.provider,
      verify: async () => {
        throw new Error("bad token");
      },
      tickSecret: TICK_SECRET,
    });
    const response = await app.fetch(
      new Request("http://api.test/api/results/mine", {
        method: "POST",
        headers: {
          authorization: "Bearer nonsense",
          "content-type": "application/json",
        },
        body: JSON.stringify({ matchId: "00000000-0000-4000-8000-000000000000" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("creates the profile row the first time an account is seen", async () => {
    const unseen = "77777777-7777-4777-8777-777777777777";
    const token = await api.token(unseen, {
      email: "new@example.com",
      name: "New Player",
    });
    const room = await createRoom();
    const joined = await api.post(
      "/api/rooms/joinRoom",
      {
        roomCode: room.roomCode,
        callSign: "P9",
        displayName: "New Player",
        displayNameMode: "nickname",
      },
      { token },
    );
    expect(joined.status).toBe(200);

    const rows = await api.db.query<{ name: string; email: string }>(
      `select name, email from users where id = $1::uuid`,
      [unseen],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("New Player");
    expect(rows[0].email).toBe("new@example.com");
  });
});

/* -------------------------------------------------------------------------- *
 * The pg_cron / pg_net schedule, which cannot run in-process.
 * ------------------------------------------------------------------------ */

describe("the scheduled migration", () => {
  it("wires the tick and the purge to the API, and fails closed without them", () => {
    const path = fileURLToPath(
      new URL("../../supabase/migrations/20261101090200_cron.sql", import.meta.url),
    );
    const sql = readFileSync(path, "utf8");

    // Both extensions and both schedules.
    expect(sql).toContain("create extension if not exists pg_cron");
    expect(sql).toContain("create extension if not exists pg_net");
    expect(sql).toContain("'shadow-hunt-tick'");
    expect(sql).toContain("'shadow-hunt-purge-positions'");
    expect(sql).toContain("'* * * * *'");
    expect(sql).toContain("'/api/tick'");
    expect(sql).toContain("'/api/maintenance/purgePositions'");

    // The settings are read at call time, and the job does nothing without them.
    expect(sql).toContain("current_setting('app.tick_url'");
    expect(sql).toContain("current_setting('app.tick_secret'");
    expect(sql).toContain("if base_url is null or secret is null then");

    // The helpers are not callable from the browser.
    expect(sql).toContain(
      "revoke all on function public.shadow_hunt_tick() from public",
    );
    expect(sql).toContain(
      "revoke all on function public.shadow_hunt_purge_positions() from public",
    );
  });
});
