/**
 * The numbers on the public Match Stats panel.
 *
 * Everything is derived from the match clock, which already skips every pause
 * (`pausedTotalMs`), so a five-minute fog does not add a radar pulse or a zone
 * contraction that never happened.
 *
 * Pure TypeScript: no Convex, React or database imports.
 */
import type { MatchConfig } from "./config";

export interface MatchClockInput {
  /** When the head start began (the match clock's zero), or null. */
  startedAtMs: number | null;
  /** The final whistle, or null while the match is still running. */
  endedAtMs: number | null;
  nowMs: number;
  /** Total milliseconds spent in finished pauses. */
  pausedTotalMs: number;
}

const MINUTE_MS = 60_000;

/** Match time played, pauses excluded, stopped at the final whistle. */
export function matchClockMs(input: MatchClockInput): number {
  if (input.startedAtMs === null) return 0;
  const stopAt = input.endedAtMs ?? input.nowMs;
  return Math.max(0, stopAt - Math.max(0, input.pausedTotalMs) - input.startedAtMs);
}

/**
 * Radar pulses fired: the first lands when the head start ends, then one every
 * `pingIntervalMinutes` — exactly the `pingWindow` schedule the map uses.
 */
export function radarPulsesFired(
  input: MatchClockInput & { config: MatchConfig },
): number {
  const elapsed = matchClockMs(input);
  const first = input.config.headStartMinutes * MINUTE_MS;
  if (elapsed < first) return 0;
  const interval = input.config.pingIntervalMinutes * MINUTE_MS;
  return Math.floor((elapsed - first) / interval) + 1;
}

/** Zone contractions: one per `zoneShrinkIntervalMinutes` of played time. */
export function zoneContractionsFired(
  input: MatchClockInput & { config: MatchConfig },
): number {
  const interval = input.config.zoneShrinkIntervalMinutes * MINUTE_MS;
  return Math.floor(matchClockMs(input) / interval);
}

/**
 * Whole minutes a player was in the match.
 *
 * Pause time is taken off the match clock as a whole, so every player loses the
 * same paused minutes rather than the match owner tracking a per-player clock.
 */
export function survivedMinutes(args: {
  startedAtMs: number | null;
  untilMs: number | null;
  pausedTotalMs: number;
}): number {
  if (args.startedAtMs === null || args.untilMs === null) return 0;
  const ms =
    args.untilMs - Math.max(0, args.pausedTotalMs) - args.startedAtMs;
  return Math.max(0, Math.floor(ms / MINUTE_MS));
}

export interface MatchStatsInput extends MatchClockInput {
  config: MatchConfig;
  totalPlayers: number;
  shadowsTagged: number;
  shadowsSurvived: number;
  proximityAlerts: number;
}

export interface MatchStats {
  totalPlayers: number;
  shadowsTagged: number;
  shadowsSurvived: number;
  radarPulses: number;
  zoneContractions: number;
  /** Played length, pauses excluded, in milliseconds. */
  matchLengthMs: number;
  proximityAlerts: number;
}

/** The whole public stats block, from counts the caller already has. */
export function matchStats(input: MatchStatsInput): MatchStats {
  return {
    totalPlayers: input.totalPlayers,
    shadowsTagged: input.shadowsTagged,
    shadowsSurvived: input.shadowsSurvived,
    radarPulses: radarPulsesFired(input),
    zoneContractions: zoneContractionsFired(input),
    matchLengthMs: matchClockMs(input),
    proximityAlerts: input.proximityAlerts,
  };
}
