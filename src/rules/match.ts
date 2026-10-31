import type { MatchConfig } from "./config";
import type { MatchStatus } from "./types";

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

export interface UploadSchedule {
  allowed: boolean;
  reason: "not_started" | "too_soon" | "not_live" | null;
  nextAllowedAtMs: number | null;
}

/**
 * Position uploads are separate from the 3-minute ping reveal.
 *
 * Phones upload every few seconds (config `uploadIntervalSeconds`) so the server
 * can answer "where is everyone right now" for teammates, invigilators and tag
 * checks. The ping interval only controls what Hunters are shown. Uploads are
 * therefore rate-limited to a few seconds, never to three minutes.
 *
 * They also run during `setup`, where the clock is stopped but the server needs
 * live positions to check that everyone has spread out.
 */
export function uploadSchedule(args: {
  status: MatchStatus;
  lastUploadAtMs: number | null;
  nowMs: number;
  config: MatchConfig;
}): UploadSchedule {
  const { status, lastUploadAtMs, nowMs, config } = args;

  if (status === "setup") {
    // Setup: the ring on everyone's screen is fed from these. Rate limit only.
  } else if (
    status === "lobby" ||
    status === "locked" ||
    status === "headstart"
  ) {
    return { allowed: false, reason: "not_started", nextAllowedAtMs: null };
  } else if (status !== "live") {
    return { allowed: false, reason: "not_live", nextAllowedAtMs: null };
  }

  if (lastUploadAtMs !== null) {
    const nextAt = lastUploadAtMs + config.uploadIntervalSeconds * 1000;
    if (nowMs < nextAt) {
      return { allowed: false, reason: "too_soon", nextAllowedAtMs: nextAt };
    }
  }

  return { allowed: true, reason: null, nextAllowedAtMs: nowMs };
}

export interface PingWindow {
  /** The most recent ping the Hunters are allowed to see, or null. */
  lastPingAtMs: number | null;
  /** When the next ping lands. */
  nextPingAtMs: number | null;
  /** -1 before the first ping. */
  index: number;
}

/**
 * The 3-minute ping schedule. Pings start when the Shadow head start ends; the
 * server uses `lastPingAtMs` to decide which Shadow positions a Hunter sees.
 */
export function pingWindow(args: {
  startedAtMs: number | null;
  nowMs: number;
  config: MatchConfig;
}): PingWindow {
  const { startedAtMs, nowMs, config } = args;
  if (startedAtMs === null) {
    return { lastPingAtMs: null, nextPingAtMs: null, index: -1 };
  }

  const first = startedAtMs + config.headStartMinutes * 60_000;
  if (nowMs < first) {
    return { lastPingAtMs: null, nextPingAtMs: first, index: -1 };
  }

  const interval = config.pingIntervalMinutes * 60_000;
  const index = Math.floor((nowMs - first) / interval);
  return {
    lastPingAtMs: first + index * interval,
    nextPingAtMs: first + (index + 1) * interval,
    index,
  };
}

/** When the match timer expires. */
export function matchEndsAt(startedAtMs: number, config: MatchConfig): number {
  return startedAtMs + config.matchDurationMinutes * 60_000;
}

/* ------------------------------------------------------------------ *
 * Pause / resume
 * ------------------------------------------------------------------ */

/**
 * The clock the rules run on while the match may be paused.
 *
 * `pausedAtMs` freezes the clock where it stood; `pausedTotalMs` is the sum of
 * every completed pause, so time spent paused never counts against the match
 * timer, the zone shrink schedule, the ping interval or the drain.
 */
export function matchClockNow(args: {
  nowMs: number;
  pausedAtMs: number | null;
  pausedTotalMs: number;
}): number {
  if (args.pausedAtMs !== null) return args.pausedAtMs;
  return args.nowMs - Math.max(0, args.pausedTotalMs);
}

/** A match may only be frozen between the start and the whistle. */
export function canPause(status: MatchStatus): boolean {
  return status === "headstart" || status === "live";
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
      reason: "no_active_shadows" | "timer_expired";
    };

/**
 * Hunters win when no Shadow remains active — every Shadow is tagged, removed
 * by an invigilator, or eliminated for being out of the zone. Otherwise the
 * Shadows win when the match timer runs out.
 *
 * The roster size is only used to refuse ending a roster with no Shadows at
 * all; the win condition itself is "zero active Shadows". A tag landed on the
 * final whistle still belongs to the Hunters, so this is checked first.
 */
export function matchEndState(args: {
  totalShadows: number;
  activeShadows: number;
  nowMs: number;
  endsAtMs: number | null;
}): MatchEndState {
  const { totalShadows, activeShadows, nowMs, endsAtMs } = args;

  if (totalShadows <= 0) {
    // No Shadows in the roster: nothing can end the match. Caller's job to fix.
    return { ended: false, winner: null, reason: null };
  }
  if (activeShadows <= 0) {
    return { ended: true, winner: "hunters", reason: "no_active_shadows" };
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
