/**
 * The invigilator console.
 *
 * Only an invigilator attached to the match may read it or act on it — checked
 * here against the database, never against what the client claims. Every action
 * writes an append-only audit row (who, when, why) before it changes anything.
 *
 * Rules live in `src/rules`; this module resolves players and writes.
 */
import {
  canPause,
  complaintIsOverdue,
  distanceMetres,
  hunterTagPoints,
  matchClockNow,
  nextShrinkAtMs,
  statusForClock,
  zoneProgress,
  zoneRadiusAtMinute,
  type MatchConfig,
  type MatchStatus,
  type PlayerMode,
  type PlayerStatus,
  type Role,
} from "../rules";
import { getRepos } from "./providers";
import { activeShadows, endMatch, isEligibleHunter } from "./matchEnd";
import { award } from "./settlement";
import type {
  AuditRow,
  ComplaintRow,
  InvigilatorRow,
  MatchRow,
  PlayerRow,
  RepoContext,
} from "./repos";

// ---- authorization ---------------------------------------------------------

/** The invigilator record for this user on this match, or a refusal. */
async function requireInvigilator(
  ctx: RepoContext,
  matchId: string,
  userId: string,
): Promise<{ invigilator: InvigilatorRow; match: MatchRow }> {
  const repos = getRepos();
  const match = await repos.matches.findById(ctx, matchId);
  if (!match) throw new Error("Match not found.");
  const invigilator = await repos.invigilators.findByMatchAndUser(
    ctx,
    match.id,
    userId,
  );
  if (invigilator === null) {
    throw new Error("Only an invigilator for this match can open the console.");
  }
  return { invigilator, match };
}

/** Organiser or invigilator — the two roles allowed to freeze a match. */
async function requireFreezeRights(
  ctx: RepoContext,
  matchId: string,
  userId: string,
): Promise<{ actor: string; match: MatchRow }> {
  const repos = getRepos();
  const match = await repos.matches.findById(ctx, matchId);
  if (!match) throw new Error("Match not found.");
  if (match.createdByUserId === userId) {
    return { actor: "Organiser", match };
  }
  const invigilator = await repos.invigilators.findByMatchAndUser(
    ctx,
    match.id,
    userId,
  );
  if (invigilator === null) {
    throw new Error("Only the organiser or an invigilator can do that.");
  }
  return { actor: invigilator.displayName, match };
}

async function logAction(
  ctx: RepoContext,
  input: {
    match: MatchRow;
    actorUserId: string;
    actorName: string;
    action: string;
    targetType: string;
    targetId?: string;
    targetLabel?: string;
    reason?: string;
    detail?: string;
    at: number;
  },
): Promise<void> {
  await getRepos().audit.append(ctx, {
    matchId: input.match.id,
    at: input.at,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    reason: input.reason ?? null,
    detail: input.detail ?? null,
  });
}

