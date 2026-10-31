/**
 * Positions on the server.
 *
 * Uploads are validated here (speed, accuracy, zone breach), stored through the
 * repositories, and read back only through `getMapView`, which applies the pure
 * visibility rules so a Hunter can never receive a live Shadow position.
 */
import {
  distanceMetres,
  RULES_CONFIG,
  matchClockNow,
  nextShrinkAtMs,
  outOfZoneState,
  pingWindow,
  statusForClock,
  uploadSchedule,
  visibilityFor,
  zoneRadiusAtMinute,
  type MatchConfig,
  type MatchStatus,
  type OutOfZoneStatus,
  type PlayerMode,
  type PlayerStatus,
  type Role,
  type Viewer,
  type VisibilityMode,
} from "../rules";
import { getRepos } from "./providers";
import { award } from "./settlement";
import type {
  LocationRow,
  MatchRow,
  PlayerRow,
  RepoContext,
} from "./repos";

// ---- helpers ---------------------------------------------------------------

function assertLatLng(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }
}

function effectiveStatus(match: MatchRow, nowMs: number): MatchStatus {
  return statusForClock({
    stored: match.status,
    startedAtMs: match.startedAt,
    endsAtMs: match.endsAt,
    nowMs,
    config: match.config,
  });
}

/** The clock the rules run on: frozen while the match is paused. */
function clockOf(match: MatchRow, nowMs: number): number {
  return matchClockNow({
    nowMs,
    pausedAtMs: match.pausedAt,
    pausedTotalMs: match.pausedTotalMs,
  });
}

function inPlayCount(players: PlayerRow[]): number {
  return players.filter(
    (player) => player.status === "active" || player.status === "tagged",
  ).length;
}

function currentRadius(
  match: MatchRow,
  players: PlayerRow[],
  nowMs: number,
): number {
  const startedAt = match.startedAt ?? nowMs;
  const minute = Math.max(0, Math.floor((nowMs - startedAt) / 60_000));
  return zoneRadiusAtMinute({
    minute,
    activePlayerCount: inPlayCount(players),
    initialRadiusMetres: match.initialRadiusMetres,
    config: match.config,
  });
}

// ---- upload ----------------------------------------------------------------

export interface ZoneBreach {
  status: OutOfZoneStatus;
  outside: boolean;
  secondsOutside: number;
  graceSecondsLeft: number;
  drainTicksApplied: number;
}

export interface PositionUploadResult {
  stored: boolean;
  reason: "not_started" | "too_soon" | "not_live" | null;
  nextAllowedAtMs: number | null;
  /** Spoof check result. A flagged reading is stored but never acted on. */
  flagged: boolean;
  suspiciousReason: string | null;
  breach: ZoneBreach | null;
}

/**
 * Phones upload every few seconds while the match is live. The upload interval
 * is `uploadIntervalSeconds` (7 s), never the 3-minute ping.
 *
 * Every acceptance updates the out-of-zone state machine: warning on exit,
 * 60 s grace, a drain every 10 s, elimination after 3 minutes outside. Drains
 * are written to the append-only score ledger through `award`.
 */
