import type { MatchConfig } from "./config";
import type { LatLng } from "./types";

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. Pure, so the 40 m tag rule is testable. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ------------------------------------------------------------------ *
 * Play area radius
 * ------------------------------------------------------------------ */

/**
 * Radius for a given player count, read from the configured table.
 * Tiers are open-ended upwards; a count below the first tier is a config
 * error, not something to silently clamp (the rules fix no min or max).
 */
export function radiusForPlayerCount(
  playerCount: number,
  config: MatchConfig,
): number {
  const table = [...config.radiusTable].sort((a, b) => a.minPlayers - b.minPlayers);
  const first = table[0];
  if (!first) throw new Error("radiusTable is empty");
  if (playerCount < first.minPlayers) {
    throw new Error(
      `radiusTable has no tier for ${playerCount} players (first tier starts at ${first.minPlayers})`,
    );
  }
  let radius = first.radiusMetres;
  for (const tier of table) {
    if (playerCount >= tier.minPlayers) radius = tier.radiusMetres;
  }
  return radius;
}

/**
 * Radius at a given minute of the match.
 *
 * Base schedule: one shrink step every `zoneShrinkIntervalMinutes`.
 * Extra shrink: if the resulting area is large for the number of players
 * still in, up to `maxExtraShrinks` further steps are applied.
 *
 * The result never grows as the match progresses: the step count only
 * rises, the player count only falls, and both push the radius down.
 */
export function zoneRadiusAtMinute(args: {
  minute: number;
  activePlayerCount: number;
  initialRadiusMetres: number;
  config: MatchConfig;
}): number {
  const { minute, activePlayerCount, initialRadiusMetres, config } = args;
  const steps = Math.max(0, Math.floor(minute / config.zoneShrinkIntervalMinutes));
  let radius = initialRadiusMetres * config.zoneShrinkFactor ** steps;

  const perPlayer = (r: number) =>
    (Math.PI * r * r) / Math.max(1, activePlayerCount);

  let extra = 0;
  while (
    extra < config.maxExtraShrinks &&
    perPlayer(radius) > config.extraShrinkAreaPerPlayerMetres2
  ) {
    radius *= config.zoneShrinkFactor;
    extra += 1;
  }
  return radius;
}

/**
 * How far the zone has contracted, 0 → 1. Drives both scoring curves:
 * alive points rise and tag points fall as this grows.
 */
export function zoneProgress(
  currentRadiusMetres: number,
  initialRadiusMetres: number,
): number {
  if (initialRadiusMetres <= 0) return 0;
  const p = 1 - currentRadiusMetres / initialRadiusMetres;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/* ------------------------------------------------------------------ *
 * Out-of-zone grace time
 * ------------------------------------------------------------------ */

export type OutOfZoneStatus = "inside" | "grace" | "draining" | "eliminated";

export interface OutOfZoneState {
  status: OutOfZoneStatus;
  /** True once the position is beyond zone radius + GPS tolerance. */
  outside: boolean;
  /** Continuous seconds spent outside the tolerance. Reset by the caller on return. */
  secondsOutside: number;
  /** Seconds of grace remaining before points start draining. */
  graceSecondsLeft: number;
  /**
   * Total drain ticks owed so far. The caller stores the number it has already
   * applied and only charges the difference, so ticks are never double-counted.
   */
  drainTicksOwed: number;
  /** True on the evaluation where the player must become a spectator. */
  shouldEliminate: boolean;
}

/**
 * Pure out-of-zone state machine:
 *   inside → grace (warning on exit) → draining (every 10 s) → eliminated.
 *
 * `secondsOutside` is supplied by the caller because only the caller knows the
 * history; this function decides what that history means under the config.
 */
export function outOfZoneState(args: {
  distanceFromCentreMetres: number;
  zoneRadiusMetres: number;
  secondsOutside: number;
  config: MatchConfig;
}): OutOfZoneState {
  const { distanceFromCentreMetres, zoneRadiusMetres, secondsOutside, config } = args;
  const boundary = zoneRadiusMetres + config.gpsToleranceMetres;
  const outside = distanceFromCentreMetres > boundary;

  if (!outside) {
    return {
      status: "inside",
      outside: false,
      secondsOutside: 0,
      graceSecondsLeft: 0,
      drainTicksOwed: 0,
      shouldEliminate: false,
    };
  }

  const shouldEliminate = secondsOutside >= config.eliminationSecondsOutside;
  const elapsed = Math.min(secondsOutside, config.eliminationSecondsOutside);
  const drainingSeconds = Math.max(0, elapsed - config.graceSeconds);
  const drainTicksOwed = Math.floor(drainingSeconds / config.drainIntervalSeconds);

  if (shouldEliminate) {
    return {
      status: "eliminated",
      outside: true,
      secondsOutside: elapsed,
      graceSecondsLeft: 0,
      drainTicksOwed,
      shouldEliminate: true,
    };
  }

  if (elapsed < config.graceSeconds) {
    return {
      status: "grace",
      outside: true,
      secondsOutside: elapsed,
      graceSecondsLeft: config.graceSeconds - elapsed,
      drainTicksOwed: 0,
      shouldEliminate: false,
    };
  }

  return {
    status: "draining",
    outside: true,
    secondsOutside: elapsed,
    graceSecondsLeft: 0,
    drainTicksOwed,
    shouldEliminate: false,
  };
}
