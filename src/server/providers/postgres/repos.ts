/**
 * Postgres implementation of every repository in `src/server/repos`.
 *
 * The opaque `RepoContext` is a `PgContext`: the connection a service is
 * running on plus whether that connection is inside a write transaction. In a
 * write transaction the row reads that two requests could collide on are
 * `select … for update` — the lock is what replaces the serialisable behaviour
 * Convex gave us for free:
 *
 *   two scans of the same Shadow   → both lock the Shadow's player row
 *   a tag landing during a tick    → both lock the match row
 *   two joins at the player cap    → both lock the match row
 *   publish and end at once        → both lock the match row
 *
 * Time columns are `timestamptz` and are converted to the epoch milliseconds
 * the rules speak at this boundary; nothing above this file sees a Date.
 */
import type { RepoContext } from "../../repos/context";
import type { UserRepository } from "../../repos/userRepo";
import type { MatchRepository, MatchRow } from "../../repos/matchRepo";
import type { PlayerRepository, PlayerRow } from "../../repos/playerRepo";
import type { LocationRepository, LocationRow } from "../../repos/locationRepo";
import type { TagRepository, TagRow } from "../../repos/tagRepo";
import type { ComplaintRepository, ComplaintRow } from "../../repos/complaintRepo";
import type {
  InvigilatorRepository,
  InvigilatorRow,
} from "../../repos/invigilatorRepo";
import type { ScoreEventRow, ScoreRepository } from "../../repos/scoreRepo";
import type {
  LeaderboardRepository,
  LeaderboardRow,
} from "../../repos/leaderboardRepo";
import type { AuditRepository, AuditRow } from "../../repos/auditRepo";
import type {
  MatchEventKind,
  MatchEventRepository,
  MatchEventRow,
} from "../../repos/eventRepo";
import type { Repos } from "../../repos";
import type { DbConnection } from "./db";

type Row = Record<string, unknown>;

export interface PgContext {
  conn: DbConnection;
  /** Inside a transaction that may write: row reads take `for update` locks. */
  write: boolean;
}

function pgOf(ctx: RepoContext): PgContext {
  return ctx as PgContext;
}

function query<T = Row>(
  ctx: RepoContext,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return pgOf(ctx).conn.query<T>(text, params);
}

/** The row lock, only inside a write transaction. */
function lock(ctx: RepoContext): string {
  return pgOf(ctx).write ? " for update" : "";
}

/**
 * Every repository, implemented on Postgres. Declared at the bottom of the
 * file so every implementation above it is already initialised.
 */

// ---- value conversions -----------------------------------------------------

function str(value: unknown): string {
  return String(value);
}

