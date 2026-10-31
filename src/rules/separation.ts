/**
 * Initial separation during the setup phase (Stage 5 add-on, condition 1).
 *
 * Everyone walks to a starting position while the clock is stopped. Every
 * player must be at least `minSeparationMetres` from every other player, and a
 * Hunter must be at least `minHunterShadowSeparationMetres` from any Shadow.
 *
 * Pure TypeScript: no Convex, React or database imports. The caller passes the
 * readings the server already holds; nothing here decides who is who.
 */
import { distanceMetres } from "./zone";
import type { MatchConfig } from "./config";
import type { Role } from "./types";

/** One player's latest usable reading. */
export interface SeparationSample {
  playerId: string;
  role: Role;
  lat: number;
  lng: number;
  accuracyMetres: number | null;
  recordedAtMs: number;
  /** Spoof-checked readings never prove separation. */
  suspicious: boolean;
}

export interface SeparationViolation {
  aId: string;
  bId: string;
  distanceMetres: number;
  requiredMetres: number;
}

/** What one player is shown: only a distance, never a name or a role. */
export interface SeparationStatus {
  ok: boolean;
  /** Distance to the nearest player who is too close, or null when clear. */
  distanceMetres: number | null;
  /** The distance that was required in that case. */
  requiredMetres: number | null;
  /** True while the player has no usable reading of their own yet. */
  waiting: boolean;
}

/** The distance this pair must keep, whichever way round it is asked. */
export function requiredSeparation(
  a: Role,
  b: Role,
  config: MatchConfig,
): number {
  return a !== b
    ? config.minHunterShadowSeparationMetres
    : config.minSeparationMetres;
}

function usable(
  sample: SeparationSample | null | undefined,
  nowMs: number,
  config: MatchConfig,
): sample is SeparationSample {
  if (!sample) return false;
  if (sample.suspicious) return false;
  if (nowMs - sample.recordedAtMs > config.detectionStaleSeconds * 1000) {
    return false;
  }
  return true;
}

/**
 * Every pair that is too close right now. Both players must have a fresh,
 * unflagged reading; a pair with a missing reading simply cannot be judged and
 * is left out (the console reports those separately as "waiting").
 */
export function separationViolations(args: {
  samples: (SeparationSample | null)[];
  nowMs: number;
  config: MatchConfig;
}): SeparationViolation[] {
  const { nowMs, config } = args;
  const good = args.samples.filter((sample) =>
    usable(sample, nowMs, config),
  ) as SeparationSample[];

  const violations: SeparationViolation[] = [];
  for (let i = 0; i < good.length; i += 1) {
    for (let j = i + 1; j < good.length; j += 1) {
      const a = good[i];
      const b = good[j];
      const required = requiredSeparation(a.role, b.role, config);
      const distance = distanceMetres(a, b);
      if (distance < required) {
        violations.push({
          aId: a.playerId,
          bId: b.playerId,
          distanceMetres: Math.round(distance),
          requiredMetres: required,
        });
      }
    }
  }
  return violations.sort((x, y) => x.distanceMetres - y.distanceMetres);
}

/**
 * What one player is told: green when they are far enough from everyone, red
 * with the distance to the nearest person they are too close to. The caller
 * must not attach a name, a role or a position to this.
 */
export function separationStatusFor(
  playerId: string,
  args: {
    samples: (SeparationSample | null)[];
    nowMs: number;
    config: MatchConfig;
  },
): SeparationStatus {
  const mine = args.samples.find((sample) => sample?.playerId === playerId);
  if (!usable(mine, args.nowMs, args.config)) {
    return { ok: false, distanceMetres: null, requiredMetres: null, waiting: true };
  }

  let nearest: { distance: number; required: number } | null = null;
  for (const other of args.samples) {
    if (!other || other.playerId === playerId) continue;
    if (!usable(other, args.nowMs, args.config)) continue;
    const required = requiredSeparation(mine.role, other.role, args.config);
    const distance = distanceMetres(mine, other);
    if (distance >= required) continue;
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, required };
    }
  }

  if (!nearest) {
    return { ok: true, distanceMetres: null, requiredMetres: null, waiting: false };
  }
  return {
    ok: false,
    distanceMetres: Math.round(nearest.distance),
    requiredMetres: nearest.required,
    waiting: false,
  };
}

/** Staff view: who is standing too close to whom. */
export function separationPairsFor(
  playerId: string,
  violations: SeparationViolation[],
): SeparationViolation[] {
  return violations.filter(
    (violation) => violation.aId === playerId || violation.bId === playerId,
  );
}
