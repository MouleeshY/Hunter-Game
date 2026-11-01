/**
 * The setup phase (Stage 5 add-on, condition 1).
 *
 * After the roster is locked and everyone has confirmed the briefing, the
 * organiser starts a countdown during which every player walks to a starting
 * position. The clock, the zone and the scoring do not run — but phones upload
 * live positions so the server can check that nobody is standing on top of
 * anyone else:
 *
 *   - every player at least `minSeparationMetres` from every other, and
 *   - a Hunter at least `minHunterShadowSeparationMetres` from any Shadow.
 *
 * At the end of the countdown the server checks again. If anyone is still too
 * close **or has no position at all** nobody is ready: the organiser may either
 * extend the countdown by one minute or start the head start anyway — and both
 * choices go in the audit log. All decisions come from `src/rules/separation`;
 * everything here reads and writes through the repositories.
 */
import { separationStatusFor, separationViolations, type MatchConfig, type MatchStatus, type SeparationSample, type SeparationViolation } from "../rules";
import { getRepos } from "./providers";
import type { MatchRow, PlayerRow, RepoContext } from "./repos";

/** A violation, resolved for display: call signs, never positions. */
export interface SeparationIssue {
  aId: string;
  aCallSign: string;
  bId: string;
  bCallSign: string;
  distanceMetres: number;
  requiredMetres: number;
}

export interface SeparationCheck {
  checkedAt: number;
  violations: SeparationIssue[];
  /** Call signs with no usable reading yet — shown to staff as "no location". */
  waiting: string[];
  ok: boolean;
}

/** Latest usable reading for every player in the match. */
async function samplesFor(
  ctx: RepoContext,
  match: MatchRow,
  players: PlayerRow[],
): Promise<(SeparationSample | null)[]> {
  const repos = getRepos();
  return await Promise.all(
    players.map(async (player) => {
      const location = await repos.locations.latestByPlayer(
        ctx,
        match.id,
        player.id,
      );
      if (!location) return null;
      return {
        playerId: player.id,
        role: player.role,
        lat: location.lat,
        lng: location.lng,
        accuracyMetres: location.accuracyMetres,
        recordedAtMs: location.recordedAtMs,
        suspicious: location.suspicious ?? false,
      };
    }),
  );
}

function isWaiting(
  sample: SeparationSample | null,
  nowMs: number,
  config: MatchConfig,
): boolean {
  if (!sample) return true;
  if (sample.suspicious) return true;
  return nowMs - sample.recordedAtMs > config.detectionStaleSeconds * 1000;
}

/** The full separation check the organiser and invigilators see. */
export async function checkSeparation(
  ctx: RepoContext,
  input: { matchId: string; nowMs?: number },
): Promise<SeparationCheck> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();
  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");

  const players = await repos.players.listByMatch(ctx, match.id);
  const samples = await samplesFor(ctx, match, players);
  const callSign = new Map(players.map((player) => [player.id, player.callSign]));

  const raw: SeparationViolation[] = separationViolations({
    samples,
    nowMs: now,
    config: match.config,
  });
  const violations: SeparationIssue[] = raw.map((violation) => ({
    aId: violation.aId,
    aCallSign: callSign.get(violation.aId) ?? "?",
    bId: violation.bId,
    bCallSign: callSign.get(violation.bId) ?? "?",
    distanceMetres: violation.distanceMetres,
    requiredMetres: violation.requiredMetres,
  }));

  const waiting = players
    .filter((_player, index) => isWaiting(samples[index], now, match.config))
    .map((player) => player.callSign);

  return {
    checkedAt: now,
    violations,
    waiting,
    ok: violations.length === 0 && waiting.length === 0,
  };
}

/** What one player's ring shows: a distance, never who or where. */
export async function separationForPlayer(
  ctx: RepoContext,
  input: { matchId: string; playerId: string; nowMs?: number },
): Promise<{
  ok: boolean;
  distanceMetres: number | null;
  requiredMetres: number | null;
  waiting: boolean;
}> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();
  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  const players = await repos.players.listByMatch(ctx, match.id);
  const samples = await samplesFor(ctx, match, players);
  return separationStatusFor(input.playerId, {
    samples,
    nowMs: now,
    config: match.config,
  });
}

/**
 * Is the setup countdown over, and is everyone ready to go?
 *
 * Ready means two things: nobody is standing too close to anybody else, and
 * every player has a usable reading. A player with no position (`waiting`) is
 * **not** ready — the server cannot tell whether they are clear — so the
 * countdown never advances by itself while one is missing. The organiser then
 * extends the setup or force-starts it with a confirmation.
 */
export async function setupIsClear(
  ctx: RepoContext,
  match: MatchRow,
  nowMs: number,
): Promise<boolean> {
  const check = await checkSeparation(ctx, {
    matchId: match.id,
    nowMs,
  });
  return check.ok;
}