function maybeStr(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function maybeNum(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

/** epoch milliseconds from a timestamptz column, however the driver parses it. */
function ms(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function msOr(value: unknown, fallback: number): number {
  return ms(value) ?? fallback;
}

/** A parameter for a timestamptz column. ISO text + an explicit cast works on
 *  both drivers, including a null value. */
function tsv(value: number | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : new Date(value).toISOString();
}

function jsonb(value: unknown): string {
  return JSON.stringify(value);
}

// ---- rows ------------------------------------------------------------------

function matchRow(r: Row): MatchRow {
  return {
    id: str(r.id),
    roomCode: str(r.room_code),
    publicSlug: maybeStr(r.public_slug),
    title: maybeStr(r.title),
    clubName: maybeStr(r.club_name),
    published: r.published === null || r.published === undefined ? null : r.published === true,
    status: r.status as MatchRow["status"],
    config: r.config as MatchRow["config"],
    createdAt: msOr(r.created_at, 0),
    startedAt: ms(r.started_at),
    endsAt: ms(r.ends_at),
    eventWindowEndsAt: ms(r.event_window_ends_at),
    rosterLocked: r.roster_locked === true,
    createdByUserId: maybeStr(r.created_by),
    zoneCentre: { lat: num(r.zone_lat), lng: num(r.zone_lng) },
    lastPingAt: ms(r.last_ping_at),
    setupStartedAt: ms(r.setup_started_at),
    setupEndsAt: ms(r.setup_ends_at),
    pausedAt: ms(r.paused_at),
    pausedTotalMs: num(r.paused_total_ms ?? 0),
    pauseReason: maybeStr(r.pause_reason),
    aliveUpToMinute: num(r.alive_up_to_minute ?? -1),
    organiserPosition:
      r.organiser_lat === null || r.organiser_lat === undefined
        ? null
        : { lat: num(r.organiser_lat), lng: num(r.organiser_lng) },
    initialRadiusMetres: num(r.initial_radius_metres),
    winner: (r.winner ?? null) as MatchRow["winner"],
    endedAt: ms(r.ended_at),
    endReason: (r.end_reason ?? null) as MatchRow["endReason"],
  };
}

function playerRow(r: Row): PlayerRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    userId: str(r.user_id),
    role: r.role as PlayerRow["role"],
    mode: r.mode as PlayerRow["mode"],
    status: r.status as PlayerRow["status"],
    callSign: str(r.call_sign),
    displayName: str(r.display_name),
    displayNameMode: r.display_name_mode as PlayerRow["displayNameMode"],
    qrToken: str(r.qr_token),
    points: num(r.points),
    joinedAt: msOr(r.joined_at, 0),
    taggedAt: ms(r.tagged_at),
    taggedById: maybeStr(r.tagged_by_id),
    captureChosenAt: ms(r.capture_chosen_at),
    briefedAt: ms(r.briefed_at),
    outsideSince: ms(r.outside_since),
    outsideSecondsTotal: num(r.outside_seconds_total ?? 0),
    chargedDrainTicks: num(r.charged_drain_ticks ?? 0),
    warnedAt: ms(r.warned_at),
  };
}

function locationRow(r: Row): LocationRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    playerId: str(r.player_id),
    lat: num(r.lat),
    lng: num(r.lng),
    accuracyMetres: maybeNum(r.accuracy_metres),
    recordedAtMs: msOr(r.recorded_at, 0),
    pingIndex: num(r.ping_index),
    suspicious: r.suspicious === true,
    suspiciousReason: maybeStr(r.suspicious_reason),
  };
}

function tagRow(r: Row): TagRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    hunterId: str(r.hunter_id),
    shadowId: str(r.shadow_id),
    status: r.status as TagRow["status"],
    rejectionCode: maybeStr(r.rejection_code),
    distanceMetres: maybeNum(r.distance_metres),
    assistedById: maybeStr(r.assisted_by_id),
    captureMode: (r.capture_mode ?? null) as TagRow["captureMode"],
    forced: r.forced === true,
    forcedByUserId: maybeStr(r.forced_by),
    scoredPoints: num(r.scored_points),
    at: msOr(r.at, 0),
  };
}

function complaintRow(r: Row): ComplaintRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    complainantId: str(r.complainant_id),
    accusedId: str(r.accused_id),
    note: maybeStr(r.note),
    createdAt: msOr(r.created_at, 0),
    responseDueAt: msOr(r.response_due_at, 0),
    status: r.status as ComplaintRow["status"],
    resolvedByUserId: maybeStr(r.resolved_by),
    resolvedAt: ms(r.resolved_at),
    resolutionNote: maybeStr(r.resolution_note),
  };
}

function invigilatorRow(r: Row): InvigilatorRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    userId: maybeStr(r.user_id),
    displayName: str(r.display_name),
    inviteCode: str(r.invite_code),
    active: r.active === true,
    addedAt: msOr(r.added_at, 0),
  };
}

function scoreRow(r: Row): ScoreEventRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    playerId: str(r.player_id),
    kind: r.kind as ScoreEventRow["kind"],
    points: num(r.points),
    at: msOr(r.at, 0),
    source: r.source as ScoreEventRow["source"],
    refId: maybeStr(r.ref_id),
  };
}

