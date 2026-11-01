/**
 * The repository contract.
 *
 * One suite, two implementations: the in-memory repositories the other tests
 * use, and the Postgres provider running on PGlite with the real migrations
 * from `supabase/migrations`. If a service behaves one way on Convex-shaped
 * data and another way on Postgres, this is where it shows up.
 *
 * The suite only asserts what the interfaces promise. Things the database
 * enforces on top of that (unique awards, one accepted tag per Shadow, one open
 * complaint per pair) are covered in the Postgres block at the bottom, because
 * an in-memory Map cannot refuse them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { memoryRepos } from "./testSupport/memoryRepos";
import {
  createPostgresTestDatabase,
  type TestDatabase,
} from "./testSupport/pglite";
import { getRepos, setReposForTests } from "./providers";
import { createPostgresProvider, type PostgresProvider } from "./providers/postgres";
import type { Repos, RepoContext } from "./repos";
import { RULES_CONFIG } from "../rules";

const USER_A = "0f1e2d3c-0000-4000-8000-000000000001";
const USER_B = "0f1e2d3c-0000-4000-8000-000000000002";
const USER_C = "0f1e2d3c-0000-4000-8000-000000000003";
const COORD = { lat: 51.5074, lng: -0.1278 };
const MINUTE = 60_000;

interface Harness {
  name: string;
  before(): Promise<void>;
  after(): Promise<void>;
  read<T>(fn: (ctx: RepoContext, repos: Repos) => Promise<T>): Promise<T>;
  write<T>(fn: (ctx: RepoContext, repos: Repos) => Promise<T>): Promise<T>;
}

/** The suite. Called once per harness. */
function repositoryContract(harness: Harness): void {
  describe(`repository contract: ${harness.name}`, () => {
    beforeEach(async () => {
      await harness.before();
    });

    // ---- matches ----------------------------------------------------------

    it("creates a match and finds it by id, room code and public slug", async () => {
      const created = await harness.write((ctx, repos) =>
        repos.matches.create(ctx, {
          roomCode: "ABCDE",
          publicSlug: "slug".padEnd(32, "0"),
          title: "Night hunt",
          clubName: "Riverside Runners",
          status: "lobby",
          config: RULES_CONFIG,
          createdByUserId: USER_A,
          zoneCentre: COORD,
          organiserPosition: COORD,
          initialRadiusMetres: 300,
          eventWindowMinutesMax: 180,
        }),
      );

      expect(created.roomCode).toBe("ABCDE");
      expect(created.title).toBe("Night hunt");
      expect(created.clubName).toBe("Riverside Runners");
      expect(created.published).toBeNull();
      expect(created.aliveUpToMinute).toBe(-1);
      expect(created.pausedTotalMs).toBe(0);
      expect(created.eventWindowEndsAt).toBeGreaterThan(created.createdAt);

      const [byId, byCode, bySlug] = await harness.read((ctx, repos) =>
        Promise.all([
          repos.matches.findById(ctx, created.id),
          repos.matches.findByRoomCode(ctx, "ABCDE"),
          repos.matches.findByPublicSlug(ctx, "slug".padEnd(32, "0")),
        ]),
      );
      expect(byId?.id).toBe(created.id);
      expect(byCode?.id).toBe(created.id);
      expect(bySlug?.id).toBe(created.id);
      expect(byId?.config).toEqual(RULES_CONFIG);
      expect(byId?.createdByUserId).toBe(USER_A);
      expect(byId?.zoneCentre).toEqual(COORD);
      expect(byId?.organiserPosition).toEqual(COORD);
    });

    it("round-trips every patchable field, including clearing one", async () => {
      const created = await harness.write((ctx, repos) =>
        repos.matches.create(ctx, {
          roomCode: "PATCH",
          publicSlug: "p".repeat(32),
          title: null,
          clubName: null,
          status: "lobby",
          config: RULES_CONFIG,
          createdByUserId: null,
          zoneCentre: COORD,
          organiserPosition: COORD,
          initialRadiusMetres: 300,
          eventWindowMinutesMax: 120,
        }),
      );

      const startedAt = Date.now() - 10 * MINUTE;
      await harness.write((ctx, repos) =>
        repos.matches.patch(ctx, created.id, {
          status: "live",
          startedAt,
          endsAt: startedAt + 90 * MINUTE,
          lastPingAt: startedAt,
          setupStartedAt: startedAt - 5 * MINUTE,
          setupEndsAt: startedAt - 2 * MINUTE,
          pausedAt: null,
          pausedTotalMs: 120_000,
          pauseReason: "Fog.",
          aliveUpToMinute: 7,
          winner: "shadows",
          endedAt: null,
          endReason: "staff_end",
          rosterLocked: true,
          zoneCentre: { lat: 1, lng: 2 },
          initialRadiusMetres: 450,
          title: "Rooftops",
          clubName: "Northside",
          published: true,
        }),
      );

      const row = await harness.read((ctx, repos) =>
        repos.matches.findById(ctx, created.id),
      );
      expect(row?.status).toBe("live");
      expect(row?.startedAt).toBe(startedAt);
      expect(row?.endsAt).toBe(startedAt + 90 * MINUTE);
      expect(row?.lastPingAt).toBe(startedAt);
      expect(row?.setupStartedAt).toBe(startedAt - 5 * MINUTE);
      expect(row?.setupEndsAt).toBe(startedAt - 2 * MINUTE);
      expect(row?.pausedAt).toBeNull();
      expect(row?.pausedTotalMs).toBe(120_000);
      expect(row?.pauseReason).toBe("Fog.");
      expect(row?.aliveUpToMinute).toBe(7);
      expect(row?.winner).toBe("shadows");
      expect(row?.endedAt).toBeNull();
      expect(row?.endReason).toBe("staff_end");
      expect(row?.rosterLocked).toBe(true);
      expect(row?.zoneCentre).toEqual({ lat: 1, lng: 2 });
      expect(row?.initialRadiusMetres).toBe(450);
      expect(row?.title).toBe("Rooftops");
      expect(row?.clubName).toBe("Northside");
      expect(row?.published).toBe(true);

      // null clears the publication override and returns to the default.
      await harness.write((ctx, repos) =>
        repos.matches.patch(ctx, created.id, { published: null }),
      );
      const cleared = await harness.read((ctx, repos) =>
        repos.matches.findById(ctx, created.id),
      );
      expect(cleared?.published).toBeNull();
    });

    it("lists ended matches and the ones still on the clock", async () => {
      const open = await harness.write((ctx, repos) =>
        repos.matches.create(ctx, {
          roomCode: "OPEN1",
          publicSlug: "o".repeat(32),
          title: null,
          clubName: null,
          status: "live",
          config: RULES_CONFIG,
          createdByUserId: null,
          zoneCentre: COORD,
          organiserPosition: COORD,
          initialRadiusMetres: 300,
          eventWindowMinutesMax: 120,
        }),
      );
      const old = await harness.write((ctx, repos) =>
        repos.matches.create(ctx, {
          roomCode: "OLD01",
          publicSlug: "d".repeat(32),
          title: null,
          clubName: null,
          status: "lobby",
          config: RULES_CONFIG,
          createdByUserId: null,
          zoneCentre: COORD,
          organiserPosition: COORD,
          initialRadiusMetres: 300,
          eventWindowMinutesMax: 120,
        }),
      );
      const recent = await harness.write((ctx, repos) =>
        repos.matches.create(ctx, {
          roomCode: "NEW01",
          publicSlug: "n".repeat(32),
          title: null,
          clubName: null,
          status: "lobby",
          config: RULES_CONFIG,
          createdByUserId: null,
          zoneCentre: COORD,
          organiserPosition: COORD,
          initialRadiusMetres: 300,
          eventWindowMinutesMax: 120,
        }),
      );

      const now = Date.now();
      await harness.write((ctx, repos) => {
        repos.matches.patch(ctx, old.id, {
          status: "ended",
          endedAt: now - 60 * MINUTE,
          endReason: "timer_expired",
        });
        repos.matches.patch(ctx, recent.id, {
          status: "ended",
          endedAt: now - 5 * MINUTE,
          endReason: "aborted",
        });
      });

      const [ended, before, running] = await harness.read((ctx, repos) =>
        Promise.all([
          repos.matches.listEnded(ctx),
          repos.matches.listEndedBefore(ctx, now - 30 * MINUTE),
          repos.matches.listRunning(ctx),
        ]),
      );
      expect(ended.map((m) => m.id)).toEqual([old.id, recent.id]);
      expect(before.map((m) => m.id)).toEqual([old.id]);
      expect(running.map((m) => m.id)).toEqual([open.id]);
    });

    // ---- players ----------------------------------------------------------

    it("creates a player and finds them by match, user and QR token", async () => {
      const match = await harness.write((ctx, repos) =>
        repos.matches.create(ctx, {
          roomCode: "PLAY1",
          publicSlug: "q".repeat(32),
          title: null,
          clubName: null,
          status: "lobby",
          config: RULES_CONFIG,
          createdByUserId: null,
          zoneCentre: COORD,
          organiserPosition: COORD,
          initialRadiusMetres: 300,
          eventWindowMinutesMax: 120,
        }),
      );
      const player = await harness.write((ctx, repos) =>
        repos.players.create(ctx, {
          matchId: match.id,
          userId: USER_A,
          role: "shadow",
          mode: "spectator",
          status: "active",
          callSign: "P0",
          displayName: "nightfox",
          displayNameMode: "nickname",
          qrToken: "token-0",
          joinedAt: Date.now(),
        }),
      );

      expect(player.points).toBe(0);
      expect(player.taggedAt).toBeNull();
      expect(player.outsideSecondsTotal).toBe(0);
      expect(player.chargedDrainTicks).toBe(0);
      expect(player.briefedAt).toBeNull();

      const [byId, byUser, byToken, list] = await harness.read((ctx, repos) =>
        Promise.all([
          repos.players.findById(ctx, player.id),
          repos.players.findByMatchAndUser(ctx, match.id, USER_A),
          repos.players.findByMatchAndToken(ctx, match.id, "token-0"),
          repos.players.listByMatch(ctx, match.id),
        ]),
      );
      expect(byId?.displayName).toBe("nightfox");
      expect(byUser?.id).toBe(player.id);
      expect(byToken?.id).toBe(player.id);
      expect(list.map((p) => p.id)).toEqual([player.id]);
    });

    it("patches a player, including the out-of-zone state", async () => {
      const match = await harness.write((ctx, repos) =>
        repos.matches.create(ctx, {
          roomCode: "PLAY2",
          publicSlug: "r".repeat(32),
          title: null,
          clubName: null,
          status: "live",
          config: RULES_CONFIG,
          createdByUserId: null,
          zoneCentre: COORD,
          organiserPosition: COORD,
          initialRadiusMetres: 300,
          eventWindowMinutesMax: 120,
        }),
      );
      const player = await harness.write((ctx, repos) =>
        repos.players.create(ctx, {
          matchId: match.id,
          userId: USER_A,
          role: "hunter",
          mode: "helper",
          status: "active",
          callSign: "P1",
          displayName: "Amina",
          displayNameMode: "real",
          qrToken: "token-1",
          joinedAt: Date.now(),
        }),
      );

      const taggedAt = Date.now();
      await harness.write((ctx, repos) => {
        repos.players.patch(ctx, player.id, {
          status: "tagged",
          points: 140,
          taggedAt,
          captureChosenAt: taggedAt + 1000,
          briefedAt: taggedAt - 5000,
        });
        repos.players.patchOutZoneState(ctx, player.id, {
          outsideSince: taggedAt,
          outsideSecondsTotal: 42,
          chargedDrainTicks: 4,
          warnedAt: taggedAt + 500,
        });
      });

      const row = await harness.read((ctx, repos) =>
        repos.players.findById(ctx, player.id),
      );
      expect(row?.status).toBe("tagged");
      expect(row?.points).toBe(140);
      expect(row?.taggedAt).toBe(taggedAt);
      expect(row?.captureChosenAt).toBe(taggedAt + 1000);
      expect(row?.briefedAt).toBe(taggedAt - 5000);
      expect(row?.outsideSince).toBe(taggedAt);
      expect(row?.outsideSecondsTotal).toBe(42);
      expect(row?.chargedDrainTicks).toBe(4);
      expect(row?.warnedAt).toBe(taggedAt + 500);

      await harness.write((ctx, repos) =>
        repos.players.patchOutZoneState(ctx, player.id, {
          outsideSince: null,
          warnedAt: null,
        }),
      );
      const cleared = await harness.read((ctx, repos) =>
        repos.players.findById(ctx, player.id),
      );
      expect(cleared?.outsideSince).toBeNull();
      expect(cleared?.warnedAt).toBeNull();
    });

    // ---- locations --------------------------------------------------------

    it("stores positions and returns the latest one, or the latest before a time", async () => {
      const { match, player } = await seedPlayer(harness);

      const base = Date.now() - 60_000;
      for (let i = 0; i < 3; i += 1) {
        await harness.write((ctx, repos) =>
          repos.locations.insert(ctx, {
            matchId: match.id,
            playerId: player.id,
            lat: 51.5 + i * 0.001,
            lng: -0.1,
            accuracyMetres: 8,
            pingIndex: i,
            recordedAt: base + i * 5000,
          }),
        );
      }

      const [latest, before, snapshots] = await harness.read((ctx, repos) =>
        Promise.all([
          repos.locations.latestByPlayer(ctx, match.id, player.id),
          repos.locations.latestByPlayerBefore(
            ctx,
            match.id,
            player.id,
            base + 5000,
          ),
          repos.locations.latestSnapshotByPlayers(ctx, match.id, [player.id]),
        ]),
      );
      expect(latest?.pingIndex).toBe(2);
      expect(latest?.recordedAtMs).toBe(base + 10_000);
      expect(latest?.accuracyMetres).toBe(8);
      expect(latest?.suspicious).toBe(false);
      expect(before?.pingIndex).toBe(1);
      expect(snapshots.get(player.id)?.pingIndex).toBe(2);

      const empty = await harness.read((ctx, repos) =>
        repos.locations.latestSnapshotByPlayers(ctx, match.id, []),
      );
      expect(empty.size).toBe(0);

      const deleted = await harness.write((ctx, repos) =>
        repos.locations.deleteForMatch(ctx, match.id),
      );
      expect(deleted).toBe(3);
      const afterDelete = await harness.read((ctx, repos) =>
        repos.locations.latestByPlayer(ctx, match.id, player.id),
      );
      expect(afterDelete).toBeNull();
    });

    // ---- tags -------------------------------------------------------------

    it("records accepted and rejected scans and reads them back in time order", async () => {
      const { match, player } = await seedPlayer(harness);
      const other = await harness.write((ctx, repos) =>
        repos.players.create(ctx, {
          matchId: match.id,
          userId: USER_B,
          role: "hunter",
          mode: "hunter",
          status: "active",
          callSign: "P2",
          displayName: "Bogdan",
          displayNameMode: "real",
          qrToken: "token-2",
          joinedAt: Date.now(),
        }),
      );

      const at = Date.now();
      const rejectedId = await harness.write((ctx, repos) =>
        repos.tags.insert(ctx, {
          matchId: match.id,
          hunterId: other.id,
          shadowId: player.id,
          status: "rejected",
          rejectionCode: "too_far",
          distanceMetres: 90,
          scoredPoints: 0,
          at,
        }),
      );
      const acceptedId = await harness.write((ctx, repos) =>
        repos.tags.insert(ctx, {
          matchId: match.id,
          hunterId: other.id,
          shadowId: player.id,
          status: "accepted",
          distanceMetres: 12,
          captureMode: "spectator",
          scoredPoints: 100,
          at: at + 1000,
        }),
      );
      await harness.write((ctx, repos) =>
        repos.tags.patch(ctx, acceptedId, { captureMode: "hunter" }),
      );

      const rows = await harness.read((ctx, repos) =>
        repos.tags.listByMatch(ctx, match.id),
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe(rejectedId);
      expect(rows[0].rejectionCode).toBe("too_far");
      expect(rows[0].forced).toBe(false);
      expect(rows[1].captureMode).toBe("hunter");
      expect(rows[1].scoredPoints).toBe(100);
    });

    // ---- complaints -------------------------------------------------------

    it("files a complaint with its response deadline and resolves it", async () => {
      const { match, player } = await seedPlayer(harness);
      const accused = await harness.write((ctx, repos) =>
        repos.players.create(ctx, {
          matchId: match.id,
          userId: USER_B,
          role: "shadow",
          mode: "spectator",
          status: "active",
          callSign: "P3",
          displayName: "Kwame",
          displayNameMode: "nickname",
          qrToken: "token-3",
          joinedAt: Date.now(),
        }),
      );

      const filedAt = Date.now();
      const complaint = await harness.write((ctx, repos) =>
        repos.complaints.create(ctx, {
          matchId: match.id,
          complainantId: player.id,
          accusedId: accused.id,
          note: "No code shown.",
          configComplaintResponseMinutes: 10,
          nowMs: filedAt,
        }),
      );
      expect(complaint.status).toBe("open");
      expect(complaint.responseDueAt).toBe(filedAt + 10 * MINUTE);

      const open = await harness.read((ctx, repos) =>
        repos.complaints.listOpenByMatch(ctx, match.id),
      );
      expect(open.map((c) => c.id)).toEqual([complaint.id]);

      await harness.write((ctx, repos) =>
        repos.complaints.patch(ctx, complaint.id, {
          status: "upheld",
          resolvedByUserId: USER_C,
          resolvedAt: filedAt + 3000,
          resolutionNote: "Shadow removed.",
        }),
      );

      const [stillOpen, all] = await harness.read((ctx, repos) =>
        Promise.all([
          repos.complaints.listOpenByMatch(ctx, match.id),
          repos.complaints.listByMatch(ctx, match.id),
        ]),
      );
      expect(stillOpen).toHaveLength(0);
      expect(all[0].status).toBe("upheld");
      expect(all[0].resolvedByUserId).toBe(USER_C);
      expect(all[0].resolutionNote).toBe("Shadow removed.");
    });

    // ---- invigilators -----------------------------------------------------

    it("creates an invite, claims it and deactivates it", async () => {
      const { match } = await seedPlayer(harness);
      const invite = await harness.write((ctx, repos) =>
        repos.invigilators.create(ctx, {
          matchId: match.id,
          displayName: "Ines",
          inviteCode: "INV123",
          addedAt: Date.now(),
        }),
      );
      expect(invite.userId).toBeNull();
      expect(invite.active).toBe(true);

      const found = await harness.read((ctx, repos) =>
        repos.invigilators.findByInviteCode(ctx, "INV123"),
      );
      expect(found?.id).toBe(invite.id);

      await harness.write((ctx, repos) => {
        repos.invigilators.claim(ctx, invite.id, USER_B);
        repos.invigilators.patchActive(ctx, invite.id, false);
      });

      const [byUser, listed] = await harness.read((ctx, repos) =>
        Promise.all([
          repos.invigilators.findByMatchAndUser(ctx, match.id, USER_B),
          repos.invigilators.listByMatch(ctx, match.id),
        ]),
      );
      expect(byUser?.id).toBe(invite.id);
      expect(byUser?.active).toBe(false);
      expect(listed).toHaveLength(1);
      expect(await harness.read((ctx, repos) => repos.invigilators.findById(ctx, invite.id))).not.toBeNull();
    });

    // ---- score ledger -----------------------------------------------------

    it("writes ledger rows and answers existsByRef for exactly that key", async () => {
      const { match, player } = await seedPlayer(harness);
      const at = Date.now();
      await harness.write((ctx, repos) =>
        repos.scores.insert(ctx, {
          matchId: match.id,
          playerId: player.id,
          kind: "shadow_alive",
          points: 10,
          at,
          source: "system",
          refId: "alive:12",
        }),
      );
      await harness.write((ctx, repos) =>
        repos.scores.insert(ctx, {
          matchId: match.id,
          playerId: player.id,
          kind: "tag",
          points: 100,
          at: at + 1000,
          source: "invigilator",
          refId: null,
        }),
      );

      const [forPlayer, forMatch, byRef, wrongKind, wrongRef] =
        await harness.read((ctx, repos) =>
          Promise.all([
            repos.scores.listByPlayer(ctx, match.id, player.id),
            repos.scores.listByMatch(ctx, match.id),
            repos.scores.existsByRef(ctx, match.id, player.id, "shadow_alive", "alive:12"),
            repos.scores.existsByRef(ctx, match.id, player.id, "tag", "alive:12"),
            repos.scores.existsByRef(ctx, match.id, player.id, "shadow_alive", "alive:13"),
          ]),
        );
      expect(forPlayer).toHaveLength(2);
      expect(forMatch).toHaveLength(2);
      expect(forPlayer[0].points).toBe(10);
      expect(forPlayer[1].refId).toBeNull();
      expect(byRef).toBe(true);
      expect(wrongKind).toBe(false);
      expect(wrongRef).toBe(false);
    });

    // ---- leaderboard ------------------------------------------------------

    it("upserts a leaderboard row instead of adding a second one", async () => {
      const { match, player } = await seedPlayer(harness);
      const input = {
        matchId: match.id,
        playerId: player.id,
        displayName: "nightfox",
        displayNameMode: "nickname" as const,
        totalPoints: 120,
        breakdown: { alive: 100, tags: 0, bonuses: 20, drains: 0 },
        at: Date.now(),
      };
      await harness.write((ctx, repos) => repos.leaderboard.upsert(ctx, input));
      await harness.write((ctx, repos) =>
        repos.leaderboard.upsert(ctx, {
          ...input,
          totalPoints: 240,
          breakdown: { alive: 200, tags: 40, bonuses: 0, drains: 0 },
          at: input.at + 1000,
        }),
      );

      const rows = await harness.read((ctx, repos) =>
        repos.leaderboard.listByMatch(ctx, match.id),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].totalPoints).toBe(240);
      expect(rows[0].breakdown.tags).toBe(40);
      expect(rows[0].updatedAt).toBe(input.at + 1000);
    });

    // ---- audit and events -------------------------------------------------

    it("appends audit rows oldest first and never reorders them", async () => {
      const { match } = await seedPlayer(harness);
      const at = Date.now();
      const first = await harness.write((ctx, repos) =>
        repos.audit.append(ctx, {
          matchId: match.id,
          at,
          actorUserId: USER_C,
          actorName: "Ines",
          action: "tag_forced",
          targetType: "player",
          targetId: "p1",
          targetLabel: "P1",
          reason: "Would not show the code.",
        }),
      );
      await harness.write((ctx, repos) =>
        repos.audit.append(ctx, {
          matchId: match.id,
          at: at + 500,
          actorUserId: USER_C,
          actorName: "Ines",
          action: "player_removed",
          targetType: "player",
        }),
      );

      const rows = await harness.read((ctx, repos) =>
        repos.audit.listByMatch(ctx, match.id),
      );
      expect(rows.map((r) => r.id)).toHaveLength(2);
      expect(rows[0].id).toBe(first);
      expect(rows[0].action).toBe("tag_forced");
      expect(rows[0].reason).toBe("Would not show the code.");
      expect(rows[1].targetId).toBeNull();
      expect(rows[1].reason).toBeNull();
    });

    it("appends feed events, filters by kind and deduplicates by ref id", async () => {
      const { match, player } = await seedPlayer(harness);
      const at = Date.now();
      await harness.write((ctx, repos) =>
        repos.events.append(ctx, {
          matchId: match.id,
          at,
          kind: "phase",
          detail: "The match is live.",
        }),
      );
      await harness.write((ctx, repos) =>
        repos.events.append(ctx, {
          matchId: match.id,
          at: at + 1000,
          kind: "shrink",
          detail: "The play area is down to 450 m.",
          refId: "shrink:10",
        }),
      );
      await harness.write((ctx, repos) =>
        repos.events.append(ctx, {
          matchId: match.id,
          at: at + 2000,
          kind: "help",
          playerId: player.id,
          lat: COORD.lat,
          lng: COORD.lng,
          distanceMetres: 12,
        }),
      );

      const [all, shrinks, byRef, missing] = await harness.read((ctx, repos) =>
        Promise.all([
          repos.events.listByMatch(ctx, match.id),
          repos.events.listByMatchAndKind(ctx, match.id, "shrink"),
          repos.events.existsByRef(ctx, match.id, "shrink:10"),
          repos.events.existsByRef(ctx, match.id, "shrink:20"),
        ]),
      );
      expect(all.map((e) => e.kind)).toEqual(["phase", "shrink", "help"]);
      expect(shrinks).toHaveLength(1);
      expect(shrinks[0].refId).toBe("shrink:10");
      expect(byRef).toBe(true);
      expect(missing).toBe(false);
      expect(all[2].lat).toBe(COORD.lat);
      expect(all[0].lat).toBeNull();
    });

    // ---- users ------------------------------------------------------------

    it("creates a profile once and refreshes it", async () => {
      const created = await harness.write((ctx, repos) =>
        repos.users.upsert(ctx, {
          id: USER_A,
          name: "Amina Yusuf",
          email: "amina@example.com",
        }),
      );
      expect(created.name).toBe("Amina Yusuf");

      const again = await harness.write((ctx, repos) =>
        repos.users.upsert(ctx, { id: USER_A, email: "amina@new.example" }),
      );
      expect(again.id).toBe(USER_A);
      expect(again.email).toBe("amina@new.example");
      // The name was not sent this time, so it is kept.
      expect(again.name).toBe("Amina Yusuf");

      const found = await harness.read((ctx, repos) =>
        repos.users.findById(ctx, USER_A),
      );
      expect(found?.name).toBe("Amina Yusuf");
      expect(await harness.read((ctx, repos) => repos.users.findById(ctx, USER_B))).toBeNull();
    });
  });
}

