export type ScoreKind =
  | "shadow_alive"
  | "tag"
  | "all_tagged_bonus"
  | "survival_bonus"
  | "zone_drain";

export type ScoreSource = "system" | "invigilator";

export interface ScoreEventRow {
  id: string;
  matchId: string;
  playerId: string;
  kind: ScoreKind;
  points: number;
  at: number;
  source: ScoreSource;
  refId: string | null;
}

export interface ScoreRepository {
  insert(input: {
    matchId: string;
    playerId: string;
    kind: ScoreKind;
    points: number;
    at: number;
    source: ScoreSource;
    refId: string | null;
  }): Promise<void>;
  /** Return every score event for a player in a match, newest first. */
  listByPlayer(matchId: string, playerId: string): Promise<ScoreEventRow[]>;
}
