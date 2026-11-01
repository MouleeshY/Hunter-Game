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
  /** Random public link id (never the room code), or null for pre-Stage-6 rows. */
  publicSlug: string | null;
  /** Optional title and club name on the public result page. */
  title: string | null;
  clubName: string | null;
  /** Organiser override; null means the default publication applies. */
  published: boolean | null;
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
  /** When the initial-separation countdown began, or null outside setup. */
  setupStartedAt: number | null;
  /** When the setup countdown runs out. The organiser may push it out. */
  setupEndsAt: number | null;
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
  /** Public result link lookup; the slug is random, never the room code. */
  findByPublicSlug(ctx: RepoContext, slug: string): Promise<MatchRow | null>;
  /** Every ended match, oldest first: the public list filters and sorts these. */
  listEnded(ctx: RepoContext): Promise<MatchRow[]>;
  /** Matches that ended before `endedBeforeMs`, for position cleanup. */
  listEndedBefore(
    ctx: RepoContext,
    endedBeforeMs: number,
  ): Promise<MatchRow[]>;
  /**
   * Matches the minute tick must look at: the setup countdown (to advance it)
   * plus everything on the clock (head start or live).
   */
  listRunning(ctx: RepoContext): Promise<MatchRow[]>;
  create(
    ctx: RepoContext,
    input: {
      roomCode: string;
      publicSlug: string;
      title: string | null;
      clubName: string | null;
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
      setupStartedAt?: number | null;
      setupEndsAt?: number | null;
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
      title?: string | null;
      clubName?: string | null;
      /** null clears the override and returns to the default. */
      published?: boolean | null;
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