/** A match with one player in it, used by most of the cases above. */
async function seedPlayer(harness: Harness) {
  const match = await harness.write((ctx, repos) =>
    repos.matches.create(ctx, {
      roomCode: `S${Math.floor(Math.random() * 100000)}`.padEnd(5, "X"),
      publicSlug: Math.random().toString(16).slice(2).padEnd(32, "0"),
      title: null,
      clubName: null,
      status: "live",
      config: RULES_CONFIG,
      createdByUserId: null,
      zoneCentre: COORD,
      organiserPosition: COORD,
      initialRadiusMetres: 300,
      eventWindowMinutesMax: 120,
    }),
  );
  const player = await harness.write((ctx, repos) =>
    repos.players.create(ctx, {
      matchId: match.id,
      userId: USER_A,
      role: "shadow",
      mode: "spectator",
      status: "active",
      callSign: "P0",
      displayName: "nightfox",
      displayNameMode: "nickname",
      qrToken: `token-${Math.random().toString(16).slice(2)}`,
      joinedAt: Date.now(),
    }),
  );
  return { match, player };
}

// ---- harnesses -------------------------------------------------------------

const memoryHarness: Harness = {
  name: "in-memory",
  before: async () => {
    setReposForTests(memoryRepos());
  },
  after: async () => {
    setReposForTests(null);
  },
  read: async (fn) => fn(null, getRepos()),
  write: async (fn) => fn(null, getRepos()),
};

