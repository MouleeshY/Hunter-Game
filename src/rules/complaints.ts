/**
 * Complaint rules.
 *
 * A Hunter taps "Shadow won't show code" and names an active Shadow. Pure
 * TypeScript: no Convex, React or database imports. Every number comes from
 * the match's config snapshot.
 *
 *   - filed within `complaintFilingWindowMinutes` of the incident
 *   - one open complaint per Hunter/Shadow pair
 *   - at most `complaintRateLimit` filings per Hunter per
 *     `complaintRateWindowMinutes`
 *   - an invigilator has `complaintResponseMinutes` to respond; after that the
 *     complaint reads as OVERDUE
 */
import type { MatchConfig } from "./config";
import type { PlayerStatus, Role } from "./types";

export type ComplaintRejectionCode =
  | "match_not_active"
  | "match_paused"
  | "not_a_player"
  | "scanner_not_hunter"
  | "unknown_target"
  | "self_complaint"
  | "target_not_active_shadow"
  | "window_expired"
  | "duplicate_open"
  | "rate_limited";

export type ComplaintVerdict =
  | { ok: true }
  | { ok: false; code: ComplaintRejectionCode };

/** The minimum a complaint rule needs to know about a player. */
export interface ComplaintPlayer {
  id: string;
  role: Role;
  status: PlayerStatus;
}

/** One complaint already on record, from the complainant's point of view. */
export interface ComplaintRecord {
  complainantId: string;
  accusedId: string;
  status: "open" | "upheld" | "dismissed";
  createdAtMs: number;
}

/**
 * Whether this complaint may be filed right now.
 *
 * The caller supplies everything the rules need — including `incidentAtMs`,
 * which on a phone is "the moment the Hunter tapped the button" — so the whole
 * decision is testable without a database.
 */
export function complaintPolicy(input: {
  nowMs: number;
  incidentAtMs: number;
  matchActive: boolean;
  /** True while the match is frozen: no complaint may be filed. */
  matchPaused?: boolean;
  complainant: ComplaintPlayer | null;
  target: ComplaintPlayer | null;
  existing: ComplaintRecord[];
  config: MatchConfig;
}): ComplaintVerdict {
  const { nowMs, incidentAtMs, matchActive, complainant, target, config } = input;

  if (!matchActive) return { ok: false, code: "match_not_active" };
  if (input.matchPaused === true) return { ok: false, code: "match_paused" };
  if (!complainant) return { ok: false, code: "not_a_player" };
  if (complainant.role !== "hunter") {
    return { ok: false, code: "scanner_not_hunter" };
  }
  if (!target) return { ok: false, code: "unknown_target" };
  if (target.id === complainant.id) return { ok: false, code: "self_complaint" };
  if (target.role !== "shadow" || target.status !== "active") {
    return { ok: false, code: "target_not_active_shadow" };
  }

  // The incident may be slightly in the future if the phone clock leads the
  // server; only a genuinely late filing is refused.
  const ageMinutes = (nowMs - incidentAtMs) / 60_000;
  if (ageMinutes > config.complaintFilingWindowMinutes) {
    return { ok: false, code: "window_expired" };
  }

  const mine = input.existing.filter(
    (record) => record.complainantId === complainant.id,
  );
  if (
    mine.some(
      (record) =>
        record.accusedId === target.id && record.status === "open",
    )
  ) {
    return { ok: false, code: "duplicate_open" };
  }

  const windowMs = config.complaintRateWindowMinutes * 60_000;
  const recent = mine.filter(
    (record) => nowMs - record.createdAtMs <= windowMs,
  );
  if (recent.length >= config.complaintRateLimit) {
    return { ok: false, code: "rate_limited" };
  }

  return { ok: true };
}

export function complaintRejectionMessage(code: ComplaintRejectionCode): string {
  switch (code) {
    case "match_not_active":
      return "Complaints can only be filed while the match is running.";
    case "match_paused":
      return "The match is paused. Complaints open again as soon as it resumes.";
    case "not_a_player":
      return "You are not in this match.";
    case "scanner_not_hunter":
      return "Only Hunters can report a Shadow.";
    case "unknown_target":
      return "That player is not in this match.";
    case "self_complaint":
      return "You cannot report yourself.";
    case "target_not_active_shadow":
      return "That Shadow is no longer in play.";
    case "window_expired":
      return "That happened too long ago to report.";
    case "duplicate_open":
      return "You already have an open complaint about that Shadow.";
    case "rate_limited":
      return "You have filed too many complaints recently. Wait a moment.";
  }
}

/** OVERDUE once the response limit has passed with no answer. */
export function complaintIsOverdue(args: {
  nowMs: number;
  responseDueAtMs: number;
  status: "open" | "upheld" | "dismissed";
}): boolean {
  return args.status === "open" && args.nowMs > args.responseDueAtMs;
}

/** Milliseconds left before the response limit, floored at zero. */
export function complaintTimeLeftMs(args: {
  nowMs: number;
  responseDueAtMs: number;
}): number {
  return Math.max(0, args.responseDueAtMs - args.nowMs);
}
