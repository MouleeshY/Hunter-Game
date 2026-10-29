/**
 * Match lifecycle service.
 *
 * Every high-level use-case that touches more than one repository lives here:
 * creating a room, joining it, locking the roster, starting the match, accepting
 * an invigilator invite, and uploading a position. All reads and writes go
 * through `getRepos()`, so the database can be swapped by DATA_PROVIDER without
 * touching this file. The rules themselves come from `src/rules` and are pure.
 */
import {
  assignTeams,
  canStartMatch,
  generateInviteCode,
  generateRoomCode,
  joinPolicy,
  joinRefusalMessage,
  normalizeRoomCode,
  radiusForPlayerCount,
  randomZoneCentre,
  RULES_CONFIG,
  roomCodeError,
  callSignError,
  displayNameError,
  statusForClock,
  uploadSchedule,
  type DisplayNameMode,
  type MatchConfig,
  type MatchStatus,
  type Role,
} from "../rules";
import { getRepos } from "./providers";
import type { MatchRow, RepoContext } from "./repos";

// ---- shared helpers --------------------------------------------------------

function randomUnit(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

function randomToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

function assertLatLng(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }
}

/** The stage the clock has moved the match to. */
export function effectiveStatus(match: MatchRow, nowMs: number): MatchStatus {
  return statusForClock({
    stored: match.status,
    startedAtMs: match.startedAt,
    endsAtMs: match.endsAt,
    nowMs,
    config: match.config,
  });
}

async function requireMatchByCode(
  ctx: RepoContext,
  roomCode: string,
): Promise<MatchRow> {
  const code = normalizeRoomCode(roomCode);
  const match = await getRepos().matches.findByRoomCode(ctx, code);
  if (!match) throw new Error(joinRefusalMessage("unknown_room") ?? "Unknown room.");
  return match;
}

// ---- create match ----------------------------------------------------------

export interface CreatedMatch {
  matchId: string;
  roomCode: string;
  zone: { centreLat: number; centreLng: number; initialRadiusMetres: number };
  invigilators: { displayName: string; inviteCode: string }[];
}

/**
 * Organiser creates a room: match length, 2–3 named invigilators, and a random
 * centre within 500 m of the organiser's position. Players have not joined yet,
 * so the starting radius comes from the smallest tier and is recalculated at
 * start from the real player count.
 */
export async function createMatch(
  ctx: RepoContext,
  input: {
    createdByUserId: string;
    matchDurationMinutes: number;
    organiserLat: number;
    organiserLng: number;
    invigilatorNames: string[];
  },
): Promise<CreatedMatch> {
  const repos = getRepos();
  const config: MatchConfig = RULES_CONFIG;

  if (
    input.matchDurationMinutes < config.matchDurationRangeMinutes.min ||
    input.matchDurationMinutes > config.matchDurationRangeMinutes.max
  ) {
    throw new Error(
      `Match length must be between ${config.matchDurationRangeMinutes.min} and ${config.matchDurationRangeMinutes.max} minutes.`,
    );
  }

  const names = input.invigilatorNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (
    names.length < config.invigilatorCount.min ||
    names.length > config.invigilatorCount.max
  ) {
    throw new Error(
      `A match needs between ${config.invigilatorCount.min} and ${config.invigilatorCount.max} invigilators.`,
    );
  }

  assertLatLng(input.organiserLat, input.organiserLng);

  const centre = randomZoneCentre({
    organiserLat: input.organiserLat,
    organiserLng: input.organiserLng,
    maxDistanceMetres: config.centrePickDistanceMetres,
  });

  // Room codes are short, so retry until the code is free.
  let roomCode = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generateRoomCode(randomUnit, config.roomCodeLength);
    const existing = await repos.matches.findByRoomCode(ctx, candidate);
    if (!existing) {
      roomCode = candidate;
      break;
    }
  }
  if (roomCode === "") {
    throw new Error("Could not allocate a room code. Please try again.");
  }

  const initialRadiusMetres = radiusForPlayerCount(
    config.minPlayers,
    config,
  );

  const match = await repos.matches.create(ctx, {
    roomCode,
    status: "lobby",
    config: { ...config, matchDurationMinutes: input.matchDurationMinutes },
    createdByUserId: input.createdByUserId,
    zoneCentre: centre,
    organiserPosition: {
      lat: input.organiserLat,
      lng: input.organiserLng,
    },
    initialRadiusMetres,
    eventWindowMinutesMax: config.eventWindowMinutes.max,
  });

  const invigilators: { displayName: string; inviteCode: string }[] = [];
  for (const displayName of names) {
    const inviteCode = generateInviteCode(randomUnit, config.inviteCodeLength);
    await repos.invigilators.create(ctx, {
      matchId: match.id,
      displayName,
      inviteCode,
      addedAt: Date.now(),
    });
    invigilators.push({ displayName, inviteCode });
  }

  return {
    matchId: match.id,
    roomCode: match.roomCode,
    zone: {
      centreLat: centre.lat,
      centreLng: centre.lng,
      initialRadiusMetres,
    },
    invigilators,
  };
}

