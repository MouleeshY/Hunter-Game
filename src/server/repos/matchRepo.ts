import type {
  MatchConfig,
  MatchEndReason,
  MatchStatus,
  LatLng,
  MatchSnapshot,
} from "../../rules/types";
import type { RepoContext } from "./context";

export type { MatchEndReason, MatchStatus, MatchConfig, LatLng };

/** One match. Kept deliberately fat so the rules engine only needs this shape,
 *   not the underlying database document. */
export interface MatchRow {
  id: string;
  /** Five-character join code. */
  roomCode: string;
  status: MatchStatus;
  config: MatchConfig;
  createdAt: number;
  startedAt: number | null;
  endsAt: number | null;
  eventWindowEndsAt: number | null;
  rosterLocked: boolean;
  createdByUserId: string | null;
  zoneCentre: LatLng;
  /** Most recent 3-minute ping; Hunters only see positions up to this. */
  lastPingAt: number | null;
  /** Frozen moment while the match is paused, or null while it runs. */
  pausedAt: number | null;
  /** Total milliseconds spent in finished pauses. */
  pausedTotalMs: number;
  pauseReason: string | null;
  /** Last minute of Shadow alive points already paid (`-1` before the first). */
  aliveUpToMinute: number;
  /** Where the organiser stood at setup; used for re-rolls, never published. */
  organiserPosition: LatLng | null;
  initialRadiusMetres: number;
  winner: "hunters" | "shadows" | null;
  endedAt: number | null;
  /** How it finished: natural end, the organiser's "End match", or abort. */
  endReason: MatchEndReason | null;
}

export interface MatchRepository {
  findById(ctx: RepoContext, id: string): Promise<MatchRow | null>;
  findByRoomCode(ctx: RepoContext, roomCode: string): Promise<MatchRow | null>;
  /** Matches that ended before `endedBeforeMs`, for position cleanup. */
  listEndedBefore(
    ctx: RepoContext,
    endedBeforeMs: number,
  ): Promise<MatchRow[]>;
  /** Matches still on the clock (head start or live), for the minute tick. */
  listRunning(ctx: RepoContext): Promise<MatchRow[]>;
  create(
    ctx: RepoContext,
    input: {
      roomCode: string;
      status: MatchStatus;
      config: MatchConfig;
      createdByUserId: string | null;
      zoneCentre: LatLng;
      organiserPosition: LatLng;
      initialRadiusMetres: number;
      eventWindowMinutesMax: number;
    },
  ): Promise<MatchRow>;
  patch(
    ctx: RepoContext,
    id: string,
    patch: {
      status?: MatchStatus;
      startedAt?: number | null;
      endsAt?: number | null;
      lastPingAt?: number | null;
      pausedAt?: number | null;
      pausedTotalMs?: number;
      pauseReason?: string | null;
      aliveUpToMinute?: number;
      winner?: "hunters" | "shadows" | null;
      endReason?: MatchEndReason | null;
      endedAt?: number | null;
      rosterLocked?: boolean;
      zoneCentre?: LatLng;
      initialRadiusMetres?: number;
    },
  ): Promise<void>;
}

/** As the rules engine sees it. */
export function snapshotOf(row: MatchRow): MatchSnapshot {
  return {
    status: row.status,
    startedAtMs: row.startedAt,
    endsAtMs: row.endsAt,
    config: row.config,
    pausedAtMs: row.pausedAt,
    pausedTotalMs: row.pausedTotalMs,
  };
}

/** Centre + starting radius stored at kickoff. */
export interface ZoneSnapshot {
  centre: LatLng;
  initialRadiusMetres: number;
}

export function zoneSnapshotOf(row: MatchRow): ZoneSnapshot {
  return {
    centre: row.zoneCentre,
    initialRadiusMetres: row.initialRadiusMetres,
  };
}
