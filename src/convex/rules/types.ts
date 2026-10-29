import { Infer, v } from "convex/values";

export const roleValidator = v.union(v.literal("hunter"), v.literal("shadow"));
/** A player's team. Fixed once the roster is locked. */
export type Role = Infer<typeof roleValidator>;

export const playerModeValidator = v.union(
  v.literal("spectator"),
  v.literal("hunter"),
);
/** What a tagged Shadow does for the rest of the match. Chosen before the match. */
export type PlayerMode = Infer<typeof playerModeValidator>;

export const playerStatusValidator = v.union(
  v.literal("active"),
  v.literal("tagged"),
  v.literal("spectator"),
  v.literal("eliminated"),
);
/** Lifecycle state of a player inside a match. */
export type PlayerStatus = Infer<typeof playerStatusValidator>;

export const matchStatusValidator = v.union(
  v.literal("setup"),
  v.literal("active"),
  v.literal("ended"),
);
export type MatchStatus = Infer<typeof matchStatusValidator>;

export const displayNameModeValidator = v.union(
  v.literal("nickname"),
  v.literal("real"),
);
/** Public name choice on the leaderboard. */
export type DisplayNameMode = Infer<typeof displayNameModeValidator>;

/** WGS84 position. Raw positions are never returned to other players. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** The minimum a validation rule needs to know about a player. */
export interface PlayerSnapshot {
  id: string;
  role: Role;
  mode: PlayerMode;
  status: PlayerStatus;
  taggedAtMs: number | null;
}

/** Last known position of a player, as recorded by a ping. */
export interface LocationSnapshot {
  lat: number;
  lng: number;
  recordedAtMs: number;
}
