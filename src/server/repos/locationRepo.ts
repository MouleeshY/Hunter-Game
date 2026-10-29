import type { Location } from "../../rules/types";

/** A stored position record. `recordedAt` is a server millisecond timestamp. */
export interface LocationRow {
  id: string;
  matchId: string;
  playerId: string;
  lat: number;
  lng: number;
  accuracyMetres: number | null;
  recordedAt: number;
  pingIndex: number;
}

export interface LocationRepository {
  /** Latest stored position for a player in a match, or null. */
  latestByPlayer(
    matchId: string,
    playerId: string,
  ): Promise<LocationRow | null>;
  /** Latest stored position for a set of players in a match. Only columns needed
   *   by the rules engine are returned. */
  latestSnapshotByPlayers(
    matchId: string,
    playerIds: string[],
  ): Promise<Map<string, Location>>;
  /** Store a fresh position uploaded by the player's phone. */
  insert(input: {
    matchId: string;
    playerId: string;
    lat: number;
    lng: number;
    accuracyMetres: number | null;
    reportedAtClientMs: number;
  }): Promise<LocationRow>;
  /** Store a ping-side position the server records from the upload path. */
  insertPing(input: {
    matchId: string;
    playerId: string;
    lat: number;
    lng: number;
    pingIndex: number;
    recordedAt: number;
  }): Promise<LocationRow>;
}