function leaderboardRow(r: Row): LeaderboardRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    playerId: str(r.player_id),
    displayName: str(r.display_name),
    displayNameMode: r.display_name_mode as LeaderboardRow["displayNameMode"],
    totalPoints: num(r.total_points),
    breakdown: r.breakdown as LeaderboardRow["breakdown"],
    updatedAt: msOr(r.updated_at, 0),
  };
}

function auditRow(r: Row): AuditRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    at: msOr(r.at, 0),
    actorUserId: str(r.actor_user_id),
    actorName: str(r.actor_name),
    action: str(r.action),
    targetType: str(r.target_type),
    targetId: maybeStr(r.target_id),
    targetLabel: maybeStr(r.target_label),
    reason: maybeStr(r.reason),
    detail: maybeStr(r.detail),
  };
}

function eventRow(r: Row): MatchEventRow {
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    at: msOr(r.at, 0),
    kind: r.kind as MatchEventKind,
    playerId: maybeStr(r.player_id),
    actorId: maybeStr(r.actor_id),
    detail: maybeStr(r.detail),
    refId: maybeStr(r.ref_id),
    distanceMetres: maybeNum(r.distance_metres),
    lat: maybeNum(r.lat),
    lng: maybeNum(r.lng),
  };
}

// ---- update builders -------------------------------------------------------

interface Assignment {
  column: string;
  value: unknown;
  cast?: string;
}

function patchStatement(
  table: string,
  id: string,
  assignments: Assignment[],
): { text: string; params: unknown[] } | null {
  if (assignments.length === 0) return null;
  const sets = assignments.map(
    (a, i) => `${a.column} = $${i + 2}${a.cast ?? ""}`,
  );
  return {
    text: `update ${table} set ${sets.join(", ")} where id = $1::uuid`,
    params: [id, ...assignments.map((a) => a.value)],
  };
}

async function applyPatch(
  ctx: RepoContext,
  table: string,
  id: string,
  assignments: Assignment[],
): Promise<void> {
  const statement = patchStatement(table, id, assignments);
  if (!statement) return;
  await query(ctx, statement.text, statement.params);
}

// ---- UserRepository --------------------------------------------------------

export const userRepo: UserRepository = {
  findById: async (ctx, id) => {
    const rows = await query(ctx, `select * from users where id = $1::uuid`, [id]);
    return rows[0]
      ? {
          id: str(rows[0].id),
          name: maybeStr(rows[0].name),
          email: maybeStr(rows[0].email),
        }
      : null;
  },

  upsert: async (ctx, input) => {
    const rows = await query(
      ctx,
      `insert into users (id, name, email)
       values ($1::uuid, $2, $3)
       on conflict (id) do update set
         name = coalesce(excluded.name, users.name),
         email = coalesce(excluded.email, users.email)
       returning *`,
      [input.id, input.name ?? null, input.email ?? null],
    );
    return {
      id: str(rows[0].id),
      name: maybeStr(rows[0].name),
      email: maybeStr(rows[0].email),
    };
  },
};

// ---- MatchRepository -------------------------------------------------------

const MATCH_COLUMNS = "*";