/**
 * Move a setup match into the head start. Used by the organiser's button and
 * by the minute tick when the countdown ends with everyone clear.
 */
export async function advanceToHeadStart(
  ctx: RepoContext,
  input: { match: MatchRow; nowMs: number },
): Promise<{ startedAt: number; endsAt: number; headStartEndsAt: number }> {
  const repos = getRepos();
  const { match, nowMs } = input;
  const endsAt = nowMs + match.config.matchDurationMinutes * 60_000;
  const headStartEndsAt = nowMs + match.config.headStartMinutes * 60_000;

  await repos.matches.patch(ctx, match.id, {
    status: "headstart",
    startedAt: nowMs,
    endsAt,
    rosterLocked: true,
    setupEndsAt: null,
  });
  await repos.events.append(ctx, {
    matchId: match.id,
    at: nowMs,
    kind: "phase",
    detail: "The head start has begun.",
  });

  return { startedAt: nowMs, endsAt, headStartEndsAt };
}

/**
 * The organiser's "start the head start" button, with the confirmation the
 * rules ask for when people are still too close.
 */
export async function beginHeadStart(
  ctx: RepoContext,
  input: { matchId: string; userId: string; force?: boolean; nowMs?: number },
): Promise<{
  status: MatchStatus;
  startedAt: number;
  endsAt: number;
  headStartEndsAt: number;
  forced: boolean;
  violations: number;
}> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();
  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  if (match.createdByUserId !== input.userId) {
    throw new Error("Only the organiser can start the head start.");
  }
  if (match.status !== "setup") {
    throw new Error("The setup period is not running.");
  }

  const check = await checkSeparation(ctx, { matchId: match.id, nowMs: now });
  const violations = check.violations.length;
  const noLocation = check.waiting.length;
  // Not clear means either kind of problem: too close, or no usable position.
  const blocked = violations > 0 || noLocation > 0;

  if (blocked && input.force !== true) {
    const parts: string[] = [];
    if (violations > 0) {
      parts.push(
        `${violations} pair${violations === 1 ? " is" : "s are"} too close`,
      );
    }
    if (noLocation > 0) {
      parts.push(
        `${noLocation} player${noLocation === 1 ? " has" : "s have"} no location`,
      );
    }
    throw new Error(
      `The setup is not clear yet: ${parts.join(", ")}. Extend the setup, or start anyway with a confirmation.`,
    );
  }

  const started = await advanceToHeadStart(ctx, { match, nowMs: now });

  if (blocked) {
    await repos.audit.append(ctx, {
      matchId: match.id,
      at: now,
      actorUserId: input.userId,
      actorName: "Organiser",
      action: "started_head_start_forced",
      targetType: "match",
      targetId: match.id,
      targetLabel: match.roomCode,
      reason: "Force start confirmed by the organiser.",
      detail: [
        violations > 0
          ? `${violations} too-close pair${violations === 1 ? "" : "s"}`
          : null,
        noLocation > 0
          ? `No location: ${check.waiting.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return {
    status: "headstart",
    startedAt: started.startedAt,
    endsAt: started.endsAt,
    headStartEndsAt: started.headStartEndsAt,
    forced: blocked,
    violations,
  };
}

/** Push the setup countdown out by one extension, up to the configured cap. */
export async function extendSetup(
  ctx: RepoContext,
  input: { matchId: string; userId: string; nowMs?: number },
): Promise<{ setupEndsAt: number; extendedBySeconds: number }> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();
  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  if (match.createdByUserId !== input.userId) {
    throw new Error("Only the organiser can extend the setup period.");
  }
  if (match.status !== "setup" || match.setupEndsAt === null) {
    throw new Error("The setup period is not running.");
  }

  const startedAt = match.setupStartedAt ?? now;
  const currentEnd = match.setupEndsAt;
  const wanted = currentEnd + match.config.setupExtensionSeconds * 1000;
  const capped = Math.min(
    wanted,
    startedAt + match.config.setupMaxDurationSeconds * 1000,
  );
  if (capped <= currentEnd) {
    throw new Error("The setup period cannot be extended any further.");
  }

  await repos.matches.patch(ctx, match.id, { setupEndsAt: capped });
  await repos.audit.append(ctx, {
    matchId: match.id,
    at: now,
    actorUserId: input.userId,
    actorName: "Organiser",
    action: "setup_extended",
    targetType: "match",
    targetId: match.id,
    targetLabel: match.roomCode,
    reason: "Players were still too close at the end of the countdown.",
    detail: `Setup extended by ${match.config.setupExtensionSeconds}s`,
  });

  return {
    setupEndsAt: capped,
    extendedBySeconds: match.config.setupExtensionSeconds,
  };
}
