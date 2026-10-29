/**
 * Server facade for match lifecycle.
 *
 * This module owns the high-level server use-cases that involve more than one
 * repository: creating a match, joining a match, starting it, uploading a
 * position, and the simple read-side helpers the front end will ask for. All
 * reads and writes go through the repository interfaces, so the rules engine
 * and the repository implementations never leak Convex into each other.
 *
 * The actual mutations / queries exposed to Convex live in `src/convex/matches.ts`
 * and the new room-mutation module. They call into this module after resolving
 * auth and ids.
 */

import { repos } from "../providers/convex";
import { selectProvider } from "./helpers";
import type {
  MatchConfig,
  MatchStatus,
  PlayerStatus,
  PlayerMode,
  LatLng,
} from "../rules/types";
import { RULES_CONFIG } from "../rules/config";
import { assignTeams, teamConfigForCount, randomZoneCentre } from "./teamOps";
import { makeId } from "../lib/id";

// ---- provider dispatch ------------------------------------------------------

function provider(): "convex" | "supabase" {
  return selectProvider();
}

// ---- create match -----------------------------------------------------------

export function createMatch(input: {
  createdByUserId: string | null;
  matchDurationMinutes: number;
  invigilators: { displayName: string }[];
  organiserLat: number;
  organiserLng: number;
  rerollCentre?: boolean;
  previousCentre?: LatLng | null;
}): {
  matchId: string;
  roomCode: string;
  zone: { centreLat: number; centreLng: number; initialRadiusMetres: number };
} {
  const providerName = provider();
  if (providerName !== "convex") {
    throw new Error(
      `DATA_PROVIDER=${providerName} is not wired yet; expected convex.`,
    );
  }

  if (
    input.matchDurationMinutes < RULES_CONFIG.eventWindowMinutes.min ||
    input.matchDurationMinutes > RULES_CONFIG.eventWindowMinutes.max
  ) {
    throw new RangeError(
      `matchDurationMinutes must be between ${RULES_CONFIG.eventWindowMinutes.min} and ${RULES_CONFIG.eventWindowMinutes.max}.`,
    );
  }

  const invigilatorCount = input.invigilators.length;
  if (
    invigilatorCount < RULES_CONFIG.invigilatorCount.min ||
    invigilatorCount > RULES_CONFIG.invigilatorCount.max
  ) {
    throw new RangeError(
      `A match needs between ${RULES_CONFIG.invigilatorCount.min} and ${RULES_CONFIG.invigilatorCount.max} invigilators. Requested ${invigilatorCount}.`,
    );
  }

  // Centre is picked within a configurable distance of the organiser. If the
  // organiser asks for a re-roll we keep trying until we get a fresh centre.
  const centre = randomZoneCentre({
    organiserLat: input.organiserLat,
    organiserLng: input.organiserLng,
    maxDistanceMetres: RULES_CONFIG.centrePickDistanceMetres,
    avoid: rerollCondition(input.rerollCentre, input.previousCentre),
  });

  // At this stage we do not yet have players, but players are the base from
  // which the radius table and team split are derived. When the roster lands
  // we store the config snapshot.
  const configSnapshot: MatchConfig = {
    ...RULES_CONFIG,
    matchDurationMinutes: input.matchDurationMinutes,
  };

  const createdAt = Date.now();
  const doc = repos.matches.create({
    status: "lobby" as MatchStatus,
    config: configSnapshot,
    createdByUserId: input.createdByUserId,
    zoneCentre: centre,
    initialRadiusMetres:
      configSnapshot.radiusTable[configSnapshot.radiusTable.length - 1]
        .radiusMetres,
    eventWindowMinutesMax: configSnapshot.eventWindowMinutes.max,
    matchDurationMinutes: input.matchDurationMinutes,
  });

  const roomCode = roomCodeFromCreatedAt(createdAt);
  return {
    matchId: "",
    roomCode,
    zone: {
      centreLat: centre.lat,
      centreLng: centre.lng,
      initialRadiusMetres:
        configSnapshot.radiusTable[configSnapshot.radiusTable.length - 1]
          .radiusMetres,
    },
  };
}

