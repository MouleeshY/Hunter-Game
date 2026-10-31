/**
 * Proximity detection (Stage 5 add-on, condition 2).
 *
 * While the zone is still wide, a Hunter and an active Shadow who wander close
 * to each other both get a warning. It is a warning and nothing else: no
 * points, no tag, and never a position, a name or a direction — only a rough
 * distance band.
 *
 * Pure TypeScript: no Convex, React or database imports.
 */
import { distanceMetres } from "./zone";
import type { MatchConfig } from "./config";
import type { MatchStatus, Role } from "./types";

/** One side of a possible encounter. */
export interface DetectionSample {
  playerId: string;
  role: Role;
  lat: number;
  lng: number;
  accuracyMetres: number | null;
  recordedAtMs: number;
  /** Tagged Shadows and anyone out of play are not hunted any more. */
  inPlay: boolean;
  suspicious: boolean;
}

export type DetectionBlockReason =
  | "disabled"
  | "not_live"
  | "paused"
  | "zone_small"
  | "missing_position"
  | "stale_position"
  | "flagged_position"
  | "accuracy"
  | "wrong_parties"
  | "too_far"
  | "cooldown";

export interface DetectionVerdict {
  alert: boolean;
  reason: DetectionBlockReason | null;
  /** Exact metres, for the console only. */
  distanceMetres: number | null;
  /** What a player is shown: a band, never the exact number. */
  band: string | null;
}

/** Rough band shown to players: "under 25 m", then "under 50 m". */
export function detectionBand(
  distanceMetresValue: number,
  config: MatchConfig,
): string {
  const half = config.detectionRadiusMetres / 2;
  return distanceMetresValue < half
    ? `under ${Math.round(half)} m`
    : `under ${Math.round(config.detectionRadiusMetres)} m`;
}

function blockingPosition(
  sample: DetectionSample | null | undefined,
  nowMs: number,
  config: MatchConfig,
): DetectionBlockReason | null {
  if (!sample) return "missing_position";
  if (sample.suspicious) return "flagged_position";
  if (nowMs - sample.recordedAtMs > config.detectionStaleSeconds * 1000) {
    return "stale_position";
  }
  if (
    sample.accuracyMetres !== null &&
    sample.accuracyMetres > config.detectionRadiusMetres
  ) {
    return "accuracy";
  }
  return null;
}

/**
 * One full decision, so every condition is testable without a database.
 *
 * `lastAlertAtMs` is when this Hunter/Shadow pair last triggered an alert; the
 * cooldown stops the two phones buzzing at each other every few seconds.
 */
export function detectionVerdict(args: {
  nowMs: number;
  status: MatchStatus;
  paused: boolean;
  zoneRadiusMetres: number;
  hunter: DetectionSample | null;
  shadow: DetectionSample | null;
  lastAlertAtMs: number | null;
  config: MatchConfig;
}): DetectionVerdict {
  const { nowMs, status, config } = args;
  const none: DetectionVerdict = {
    alert: false,
    reason: null,
    distanceMetres: null,
    band: null,
  };
  const block = (reason: DetectionBlockReason): DetectionVerdict => ({
    ...none,
    reason,
  });

  if (!config.proximityDetectionEnabled) return block("disabled");
  if (status !== "live") return block("not_live");
  if (args.paused) return block("paused");
  if (args.zoneRadiusMetres < config.detectionMinZoneRadiusMetres) {
    return block("zone_small");
  }

  // Only a real Hunter and a still-free Shadow count.
  if (!args.hunter || !args.shadow) return block("wrong_parties");
  if (args.hunter.role !== "hunter" || args.shadow.role !== "shadow") {
    return block("wrong_parties");
  }
  if (!args.hunter.inPlay || !args.shadow.inPlay) return block("wrong_parties");

  const badHunter = blockingPosition(args.hunter, nowMs, config);
  if (badHunter) return block(badHunter);
  const badShadow = blockingPosition(args.shadow, nowMs, config);
  if (badShadow) return block(badShadow);

  const distance = distanceMetres(args.hunter, args.shadow);
  if (distance > config.detectionRadiusMetres) return block("too_far");

  if (
    args.lastAlertAtMs !== null &&
    nowMs - args.lastAlertAtMs < config.detectionCooldownSeconds * 1000
  ) {
    return block("cooldown");
  }

  return {
    alert: true,
    reason: null,
    distanceMetres: Math.round(distance),
    band: detectionBand(distance, config),
  };
}

/** Ledger key for a pair, so the cooldown can be looked up either way round. */
export function detectionPairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}