export const matchRepo: MatchRepository = {
  findById: async (ctx, id) => {
    const rows = await query(
      ctx,
      `select ${MATCH_COLUMNS} from matches where id = $1::uuid${lock(ctx)}`,
      [id],
    );
    return rows[0] ? matchRow(rows[0]) : null;
  },

  findByRoomCode: async (ctx, roomCode) => {
    // Prefer a match that is still open; codes may be reused after a match ends.
    const rows = await query(
      ctx,
      `select ${MATCH_COLUMNS} from matches
        where room_code = $1
        order by (status = 'ended') asc, created_at desc
        limit 1${lock(ctx)}`,
      [roomCode],
    );
    return rows[0] ? matchRow(rows[0]) : null;
  },

  findByPublicSlug: async (ctx, slug) => {
    const rows = await query(
      ctx,
      `select ${MATCH_COLUMNS} from matches where public_slug = $1 limit 1${lock(ctx)}`,
      [slug],
    );
    return rows[0] ? matchRow(rows[0]) : null;
  },

  listEnded: async (ctx) => {
    const rows = await query(
      ctx,
      `select ${MATCH_COLUMNS} from matches
        where status = 'ended'
        order by ended_at asc nulls first`,
    );
    return rows.map(matchRow);
  },

  listEndedBefore: async (ctx, endedBeforeMs) => {
    const rows = await query(
      ctx,
      `select ${MATCH_COLUMNS} from matches
        where status = 'ended' and ended_at < $1::timestamptz`,
      [tsv(endedBeforeMs)],
    );
    return rows.map(matchRow);
  },

  listRunning: async (ctx) => {
    const rows = await query(
      ctx,
      `select ${MATCH_COLUMNS} from matches
        where status in ('setup', 'headstart', 'live')`,
    );
    return rows.map(matchRow);
  },

  create: async (ctx, input) => {
    const createdAt = Date.now();
    const rows = await query(
      ctx,
      `insert into matches (
         room_code, public_slug, title, club_name, status, config, created_at,
         event_window_ends_at, roster_locked, created_by,
         zone_lat, zone_lng, initial_radius_metres, organiser_lat, organiser_lng
       ) values (
         $1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz,
         $8::timestamptz, false, $9::uuid,
         $10, $11, $12, $13, $14
       )
       returning *`,
      [
        input.roomCode,
        input.publicSlug,
        input.title,
        input.clubName,
        input.status,
        jsonb(input.config),
        tsv(createdAt),
        tsv(createdAt + input.eventWindowMinutesMax * 60_000),
        input.createdByUserId,
        input.zoneCentre.lat,
        input.zoneCentre.lng,
        input.initialRadiusMetres,
        input.organiserPosition.lat,
        input.organiserPosition.lng,
      ],
    );
    return matchRow(rows[0]);
  },

  patch: async (ctx, id, patch) => {
    const assignments: Assignment[] = [];
    const push = (column: string, value: unknown, cast?: string) =>
      assignments.push({ column, value, cast });

    if (patch.status !== undefined) push("status", patch.status);
    if (patch.startedAt !== undefined) push("started_at", tsv(patch.startedAt), "::timestamptz");
    if (patch.endsAt !== undefined) push("ends_at", tsv(patch.endsAt), "::timestamptz");
    if (patch.lastPingAt !== undefined) push("last_ping_at", tsv(patch.lastPingAt), "::timestamptz");
    if (patch.setupStartedAt !== undefined) {
      push("setup_started_at", tsv(patch.setupStartedAt), "::timestamptz");
    }
    if (patch.setupEndsAt !== undefined) {
      push("setup_ends_at", tsv(patch.setupEndsAt), "::timestamptz");
    }
    if (patch.pausedAt !== undefined) push("paused_at", tsv(patch.pausedAt), "::timestamptz");
    if (patch.pausedTotalMs !== undefined) push("paused_total_ms", patch.pausedTotalMs);
    if (patch.pauseReason !== undefined) push("pause_reason", patch.pauseReason);
    if (patch.aliveUpToMinute !== undefined) push("alive_up_to_minute", patch.aliveUpToMinute);
    if (patch.winner !== undefined) push("winner", patch.winner);
    if (patch.endReason !== undefined) push("end_reason", patch.endReason);
    if (patch.endedAt !== undefined) push("ended_at", tsv(patch.endedAt), "::timestamptz");
    if (patch.rosterLocked !== undefined) push("roster_locked", patch.rosterLocked);
    if (patch.title !== undefined) push("title", patch.title);
    if (patch.clubName !== undefined) push("club_name", patch.clubName);
    if (patch.published !== undefined) push("published", patch.published);
    if (patch.zoneCentre !== undefined) {
      push("zone_lat", patch.zoneCentre.lat);
      push("zone_lng", patch.zoneCentre.lng);
    }
    if (patch.initialRadiusMetres !== undefined) {
      push("initial_radius_metres", patch.initialRadiusMetres);
    }

    await applyPatch(ctx, "matches", id, assignments);
  },
};

