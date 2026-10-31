import type { RepoContext } from "./context";

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
  insert(
    ctx: RepoContext,
    input: {
      matchId: string;
      playerId: string;
      kind: ScoreKind;
      points: number;
      at: number;
      source: ScoreSource;
      refId: string | null;
    },
  ): Promise<void>;
  listByPlayer(
    ctx: RepoContext,
    matchId: string,
    playerId: string,
  ): Promise<ScoreEventRow[]>;
  /** Every event in a match, used by the minute tick and the console. */
  listByMatch(ctx: RepoContext, matchId: string): Promise<ScoreEventRow[]>;
  /**
   * Has this ledger entry already been written? The scheduler uses it to
   * guarantee a minute of alive points is awarded exactly once.
   */
  existsByRef(
    ctx: RepoContext,
    matchId: string,
    playerId: string,
    kind: ScoreKind,
    refId: string,
  ): Promise<boolean>;
}
