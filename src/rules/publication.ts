/**
 * When a match result may be shown in public.
 *
 * Decided rules (Stage 6):
 *   - a result is public only once the match has ENDED; a live table would say
 *     who is already out;
 *   - an aborted match is private unless the organiser publishes it by hand;
 *   - the organiser may hide or restore any result at any time.
 *
 * Pure TypeScript: no Convex, React or database imports.
 */
import type { MatchEndReason, MatchStatus } from "./types";

/**
 * What the organiser chose: `published` / `hidden`, or `null` for "leave it to
 * the default".
 */
export type PublishOverride = "published" | "hidden" | null;

export interface PublicationSnapshot {
  status: MatchStatus;
  endReason: MatchEndReason | null;
  override: PublishOverride;
}

/** Is this result readable by someone with the link (or in the public list)? */
export function isResultPublic(snapshot: PublicationSnapshot): boolean {
  if (snapshot.status !== "ended") return false;
  if (snapshot.override === "hidden") return false;
  if (snapshot.override === "published") return true;
  // Default: a played-out match goes public, an abort stays private.
  return snapshot.endReason !== "aborted";
}

/** Publishing is only ever offered once the match has ended. */
export function canChangePublication(status: MatchStatus): boolean {
  return status === "ended";
}

/** The override stored on a match, or null while the default applies. */
export function overrideOf(published: boolean | null): PublishOverride {
  if (published === null) return null;
  return published ? "published" : "hidden";
}