// ---- PlayerRepository ------------------------------------------------------

export const playerRepo: PlayerRepository = {
  findById: async (ctx, id) => {
    const rows = await query(
      ctx,
      `select * from players where id = $1::uuid${lock(ctx)}`,
      [id],
    );
    return rows[0] ? playerRow(rows[0]) : null;
  },

  findByMatchAndUser: async (ctx, matchId, userId) => {
    const rows = await query(
      ctx,
      `select * from players
        where match_id = $1::uuid and user_id = $2::uuid
        limit 1${lock(ctx)}`,
      [matchId, userId],
    );
    return rows[0] ? playerRow(rows[0]) : null;
  },

  findByMatchAndToken: async (ctx, matchId, qrToken) => {
    const rows = await query(
      ctx,
      `select * from players
        where match_id = $1::uuid and qr_token = $2
        limit 1${lock(ctx)}`,
      [matchId, qrToken],
    );
    return rows[0] ? playerRow(rows[0]) : null;
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from players where match_id = $1::uuid order by joined_at asc, id asc`,
      [matchId],
    );
    return rows.map(playerRow);
  },

  create: async (ctx, input) => {
    const rows = await query(
      ctx,
      `insert into players (
         match_id, user_id, role, mode, status, call_sign, display_name,
         display_name_mode, qr_token, points, joined_at
       ) values (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, 0, $10::timestamptz
       )
       returning *`,
      [
        input.matchId,
        input.userId,
        input.role,
        input.mode,
        input.status,
        input.callSign,
        input.displayName,
        input.displayNameMode,
        input.qrToken,
        tsv(input.joinedAt),
      ],
    );
    return playerRow(rows[0]);
  },

  patch: async (ctx, id, patch) => {
    const assignments: Assignment[] = [];
    const push = (column: string, value: unknown, cast?: string) =>
      assignments.push({ column, value, cast });

    if (patch.role !== undefined) push("role", patch.role);
    if (patch.mode !== undefined) push("mode", patch.mode);
    if (patch.status !== undefined) push("status", patch.status);
    if (patch.points !== undefined) push("points", patch.points);
    if (patch.taggedAt !== undefined) push("tagged_at", tsv(patch.taggedAt), "::timestamptz");
    if (patch.taggedById !== undefined) push("tagged_by_id", patch.taggedById, "::uuid");
    if (patch.captureChosenAt !== undefined) {
      push("capture_chosen_at", tsv(patch.captureChosenAt), "::timestamptz");
    }
    if (patch.briefedAt !== undefined) {
      push("briefed_at", tsv(patch.briefedAt), "::timestamptz");
    }

    await applyPatch(ctx, "players", id, assignments);
  },

  patchOutZoneState: async (ctx, id, state) => {
    const assignments: Assignment[] = [];
    const push = (column: string, value: unknown, cast?: string) =>
      assignments.push({ column, value, cast });

    if (state.outsideSince !== undefined) {
      push("outside_since", tsv(state.outsideSince), "::timestamptz");
    }
    if (state.outsideSecondsTotal !== undefined) {
      push("outside_seconds_total", state.outsideSecondsTotal);
    }
    if (state.chargedDrainTicks !== undefined) {
      push("charged_drain_ticks", state.chargedDrainTicks);
    }
    if (state.warnedAt !== undefined) {
      push("warned_at", tsv(state.warnedAt), "::timestamptz");
    }
    if (state.status !== undefined) push("status", state.status);

    await applyPatch(ctx, "players", id, assignments);
  },
};

// ---- LocationRepository ----------------------------------------------------

export const locationRepo: LocationRepository = {
  latestByPlayer: async (ctx, matchId, playerId) => {
    const rows = await query(
      ctx,
      `select * from locations
        where match_id = $1::uuid and player_id = $2::uuid
        order by recorded_at desc
        limit 1`,
      [matchId, playerId],
    );
    return rows[0] ? locationRow(rows[0]) : null;
  },

  latestByPlayerBefore: async (ctx, matchId, playerId, atMs) => {
    const rows = await query(
      ctx,
      `select * from locations
        where match_id = $1::uuid and player_id = $2::uuid
          and recorded_at <= $3::timestamptz
        order by recorded_at desc
        limit 1`,
      [matchId, playerId, tsv(atMs)],
    );
    return rows[0] ? locationRow(rows[0]) : null;
  },

  latestSnapshotByPlayers: async (ctx, matchId, playerIds) => {
    const map = new Map<string, LocationRow>();
    if (playerIds.length === 0) return map;
    const rows = await query(
      ctx,
      `select distinct on (player_id) *
        from locations
        where match_id = $1::uuid and player_id = any($2::uuid[])
        order by player_id, recorded_at desc`,
      [matchId, playerIds],
    );
    for (const row of rows) {
      const mapped = locationRow(row);
      map.set(mapped.playerId, mapped);
    }
    return map;
  },

  insert: async (ctx, input) => {
    const rows = await query(
      ctx,
      `insert into locations (
         match_id, player_id, lat, lng, accuracy_metres, recorded_at,
         ping_index, suspicious, suspicious_reason
       ) values (
         $1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7, $8, $9
       )
       returning *`,
      [
        input.matchId,
        input.playerId,
        input.lat,
        input.lng,
        input.accuracyMetres,
        tsv(input.recordedAt),
        input.pingIndex,
        input.suspicious ?? false,
        input.suspiciousReason ?? null,
      ],
    );
    return locationRow(rows[0]);
  },

  deleteForMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `delete from locations where match_id = $1::uuid returning id`,
      [matchId],
    );
    return rows.length;
  },
};

// ---- TagRepository ---------------------------------------------------------

export const tagRepo: TagRepository = {
  insert: async (ctx, input) => {
    const rows = await query(
      ctx,
      `insert into tags (
         match_id, hunter_id, shadow_id, status, rejection_code, distance_metres,
         assisted_by_id, capture_mode, forced, forced_by, scored_points, "at"
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
         $7::uuid, $8, $9, $10::uuid, $11, $12::timestamptz
       )
       returning id`,
      [
        input.matchId,
        input.hunterId,
        input.shadowId,
        input.status,
        input.rejectionCode ?? null,
        input.distanceMetres ?? null,
        input.assistedById ?? null,
        input.captureMode ?? null,
        input.forced ?? false,
        input.forcedByUserId ?? null,
        input.scoredPoints,
        tsv(input.at),
      ],
    );
    return str(rows[0].id);
  },

  patch: async (ctx, id, patch) => {
    if (patch.captureMode === undefined) return;
    await query(ctx, `update tags set capture_mode = $2 where id = $1::uuid`, [
      id,
      patch.captureMode,
    ]);
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from tags where match_id = $1::uuid order by "at" asc, id asc`,
      [matchId],
    );
    return rows.map(tagRow);
  },
};

