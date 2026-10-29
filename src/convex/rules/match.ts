import type { MatchConfig } from "./config";

/* ------------------------------------------------------------------ *
 * Timeline: head start, ping interval, event window
 * ------------------------------------------------------------------ */

/** Moment the first location ping is allowed: 5 minutes after the start. */
export function firstPingAt(startedAtMs: number, config: MatchConfig): number {
  return startedAtMs + config.headStartMinutes * 60_000;
}

export interface PingSchedule {
  allowed: boolean;
  /** Why a ping is refused, or null when it is accepted. */
  reason: "not_started" | "head_start" | "interval" | null;
  nextAllowedAtMs: number | null;
}

/**
 * Location pings begin once the Shadow head start is over, then repeat every
 * 3 minutes. Anything else is refused without penalty.
 */
export function pingSchedule(args: {
  startedAtMs: number | null;
  lastPingAtMs: number | null;
  nowMs: number;
  config: MatchConfig;
}): PingSchedule {
  const { startedAtMs, lastPingAtMs, nowMs, config } = args;

  if (startedAtMs === null) {
    return { allowed: false, reason: "not_started", nextAllowedAtMs: null };
  }

  const firstPing = firstPingAt(startedAtMs, config);
  if (nowMs < firstPing) {
    return { allowed: false, reason: "head_start", nextAllowedAtMs: firstPing };
  }

  if (lastPingAtMs !== null) {
    const nextAt = lastPingAtMs + config.pingIntervalMinutes * 60_000;
    if (nowMs < nextAt) {
      return { allowed: false, reason: "interval", nextAllowedAtMs: nextAt };
    }
  }

  return { allowed: true, reason: null, nextAllowedAtMs: nowMs };
}

/** When the match timer expires. */
export function matchEndsAt(startedAtMs: number, config: MatchConfig): number {
  return startedAtMs + config.matchDurationMinutes * 60_000;
}

/** End of the organiser's event window, for reference in the UI. */
export function eventWindowEndsAt(
  startedAtMs: number,
  config: MatchConfig,
): number {
  return startedAtMs + config.eventWindowMinutes.max * 60_000;
}

/* ------------------------------------------------------------------ *
 * End conditions
 * ------------------------------------------------------------------ */

export type MatchWinner = "hunters" | "shadows";

export type MatchEndState =
  | { ended: false; winner: null; reason: null }
  | {
      ended: true;
      winner: MatchWinner;
      reason: "all_shadows_tagged" | "timer_expired";
    };

/**
 * Hunters win the moment every Shadow is tagged. Otherwise, surviving Shadows
 * win when the match timer runs out. "All tagged" is checked first, so a final
 * tag landed on the whistle still belongs to the Hunters.
 */
export function matchEndState(args: {
  totalShadows: number;
  taggedShadows: number;
  nowMs: number;
  endsAtMs: number | null;
}): MatchEndState {
  const { totalShadows, taggedShadows, nowMs, endsAtMs } = args;

  if (totalShadows > 0 && taggedShadows >= totalShadows) {
    return { ended: true, winner: "hunters", reason: "all_shadows_tagged" };
  }
  if (totalShadows <= 0) {
    // No Shadows in the roster: nothing can end the match. Caller's job to fix.
    return { ended: false, winner: null, reason: null };
  }
  if (endsAtMs !== null && nowMs >= endsAtMs) {
    return { ended: true, winner: "shadows", reason: "timer_expired" };
  }
  return { ended: false, winner: null, reason: null };
}

/**
 * Whether the match clock has run out — used before accepting any further
 * action once the whistle has blown, even if the match row is not settled yet.
 */
export function timerExpired(args: {
  nowMs: number;
  endsAtMs: number | null;
}): boolean {
  return args.endsAtMs !== null && args.nowMs >= args.endsAtMs;
}

/** True while the match is inside its 2–3 hour event window. */
export function withinEventWindow(args: {
  startedAtMs: number;
  nowMs: number;
  config: MatchConfig;
}): boolean {
  const { startedAtMs, nowMs, config } = args;
  return (
    nowMs >= startedAtMs &&
    nowMs <= startedAtMs + config.eventWindowMinutes.max * 60_000
  );
}
