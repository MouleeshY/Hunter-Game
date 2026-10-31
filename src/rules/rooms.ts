/**
 * Room and lobby rules.
 *
 * Pure TypeScript: no Convex, React or database imports. Everything here is
 * unit-testable and shared by the Convex mutations and, later, Supabase.
 */
import type { MatchConfig } from "./config";
import type { MatchStatus } from "./types";

/* ------------------------------------------------------------------ *\n * Codes\n * ------------------------------------------------------------------ */

/** Join-code alphabet without 0/O/1/I so codes survive being read aloud. */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Five-character room code. `random` is injected so tests are deterministic and
 * the production caller can pass a cryptographic source.
 */
export function generateRoomCode(
  random: () => number,
  length: number,
): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[Math.min(index, ROOM_CODE_ALPHABET.length - 1)];
  }
  return code;
}

/** Invigilator invite codes use the same alphabet and a slightly longer length. */
export function generateInviteCode(
  random: () => number,
  length: number,
): string {
  return generateRoomCode(random, length);
}

/** Uppercase, trim and strip spaces/punctuation so "ab 2cd" joins "AB2CD". */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 12);
}

/** A room code is valid when it is exactly `length` alphabet characters. */
export function isValidRoomCode(code: string, config: MatchConfig): boolean {
  if (code.length !== config.roomCodeLength) return false;
  for (const char of code) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

/** Returns an error message, or null when the code is well formed. */
export function roomCodeError(
  input: string,
  config: MatchConfig,
): string | null {
  const code = normalizeRoomCode(input);
  if (code.length === 0) return "Enter the room code.";
  if (!isValidRoomCode(code, config)) {
    return `A room code is ${config.roomCodeLength} characters, like AB2CD.`;
  }
  return null;
}

/* ------------------------------------------------------------------ *\n * Player details\n * ------------------------------------------------------------------ */

/** The call sign is what other players see in the lobby. */
export function callSignError(input: string): string | null {
  const value = input.trim();
  if (value.length < 2) return "Call signs are at least 2 characters.";
  if (value.length > 24) return "Call signs are at most 24 characters.";
  return null;
}

/** The leaderboard name: a nickname or the player's real name. */
export function displayNameError(input: string): string | null {
  const value = input.trim();
  if (value.length < 2) return "Names are at least 2 characters.";
  if (value.length > 32) return "Names are at most 32 characters.";
  return null;
}

/* ------------------------------------------------------------------ *\n * Roster policy\n * ------------------------------------------------------------------ */

export type JoinRefusal =
  | "unknown_room"
  | "match_started"
  | "roster_locked"
  | "full"
  | "already_joined"
  | "duplicate_call_sign"
  | null;

export interface JoinPolicyInput {
  status: MatchStatus;
  rosterLocked: boolean;
  playerCount: number;
  alreadyJoined: boolean;
  callSignTaken: boolean;
  config: MatchConfig;
}

/**
 * Joining is only possible while the room is in its lobby and the roster is
 * unlocked. The soft cap is how many players the app supports; there is no hard
 * maximum beyond it.
 */
export function joinPolicy(input: JoinPolicyInput): JoinRefusal {
  const {
    status,
    rosterLocked,
    playerCount,
    alreadyJoined,
    callSignTaken,
    config,
  } = input;

  if (status === "locked") return "roster_locked";
  if (status !== "lobby") return "match_started";
  if (rosterLocked) return "roster_locked";
  if (alreadyJoined) return "already_joined";
  if (playerCount >= config.softCapPlayers) return "full";
  if (callSignTaken) return "duplicate_call_sign";
  return null;
}

export function joinRefusalMessage(reason: JoinRefusal): string | null {
  switch (reason) {
    case null:
      return null;
    case "unknown_room":
      return "No room with that code.";
    case "match_started":
      return "That match has already started.";
    case "roster_locked":
      return "The roster is locked. Ask the organiser to unlock it.";
    case "full":
      return "That room is full.";
    case "already_joined":
      return "You are already in this room.";
    case "duplicate_call_sign":
      return "That call sign is taken. Pick another one.";
  }
}

/* ------------------------------------------------------------------ *\n * Match state machine\n * ------------------------------------------------------------------ */

export type MatchEvent = "lock" | "unlock" | "start" | "end" | "extend";

/**
 * The only legal match transitions:
 *   lobby     → locked, setup
 *   locked    → lobby, setup
 *   setup     → setup (extend), headstart
 *   headstart → live, ended
 *   live      → ended
 * Everything else is refused, so a late join or a double start cannot slip in.
 */
export function nextMatchStatus(
  current: MatchStatus,
  event: MatchEvent,
): MatchStatus | null {
  if (current === "lobby") {
    if (event === "lock") return "locked";
    if (event === "start") return "setup";
    return null;
  }
  if (current === "locked") {
    if (event === "unlock") return "lobby";
    if (event === "start") return "setup";
    return null;
  }
  if (current === "setup") {
    if (event === "extend") return "setup";
    if (event === "start") return "headstart";
    return null;
  }
  if (current === "headstart") {
    if (event === "start") return "live";
    if (event === "end") return "ended";
    return null;
  }
  if (current === "live") {
    if (event === "end") return "ended";
    return null;
  }
  return null;
}

/**
 * The organiser may start once the minimum is in, from lobby or locked.
 *
 * Every player must also have confirmed the rules briefing first (Stage 5,
 * task 1) — unless the organiser passes `force`, which is the confirmed
 * "start anyway" button after they have been told who is missing.
 */
export function canStartMatch(input: {
  status: MatchStatus;
  playerCount: number;
  config: MatchConfig;
  /** Players who have tapped "I understand". Omit to skip the gate. */
  briefedCount?: number;
  /** The organiser confirmed they want to start with people missing. */
  force?: boolean;
}): { allowed: boolean; reason: string | null; pendingBriefings: number } {
  const { status, playerCount, config } = input;
  const pendingBriefings =
    input.briefedCount === undefined
      ? 0
      : Math.max(0, playerCount - input.briefedCount);

  if (status !== "lobby" && status !== "locked") {
    return {
      allowed: false,
      reason: "This match has already started.",
      pendingBriefings,
    };
  }
  if (playerCount < config.minPlayers) {
    return {
      allowed: false,
      reason: `At least ${config.minPlayers} players are needed to start.`,
      pendingBriefings,
    };
  }
  if (playerCount > config.softCapPlayers) {
    return {
      allowed: false,
      reason: `A room can hold at most ${config.softCapPlayers} players.`,
      pendingBriefings,
    };
  }
  if (pendingBriefings > 0 && input.force !== true) {
    return {
      allowed: false,
      reason:
        pendingBriefings === 1
          ? "1 player has not confirmed the rules yet."
          : `${pendingBriefings} players have not confirmed the rules yet.`,
      pendingBriefings,
    };
  }
  return { allowed: true, reason: null, pendingBriefings: 0 };
}

/**
 * The stage the clock has moved the match to. The stored status is written by
 * the organiser (or by the head-start transition); this only answers "has the
 * head start ended, and has the timer run out".
 */
export function statusForClock(input: {
  stored: MatchStatus;
  startedAtMs: number | null;
  endsAtMs: number | null;
  nowMs: number;
  config: MatchConfig;
}): MatchStatus {
  const { stored, startedAtMs, endsAtMs, nowMs, config } = input;
  if (stored === "ended") return "ended";
  if (stored !== "headstart" && stored !== "live") return stored;
  if (startedAtMs === null) return stored;
  if (endsAtMs !== null && nowMs >= endsAtMs) return "ended";
  if (nowMs < startedAtMs + config.headStartMinutes * 60_000) {
    return "headstart";
  }
  return "live";
}