// ---- ComplaintRepository ---------------------------------------------------

export const complaintRepo: ComplaintRepository = {
  create: async (ctx, input) => {
    const at = input.nowMs ?? Date.now();
    const rows = await query(
      ctx,
      `insert into complaints (
         match_id, complainant_id, accused_id, note, created_at, response_due_at, status
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::timestamptz, 'open'
       )
       returning *`,
      [
        input.matchId,
        input.complainantId,
        input.accusedId,
        input.note,
        tsv(at),
        tsv(at + input.configComplaintResponseMinutes * 60_000),
      ],
    );
    return complaintRow(rows[0]);
  },

  listOpenByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from complaints
        where match_id = $1::uuid and status = 'open'
        order by created_at asc`,
      [matchId],
    );
    return rows.map(complaintRow);
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from complaints where match_id = $1::uuid order by created_at asc, id asc`,
      [matchId],
    );
    return rows.map(complaintRow);
  },

  patch: async (ctx, id, patch) => {
    const assignments: Assignment[] = [];
    if (patch.status !== undefined) assignments.push({ column: "status", value: patch.status });
    if (patch.resolvedByUserId !== undefined) {
      assignments.push({
        column: "resolved_by",
        value: patch.resolvedByUserId,
        cast: "::uuid",
      });
    }
    if (patch.resolvedAt !== undefined) {
      assignments.push({
        column: "resolved_at",
        value: tsv(patch.resolvedAt),
        cast: "::timestamptz",
      });
    }
    if (patch.resolutionNote !== undefined) {
      assignments.push({ column: "resolution_note", value: patch.resolutionNote });
    }
    await applyPatch(ctx, "complaints", id, assignments);
  },
};