/** Re-roll the play area, keeping it within the configured distance. */
export async function rerollCentre(
  ctx: RepoContext,
  input: { matchId: string; organiserUserId: string },
): Promise<{ centreLat: number; centreLng: number }> {
  const repos = getRepos();
  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  if (match.createdByUserId !== input.organiserUserId) {
    throw new Error("Only the organiser can re-roll the play area.");
  }
  if (match.status !== "lobby" && match.status !== "locked") {
    throw new Error("The play area is fixed once the match starts.");
  }

  // Re-rolls stay within the configured distance of the organiser, not of the
  // previous centre, so repeated re-rolls cannot drift.
  const anchor = match.organiserPosition ?? match.zoneCentre;
  const centre = randomZoneCentre({
    organiserLat: anchor.lat,
    organiserLng: anchor.lng,
    maxDistanceMetres: match.config.centrePickDistanceMetres,
    avoid: match.zoneCentre,
  });
  await repos.matches.patch(ctx, match.id, { zoneCentre: centre });
  return { centreLat: centre.lat, centreLng: centre.lng };
}

// ---- join ------------------------------------------------------------------

export interface JoinedMatch {
  matchId: string;
  roomCode: string;
  playerId: string;
}

/**
 * Join with a five-character code and a call sign, storing the leaderboard name
 * choice (nickname or real name). Joining is refused once the roster is locked.
 */
export async function joinMatch(
  ctx: RepoContext,
  input: {
    userId: string;
    roomCode: string;
    callSign: string;
    displayName: string;
    displayNameMode: DisplayNameMode;
    playerMode: "spectator" | "hunter";
  },
): Promise<JoinedMatch> {
  const repos = getRepos();
  const codeError = roomCodeError(input.roomCode, RULES_CONFIG);
  if (codeError) throw new Error(codeError);

  const match = await requireMatchByCode(ctx, input.roomCode);
  const players = await repos.players.listByMatch(ctx, match.id);
  const existing =
    players.find((player) => player.userId === input.userId) ?? null;

  const callSign = input.callSign.trim();
  const displayName = input.displayName.trim();
  const callSignInputError = callSignError(callSign);
  if (callSignInputError) throw new Error(callSignInputError);
  const displayNameInputError = displayNameError(displayName);
  if (displayNameInputError) throw new Error(displayNameInputError);

  const refusal = joinPolicy({
    status: effectiveStatus(match, Date.now()),
    rosterLocked: match.rosterLocked,
    playerCount: players.length,
    alreadyJoined: existing !== null,
    callSignTaken: players.some(
      (player) => player.callSign.toLowerCase() === callSign.toLowerCase(),
    ),
    config: match.config,
  });
  if (refusal) {
    throw new Error(joinRefusalMessage(refusal) ?? "Cannot join this room.");
  }

  const player = await repos.players.create(ctx, {
    matchId: match.id,
    userId: input.userId,
    // Roles are random and only written when the match starts. Until then the
    // lobby shows nobody a team.
    role: "shadow" satisfies Role,
    mode: input.playerMode,
    status: "active",
    callSign,
    displayName,
    displayNameMode: input.displayNameMode,
    qrToken: `SH-${randomToken(8)}`,
    joinedAt: Date.now(),
  });

  return { matchId: match.id, roomCode: match.roomCode, playerId: player.id };
}

// ---- lobby -----------------------------------------------------------------

export interface LobbyPlayer {
  id: string;
  callSign: string;
  joinedAt: number;
}

export interface LobbyInvigilator {
  displayName: string;
  /** Only shown to the organiser. */
  inviteCode: string | null;
}

export interface LobbyView {
  matchId: string;
  roomCode: string;
  status: MatchStatus;
  matchDurationMinutes: number;
  playerCount: number;
  minPlayers: number;
  softCapPlayers: number;
  canStart: boolean;
  startBlockedReason: string | null;
  zone: { centreLat: number; centreLng: number; initialRadiusMetres: number };
  players: LobbyPlayer[];
  invigilators: LobbyInvigilator[];
  me: {
    isOrganiser: boolean;
    isInvigilator: boolean;
    playerId: string | null;
    callSign: string | null;
    displayNameMode: DisplayNameMode | null;
  };
  startedAt: number | null;
  endsAt: number | null;
  headStartEndsAt: number | null;
}