/** Where a captured Shadow lands once they have chosen. */
export function statusAfterCapture(mode: PlayerMode): PlayerStatus {
  return mode === "spectator" ? "spectator" : "tagged";
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

// ---- view ------------------------------------------------------------------

export interface ConsolePlayer {
  playerId: string;
  callSign: string;
  displayName: string;
  role: Role;
  mode: PlayerMode;
  status: PlayerStatus;
  points: number;
  outsideSeconds: number;
  flagged: boolean;
  flagReason: string | null;
  accuracyMetres: number | null;
  lastSeenAtMs: number | null;
  lat: number | null;
  lng: number | null;
}

export interface ConsoleComplaint {
  id: string;
  createdAtMs: number;
  responseDueAtMs: number;
  overdue: boolean;
  ageMs: number;
  timeLeftMs: number;
  status: ComplaintRow["status"];
  note: string | null;
  hunterId: string;
  hunterCallSign: string;
  shadowId: string;
  shadowCallSign: string;
  distanceMetres: number | null;
  hunterLat: number | null;
  hunterLng: number | null;
  shadowLat: number | null;
  shadowLng: number | null;
}

/** A player's "I need help" alert, with the position it was raised from. */
export interface ConsoleHelpAlert {
  id: string;
  at: number;
  ageMs: number;
  playerId: string;
  callSign: string;
  lat: number | null;
  lng: number | null;
}

export interface ConsoleView {
  matchId: string;
  roomCode: string;
  status: MatchStatus;
  endReason: MatchRow["endReason"];
  serverNowMs: number;
  paused: boolean;
  pauseReason: string | null;
  pausedAtMs: number | null;
  startedAt: number | null;
  endsAt: number | null;
  headStartEndsAt: number | null;
  config: MatchConfig;
  zone: {
    centreLat: number;
    centreLng: number;
    radiusMetres: number;
    nextShrinkAtMs: number | null;
  };
  players: ConsolePlayer[];
  complaints: ConsoleComplaint[];
  helpAlerts: ConsoleHelpAlert[];
  audit: AuditRow[];
  invigilatorName: string;
}

/**
 * Everything the console shows, resolved on the server for this viewer.
 * Positions are only ever returned to an invigilator of the match.
 */
export async function getConsoleView(
  ctx: RepoContext,
  input: { matchId: string; userId: string; nowMs?: number },
): Promise<ConsoleView> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();
  const { invigilator, match } = await requireInvigilator(
    ctx,
    input.matchId,
    input.userId,
  );

  const [players, complaints, audit, events] = await Promise.all([
    repos.players.listByMatch(ctx, match.id),
    repos.complaints.listByMatch(ctx, match.id),
    repos.audit.listByMatch(ctx, match.id),
    repos.events.listByMatch(ctx, match.id),
  ]);

  const startedAt = match.startedAt ?? now;
  const minute = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const radius = zoneRadiusAtMinute({
    minute,
    activePlayerCount: Math.max(
      1,
      players.filter((p) => p.status === "active" || p.status === "tagged")
        .length,
    ),
    initialRadiusMetres: match.initialRadiusMetres,
    config: match.config,
  });

  const playerById = new Map(players.map((player) => [player.id, player]));

  const consolePlayers: ConsolePlayer[] = [];
  for (const player of players) {
    const location = await repos.locations.latestByPlayer(
      ctx,
      match.id,
      player.id,
    );
    consolePlayers.push({
      playerId: player.id,
      callSign: player.callSign,
      displayName: player.displayName,
      role: player.role,
      mode: player.mode,
      status: player.status,
      points: player.points,
      outsideSeconds: player.outsideSecondsTotal,
      flagged: location?.suspicious ?? false,
      flagReason:
        location && location.suspicious ? location.suspiciousReason : null,
      accuracyMetres: location?.accuracyMetres ?? null,
      lastSeenAtMs: location?.recordedAtMs ?? null,
      lat: location && !location.suspicious ? location.lat : null,
      lng: location && !location.suspicious ? location.lng : null,
    });
  }

  const consoleComplaints: ConsoleComplaint[] = [];
  for (const complaint of complaints) {
    const hunter = playerById.get(complaint.complainantId) ?? null;
    const shadow = playerById.get(complaint.accusedId) ?? null;
    const [hunterLoc, shadowLoc] = await Promise.all([
      hunter
        ? repos.locations.latestByPlayer(ctx, match.id, hunter.id)
        : Promise.resolve(null),
      shadow
        ? repos.locations.latestByPlayer(ctx, match.id, shadow.id)
        : Promise.resolve(null),
    ]);

    let distance: number | null = null;
    if (hunterLoc && shadowLoc) {
      distance = Math.round(distanceMetres(hunterLoc, shadowLoc));
    }

    consoleComplaints.push({
      id: complaint.id,
      createdAtMs: complaint.createdAt,
      responseDueAtMs: complaint.responseDueAt,
      overdue: complaintIsOverdue({
        nowMs: now,
        responseDueAtMs: complaint.responseDueAt,
        status: complaint.status,
      }),
      ageMs: Math.max(0, now - complaint.createdAt),
      timeLeftMs: Math.max(0, complaint.responseDueAt - now),
      status: complaint.status,
      note: complaint.note,
      hunterId: complaint.complainantId,
      hunterCallSign: hunter?.callSign ?? "Unknown",
      shadowId: complaint.accusedId,
      shadowCallSign: shadow?.callSign ?? "Unknown",
      distanceMetres: distance,
      hunterLat: hunterLoc ? hunterLoc.lat : null,
      hunterLng: hunterLoc ? hunterLoc.lng : null,
      shadowLat: shadowLoc ? shadowLoc.lat : null,
      shadowLng: shadowLoc ? shadowLoc.lng : null,
    });
  }

  // Oldest first: the queue is worked in the order complaints arrived.
  consoleComplaints.sort((a, b) => a.createdAtMs - b.createdAtMs);

  const status = effectiveStatus(match, now);
  const frozenNow = matchClockNow({
    nowMs: now,
    pausedAtMs: match.pausedAt,
    pausedTotalMs: match.pausedTotalMs,
  });

  const helpAlerts: ConsoleHelpAlert[] = events
    .filter((event) => event.kind === "help")
    .map((event) => ({
      id: event.id,
      at: event.at,
      ageMs: Math.max(0, now - event.at),
      playerId: event.playerId ?? "",
      callSign:
        event.detail ??
        playerById.get(event.playerId ?? "")?.callSign ??
        "Unknown",
      lat: event.lat,
      lng: event.lng,
    }))
    .sort((a, b) => b.at - a.at);

  return {
    matchId: match.id,
    roomCode: match.roomCode,
    status,
    endReason: match.endReason,
    serverNowMs: frozenNow,
    paused: match.pausedAt !== null,
    pauseReason: match.pauseReason,
    pausedAtMs: match.pausedAt,
    startedAt: match.startedAt,
    endsAt: match.endsAt,
    headStartEndsAt:
      match.startedAt === null
        ? null
        : match.startedAt + match.config.headStartMinutes * 60_000,
    config: match.config,
    zone: {
      centreLat: match.zoneCentre.lat,
      centreLng: match.zoneCentre.lng,
      radiusMetres: radius,
      nextShrinkAtMs:
        match.startedAt === null
          ? null
          : nextShrinkAtMs(match.startedAt, frozenNow, match.config),
    },
    players: consolePlayers,
    complaints: consoleComplaints,
    helpAlerts,
    audit,
    invigilatorName: invigilator.displayName,
  };
}

