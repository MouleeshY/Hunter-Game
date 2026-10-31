/**
 * Pure types the rules engine needs.
 *
 * This module has no Convex, React or database imports. Convex validators for
 * the same literals live in `src/convex/validators.ts`, so the engine can be
 * reused unchanged when the data layer moves to Supabase.
 */

// ---- Roles & lifecycle ------------------------------------------------------

/** [RULE] Two teams, Hunters and Shadows, assigned at random at start. */
export type Role = "hunter" | "shadow";

/**
 * What a tagged Shadow does for the rest of the match. Set before the match,
 * changeable by the organiser or an invigilator at any time, and re-chosen by
 * the player themselves at the moment of capture.
 *
 * - `spectator` stops playing.
 * - `hunter` joins the Hunters and may land tags (they score nothing).
 * - `helper` sticks with a Hunter for fun and earns no points; their help is
 *   recorded as the capture's `assistedBy`.
 */
export type PlayerMode = "spectator" | "hunter" | "helper";

/** Lifecycle state of a player inside a match. */
export type PlayerStatus =
  | "active"
  | "tagged"
  | "spectator"
  | "removed"
  | "eliminated";

/**
 * Match stage the organiser drives.
 *
 * lobby → locked → headstart → live → ended
 * `locked` is optional: the organiser may start straight from the lobby.
 */
export type MatchStatus = "lobby" | "locked" | "headstart" | "live" | "ended";

/** Public name choice on the leaderboard. */
export type DisplayNameMode = "nickname" | "real";

// ---- Positions --------------------------------------------------------------

/** WGS84 position. Raw positions are never returned publicly. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** A position as recorded by an upload or ping. */
export interface Location {
  lat: number;
  lng: number;
  recordedAtMs: number;
}

/** A stored position row, including its accuracy and ping index. */
export interface LocationSnapshot extends Location {
  accuracyMetres: number | null;
  pingIndex: number;
  /** Spoof check: an impossible jump or accuracy. A flagged reading never
   *  counts for a tag. */
  suspicious?: boolean;
}

// ---- Minimal data a rule needs ---------------------------------------------

/** The minimum the rules need to know about a player. */
export interface PlayerSnapshot {
  id: string;
  role: Role;
  mode: PlayerMode;
  status: PlayerStatus;
  taggedAtMs: number | null;
}

/** The minimum the rules need to know about a match. */
export interface MatchSnapshot {
  status: MatchStatus;
  startedAtMs: number | null;
  endsAtMs: number | null;
  config: MatchConfig;
  /** Wall-clock moment the match was frozen, or null while running. */
  pausedAtMs?: number | null;
  /** Total milliseconds already spent paused, so the clock can skip them. */
  pausedTotalMs?: number;
}

export type MatchConfig = import("./config").MatchConfig;