export async function getLobby(
  ctx: RepoContext,
  input: { userId: string; roomCode: string },
): Promise<LobbyView> {
  const repos = getRepos();
  const match = await requireMatchByCode(ctx, input.roomCode);
  const now = Date.now();
  const status = effectiveStatus(match, now);

  const [players, invigilators, meAsInvigilator] = await Promise.all([
    repos.players.listByMatch(ctx, match.id),
    repos.invigilators.listByMatch(ctx, match.id),
    repos.invigilators.findByMatchAndUser(ctx, match.id, input.userId),
  ]);

  const me = players.find((player) => player.userId === input.userId) ?? null;
  const isOrganiser = match.createdByUserId === input.userId;
  const start = canStartMatch({
    status,
    playerCount: players.length,
    config: match.config,
  });

  return {
    matchId: match.id,
    roomCode: match.roomCode,
    status,
    matchDurationMinutes: match.config.matchDurationMinutes,
    playerCount: players.length,
    minPlayers: match.config.minPlayers,
    softCapPlayers: match.config.softCapPlayers,
    canStart: isOrganiser && start.allowed,
    startBlockedReason: isOrganiser ? start.reason : "Only the organiser can start.",
    zone: {
      centreLat: match.zoneCentre.lat,
      centreLng: match.zoneCentre.lng,
      initialRadiusMetres: match.initialRadiusMetres,
    },
    players: players.map((player) => ({
      id: player.id,
      callSign: player.callSign,
      joinedAt: player.joinedAt,
    })),
    invigilators: invigilators.map((invigilator) => ({
      displayName: invigilator.displayName,
      inviteCode: isOrganiser ? invigilator.inviteCode : null,
    })),
    me: {
      isOrganiser,
      isInvigilator: meAsInvigilator !== null,
      playerId: me?.id ?? null,
      callSign: me?.callSign ?? null,
      displayNameMode: me?.displayNameMode ?? null,
    },
    startedAt: match.startedAt,
    endsAt: match.endsAt,
    headStartEndsAt:
      match.startedAt === null
        ? null
        : match.startedAt + match.config.headStartMinutes * 60_000,
  };
}

// ---- lock / unlock ---------------------------------------------------------

async function organiserMatch(
  ctx: RepoContext,
  matchId: string,
  userId: string,
): Promise<MatchRow> {
  const repos = getRepos();
  const match = await repos.matches.findById(ctx, matchId);
  if (!match) throw new Error("Match not found.");
  if (match.createdByUserId !== userId) {
    throw new Error("Only the organiser can do that.");
  }
  return match;
}

/** Lock or unlock the roster before the match starts. */
export async function setRosterLock(
  ctx: RepoContext,
  input: { matchId: string; userId: string; locked: boolean },
): Promise<MatchStatus> {
  const repos = getRepos();
  const match = await organiserMatch(ctx, input.matchId, input.userId);
  const status = effectiveStatus(match, Date.now());

  if (status !== "lobby" && status !== "locked") {
    throw new Error("The roster is fixed once the match has started.");
  }

  const next: MatchStatus = input.locked ? "locked" : "lobby";
  await repos.matches.patch(ctx, match.id, {
    status: next,
    rosterLocked: input.locked,
  });
  return next;
}

// ---- start -----------------------------------------------------------------

export interface StartedMatch {
  matchId: string;
  status: MatchStatus;
  startedAt: number;
  endsAt: number;
  headStartEndsAt: number;
  hunters: number;
  shadows: number;
  initialRadiusMetres: number;
}

/**
 * Start the match: assign teams at random from the config ratio, lock the
 * roster, begin the five-minute head start and set the timer.
 */
