/**
 * The minute tick.
 *
 * One scheduled job per minute does two things for every match on the clock:
 *
 *   1. pays each active Shadow the alive rate for every completed minute,
 *      exactly once — the score ledger is checked before each award;
 *   2. ends the match when the timer runs out or no Shadow is left active
 *      (tagged, removed or eliminated), running the settlement bonuses once.
 *
 * Everything it decides comes from `src/rules`; every write goes through the
 * repositories. A paused match is skipped entirely: its clock is frozen.
 */
import {
  matchClockNow,
  matchEndState,
  shadowAlivePoints,
  statusForClock,
  zoneProgress,
  zoneRadiusAtMinute,
  type MatchConfig,
} from "../rules";
import { getRepos } from "./providers";
import { activeShadows, endMatch } from "./matchEnd";
import { award } from "./settlement";
import { advanceToHeadStart, setupIsClear } from "./setup";
import type { MatchRow, PlayerRow, RepoContext } from "./repos";

/** Upper bound on back-fill in one run, so a cold start cannot time out. */
const MAX_MINUTES_PER_TICK = 5;

export interface TickResult {
  matches: number;
  aliveAwards: number;
  ended: number;
  /** Setup countdowns that ran out with everyone clear. */
  advanced: number;
}

function inPlayCount(players: PlayerRow[]): number {
  return players.filter(
    (player) => player.status === "active" || player.status === "tagged",
  ).length;
}

/** Alive points for one completed minute of the match. */
async function awardMinute(
  ctx: RepoContext,
  args: {
    match: MatchRow;
    players: PlayerRow[];
    minute: number;
    nowMs: number;
  },
): Promise<number> {
  const { match, players, minute, nowMs } = args;
  const config: MatchConfig = match.config;

  const radius = zoneRadiusAtMinute({
    minute,
    activePlayerCount: inPlayCount(players),
    initialRadiusMetres: match.initialRadiusMetres,
    config,
  });
  const progress = zoneProgress(radius, match.initialRadiusMetres);
  const points = shadowAlivePoints({
    minutes: 1,
    zoneProgress01: progress,
    config,
  });

  let awarded = 0;
  const refId = `alive:${minute}`;
  for (const player of players) {
    if (
      player.role !== "shadow" ||
      player.status !== "active" ||
      player.taggedAt !== null
    ) {
      continue;
    }
    const alreadyPaid = await getRepos().scores.existsByRef(
      ctx,
      match.id,
      player.id,
      "shadow_alive",
      refId,
    );
    if (alreadyPaid) continue;

    await award(ctx, {
      matchId: match.id,
      playerId: player.id,
      kind: "shadow_alive",
      points,
      at: nowMs,
      refId,
    });
    awarded += 1;
  }
  return awarded;
}

/**
 * Run the tick for every match still on the clock. Returns what happened so
 * tests (and logs) can assert on it.
 */
export async function runMatchTick(
  ctx: RepoContext,
  nowMs: number = Date.now(),
): Promise<TickResult> {
  const repos = getRepos();
  const running = await repos.matches.listRunning(ctx);
  const result: TickResult = {
    matches: 0,
    aliveAwards: 0,
    ended: 0,
    advanced: 0,
  };

  for (const match of running) {
    result.matches += 1;

    // Frozen: timer, zone, ping schedule and drain all stop while paused.
    if (match.pausedAt !== null) continue;

    const now = matchClockNow({
      nowMs,
      pausedAtMs: match.pausedAt,
      pausedTotalMs: match.pausedTotalMs,
    });

    // ---- setup countdown -------------------------------------------------
    // The clock is not running yet: this uses real time. When the countdown
    // ends with everyone far enough apart the head start begins on its own;
    // otherwise the organiser extends it or forces the start (audited).
    if (match.status === "setup") {
      if (match.setupEndsAt !== null && now >= match.setupEndsAt) {
        const clear = await setupIsClear(ctx, match, now);
        if (clear) {
          await advanceToHeadStart(ctx, { match, nowMs: now });
          result.advanced += 1;
        }
      }
      continue;
    }

    const players = await repos.players.listByMatch(ctx, match.id);

    // ---- alive points ------------------------------------------------------
    if (match.startedAt !== null) {
      const liveFrom =
        match.startedAt + match.config.headStartMinutes * 60_000;
      const currentMinute = Math.floor((now - match.startedAt) / 60_000);
      const lastComplete = currentMinute - 1;

      if (now >= liveFrom) {
        const from = Math.max(
          match.config.headStartMinutes,
          match.aliveUpToMinute + 1,
        );
        const through = Math.min(
          lastComplete,
          from + MAX_MINUTES_PER_TICK - 1,
        );
        for (let minute = from; minute <= through; minute += 1) {
          result.aliveAwards += await awardMinute(ctx, {
            match,
            players,
            minute,
            nowMs: now,
          });

          // The zone steps down on a fixed schedule; say so in the feed.
          if (
            minute > 0 &&
            minute % match.config.zoneShrinkIntervalMinutes === 0
          ) {
            const refId = `shrink:${minute}`;
            const already = await repos.events.existsByRef(
              ctx,
              match.id,
              refId,
            );
            if (!already) {
              const radius = zoneRadiusAtMinute({
                minute,
                activePlayerCount: inPlayCount(players),
                initialRadiusMetres: match.initialRadiusMetres,
                config: match.config,
              });
              await repos.events.append(ctx, {
                matchId: match.id,
                at: now,
                kind: "shrink",
                refId,
                detail: `The play area is down to ${Math.round(radius)} m.`,
              });
            }
          }
        }
        if (through >= from) {
          await repos.matches.patch(ctx, match.id, {
            aliveUpToMinute: through,
          });
          match.aliveUpToMinute = through;
        }
      }
    }

    // ---- end conditions ----------------------------------------------------
    const end = matchEndState({
      totalShadows: players.filter((p) => p.role === "shadow").length,
      activeShadows: activeShadows(players).length,
      nowMs: now,
      endsAtMs: match.endsAt,
    });

    if (end.ended) {
      const settled = await endMatch(ctx, { matchId: match.id, nowMs: now });
      if (settled.ended && !settled.alreadySettled) {
        result.ended += 1;
        await repos.events.append(ctx, {
          matchId: match.id,
          at: now,
          kind: "phase",
          detail:
            settled.winner === "hunters"
              ? "Match over: no Shadow left in play."
              : "Match over: the timer ran out.",
        });
      }
      continue;
    }

    // ---- head start → live --------------------------------------------------
    const derived = statusForClock({
      stored: match.status,
      startedAtMs: match.startedAt,
      endsAtMs: match.endsAt,
      nowMs: now,
      config: match.config,
    });
    if (derived !== match.status) {
      await repos.matches.patch(ctx, match.id, { status: derived });
      if (derived === "live") {
        await repos.events.append(ctx, {
          matchId: match.id,
          at: now,
          kind: "phase",
          detail: "The match is live. Pings are on.",
        });
      }
      match.status = derived;
    }
  }

  return result;
}