// ---- InvigilatorRepository -------------------------------------------------

export const invigilatorRepo: InvigilatorRepository = {
  findById: async (ctx, id) => {
    const rows = await query(
      ctx,
      `select * from invigilators where id = $1::uuid${lock(ctx)}`,
      [id],
    );
    return rows[0] ? invigilatorRow(rows[0]) : null;
  },

  findByInviteCode: async (ctx, inviteCode) => {
    const rows = await query(
      ctx,
      `select * from invigilators where invite_code = $1 limit 1${lock(ctx)}`,
      [inviteCode],
    );
    return rows[0] ? invigilatorRow(rows[0]) : null;
  },

  findByMatchAndUser: async (ctx, matchId, userId) => {
    const rows = await query(
      ctx,
      `select * from invigilators
        where match_id = $1::uuid and user_id = $2::uuid
        limit 1${lock(ctx)}`,
      [matchId, userId],
    );
    return rows[0] ? invigilatorRow(rows[0]) : null;
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from invigilators where match_id = $1::uuid order by added_at asc, id asc`,
      [matchId],
    );
    return rows.map(invigilatorRow);
  },

  create: async (ctx, input) => {
    const rows = await query(
      ctx,
      `insert into invigilators (match_id, display_name, invite_code, active, added_at)
       values ($1::uuid, $2, $3, true, $4::timestamptz)
       returning *`,
      [input.matchId, input.displayName, input.inviteCode, tsv(input.addedAt)],
    );
    return invigilatorRow(rows[0]);
  },

  claim: async (ctx, id, userId) => {
    await query(
      ctx,
      `update invigilators set user_id = $2::uuid where id = $1::uuid`,
      [id, userId],
    );
  },

  patchActive: async (ctx, id, active) => {
    await query(ctx, `update invigilators set active = $2 where id = $1::uuid`, [
      id,
      active,
    ]);
  },
};

// ---- ScoreRepository -------------------------------------------------------

export const scoreRepo: ScoreRepository = {
  insert: async (ctx, input) => {
    await query(
      ctx,
      `insert into score_events (match_id, player_id, kind, points, "at", source, ref_id)
       values ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6, $7)`,
      [
        input.matchId,
        input.playerId,
        input.kind,
        input.points,
        tsv(input.at),
        input.source,
        input.refId,
      ],
    );
  },

  listByPlayer: async (ctx, matchId, playerId) => {
    const rows = await query(
      ctx,
      `select * from score_events
        where match_id = $1::uuid and player_id = $2::uuid
        order by "at" asc, id asc`,
      [matchId, playerId],
    );
    return rows.map(scoreRow);
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from score_events where match_id = $1::uuid order by "at" asc, id asc`,
      [matchId],
    );
    return rows.map(scoreRow);
  },

  existsByRef: async (ctx, matchId, playerId, kind, refId) => {
    const rows = await query(
      ctx,
      `select 1 from score_events
        where match_id = $1::uuid and player_id = $2::uuid
          and kind = $3 and ref_id = $4
        limit 1`,
      [matchId, playerId, kind, refId],
    );
    return rows.length > 0;
  },
};