export async function startMatch(
  ctx: RepoContext,
  input: { matchId: string; userId: string; seed?: number },
): Promise<StartedMatch> {
  const repos = getRepos();
  const match = await organiserMatch(ctx, input.matchId, input.userId);
  const players = await repos.players.listByMatch(ctx, match.id);
  const status = effectiveStatus(match, Date.now());

  const start = canStartMatch({
    status,
    playerCount: players.length,
    config: match.config,
  });
  if (!start.allowed) throw new Error(start.reason ?? "Cannot start yet.");

  const now = Date.now();
  const seed = input.seed ?? Math.floor(randomUnit() * 2 ** 31);
  const assignments = assignTeams(players.length, seed, match.config);
  const initialRadiusMetres = radiusForPlayerCount(
    players.length,
    match.config,
  );

  // Teams are assigned once, here, and the roster is locked at the same moment.
  for (let i = 0; i < players.length; i += 1) {
    await repos.players.patch(ctx, players[i].id, {
      role: assignments[i].role,
      status: "active",
    });
  }

  const endsAt = now + match.config.matchDurationMinutes * 60_000;
  const headStartEndsAt = now + match.config.headStartMinutes * 60_000;

  await repos.matches.patch(ctx, match.id, {
    status: "headstart",
    startedAt: now,
    endsAt,
    rosterLocked: true,
    initialRadiusMetres,
  });

  return {
    matchId: match.id,
    status: "headstart",
    startedAt: now,
    endsAt,
    headStartEndsAt,
    hunters: assignments.filter((a) => a.role === "hunter").length,
    shadows: assignments.filter((a) => a.role === "shadow").length,
    initialRadiusMetres,
  };
}

// ---- invigilators ----------------------------------------------------------

export interface InvitePreview {
  matchId: string;
  roomCode: string;
  displayName: string;
  status: MatchStatus;
}

/** Let an invigilator see the invite before accepting it. */
export async function previewInvite(
  ctx: RepoContext,
  inviteCode: string,
): Promise<InvitePreview> {
  const repos = getRepos();
  const invite = await repos.invigilators.findByInviteCode(
    ctx,
    inviteCode.trim().toUpperCase(),
  );
  if (!invite) throw new Error("That invite code is not valid.");
  const match = await repos.matches.findById(ctx, invite.matchId);
  if (!match) throw new Error("Match not found.");
  return {
    matchId: match.id,
    roomCode: match.roomCode,
    displayName: invite.displayName,
    status: effectiveStatus(match, Date.now()),
  };
}

/** Accept an invite: the invigilator is attached to the match, not as a player. */
export async function claimInvite(
  ctx: RepoContext,
  input: { userId: string; inviteCode: string },
): Promise<{ matchId: string; roomCode: string }> {
  const repos = getRepos();
  const invite = await repos.invigilators.findByInviteCode(
    ctx,
    input.inviteCode.trim().toUpperCase(),
  );
  if (!invite) throw new Error("That invite code is not valid.");
  if (invite.userId !== null && invite.userId !== input.userId) {
    throw new Error("That invite has already been accepted.");
  }

  const match = await repos.matches.findById(ctx, invite.matchId);
  if (!match) throw new Error("Match not found.");

  await repos.invigilators.claim(ctx, invite.id, input.userId);
  return { matchId: match.id, roomCode: match.roomCode };
}

// ---- position upload -------------------------------------------------------

export interface PositionUploadResult {
  stored: boolean;
  reason: "not_started" | "too_soon" | "not_live" | null;
  nextAllowedAtMs: number | null;
}

/**
 * Phones upload every few seconds while the match is live. This is separate
 * from the 3-minute ping that controls what Hunters see; the interval here is
 * `uploadIntervalSeconds`, never three minutes. Positions are stored server-side
 * and never returned publicly.
 */
export async function uploadPosition(
  ctx: RepoContext,
  input: {
    matchId: string;
    userId: string;
    lat: number;
    lng: number;
    accuracyMetres: number | null;
  },
): Promise<PositionUploadResult> {
  const repos = getRepos();
  assertLatLng(input.lat, input.lng);

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");

  const player = await repos.players.findByMatchAndUser(
    ctx,
    match.id,
    input.userId,
  );
  if (!player) throw new Error("You are not in this match.");

  const now = Date.now();
  const status = effectiveStatus(match, now);

  // Move the stored match to live the first time an upload lands after the head
  // start. Pings and live positions only begin here.
  if (status === "live" && match.status === "headstart") {
    await repos.matches.patch(ctx, match.id, { status: "live" });
  }

  const last = await repos.locations.latestByPlayer(ctx, match.id, player.id);
  const schedule = uploadSchedule({
    status,
    lastUploadAtMs: last?.recordedAtMs ?? null,
    nowMs: now,
    config: match.config,
  });

  if (!schedule.allowed) {
    return {
      stored: false,
      reason: schedule.reason,
      nextAllowedAtMs: schedule.nextAllowedAtMs,
    };
  }

  await repos.locations.insert(ctx, {
    matchId: match.id,
    playerId: player.id,
    lat: input.lat,
    lng: input.lng,
    accuracyMetres: input.accuracyMetres,
    pingIndex: (last?.pingIndex ?? -1) + 1,
    recordedAt: now,
  });

  return { stored: true, reason: null, nextAllowedAtMs: schedule.nextAllowedAtMs };
}