// ---- actions ---------------------------------------------------------------

async function loadForAction(
  ctx: RepoContext,
  matchId: string,
  userId: string,
): Promise<{ match: MatchRow; actorUserId: string; actorName: string; now: number }> {
  const { invigilator, match } = await requireInvigilator(ctx, matchId, userId);
  return {
    match,
    actorUserId: userId,
    actorName: invigilator.displayName,
    now: Date.now(),
  };
}

export async function dismissComplaint(
  ctx: RepoContext,
  input: {
    matchId: string;
    complaintId: string;
    userId: string;
    reason: string;
  },
): Promise<void> {
  const repos = getRepos();
  const head = await loadForAction(ctx, input.matchId, input.userId);
  const complaint = await repos.complaints.listByMatch(ctx, head.match.id);
  const target = complaint.find((row) => row.id === input.complaintId);
  if (!target) throw new Error("That complaint is no longer open.");
  if (target.status !== "open") {
    throw new Error("That complaint has already been resolved.");
  }

  await logAction(ctx, {
    match: head.match,
    actorUserId: head.actorUserId,
    actorName: head.actorName,
    action: "complaint_dismissed",
    targetType: "complaint",
    targetId: target.id,
    targetLabel: `${target.complainantId} → ${target.accusedId}`,
    reason: input.reason,
    at: head.now,
  });
  await repos.complaints.patch(ctx, target.id, {
    status: "dismissed",
    resolvedByUserId: input.userId,
    resolvedAt: head.now,
    resolutionNote: input.reason,
  });
}