export async function uploadPosition(
  ctx: RepoContext,
  input: {
    matchId: string;
    userId: string;
    lat: number;
    lng: number;
    accuracyMetres: number | null;
    nowMs?: number;
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

  const now = input.nowMs ?? Date.now();
  const clock = clockOf(match, now);
  const status = effectiveStatus(match, clock);

  // Move the stored match to live the first time a position lands after the
  // head start.
  if (status === "live" && match.status === "headstart") {
    await repos.matches.patch(ctx, match.id, { status: "live" });
  }

  const last = await repos.locations.latestByPlayer(
    ctx,
    match.id,
    player.id,
  );
  const schedule = uploadSchedule({
    status,
    lastUploadAtMs: last?.recordedAtMs ?? null,
    // Stage 5, decision 3: uploads keep running while paused (they rate-limit
    // against the real clock), but the zone, the drain and the ping all run on
    // the frozen one.
    nowMs: match.pausedAt !== null ? now : clock,
    config: match.config,
  });
  if (!schedule.allowed) {
    return {
      stored: false,
      reason: schedule.reason,
      nextAllowedAtMs: schedule.nextAllowedAtMs,
      flagged: false,
      suspiciousReason: null,
      breach: null,
    };
  }

  // ---- spoof check ---------------------------------------------------------
  let suspiciousReason: string | null = null;
  if (
    input.accuracyMetres !== null &&
    (input.accuracyMetres < 0 ||
      input.accuracyMetres > match.config.impossibleAccuracyMetres)
  ) {
    suspiciousReason = "impossible_accuracy";
  } else if (last) {
    const seconds = (now - last.recordedAtMs) / 1000;
    if (seconds > 0) {
      const speed = distanceMetres(last, input) / seconds;
      if (speed > match.config.maxSpeedMetresPerSecond) {
        suspiciousReason = "impossible_speed";
      }
    }
  }
  const flagged = suspiciousReason !== null;

  const pingIndex = (last?.pingIndex ?? -1) + 1;
  await repos.locations.insert(ctx, {
    matchId: match.id,
    playerId: player.id,
    lat: input.lat,
    lng: input.lng,
    accuracyMetres: input.accuracyMetres,
    pingIndex,
    recordedAt: now,
    suspicious: flagged,
    suspiciousReason,
  });

  if (flagged) {
    // Stored for the invigilators, but never used for scoring, zones or pings.
    return {
      stored: true,
      reason: null,
      nextAllowedAtMs: schedule.nextAllowedAtMs,
      flagged: true,
      suspiciousReason,
      breach: null,
    };
  }

  // ---- ping ---------------------------------------------------------------
  const window = pingWindow({
    startedAtMs: match.startedAt,
    nowMs: clock,
    config: match.config,
  });
  if (
    window.lastPingAtMs !== null &&
    (match.lastPingAt ?? 0) < window.lastPingAtMs
  ) {
    await repos.matches.patch(ctx, match.id, {
      lastPingAt: window.lastPingAtMs,
    });
  }

  // ---- out of zone --------------------------------------------------------
  const radius = currentRadius(
    match,
    await repos.players.listByMatch(ctx, match.id),
    clock,
  );
  const distance = distanceMetres(input, match.zoneCentre);
  const outsideSince = player.outsideSince;
  const secondsOutside =
    outsideSince === null ? 0 : Math.max(0, (clock - outsideSince) / 1000);
  const state = outOfZoneState({
    distanceFromCentreMetres: distance,
    zoneRadiusMetres: radius,
    secondsOutside,
    config: match.config,
  });

  const breach: ZoneBreach = {
    status: state.status,
    outside: state.outside,
    secondsOutside: Math.round(state.secondsOutside),
    graceSecondsLeft: Math.ceil(state.graceSecondsLeft),
    drainTicksApplied: 0,
  };

  if (!state.outside) {
    if (outsideSince !== null) {
      await repos.players.patchOutZoneState(ctx, player.id, {
        outsideSince: null,
        chargedDrainTicks: 0,
        warnedAt: null,
      });
    }
    return {
      stored: true,
      reason: null,
      nextAllowedAtMs: schedule.nextAllowedAtMs,
      flagged: false,
      suspiciousReason: null,
      breach,
    };
  }

  // Charge only the drain ticks not already charged.
  const owed = state.drainTicksOwed;
  const alreadyCharged = player.chargedDrainTicks;
  const newTicks = Math.max(0, owed - alreadyCharged);
  if (newTicks > 0) {
    await award(ctx, {
      matchId: match.id,
      playerId: player.id,
      kind: "zone_drain",
      points: -newTicks * match.config.drainPointsPerTick,
      at: clock,
    });
    breach.drainTicksApplied = newTicks;
  }

  const eliminated = state.shouldEliminate;
  await repos.players.patchOutZoneState(ctx, player.id, {
    outsideSince: outsideSince ?? clock,
    outsideSecondsTotal: Math.round(state.secondsOutside),
    chargedDrainTicks: owed,
    warnedAt: player.warnedAt ?? clock,
    ...(eliminated ? { status: "eliminated" as PlayerStatus } : {}),
  });
  if (eliminated && player.mode !== match.config.eliminatedTurnsInto) {
    await repos.players.patch(ctx, player.id, {
      mode: match.config.eliminatedTurnsInto,
    });
  }

  return {
    stored: true,
    reason: null,
    nextAllowedAtMs: schedule.nextAllowedAtMs,
    flagged: false,
    suspiciousReason: null,
    breach,
  };
}

/**
 * Delete position history 24 h after a match ends. Scores are kept: only
 * location rows are removed.
 */
export async function purgeExpiredPositions(
  ctx: RepoContext,
  nowMs: number = Date.now(),
): Promise<{ matches: number; deleted: number }> {
  const repos = getRepos();
  const cutoff =
    nowMs - RULES_CONFIG.positionRetentionHours * 60 * 60 * 1000;
  const ended = await repos.matches.listEndedBefore(ctx, cutoff);

  let deleted = 0;
  for (const match of ended) {
    deleted += await repos.locations.deleteForMatch(ctx, match.id);
  }
  return { matches: ended.length, deleted };
}

// ---- map view --------------------------------------------------------------

export interface MapMarker {
  playerId: string;
  callSign: string;
  role: Role;
  status: PlayerStatus;
  /** live, ping ghost, or delayed for spectators. */
  kind: VisibilityMode;
  lat: number;
  lng: number;
  atMs: number;
  ageMs: number;
  accuracyMetres: number | null;
}

export interface MapView {
  matchId: string;
  roomCode: string;
  status: MatchStatus;
  /** How the match finished, once it has. */
  endReason: MatchRow["endReason"];
  startedAt: number | null;
  endsAt: number | null;
  headStartEndsAt: number | null;
  serverNowMs: number;
  /** Frozen while the match is paused: countdowns stop with it. */
  paused: boolean;
  pauseReason: string | null;
  /** The match's own config snapshot — never the default RULES_CONFIG. */
  config: MatchConfig;
  zone: {
    centreLat: number;
    centreLng: number;
    radiusMetres: number;
    initialRadiusMetres: number;
    nextShrinkAtMs: number | null;
  };
  ping: {
    lastPingAtMs: number | null;
    nextPingAtMs: number | null;
    index: number;
    ghostFadeSeconds: number;
  };
  /** What the HUD needs, without any coordinates. */
  summary: {
    activeShadows: number;
    totalShadows: number;
    activeHunters: number;
    tags: number;
    stillIn: { playerId: string; callSign: string; role: Role }[];
  };
  /** Only filled in for the organiser or an invigilator of the match. */
  staff: MapStaff | null;
  me: {
    playerId: string | null;
    callSign: string | null;
    role: Role | null;
    mode: PlayerMode | null;
    status: PlayerStatus | null;
    points: number;
    isInvigilator: boolean;
    isOrganiser: boolean;
    breach: ZoneBreach | null;
  };
  markers: MapMarker[];
}

/** Live status board for staff watching the match (Stage 5, task 8). */
export interface MapStaff {
  playerCount: number;
  briefedCount: number;
  players: {
    playerId: string;
    callSign: string;
    briefedAt: number | null;
    /** Last position upload; null means "location off or out of signal". */
    lastUploadAtMs: number | null;
  }[];
}

async function locationFor(
  ctx: RepoContext,
  matchId: string,
  playerId: string,
  mode: VisibilityMode,
  args: { lastPingAtMs: number | null },
): Promise<LocationRow | null> {
  const repos = getRepos();
  if (mode === "ping") {
    if (args.lastPingAtMs === null) return null;
    return await repos.locations.latestByPlayerBefore(
      ctx,
      matchId,
      playerId,
      args.lastPingAtMs,
    );
  }
  return await repos.locations.latestByPlayer(ctx, matchId, playerId);
}

/**
 * What this viewer may see right now. Membership is checked against the
 * database, not the request: only players in the match and its invigilators get
 * anything, and the visibility rules decide per candidate.
 */
export async function getMapView(
  ctx: RepoContext,
  input: { matchId: string; userId: string; nowMs?: number },
): Promise<MapView> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");

  const clock = clockOf(match, now);

  const [players, invigilator, meAsPlayer, tags] = await Promise.all([
    repos.players.listByMatch(ctx, match.id),
    repos.invigilators.findByMatchAndUser(ctx, match.id, input.userId),
    repos.players.findByMatchAndUser(ctx, match.id, input.userId),
    repos.tags.listByMatch(ctx, match.id),
  ]);

  if (invigilator === null && meAsPlayer === null) {
    throw new Error("You are not in this match.");
  }
  const isOrganiser = match.createdByUserId === input.userId;

  const viewer: Viewer =
    invigilator !== null
      ? { kind: "invigilator" }
      : {
          kind: "player",
          playerId: meAsPlayer!.id,
          role: meAsPlayer!.role,
          status: meAsPlayer!.status,
        };

  const status = effectiveStatus(match, clock);
  const window = pingWindow({
    startedAtMs: match.startedAt,
    nowMs: clock,
    config: match.config,
  });
  const lastPingAtMs = match.lastPingAt ?? window.lastPingAtMs;

  const markers: MapMarker[] = [];
  for (const candidate of players) {
    const mode = visibilityFor(viewer, {
      playerId: candidate.id,
      role: candidate.role,
      status: candidate.status,
    });
    if (mode === null) continue;

    const location = await locationFor(ctx, match.id, candidate.id, mode, {
      lastPingAtMs,
    });
    if (!location) continue;
    if (location.suspicious) continue;

    markers.push({
      playerId: candidate.id,
      callSign: candidate.callSign,
      role: candidate.role,
      status: candidate.status,
      kind: mode,
      lat: location.lat,
      lng: location.lng,
      atMs: location.recordedAtMs,
      ageMs: Math.max(0, clock - location.recordedAtMs),
      accuracyMetres: location.accuracyMetres,
    });
  }

  const radius = currentRadius(match, players, clock);

  let breach: ZoneBreach | null = null;
  if (meAsPlayer) {
    const outsideSince = meAsPlayer.outsideSince;
    const secondsOutside =
      outsideSince === null ? 0 : Math.max(0, (clock - outsideSince) / 1000);
    const state = outOfZoneState({
      distanceFromCentreMetres: outsideSince === null ? 0 : radius + 1,
      zoneRadiusMetres: radius,
      secondsOutside,
      config: match.config,
    });
    breach =
      outsideSince === null
        ? {
            status: "inside",
            outside: false,
            secondsOutside: 0,
            graceSecondsLeft: 0,
            drainTicksApplied: 0,
          }
        : {
            status: state.status,
            outside: true,
            secondsOutside: Math.round(secondsOutside),
            graceSecondsLeft: Math.ceil(state.graceSecondsLeft),
            drainTicksApplied: 0,
          };
  }

  const summary = {
    activeShadows: players.filter(
      (player) =>
        player.role === "shadow" &&
        player.status === "active" &&
        player.taggedAt === null,
    ).length,
    totalShadows: players.filter((player) => player.role === "shadow").length,
    activeHunters: players.filter(
      (player) => player.role === "hunter" && player.status === "active",
    ).length,
    tags: tags.filter((tag) => tag.status === "accepted").length,
    stillIn: players
      .filter((player) => player.status === "active")
      .map((player) => ({
        playerId: player.id,
        callSign: player.callSign,
        role: player.role,
      })),
  };

  let staff: MapStaff | null = null;
  if (invigilator !== null || isOrganiser) {
    const briefedCount = players.filter(
      (player) => player.briefedAt !== null,
    ).length;
    const rows: MapStaff["players"] = [];
    for (const player of players) {
      const location = await repos.locations.latestByPlayer(
        ctx,
        match.id,
        player.id,
      );
      rows.push({
        playerId: player.id,
        callSign: player.callSign,
        briefedAt: player.briefedAt,
        lastUploadAtMs: location?.recordedAtMs ?? null,
      });
    }
    staff = { playerCount: players.length, briefedCount, players: rows };
  }

  return {
    matchId: match.id,
    roomCode: match.roomCode,
    status,
    endReason: match.endReason,
    startedAt: match.startedAt,
    endsAt: match.endsAt,
    headStartEndsAt:
      match.startedAt === null
        ? null
        : match.startedAt + match.config.headStartMinutes * 60_000,
    serverNowMs: clock,
    paused: match.pausedAt !== null,
    pauseReason: match.pauseReason,
    config: match.config,
    zone: {
      centreLat: match.zoneCentre.lat,
      centreLng: match.zoneCentre.lng,
      radiusMetres: radius,
      initialRadiusMetres: match.initialRadiusMetres,
      nextShrinkAtMs:
        match.startedAt === null
          ? null
          : nextShrinkAtMs(match.startedAt, clock, match.config),
    },
    ping: {
      lastPingAtMs,
      nextPingAtMs: window.nextPingAtMs,
      index: window.index,
      ghostFadeSeconds: match.config.pingGhostFadeSeconds,
    },
    me: {
      playerId: meAsPlayer?.id ?? null,
      callSign: meAsPlayer?.callSign ?? null,
      role: meAsPlayer?.role ?? null,
      mode: meAsPlayer?.mode ?? null,
      status: meAsPlayer?.status ?? null,
      points: meAsPlayer?.points ?? 0,
      isInvigilator: invigilator !== null,
      isOrganiser,
      breach,
    },
    summary,
    staff,
    markers,
  };
}