let database: TestDatabase | null = null;

const postgresHarness: Harness = {
  name: "postgres (pglite)",
  before: async () => {
    if (database === null) {
      database = await createPostgresTestDatabase();
    }
    await wipe(database);
    setReposForTests(database.provider.repos);
  },
  after: async () => {
    setReposForTests(null);
  },
  read: async (fn) => {
    if (database === null) throw new Error("no database");
    return database.provider.read((ctx) => fn(ctx, database!.provider.repos));
  },
  write: async (fn) => {
    if (database === null) throw new Error("no database");
    return database.provider.transaction((ctx) =>
      fn(ctx, database!.provider.repos),
    );
  },
};

async function wipe(database: TestDatabase): Promise<void> {
  await database.db.exec(`
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
    delete from users;
  `);
}

beforeAll(async () => {
  database = await createPostgresTestDatabase();
  await wipe(database);
});

afterAll(async () => {
  setReposForTests(null);
  if (database !== null) {
    await database.close();
    database = null;
  }
});

repositoryContract(memoryHarness);
repositoryContract(postgresHarness);

/* -------------------------------------------------------------------------- *
 * Postgres-only guarantees: the constraints the game depends on.
 * ------------------------------------------------------------------------ */

describe("postgres constraints", () => {
  beforeEach(async () => {
    if (database === null) throw new Error("no database");
    await wipe(database);
    setReposForTests(database.provider.repos);
  });

  afterAll(() => {
    setReposForTests(null);
  });

  const createMatch = (roomCode: string, slug: string, status = "lobby") =>
    postgresHarness.write((ctx, repos) =>
      repos.matches.create(ctx, {
        roomCode,
        publicSlug: slug,
        title: null,
        clubName: null,
        status: status as never,
        config: RULES_CONFIG,
        createdByUserId: null,
        zoneCentre: COORD,
        organiserPosition: COORD,
        initialRadiusMetres: 300,
        eventWindowMinutesMax: 120,
      }),
    );

  it("refuses a second player with the same user in one match", async () => {
    const match = await createMatch("UUUUU", "u".repeat(32));
    await postgresHarness.write((ctx, repos) =>
      repos.players.create(ctx, {
        matchId: match.id,
        userId: USER_A,
        role: "shadow",
        mode: "spectator",
        status: "active",
        callSign: "P0",
        displayName: "nightfox",
        displayNameMode: "nickname",
        qrToken: "token-a",
        joinedAt: Date.now(),
      }),
    );

    await expect(
      postgresHarness.write((ctx, repos) =>
        repos.players.create(ctx, {
          matchId: match.id,
          userId: USER_A,
          role: "hunter",
          mode: "spectator",
          status: "active",
          callSign: "P9",
          displayName: "again",
          displayNameMode: "nickname",
          qrToken: "token-b",
          joinedAt: Date.now(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses two accepted tags for the same Shadow in one match", async () => {
    const match = await createMatch("TTTTT", "t".repeat(32));
    const shadow = await postgresHarness.write((ctx, repos) =>
      repos.players.create(ctx, {
        matchId: match.id,
        userId: USER_A,
        role: "shadow",
        mode: "spectator",
        status: "active",
        callSign: "P0",
        displayName: "nightfox",
        displayNameMode: "nickname",
        qrToken: "token-a",
        joinedAt: Date.now(),
      }),
    );
    const hunter = await postgresHarness.write((ctx, repos) =>
      repos.players.create(ctx, {
        matchId: match.id,
        userId: USER_B,
        role: "hunter",
        mode: "hunter",
        status: "active",
        callSign: "P1",
        displayName: "Bogdan",
        displayNameMode: "real",
        qrToken: "token-b",
        joinedAt: Date.now(),
      }),
    );

    await postgresHarness.write((ctx, repos) =>
      repos.tags.insert(ctx, {
        matchId: match.id,
        hunterId: hunter.id,
        shadowId: shadow.id,
        status: "accepted",
        distanceMetres: 10,
        scoredPoints: 100,
        at: Date.now(),
      }),
    );

    await expect(
      postgresHarness.write((ctx, repos) =>
        repos.tags.insert(ctx, {
          matchId: match.id,
          hunterId: hunter.id,
          shadowId: shadow.id,
          status: "accepted",
          distanceMetres: 12,
          scoredPoints: 100,
          at: Date.now() + 1000,
        }),
      ),
    ).rejects.toThrow();

    // A rejected scan for the same Shadow is still allowed: it awards nothing.
    const rejected = await postgresHarness.write((ctx, repos) =>
      repos.tags.insert(ctx, {
        matchId: match.id,
        hunterId: hunter.id,
        shadowId: shadow.id,
        status: "rejected",
        rejectionCode: "already_tagged",
        scoredPoints: 0,
        at: Date.now() + 2000,
      }),
    );
    expect(rejected).toBeTruthy();
  });

  it("refuses the same award twice, for the same player and ref id", async () => {
    const match = await createMatch("AAAAA", "a".repeat(32));
    const player = await postgresHarness.write((ctx, repos) =>
      repos.players.create(ctx, {
        matchId: match.id,
        userId: USER_A,
        role: "shadow",
        mode: "spectator",
        status: "active",
        callSign: "P0",
        displayName: "nightfox",
        displayNameMode: "nickname",
        qrToken: "token-a",
        joinedAt: Date.now(),
      }),
    );

    const award = (points: number) =>
      postgresHarness.write((ctx, repos) =>
        repos.scores.insert(ctx, {
          matchId: match.id,
          playerId: player.id,
          kind: "shadow_alive",
          points,
          at: Date.now(),
          source: "system",
          refId: "alive:12",
        }),
      );

    await award(10);
    await expect(award(10)).rejects.toThrow();

    // A different player at the same minute is a different award.
    const other = await postgresHarness.write((ctx, repos) =>
      repos.players.create(ctx, {
        matchId: match.id,
        userId: USER_B,
        role: "shadow",
        mode: "spectator",
        status: "active",
        callSign: "P1",
        displayName: "Kwame",
        displayNameMode: "nickname",
        qrToken: "token-b",
        joinedAt: Date.now(),
      }),
    );
    await postgresHarness.write((ctx, repos) =>
      repos.scores.insert(ctx, {
        matchId: match.id,
        playerId: other.id,
        kind: "shadow_alive",
        points: 10,
        at: Date.now(),
        source: "system",
        refId: "alive:12",
      }),
    );

    const rows = await postgresHarness.read((ctx, repos) =>
      repos.scores.listByMatch(ctx, match.id),
    );
    expect(rows).toHaveLength(2);
  });

  it("refuses one open complaint per Hunter and Shadow pair", async () => {
    const match = await createMatch("CCCCC", "c".repeat(32));
    const hunter = await postgresHarness.write((ctx, repos) =>
      repos.players.create(ctx, {
        matchId: match.id,
        userId: USER_A,
        role: "hunter",
        mode: "hunter",
        status: "active",
        callSign: "P0",
        displayName: "Amina",
        displayNameMode: "real",
        qrToken: "token-a",
        joinedAt: Date.now(),
      }),
    );
    const shadow = await postgresHarness.write((ctx, repos) =>
      repos.players.create(ctx, {
        matchId: match.id,
        userId: USER_B,
        role: "shadow",
        mode: "spectator",
        status: "active",
        callSign: "P1",
        displayName: "Kwame",
        displayNameMode: "nickname",
        qrToken: "token-b",
        joinedAt: Date.now(),
      }),
    );

    const file = () =>
      postgresHarness.write((ctx, repos) =>
        repos.complaints.create(ctx, {
          matchId: match.id,
          complainantId: hunter.id,
          accusedId: shadow.id,
          note: null,
          configComplaintResponseMinutes: 10,
        }),
      );

    await file();
    await expect(file()).rejects.toThrow();

    // Resolving it frees the pair up again.
    const existing = await postgresHarness.read((ctx, repos) =>
      repos.complaints.listOpenByMatch(ctx, match.id),
    );
    await postgresHarness.write((ctx, repos) =>
      repos.complaints.patch(ctx, existing[0].id, { status: "dismissed" }),
    );
    await expect(file()).resolves.toBeTruthy();
  });

  it("reuses a room code only after the match has ended", async () => {
    const active = await createMatch("REUSE", "e".repeat(32), "live");
    expect(active.roomCode).toBe("REUSE");
    await expect(createMatch("REUSE", "f".repeat(32))).rejects.toThrow();

    await postgresHarness.write((ctx, repos) =>
      repos.matches.patch(ctx, active.id, {
        status: "ended",
        endedAt: Date.now(),
        endReason: "timer_expired",
      }),
    );
    await expect(createMatch("REUSE", "f".repeat(32))).resolves.toBeTruthy();
  });

  it("keeps the public slug unique", async () => {
    await createMatch("SLUG1", "s".repeat(32));
    await expect(createMatch("SLUG2", "s".repeat(32))).rejects.toThrow();
  });
});
