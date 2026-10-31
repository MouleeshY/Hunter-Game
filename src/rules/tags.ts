import type { MatchConfig } from "./config";
import type { MatchStatus, PlayerSnapshot, LocationSnapshot } from "./types";
import { distanceMetres } from "./zone";

export type TagRejectionCode =
  | "match_not_active"
  | "unknown_scanner"
  | "scanner_not_hunter"
  | "scanner_not_active"
  | "unknown_target"
  | "self_scan"
  | "target_not_shadow"
  | "target_already_tagged"
  | "target_not_in_play"
  | "missing_location"
  | "flagged_location"
  | "stale_location"
  | "too_far";

export type TagVerdict =
  | { ok: true; scores: boolean; distanceMetres: number }
  | { ok: false; code: TagRejectionCode; distanceMetres?: number };

/**
 * A player is acting as a Hunter if they were assigned that team and are still
 * in play, or if they were a captured Shadow whose chosen mode is "hunter".
 */
export function actsAsHunter(player: PlayerSnapshot): boolean {
  if (player.role === "hunter") return player.status === "active";
  return player.mode === "hunter" && player.status === "tagged";
}

/**
 * The whole tag rule, in one pure function: the 40 m proximity check, the role
 * checks, and "no scoring after being tagged". The mutation in
 * `src/convex/matches.ts` calls this and then writes — it adds no rules of its
 * own.
 *
 * Rejected scans cost the Hunter nothing: no score event, no state change.
 * A converted Hunter (captured, mode "hunter") may still land a tag, but
 * `scores` comes back false, so their capture is recorded without points.
 */
export function validateTagScan(input: {
  nowMs: number;
  match: {
    status: MatchStatus;
    startedAtMs: number | null;
    endsAtMs: number | null;
  };
  scanner: PlayerSnapshot | null;
  /** Resolved server-side from the scanned QR token; null when unknown. */
  target: PlayerSnapshot | null;
  scannerLocation: LocationSnapshot | null;
  targetLocation: LocationSnapshot | null;
  config: MatchConfig;
}): TagVerdict {
  const { match, scanner, target, scannerLocation, targetLocation, config } =
    input;

  const timerRunning =
    match.status === "live" &&
    match.startedAtMs !== null &&
    (match.endsAtMs === null || input.nowMs <= match.endsAtMs);
  if (!timerRunning) return { ok: false, code: "match_not_active" };

  if (!scanner) return { ok: false, code: "unknown_scanner" };
  if (!actsAsHunter(scanner)) {
    return {
      ok: false,
      code:
        scanner.role === "hunter" ? "scanner_not_active" : "scanner_not_hunter",
    };
  }

  if (!target) return { ok: false, code: "unknown_target" };
  if (target.id === scanner.id) return { ok: false, code: "self_scan" };
  if (target.role !== "shadow") return { ok: false, code: "target_not_shadow" };
  if (target.taggedAtMs !== null)
    return { ok: false, code: "target_already_tagged" };
  if (target.status !== "active")
    return { ok: false, code: "target_not_in_play" };

  if (!scannerLocation || !targetLocation) {
    return { ok: false, code: "missing_location" };
  }

  // A reading the spoof check flagged never counts for a tag, whichever side
  // it belongs to. Invigilators can still force a tag themselves.
  if (scannerLocation.suspicious === true || targetLocation.suspicious === true) {
    return { ok: false, code: "flagged_location" };
  }

  // Both readings must be recent: the Hunter's phone sends its GPS reading with
  // the scan, and the Shadow's phone refreshes its position when the QR opens.
  const freshnessMs = config.tagFreshnessSeconds * 1000;
  if (
    input.nowMs - scannerLocation.recordedAtMs > freshnessMs ||
    input.nowMs - targetLocation.recordedAtMs > freshnessMs
  ) {
    return { ok: false, code: "stale_location" };
  }

  const distance = distanceMetres(scannerLocation, targetLocation);
  if (distance > config.tagProximityMetres) {
    return { ok: false, code: "too_far", distanceMetres: distance };
  }

  return {
    ok: true,
    // "Stops scoring for the match": anyone who has ever been tagged is done.
    scores: scanner.taggedAtMs === null,
    distanceMetres: distance,
  };
}
