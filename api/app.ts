/**
 * The Shadow Hunt HTTP API.
 *
 * One route per client call in `src/convex/*.ts`, with the same inputs and the
 * same outputs: every handler calls the same service in `src/server` over the
 * same repositories, so Convex and Supabase return the same thing.
 *
 *   POST /api/<module>/<function>   JSON body = the Convex function's args
 *   GET  /api/results/:slug         the public result page (no token)
 *   GET  /api/results               the public list (no token)
 *
 * Auth
 *   Authorization: Bearer <supabase jwt>   → the user is resolved from `sub`
 *   x-tick-secret: <secret>                → the scheduler endpoints
 *   no header                              → public result reads only
 *
 * Errors come back as `{ "error": "<the message the service threw>" }`, which
 * is the message the Convex client would have received.
 */
import { Hono } from "hono";
import {
  abortMatch,
  dismissComplaint,
  endMatchEarly,
  forceTag,
  getConsoleView,
  pauseMatch,
  removePlayer,
  resumeMatch,
  setPlayerMode,
  warnPlayer,
} from "../src/server/console";
import {
  beginHeadStart,
  claimInvite,
  confirmBriefing,
  createMatch,
  extendSetup,
  getLobby,
  joinMatch,
  previewInvite,
  rerollCentre,
  setRosterLock,
  startMatch,
} from "../src/server/index";
import {
  fileComplaint,
  getComplaintTargets,
} from "../src/server/complaints";
import {
  chooseCaptureMode,
  submitTagScan,
} from "../src/server/tagScan";
import { settleOnTimer } from "../src/server/matchEnd";
import { getLeaderboardView } from "../src/server/leaderboard";
import { uploadPosition, getMapView, purgeExpiredPositions } from "../src/server/positionService";
import { getFeedView, raiseHelpAlert } from "../src/server/events";
import {
  getPlayerResult,
  getPublicResult,
  getResultTools,
  getResultToolsBySlug,
  listPublicResults,
  setResultPublished,
} from "../src/server/results";
import { runMatchTick } from "../src/server/scheduler";
import type { PostgresProvider } from "../src/server/providers/postgres";
import type { RepoContext } from "../src/server/repos/context";
import {
  bearerToken,
  createVerifierFromEnv,
  resolveUser,
  secretMatches,
  type TokenVerifier,
  type VerifiedUser,
} from "./auth";
import * as args from "./validators";
import type { z } from "zod";

export interface ApiDeps {
  provider: PostgresProvider;
  /** Verifies the Supabase JWT. Null means "no token can be verified here". */
  verify: TokenVerifier | null;
  tickSecret: string | undefined;
}

type Auth = "public" | "user" | "optional" | "secret";

interface RouteSpec<A> {
  path: string;
  auth: Auth;
  args: z.ZodType<A>;
  /** Inside one database transaction, with row locks (a mutating call). */
  write: boolean;
  handler: (ctx: RepoContext, args: A, user: VerifiedUser | null) => unknown | Promise<unknown>;
}

function isServiceError(cause: unknown): cause is Error {
  return cause instanceof Error;
}

