import type {
  MatchStatus,
  MatchConfig,
  LatLng,
  MatchSnapshot,
} from "../../rules/types";

export type { MatchStatus, MatchConfig, LatLng } from "../../rules/types";

/** One match. Kept deliberately fat here so the rules engine only needs this
 *   interface, not the underlying DB shape. */
export interface MatchRow {
  id: string;
  status: MatchStatus;
  config: MatchConfig;
  createdAt: number;
  startedAt: number | null;
  endsAt: number | null;
  eventWindowEndsAt: number | null;
  rosterLocked: boolean;
  createdByUserId: string | null;
  zoneCentre: LatLng;
  initialRadiusMetres: number;
  winner: "hunters" | "shadows" | null;
  endedAt: number | null;
}

export interface MatchRepository {
  /** Return the match with this id, or null. */
  findById(id: string): Promise<MatchRow | null>;

  /** Persist a new match row as created by the organiser. */
  create(input: {
    status: MatchStatus;
    config: MatchConfig;
    createdByUserId: string | null;
    zoneCentre: LatLng;
    initialRadiusMetres: number;
    eventWindowMinutesMax: number;
    matchDurationMinutes: number;
  }): Promise<MatchRow>;

  /** Update a small, named set of fields — used for state transitions. */
  patch(
    id: string,
    patch: {
      status?: MatchStatus;
      startedAt?: number | null;
      endsAt?: number | null;
      winner?: "hunters" | "shadows" | null;
      endedAt?: number | null;
      rosterLocked?: boolean;
    },
  ): Promise<void>;
}

/** As the rules engine sees it. Derived from MatchRow so the engine never
 *   imports the repo interface. */
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
