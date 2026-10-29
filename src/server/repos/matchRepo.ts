import type {
  MatchConfig,
  MatchStatus,
  LatLng,
  MatchSnapshot,
} from "../../rules/types";
import type { RepoContext } from "./context";

export type { MatchStatus, MatchConfig, LatLng };

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
  /** Where the organiser stood at setup; used for re-rolls, never published. */
  organiserPosition: LatLng | null;
  initialRadiusMetres: number;
  winner: "hunters" | "shadows" | null;
  endedAt: number | null;
}

export interface MatchRepository {
  findById(ctx: RepoContext, id: string): Promise<MatchRow | null>;
  findByRoomCode(ctx: RepoContext, roomCode: string): Promise<MatchRow | null>;
  /** Matches that ended before `endedBeforeMs`, for position cleanup. */
  listEndedBefore(
    ctx: RepoContext,
    endedBeforeMs: number,
  ): Promise<MatchRow[]>;
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
      winner?: "hunters" | "shadows" | null;
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