/**
 * Force a tag when the Shadow is at fault. It scores exactly like a real tag
 * for the Hunter, bypassing distance and freshness, and is marked forced on
 * the record.
 */
export async function forceTag(
  ctx: RepoContext,
  input: {
    matchId: string;
    hunterId: string;
    shadowId: string;
    userId: string;
    reason: string;
  },
): Promise<{ tagId: string; points: number }> {
  const repos = getRepos();
  const head = await loadForAction(ctx, input.matchId, input.userId);
  const now = head.now;
  const match = head.match;

  if (match.status === "ended") throw new Error("That match has ended.");

  const players = await repos.players.listByMatch(ctx, match.id);
  const hunter = players.find((player) => player.id === input.hunterId) ?? null;
  const shadow = players.find((player) => player.id === input.shadowId) ?? null;
  if (!hunter || !shadow) throw new Error("Player not found in this match.");
  if (hunter.role !== "hunter") {
    throw new Error("Only a Hunter can be credited with a forced tag.");
  }
  if (shadow.role !== "shadow" || shadow.status !== "active") {
    throw new Error("That Shadow is not in play.");
  }

  const inPlay = players.filter(
    (player) => player.status === "active" || player.status === "tagged",
  ).length;
  const startedAt = match.startedAt ?? now;
  const minute = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const radius = zoneRadiusAtMinute({
    minute,
    activePlayerCount: inPlay,
    initialRadiusMetres: match.initialRadiusMetres,
    config: match.config,
  });
  const points =
    hunter.taggedAt === null
      ? hunterTagPoints({
          zoneProgress01: zoneProgress(radius, match.initialRadiusMetres),
          config: match.config,
        })
      : 0;

  const tagId = await repos.tags.insert(ctx, {
    matchId: match.id,
    hunterId: hunter.id,
    shadowId: shadow.id,
    status: "accepted",
    distanceMetres: null,
    captureMode: shadow.mode,
    forced: true,
    forcedByUserId: input.userId,
    scoredPoints: points,
    at: now,
  });

  await repos.players.patch(ctx, shadow.id, {
    status: statusAfterCapture(shadow.mode),
    taggedAt: now,
    taggedById: hunter.id,
    // The mode was on offer at the moment of capture; they have not chosen yet.
    captureChosenAt: null,
  });

  if (points > 0) {
    await award(ctx, {
      matchId: match.id,
      playerId: hunter.id,
      kind: "tag",
      points,
      at: now,
      source: "invigilator",
      refId: tagId,
    });
  }

  await logAction(ctx, {
    match,
    actorUserId: head.actorUserId,
    actorName: head.actorName,
    action: "forced_tag",
    targetType: "player",
    targetId: shadow.id,
    targetLabel: shadow.callSign,
    reason: input.reason,
    detail: `Credited to ${hunter.callSign} · ${Math.round(points)} points`,
    at: now,
  });

  const refreshed = await repos.players.listByMatch(ctx, match.id);
  if (
    activeShadows(refreshed).length === 0 &&
    refreshed.some((player) => player.role === "shadow")
  ) {
    await endMatch(ctx, { matchId: match.id, nowMs: now, refId: tagId });
  }

  return { tagId, points };
}

