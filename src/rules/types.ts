/**
 * Pure types and helpers the rules engine needs.
 *
 * This module is intentionally free of Convex and React imports. It re-declares
 * the shapes the engine works with so that it can be reused unchanged when we
 * move to Supabase.
 */

// ---- Roles & lifecycle ------------------------------------------------------

/** [RULE] Two teams, Hunters and Shadows, assigned at random. */
export type Role = "hunter" | "shadow";

/** What a tagged Shadow does for the rest of the match. Set before the match,
 *   changeable by the organiser or an invigilator at any time. */
export type PlayerMode = "spectator" | "hunter";

/** Lifecycle state of a player inside a match. */
export type PlayerStatus =
  | "active"
  | "tagged"
  | "spectator"
  | "removed"
  | "eliminated";

/** Match stage that the organiser drives. */
export type MatchStatus =
  | "lobby"
  | "locked"
  | "headstart"
  | "live"
  | "ended";

/** Public name choice on the leaderboard. */
export type DisplayNameMode = "nickname" | "real";

// ---- Positions --------------------------------------------------------------

/** WGS84 position. Raw positions are never returned publicly. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** A location as recorded by a position upload / ping. */
export interface Location {
  lat: number;
  lng: number;
  recordedAtMs: number;
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
}

export type MatchConfig = import("./config").MatchConfig;