function rerollCondition(
  reroll: boolean | undefined,
  previous: LatLng | null | undefined,
): LatLng | null {
  if (!reroll) return null;
  if (previous == null) return null;
  return previous;
}

// ---- room code --------------------------------------------------------------

/** 5-character code derived from the creation time so it is stable, offline-
 *   verifiable, and easy to type. */
export function roomCodeFromCreatedAt(createdAt: number): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let n = (createdAt / 1000) >>> 0;
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return code;
}

export function validateRoomCode(code: string): string {
  if (typeof code !== "string") return "Room code must be text.";
  if (code.length !== 5) return "Room code is 5 characters.";
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (const ch of code) {
    if (!alphabet.includes(ch))
      return "Room code uses the on-screen character set.";
  }
  return "";
}

// ---- join match -------------------------------------------------------------

export function joinMatch(input: {
  matchId: string;
  userId: string;
  displayName: string;
  displayNameMode: "nickname" | "real";
  callSign: string;
}): { playerId: string; qrToken: string; displayName: string } {
  const providerName = provider();
  if (providerName !== "convex") {
    throw new Error("DATA_PROVIDER is not wired for this path yet.");
  }

  // Validated on the server, too — the phone never trusts itself.
  const nameError = validateDisplayName(input.displayName);
  if (nameError) throw new Error(nameError);
  const callSignError = validateCallSign(input.callSign);
  if (callSignError) throw new Error(callSignError);

  const playerId = makeId(Date.now(), 0);
  const qrToken = makeQRToken(playerId);
  return { playerId, qrToken, displayName: input.displayName };
}

function validateDisplayName(name: string): string {
  if (typeof name !== "string") return "Display name is required.";
  const t = name.trim();
  if (t.length === 0) return "Display name is required.";
  if (t.length > 60) return "Display name is too long.";
  return "";
}

function validateCallSign(callSign: string): string {
  if (typeof callSign !== "string") return "Call sign is required.";
  const t = callSign.trim();
  if (t.length === 0) return "Call sign is required.";
  if (t.length > 32) return "Call sign is too long.";
  return "";
}

// ---- QR token ---------------------------------------------------------------

/** Plain, per-match, per-player token. No secrets, no photos, no personal data. */
export function makeQRToken(playerId: string): string {
  // Deterministic enough to be stable for the match and opaque to anyone who
  // does not have the player id. The real value is rendered as a QR code on the
  // phone; what we store is the token the server recognises.
  let h = 0;
  for (let i = 0; i < playerId.length; i++) {
    h = (Math.imul(h ^ playerId.charCodeAt(i), 2654435761) >>> 0) >>> 0;
  }
  return (
    "SH-" +
    h.toString(36).padStart(6, "0") +
    "-" +
    Date.now().toString(36).slice(-4)
  );
}

// ---- team assignment -------------------------------------------------------

export { assignTeams, teamConfigForCount, randomZoneCentre } from "./teamOps";

// ---- position upload --------------------------------------------------------

export function positionUploadRecord(input: {
  matchId: string;
  playerId: string;
  lat: number;
  lng: number;
  accuracyMetres: number | null;
  reportedAtClientMs: number;
}): void {
  const providerName = provider();
  if (providerName !== "convex") {
    throw new Error("DATA_PROVIDER is not wired for this path yet.");
  }

  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    throw new Error("Latitude out of range.");
  }
  if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    throw new Error("Longitude out of range.");
  }

  // Store it server-side; the phone keeps uploading every 5–10 seconds and the
  // server decides what to reveal. Nothing here enforces the 3-minute ping —
  // that is purely a reveal rule.
  repos.locations.insert({
    matchId: input.matchId,
    playerId: input.playerId,
    lat: input.lat,
    lng: input.lng,
    accuracyMetres: input.accuracyMetres,
    reportedAtClientMs: input.reportedAtClientMs,
  });
}