export async function removePlayer(
  ctx: RepoContext,
  input: { matchId: string; playerId: string; userId: string; reason: string },
): Promise<void> {
  const repos = getRepos();
  const head = await loadForAction(ctx, input.matchId, input.userId);
  const now = head.now;
  const player = await repos.players.findById(ctx, input.playerId);
  if (!player || player.matchId !== head.match.id) {
    throw new Error("Player not found in this match.");
  }
  if (player.status === "removed") {
    throw new Error("That player has already been removed.");
  }

  await repos.players.patch(ctx, player.id, { status: "removed" });

  await logAction(ctx, {
    match: head.match,
    actorUserId: head.actorUserId,
    actorName: head.actorName,
    action: "player_removed",
    targetType: "player",
    targetId: player.id,
    targetLabel: player.callSign,
    reason: input.reason,
    at: now,
  });

  // Removing the last Shadow ends the match for the Hunters.
  const players = await repos.players.listByMatch(ctx, head.match.id);
  if (
    activeShadows(players).length === 0 &&
    players.some((row) => row.role === "shadow")
  ) {
    await endMatch(ctx, { matchId: head.match.id, nowMs: now });
  }
}

export async function warnPlayer(
  ctx: RepoContext,
  input: { matchId: string; playerId: string; userId: string; reason: string },
): Promise<void> {
  const repos = getRepos();
  const head = await loadForAction(ctx, input.matchId, input.userId);
  const player = await repos.players.findById(ctx, input.playerId);
  if (!player || player.matchId !== head.match.id) {
    throw new Error("Player not found in this match.");
  }

  await repos.players.patchOutZoneState(ctx, player.id, {
    warnedAt: head.now,
  });
  await logAction(ctx, {
    match: head.match,
    actorUserId: head.actorUserId,
    actorName: head.actorName,
    action: "player_warned",
    targetType: "player",
    targetId: player.id,
    targetLabel: player.callSign,
    reason: input.reason,
    at: head.now,
  });
}

export async function setPlayerMode(
  ctx: RepoContext,
  input: {
    matchId: string;
    playerId: string;
    mode: PlayerMode;
    userId: string;
    reason: string;
  },
): Promise<void> {
  const repos = getRepos();
  const head = await loadForAction(ctx, input.matchId, input.userId);
  const now = head.now;
  const player = await repos.players.findById(ctx, input.playerId);
  if (!player || player.matchId !== head.match.id) {
    throw new Error("Player not found in this match.");
  }
  if (player.role !== "shadow") {
    throw new Error("Only a Shadow has a post-capture mode to change.");
  }

  await repos.players.patch(ctx, player.id, {
    mode: input.mode,
    // Once someone has decided, changing the mode must not re-open the choice.
    captureChosenAt: player.captureChosenAt ?? (player.taggedAt === null ? null : now),
    ...(player.taggedAt !== null
      ? { status: statusAfterCapture(input.mode) }
      : {}),
  });

  await logAction(ctx, {
    match: head.match,
    actorUserId: head.actorUserId,
    actorName: head.actorName,
    action: "mode_changed",
    targetType: "player",
    targetId: player.id,
    targetLabel: player.callSign,
    reason: input.reason,
    detail: `${player.mode} → ${input.mode}`,
    at: now,
  });
}

// ---- pause / resume --------------------------------------------------------

export async function pauseMatch(
  ctx: RepoContext,
  input: { matchId: string; userId: string; reason: string },
): Promise<{ pausedAt: number }> {
  const repos = getRepos();
  const { actor, match } = await requireFreezeRights(
    ctx,
    input.matchId,
    input.userId,
  );
  const now = Date.now();

  if (!canPause(effectiveStatus(match, now))) {
    throw new Error("Only a running match can be paused.");
  }
  if (match.pausedAt !== null) throw new Error("The match is already paused.");

  await repos.matches.patch(ctx, match.id, {
    pausedAt: now,
    pauseReason: input.reason || "Paused by staff.",
  });
  await logAction(ctx, {
    match,
    actorUserId: input.userId,
    actorName: actor,
    action: "match_paused",
    targetType: "match",
    targetId: match.id,
    targetLabel: match.roomCode,
    reason: input.reason,
    at: now,
  });
  return { pausedAt: now };
}

