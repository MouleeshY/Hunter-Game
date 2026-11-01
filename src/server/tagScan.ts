/**
 * The tag scan and the capture choice.
 *
 * This used to live inside `src/convex/matches.ts`, which meant a second
 * backend would have had to copy it. It is a service like any other: the Convex
 * functions and the HTTP API both call it, and every write goes through the
 * repositories. The rules (proximity, freshness, scoring, end conditions) come
 * from `src/rules`.
 */
import {
  distanceMetres,
  hunterTagPoints,
  matchEndState,
  validateTagScan,
  zoneProgress,
  zoneRadiusAtMinute,
  type LocationSnapshot,
  type PlayerSnapshot,
} from "../rules";
import { getRepos } from "./providers";
import type { LocationRow, PlayerRow, RepoContext } from "./repos";
import { award } from "./settlement";
import { activeShadows, endMatch } from "./matchEnd";
import { statusAfterCapture } from "./console";

function playerSnapshot(player: PlayerRow): PlayerSnapshot {
  return {
    id: player.id,
    role: player.role,
    mode: player.mode,
    status: player.status,
    taggedAtMs: player.taggedAt,
  };
}

function locationSnapshot(row: LocationRow): LocationSnapshot {
  return {
    lat: row.lat,
    lng: row.lng,
    recordedAtMs: row.recordedAtMs,
    accuracyMetres: row.accuracyMetres,
    pingIndex: row.pingIndex,
    suspicious: row.suspicious,
  };
}

/** Zone contraction (0 → 1) at a given moment of the match. */
function zoneProgressNow(
  match: {
    startedAt: number | null;
    initialRadiusMetres: number;
    config: Parameters<typeof zoneRadiusAtMinute>[0]["config"];
  },
  inPlayCount: number,
  nowMs: number,
): number {
  const startedAt = match.startedAt ?? nowMs;
  const minute = Math.max(0, Math.floor((nowMs - startedAt) / 60_000));
  const radius = zoneRadiusAtMinute({
    minute,
    activePlayerCount: inPlayCount,
    initialRadiusMetres: match.initialRadiusMetres,
    config: match.config,
  });
  return zoneProgress(radius, match.initialRadiusMetres);
}

/**
 * The spoof check a scan reading gets, same numbers as the upload path: an
 * impossible accuracy, or a jump faster than a person can move.
 */
function spoofReason(args: {
  previous: LocationRow | null;
  lat: number;
  lng: number;
  accuracyMetres: number | null;
  nowMs: number;
  config: {
    impossibleAccuracyMetres: number;
    maxSpeedMetresPerSecond: number;
  };
}): string | null {
  const { previous, accuracyMetres, config } = args;
  if (
    accuracyMetres !== null &&
    (accuracyMetres < 0 || accuracyMetres > config.impossibleAccuracyMetres)
  ) {
    return "impossible_accuracy";
  }
  if (previous) {
    const seconds = (args.nowMs - previous.recordedAtMs) / 1000;
    if (seconds > 0) {
      const speed =
        distanceMetres(previous, { lat: args.lat, lng: args.lng }) / seconds;
      if (speed > config.maxSpeedMetresPerSecond) return "impossible_speed";
    }
  }
  return null;
}

export interface TagScanResult {
  ok: boolean;
  code: string | null;
  distanceMetres: number | null;
  points: number;
  matchEnded: boolean;
  winner: "hunters" | "shadows" | null;
  /** The choice the tagged player is offered next. */
  captureMode?: PlayerRow["mode"];
}

/**
 * A Hunter scans a Shadow's QR code.
 *
 * The scan carries a fresh reading from the scanner, which is stored so the
 * 30-second freshness rule applies to both sides. A rejected scan writes one
 * audit row and changes nothing else; an accepted one awards the tag points,
 * moves the Shadow to the preset mode and may end the match.
 */
