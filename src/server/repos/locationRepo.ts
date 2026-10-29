import type { LocationSnapshot } from "../../rules/types";
import type { RepoContext } from "./context";

export type { LocationSnapshot };

/** A stored position record. `recordedAt` is a server millisecond timestamp. */
export interface LocationRow extends LocationSnapshot {
  id: string;
  matchId: string;
  playerId: string;
  /** Spoof check result, shown to invigilators in Stage 4. */
  suspicious: boolean;
  suspiciousReason: string | null;
}

export interface LocationRepository {
  /** Latest stored position for a player in a match, or null. */
  latestByPlayer(
    ctx: RepoContext,
    matchId: string,
    playerId: string,
  ): Promise<LocationRow | null>;
  /** Latest position recorded at or before `atMs` (ping ghosts, delay). */
  latestByPlayerBefore(
    ctx: RepoContext,
    matchId: string,
    playerId: string,
    atMs: number,
  ): Promise<LocationRow | null>;
  /** Latest position for several players, keyed by player id. */
  latestSnapshotByPlayers(
    ctx: RepoContext,
    matchId: string,
    playerIds: string[],
  ): Promise<Map<string, LocationSnapshot>>;
  /** Store a position uploaded by a phone (every few seconds). */
  insert(
    ctx: RepoContext,
    input: {
      matchId: string;
      playerId: string;
      lat: number;
      lng: number;
      accuracyMetres: number | null;
      pingIndex: number;
      recordedAt: number;
      suspicious?: boolean;
      suspiciousReason?: string | null;
    },
  ): Promise<LocationRow>;
  /** Delete a match's position history; scores are kept. */
  deleteForMatch(ctx: RepoContext, matchId: string): Promise<number>;
}