export async function resumeMatch(
  ctx: RepoContext,
  input: { matchId: string; userId: string; reason: string },
): Promise<{ pausedTotalMs: number }> {
  const repos = getRepos();
  const { actor, match } = await requireFreezeRights(
    ctx,
    input.matchId,
    input.userId,
  );
  const now = Date.now();

  if (match.pausedAt === null) throw new Error("The match is not paused.");

  const pausedTotalMs =
    match.pausedTotalMs + Math.max(0, now - match.pausedAt);
  await repos.matches.patch(ctx, match.id, {
    pausedAt: null,
    pausedTotalMs,
    pauseReason: null,
  });
  await logAction(ctx, {
    match,
    actorUserId: input.userId,
    actorName: actor,
    action: "match_resumed",
    targetType: "match",
    targetId: match.id,
    targetLabel: match.roomCode,
    reason: input.reason,
    detail: `Paused for ${Math.round((pausedTotalMs - match.pausedTotalMs) / 1000)}s`,
    at: now,
  });
  return { pausedTotalMs };
}

/**
 * The organiser's "End match" button: the same settlement as a natural end.
 * Kept here so both staff entry points share one audit trail.
 */
export async function endMatchEarly(
  ctx: RepoContext,
  input: { matchId: string; userId: string; reason?: string },
): Promise<{ winner: "hunters" | "shadows" | null }> {
  const repos = getRepos();
  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  if (match.createdByUserId !== input.userId) {
    throw new Error("Only the organiser can end the match.");
  }
  const now = Date.now();

  const settled = await endMatch(ctx, {
    matchId: match.id,
    nowMs: matchClockNow({
      nowMs: now,
      pausedAtMs: match.pausedAt,
      pausedTotalMs: match.pausedTotalMs,
    }),
    force: true,
  });

  await logAction(ctx, {
    match,
    actorUserId: input.userId,
    actorName: "Organiser",
    action: "match_ended",
    targetType: "match",
    targetId: match.id,
    targetLabel: match.roomCode,
    reason: input.reason ?? "Ended by the organiser.",
    detail: settled.winner ? `Winner: ${settled.winner}` : undefined,
    at: now,
  });

  return { winner: settled.winner };
}

/**
 * "Abort match" (Stage 5, decision 2): organiser or invigilator, reason
 * required. The match ends with **no winner and no bonuses** — the points
 * already earned stay exactly where they are — and the record reads
 * "aborted".
 */
export async function abortMatch(
  ctx: RepoContext,
  input: { matchId: string; userId: string; reason: string },
): Promise<{ aborted: boolean; endedAt: number }> {
  const repos = getRepos();
  const { actor, match } = await requireFreezeRights(
    ctx,
    input.matchId,
    input.userId,
  );
  const now = Date.now();

  const reason = input.reason.trim();
  if (!reason) throw new Error("Give a reason for aborting the match.");
  if (match.status === "ended") {
    throw new Error("That match has already ended.");
  }
  // No endMatch(): an abort never pays a bonus and never names a winner.
  await repos.matches.patch(ctx, match.id, {
    status: "ended",
    winner: null,
    endReason: "aborted",
    endedAt: now,
    pausedAt: null,
    pauseReason: null,
  });

  await repos.events.append(ctx, {
    matchId: match.id,
    at: now,
    kind: "phase",
    detail: `Match aborted — ${reason}`,
  });
  await logAction(ctx, {
    match,
    actorUserId: input.userId,
    actorName: actor,
    action: "match_aborted",
    targetType: "match",
    targetId: match.id,
    targetLabel: match.roomCode,
    reason,
    detail: "No winner, no bonuses; points earned so far are kept.",
    at: now,
  });

  return { aborted: true, endedAt: now };
}

/** Eligible recipients of the 150-point team bonus, for the console. */
export function eligibleHunters(players: PlayerRow[]): PlayerRow[] {
  return players.filter(isEligibleHunter);
}
