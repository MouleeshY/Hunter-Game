/**
 * Position visibility rules.
 *
 * Pure TypeScript: no Convex, React or database imports. The server resolves
 * the actual coordinates; this module only decides what a viewer is allowed to
 * know and how stale it must be. Hunters can never receive a live Shadow
 * position — the strongest mode they can get for a Shadow is `ping`.
 *
 * Two views exist:
 *
 *   - the **Hunter view** — own team live, active Shadows only at the ping.
 *     Everyone who is not an active Shadow gets this: Hunters, Spectators,
 *     Helpers, caught players and eliminated players. (Stage 5 decision 4:
 *     the 60-second delayed view is gone.)
 *   - the **Shadow view** — own team live, Hunters not shown at all. Only an
 *     active Shadow has it.
 *
 * Invigilators see everything live.
 */
import type { PlayerMode, PlayerStatus, Role } from "./types";

/** How a position may be shown. */
export type VisibilityMode = "live" | "ping";

export type Viewer =
  | { kind: "invigilator" }
  | {
      kind: "player";
      playerId: string;
      role: Role;
      status: PlayerStatus;
      /** Post-capture mode, so a caught player can be told apart. */
      mode?: PlayerMode;
    };

export interface Candidate {
  playerId: string;
  role: Role;
  status: PlayerStatus;
}

/** Still in play for their own team: an untagged, un-removed Shadow. */
function isActiveShadow(viewer: Viewer & { kind: "player" }): boolean {
  return viewer.role === "shadow" && viewer.status === "active";
}

/**
 * What this viewer may see of this player, or null when nothing may be shown.
 *
 * - Invigilators see everyone live.
 * - A player always sees their own position live.
 * - An active Shadow sees their own team live and never the Hunters.
 * - Everybody else — Hunters, Spectators, Helpers, caught players, the
 *   eliminated — gets the Hunter view: own team live, active Shadows only as a
 *   ping ghost.
 * - Removed players are never shown.
 */
export function visibilityFor(
  viewer: Viewer,
  candidate: Candidate,
): VisibilityMode | null {
  if (candidate.status === "removed") return null;

  if (viewer.kind === "invigilator") return "live";

  if (viewer.playerId === candidate.playerId) return "live";

  if (isActiveShadow(viewer)) {
    return candidate.role === "shadow" ? "live" : null;
  }

  if (candidate.role === "hunter") return "live";
  return candidate.status === "active" ? "ping" : null;
}