// ---- LeaderboardRepository -------------------------------------------------

export const leaderboardRepo: LeaderboardRepository = {
  upsert: async (ctx, input) => {
    await query(
      ctx,
      `insert into leaderboard (
         match_id, player_id, display_name, display_name_mode,
         total_points, breakdown, updated_at
       ) values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::timestamptz)
       on conflict (match_id, player_id) do update set
         display_name = excluded.display_name,
         display_name_mode = excluded.display_name_mode,
         total_points = excluded.total_points,
         breakdown = excluded.breakdown,
         updated_at = excluded.updated_at`,
      [
        input.matchId,
        input.playerId,
        input.displayName,
        input.displayNameMode,
        input.totalPoints,
        jsonb(input.breakdown),
        tsv(input.at),
      ],
    );
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from leaderboard
        where match_id = $1::uuid
        order by total_points desc, id asc`,
      [matchId],
    );
    return rows.map(leaderboardRow);
  },
};

// ---- AuditRepository -------------------------------------------------------

export const auditRepo: AuditRepository = {
  append: async (ctx, input) => {
    const rows = await query(
      ctx,
      `insert into audit_log (
         match_id, "at", actor_user_id, actor_name, action, target_type,
         target_id, target_label, reason, detail
       ) values (
         $1::uuid, $2::timestamptz, $3::uuid, $4, $5, $6, $7, $8, $9, $10
       )
       returning id`,
      [
        input.matchId,
        tsv(input.at),
        input.actorUserId,
        input.actorName,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.targetLabel ?? null,
        input.reason ?? null,
        input.detail ?? null,
      ],
    );
    return str(rows[0].id);
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from audit_log where match_id = $1::uuid order by "at" asc, id asc`,
      [matchId],
    );
    return rows.map(auditRow);
  },
};

// ---- MatchEventRepository --------------------------------------------------

export const eventRepo: MatchEventRepository = {
  append: async (ctx, input) => {
    const rows = await query(
      ctx,
      `insert into match_events (
         match_id, "at", kind, player_id, actor_id, detail, ref_id,
         distance_metres, lat, lng
       ) values (
         $1::uuid, $2::timestamptz, $3, $4::uuid, $5::uuid, $6, $7, $8, $9, $10
       )
       returning id`,
      [
        input.matchId,
        tsv(input.at),
        input.kind,
        input.playerId ?? null,
        input.actorId ?? null,
        input.detail ?? null,
        input.refId ?? null,
        input.distanceMetres ?? null,
        input.lat ?? null,
        input.lng ?? null,
      ],
    );
    return str(rows[0].id);
  },

  listByMatch: async (ctx, matchId) => {
    const rows = await query(
      ctx,
      `select * from match_events where match_id = $1::uuid order by "at" asc, id asc`,
      [matchId],
    );
    return rows.map(eventRow);
  },

  listByMatchAndKind: async (ctx, matchId, kind) => {
    const rows = await query(
      ctx,
      `select * from match_events
        where match_id = $1::uuid and kind = $2
        order by "at" asc, id asc`,
      [matchId, kind],
    );
    return rows.map(eventRow);
  },

  existsByRef: async (ctx, matchId, refId) => {
    const rows = await query(
      ctx,
      `select 1 from match_events where match_id = $1::uuid and ref_id = $2 limit 1`,
      [matchId, refId],
    );
    return rows.length > 0;
  },
};

/** Every repository the server uses, implemented on Postgres. */
export const repos: Repos = {
  users: userRepo,
  matches: matchRepo,
  players: playerRepo,
  locations: locationRepo,
  tags: tagRepo,
  complaints: complaintRepo,
  invigilators: invigilatorRepo,
  scores: scoreRepo,
  leaderboard: leaderboardRepo,
  audit: auditRepo,
  events: eventRepo,
};