export async function submitTagScan(
  ctx: RepoContext,
  input: {
    matchId: string;
    userId: string;
    scannedToken: string;
    scannerLat: number;
    scannerLng: number;
    scannerAccuracyMetres?: number | null;
    assistedByPlayerId?: string | null;
    nowMs?: number;
  },
): Promise<TagScanResult> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found");

  const scanner = await repos.players.findByMatchAndUser(
    ctx,
    match.id,
    input.userId,
  );
  if (!scanner) throw new Error("You are not in this match");

  // The scan carries a fresh reading; store it so the 30 s freshness rule can
  // be applied to both sides.
  if (!Number.isFinite(input.scannerLat) || !Number.isFinite(input.scannerLng)) {
    throw new Error("A current GPS reading is needed to scan.");
  }

  // Nothing happens while the match is frozen: no tags, no scoring.
  if (match.pausedAt !== null) {
    return {
      ok: false,
      code: "match_paused",
      distanceMetres: null,
      points: 0,
      matchEnded: false,
      winner: null,
    };
  }

  const previous = await repos.locations.latestByPlayer(
    ctx,
    match.id,
    scanner.id,
  );
  const scannerReason = spoofReason({
    previous,
    lat: input.scannerLat,
    lng: input.scannerLng,
    accuracyMetres: input.scannerAccuracyMetres ?? null,
    nowMs: now,
    config: match.config,
  });
  const stored = await repos.locations.insert(ctx, {
    matchId: match.id,
    playerId: scanner.id,
    lat: input.scannerLat,
    lng: input.scannerLng,
    accuracyMetres: input.scannerAccuracyMetres ?? null,
    pingIndex: (previous?.pingIndex ?? -1) + 1,
    recordedAt: now,
    suspicious: scannerReason !== null,
    suspiciousReason: scannerReason,
  });

  const target = await repos.players.findByMatchAndToken(
    ctx,
    match.id,
    input.scannedToken,
  );
  const targetLocation = target
    ? await repos.locations.latestByPlayer(ctx, match.id, target.id)
    : null;

  const verdict = validateTagScan({
    nowMs: now,
    match: {
      status: match.status,
      startedAtMs: match.startedAt,
      endsAtMs: match.endsAt,
      paused: match.pausedAt !== null,
    },
    scanner: playerSnapshot(scanner),
    target: target ? playerSnapshot(target) : null,
    scannerLocation: locationSnapshot(stored),
    targetLocation: targetLocation ? locationSnapshot(targetLocation) : null,
    config: match.config,
  });

  if (!verdict.ok) {
    // A failed or wrong scan costs the Hunter nothing: no points move and no
    // state changes. The row exists only for an invigilator to audit.
    if (target) {
      await repos.tags.insert(ctx, {
        matchId: match.id,
        hunterId: scanner.id,
        shadowId: target.id,
        status: "rejected",
        rejectionCode: verdict.code,
        distanceMetres: verdict.distanceMetres ?? null,
        scoredPoints: 0,
        at: now,
      });
    }
    return {
      ok: false,
      code: verdict.code,
      distanceMetres: verdict.distanceMetres ?? null,
      points: 0,
      matchEnded: false,
      winner: null,
    };
  }

  const players = await repos.players.listByMatch(ctx, match.id);
  const inPlay = players.filter(
    (player) => player.status === "active" || player.status === "tagged",
  );
  const progress = zoneProgressNow(match, inPlay.length, now);
  const points = verdict.scores
    ? hunterTagPoints({ zoneProgress01: progress, config: match.config })
    : 0;

  /* Who helped: a converted Hunter or a Helper may assist, never a stranger. */
  let assistedById: string | null = null;
  if (input.assistedByPlayerId) {
    const helper = players.find(
      (player) => player.id === input.assistedByPlayerId,
    );
    if (
      helper &&
      helper.id !== scanner.id &&
      helper.taggedAt !== null &&
      (helper.mode === "hunter" || helper.mode === "helper")
    ) {
      assistedById = helper.id;
    }
  }

  const tagId = await repos.tags.insert(ctx, {
    matchId: match.id,
    hunterId: scanner.id,
    shadowId: target!.id,
    status: "accepted",
    distanceMetres: verdict.distanceMetres,
    assistedById,
    // The mode chosen before the match is the default offered at capture.
    captureMode: target!.mode,
    forced: false,
    scoredPoints: points,
    at: now,
  });

  /* The Shadow stops scoring and takes the preset mode until they choose. */
  await repos.players.patch(ctx, target!.id, {
    status: statusAfterCapture(target!.mode),
    taggedAt: now,
    taggedById: scanner.id,
    captureChosenAt: null,
  });
  await repos.events.append(ctx, {
    matchId: match.id,
    at: now,
    kind: "tag",
    playerId: target!.id,
    actorId: scanner.id,
  });

  if (points > 0) {
    await award(ctx, {
      matchId: match.id,
      playerId: scanner.id,
      kind: "tag",
      points,
      at: now,
      refId: tagId,
    });
  }

  /* End conditions: Hunters win when no Shadow remains active. */
  const remaining = players.map((player) =>
    player.id === target!.id
      ? {
          ...player,
          status: statusAfterCapture(target!.mode),
          taggedAt: now,
        }
      : player,
  );
  const end = matchEndState({
    totalShadows: remaining.filter((p) => p.role === "shadow").length,
    activeShadows: activeShadows(remaining).length,
    nowMs: now,
    endsAtMs: match.endsAt,
  });

  let matchEnded = false;
  if (end.ended && end.winner === "hunters") {
    const settled = await endMatch(ctx, {
      matchId: match.id,
      nowMs: now,
      refId: tagId,
    });
    matchEnded = settled.ended;
  }

  return {
    ok: true,
    code: null,
    distanceMetres: verdict.distanceMetres,
    points,
    matchEnded,
    winner: end.ended ? end.winner : null,
    captureMode: target!.mode,
  };
}

/**
 * The tagged Shadow decides what happens next: Spectator, join the Hunters, or
 * Helper (helps a Hunter, plays for fun, earns nothing). The organiser's preset
 * arrives as the default; this records the moment they actually chose.
 */
export async function chooseCaptureMode(
  ctx: RepoContext,
  input: {
    matchId: string;
    userId: string;
    mode: PlayerRow["mode"];
    nowMs?: number;
  },
): Promise<{ mode: PlayerRow["mode"] }> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();

  const player = await repos.players.findByMatchAndUser(
    ctx,
    input.matchId,
    input.userId,
  );
  if (!player) throw new Error("You are not in this match.");
  if (player.taggedAt === null) {
    throw new Error("Only a captured Shadow picks a mode.");
  }

  await repos.players.patch(ctx, player.id, {
    mode: input.mode,
    status: statusAfterCapture(input.mode),
    captureChosenAt: now,
  });

  // The choice is written back onto the tag raised when they were caught.
  const tags = await repos.tags.listByMatch(ctx, input.matchId);
  const tag = tags
    .filter(
      (row) => row.shadowId === player.id && row.status === "accepted",
    )
    .sort((a, b) => b.at - a.at)[0];
  if (tag) {
    await repos.tags.patch(ctx, tag.id, { captureMode: input.mode });
  }

  return { mode: input.mode };
}