export function createApiApp(deps: ApiDeps): Hono {
  const app = new Hono();
  const { provider, verify, tickSecret } = deps;

  function route<A>(spec: RouteSpec<A>): void {
    const handle = async (body: unknown, header: (name: string) => string | null): Promise<{ status: number; json: unknown }> => {
      // ---- secret endpoints ------------------------------------------------
      if (spec.auth === "secret") {
        const provided = header("x-tick-secret");
        if (!(await secretMatches(provided, tickSecret))) {
          return { status: 401, json: { error: "Not authorised." } };
        }
        return run(spec, body, null, spec.write);
      }

      // ---- public endpoints ------------------------------------------------
      const token = bearerToken(header("authorization"));
      if (spec.auth === "public") {
        return run(spec, body, null, spec.write);
      }

      if (token === null && verify === null) {
        // Nothing is configured to verify tokens: refuse rather than guess.
        return { status: 401, json: { error: "Sign in to continue." } };
      }

      let user: VerifiedUser | null = null;
      if (token !== null) {
        if (verify === null) {
          return { status: 401, json: { error: "Sign in to continue." } };
        }
        try {
          user = await verify(token);
        } catch {
          return { status: 401, json: { error: "Your session has expired. Sign in again." } };
        }
      }

      if (spec.auth === "user" && user === null) {
        return { status: 401, json: { error: "Sign in to continue." } };
      }

      return run(spec, body, user, spec.write);
    };

    async function run(
      spec: RouteSpec<A>,
      body: unknown,
      user: VerifiedUser | null,
      write: boolean,
    ): Promise<{ status: number; json: unknown }> {
      const parsed = spec.args.safeParse(body ?? {});
      if (!parsed.success) {
        return { status: 400, json: { error: "Invalid request." } };
      }

      const execute = async (ctx: RepoContext): Promise<unknown> => {
        const resolved =
          user === null ? null : await resolveUser(ctx, provider.repos, user);
        return spec.handler(ctx, parsed.data, resolved);
      };

      try {
        const result = write
          ? await provider.transaction(execute)
          : await provider.read(execute);
        return { status: 200, json: result ?? null };
      } catch (cause) {
        if (!isServiceError(cause)) throw cause;
        return { status: 400, json: { error: cause.message } };
      }
    }

    app.post(spec.path, async (c) => {
      const body = await c.req.json().catch(() => null);
      const header = (name: string) => c.req.header(name) ?? null;
      const { status, json } = await handle(body, header);
      // Built by hand so the status stays a number and the body stays exactly
      // what the service returned — same JSON the Convex client would get.
      return new Response(JSON.stringify(json ?? null), {
        status,
        headers: { "content-type": "application/json" },
      });
    });
  }

  // ---------------------------------------------------------------- rooms ---

  route({
    path: "/api/rooms/createRoom",
    auth: "user",
    args: args.createRoomArgs,
    write: true,
    handler: (ctx, a, user) =>
      createMatch(ctx, {
        createdByUserId: user!.userId,
        matchDurationMinutes: a.matchDurationMinutes,
        organiserLat: a.organiserLat,
        organiserLng: a.organiserLng,
        invigilatorNames: a.invigilatorNames,
        defaultCaptureMode: a.defaultCaptureMode,
        proximityDetection: a.proximityDetection,
        title: a.title,
        clubName: a.clubName,
      }),
  });

  route({
    path: "/api/rooms/rerollCentreHandler",
    auth: "user",
    args: args.matchIdArgs,
    write: true,
    handler: (ctx, a, user) =>
      rerollCentre(ctx, { matchId: a.matchId, organiserUserId: user!.userId }),
  });

  route({
    path: "/api/rooms/joinRoom",
    auth: "user",
    args: args.joinRoomArgs,
    write: true,
    handler: (ctx, a, user) =>
      joinMatch(ctx, {
        userId: user!.userId,
        roomCode: a.roomCode,
        callSign: a.callSign,
        displayName: a.displayName,
        displayNameMode: a.displayNameMode,
      }),
  });

  route({
    path: "/api/rooms/acknowledgeBriefing",
    auth: "user",
    args: args.matchIdArgs,
    write: true,
    handler: (ctx, a, user) =>
      confirmBriefing(ctx, { matchId: a.matchId, userId: user!.userId }),
  });

  route({
    path: "/api/rooms/lobby",
    auth: "user",
    args: args.roomCodeArgs,
    write: false,
    handler: (ctx, a, user) =>
      getLobby(ctx, { userId: user!.userId, roomCode: a.roomCode }),
  });

  route({
    path: "/api/rooms/lockRoster",
    auth: "user",
    args: args.lockRosterArgs,
    write: true,
    handler: (ctx, a, user) =>
      setRosterLock(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        locked: a.locked,
      }),
  });

  route({
    path: "/api/rooms/startRoom",
    auth: "user",
    args: args.forceArgs,
    write: true,
    handler: (ctx, a, user) =>
      startMatch(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        force: a.force,
      }),
  });

  route({
    path: "/api/rooms/endRoom",
    auth: "user",
    args: args.reasonOptionalArgs,
    write: true,
    handler: (ctx, a, user) =>
      endMatchEarly(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        reason: a.reason,
      }),
  });

  route({
    path: "/api/rooms/pauseRoom",
    auth: "user",
    args: args.reasonOptionalArgs,
    write: true,
    handler: (ctx, a, user) =>
      pauseMatch(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        reason: a.reason ?? "Paused by the organiser.",
      }),
  });

  route({
    path: "/api/rooms/resumeRoom",
    auth: "user",
    args: args.reasonOptionalArgs,
    write: true,
    handler: (ctx, a, user) =>
      resumeMatch(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        reason: a.reason ?? "Resumed by the organiser.",
      }),
  });

  route({
    path: "/api/rooms/beginHeadStartRoom",
    auth: "user",
    args: args.forceArgs,
    write: true,
    handler: (ctx, a, user) =>
      beginHeadStart(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        force: a.force,
      }),
  });

  route({
    path: "/api/rooms/extendSetupRoom",
    auth: "user",
    args: args.matchIdArgs,
    write: true,
    handler: (ctx, a, user) =>
      extendSetup(ctx, { matchId: a.matchId, userId: user!.userId }),
  });

  route({
    path: "/api/rooms/abortRoom",
    auth: "user",
    args: args.reasonRequiredArgs,
    write: true,
    handler: (ctx, a, user) =>
      abortMatch(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        reason: a.reason,
      }),
  });

  route({
    path: "/api/rooms/invitePreview",
    auth: "user",
    args: args.inviteCodeArgs,
    write: false,
    handler: (_ctx, a) => previewInvite(_ctx, a.inviteCode),
  });

  route({
    path: "/api/rooms/acceptInvite",
    auth: "user",
    args: args.inviteCodeArgs,
    write: true,
    handler: (ctx, a, user) =>
      claimInvite(ctx, { userId: user!.userId, inviteCode: a.inviteCode }),
  });

  // -------------------------------------------------------------- matches ---

  route({
    path: "/api/matches/uploadPosition",
    auth: "user",
    args: args.uploadPositionArgs,
    write: true,
    handler: (ctx, a, user) =>
      uploadPosition(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        lat: a.lat,
        lng: a.lng,
        accuracyMetres: a.accuracyMetres ?? null,
      }),
  });

  route({
    path: "/api/matches/submitTagScan",
    auth: "user",
    args: args.tagScanArgs,
    write: true,
    handler: (ctx, a, user) =>
      submitTagScan(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        scannedToken: a.scannedToken,
        scannerLat: a.scannerLat,
        scannerLng: a.scannerLng,
        scannerAccuracyMetres: a.scannerAccuracyMetres ?? null,
        assistedByPlayerId: a.assistedByPlayerId ?? null,
      }),
  });

  route({
    path: "/api/matches/chooseCaptureMode",
    auth: "user",
    args: args.captureModeArgs,
    write: true,
    handler: (ctx, a, user) =>
      chooseCaptureMode(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        mode: a.mode,
      }),
  });

  route({
    path: "/api/matches/settleMatch",
    auth: "user",
    args: args.matchIdArgs,
    write: true,
    handler: (ctx, a) => settleOnTimer(ctx, { matchId: a.matchId }),
  });

  route({
    path: "/api/matches/getLeaderboard",
    auth: "user",
    args: args.matchIdArgs,
    write: false,
    handler: (ctx, a) => getLeaderboardView(ctx, { matchId: a.matchId }),
  });

  // ------------------------------------------------------------------ map ---

  route({
    path: "/api/map/view",
    auth: "user",
    args: args.matchIdArgs,
    write: false,
    handler: (ctx, a, user) =>
      getMapView(ctx, { matchId: a.matchId, userId: user!.userId }),
  });

  // ----------------------------------------------------------- complaints ---

  route({
    path: "/api/complaints/complaintTargets",
    auth: "user",
    args: args.matchIdArgs,
    write: false,
    handler: (ctx, a, user) =>
      getComplaintTargets(ctx, { matchId: a.matchId, userId: user!.userId }),
  });

  route({
    path: "/api/complaints/file",
    auth: "user",
    args: args.fileComplaintArgs,
    write: true,
    handler: (ctx, a, user) =>
      fileComplaint(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        accusedId: a.accusedId,
        note: a.note ?? null,
        incidentAtMs: a.incidentAtMs,
      }).then((row) => ({ id: row.id, responseDueAt: row.responseDueAt })),
  });

  // -------------------------------------------------------------- console ---

  route({
    path: "/api/monitor/view",
    auth: "user",
    args: args.matchIdArgs,
    write: false,
    handler: async (ctx, a, user) => {
      try {
        return await getConsoleView(ctx, {
          matchId: a.matchId,
          userId: user!.userId,
        });
      } catch (cause) {
        // The Convex query answers `null` to an outsider rather than rejecting.
        const message = cause instanceof Error ? cause.message : "";
        if (
          message.startsWith("Only an invigilator") ||
          message === "Match not found."
        ) {
          return null;
        }
        throw cause;
      }
    },
  });

  route({
    path: "/api/monitor/dismiss",
    auth: "user",
    args: args.dismissComplaintArgs,
    write: true,
    handler: async (ctx, a, user) => {
      await dismissComplaint(ctx, {
        matchId: a.matchId,
        complaintId: a.complaintId,
        userId: user!.userId,
        reason: a.reason,
      });
      return { ok: true };
    },
  });

  route({
    path: "/api/monitor/force",
    auth: "user",
    args: args.forceTagArgs,
    write: true,
    handler: (ctx, a, user) =>
      forceTag(ctx, {
        matchId: a.matchId,
        hunterId: a.hunterId,
        shadowId: a.shadowId,
        userId: user!.userId,
        reason: a.reason,
      }),
  });

  route({
    path: "/api/monitor/warn",
    auth: "user",
    args: args.playerActionArgs,
    write: true,
    handler: async (ctx, a, user) => {
      await warnPlayer(ctx, {
        matchId: a.matchId,
        playerId: a.playerId,
        userId: user!.userId,
        reason: a.reason,
      });
      return { ok: true };
    },
  });

  route({
    path: "/api/monitor/remove",
    auth: "user",
    args: args.playerActionArgs,
    write: true,
    handler: async (ctx, a, user) => {
      await removePlayer(ctx, {
        matchId: a.matchId,
        playerId: a.playerId,
        userId: user!.userId,
        reason: a.reason,
      });
      return { ok: true };
    },
  });

  route({
    path: "/api/monitor/changeMode",
    auth: "user",
    args: args.changeModeArgs,
    write: true,
    handler: async (ctx, a, user) => {
      await setPlayerMode(ctx, {
        matchId: a.matchId,
        playerId: a.playerId,
        mode: a.mode,
        userId: user!.userId,
        reason: a.reason,
      });
      return { ok: true };
    },
  });

  route({
    path: "/api/monitor/pause",
    auth: "user",
    args: args.reasonRequiredArgs,
    write: true,
    handler: (ctx, a, user) =>
      pauseMatch(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        reason: a.reason,
      }),
  });

  route({
    path: "/api/monitor/resume",
    auth: "user",
    args: args.reasonRequiredArgs,
    write: true,
    handler: (ctx, a, user) =>
      resumeMatch(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        reason: a.reason,
      }),
  });

  // -------------------------------------------------------------- results ---

  route({
    path: "/api/results/public",
    auth: "public",
    args: args.slugArgs,
    write: false,
    handler: (ctx, a) => getPublicResult(ctx, { slug: a.slug }),
  });

  route({
    path: "/api/results/list",
    auth: "public",
    args: args.listResultsArgs,
    write: false,
    handler: (ctx, a) => listPublicResults(ctx, { club: a.club ?? null }),
  });

  route({
    path: "/api/results/mine",
    auth: "user",
    args: args.matchIdArgs,
    write: false,
    handler: (ctx, a, user) =>
      getPlayerResult(ctx, { matchId: a.matchId, userId: user!.userId }),
  });

  route({
    path: "/api/results/manage",
    auth: "optional",
    args: args.matchIdArgs,
    write: false,
    handler: (ctx, a, user) =>
      user === null
        ? null
        : getResultTools(ctx, { matchId: a.matchId, userId: user.userId }),
  });

  route({
    path: "/api/results/tools",
    auth: "optional",
    args: args.slugArgs,
    write: false,
    handler: (ctx, a, user) =>
      getResultToolsBySlug(ctx, { slug: a.slug, userId: user?.userId ?? null }),
  });

  route({
    path: "/api/results/publish",
    auth: "user",
    args: args.publishArgs,
    write: true,
    handler: (ctx, a, user) =>
      setResultPublished(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        publish: a.publish,
      }),
  });

  // --------------------------------------------------------------- events ---

  route({
    path: "/api/events/feed",
    auth: "user",
    args: args.matchIdArgs,
    write: false,
    handler: (ctx, a, user) =>
      getFeedView(ctx, { matchId: a.matchId, userId: user!.userId }),
  });

  route({
    path: "/api/events/help",
    auth: "user",
    args: args.helpArgs,
    write: true,
    handler: (ctx, a, user) =>
      raiseHelpAlert(ctx, {
        matchId: a.matchId,
        userId: user!.userId,
        lat: a.lat ?? null,
        lng: a.lng ?? null,
        accuracyMetres: a.accuracyMetres ?? null,
      }),
  });

  // ---------------------------------------------------- scheduled endpoints ---

  /** The minute tick. Idempotent: a duplicate delivery pays nothing twice. */
  route({
    path: "/api/tick",
    auth: "secret",
    args: args.noArgs,
    write: true,
    handler: (ctx) => runMatchTick(ctx),
  });

  /** Deletes position history older than the retention window. */
  route({
    path: "/api/maintenance/purgePositions",
    auth: "secret",
    args: args.noArgs,
    write: true,
    handler: (ctx) => purgeExpiredPositions(ctx),
  });

  // A wrong path is a 404 with the same body shape as everything else.
  app.notFound(() =>
    new Response(JSON.stringify({ error: "Not found." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );

  return app;
}

/** A verifier built from the environment, or null when neither is set. */
export function verifierFromEnv(): TokenVerifier | null {
  return createVerifierFromEnv();
}
