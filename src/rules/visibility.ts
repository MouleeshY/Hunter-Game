/**
 * Position visibility rules.
 *
 * Pure TypeScript: no Convex, React or database imports. The server resolves
 * the actual coordinates; this module only decides what a viewer is allowed to
 * know and how stale it must be. Hunters can never receive a live Shadow
 * position — the strongest mode they can get for a Shadow is `ping`.
 */
import type { PlayerStatus, Role } from "./types";

/** How a position may be shown. */
export type VisibilityMode = "live" | "ping" | "delayed";

export type Viewer =
  | { kind: "invigilator" }
  | {
      kind: "player";
      playerId: string;
      role: Role;
      status: PlayerStatus;
    };

export interface Candidate {
  playerId: string;
  role: Role;
  status: PlayerStatus;
}

function isSpectator(status: PlayerStatus): boolean {
  return (
    status === "tagged" ||
    status === "spectator" ||
    status === "eliminated" ||
    status === "removed"
  );
}

/**
 * What this viewer may see of this player, or null when nothing may be shown.
 *
 * - Invigilators see everyone live.
 * - Hunters see their own team live and Shadows only at the ping.
 * - Shadows see their own team live; Hunters are not shown to them.
 * - Spectators (tagged or eliminated) see everyone 60 s behind.
 * - A player always sees their own position live.
 * - Removed players are never shown.
 */
export function visibilityFor(
  viewer: Viewer,
  candidate: Candidate,
): VisibilityMode | null {
  if (candidate.status === "removed") return null;

  if (viewer.kind === "invigilator") return "live";

  if (viewer.playerId === candidate.playerId) return "live";

  if (isSpectator(viewer.status)) return "delayed";

  if (viewer.role === "hunter") {
    if (candidate.role === "hunter") return "live";
    return candidate.status === "active" ? "ping" : null;
  }

  // Shadow viewer: own team live, never the Hunters.
  if (candidate.role === "shadow") return "live";
  return null;
}

/** Spectator delay in milliseconds. */
export function spectatorDelayMs(config: { spectatorDelaySeconds: number }): number {
  return config.spectatorDelaySeconds * 1000;
}
