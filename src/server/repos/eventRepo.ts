import type { RepoContext } from "./context";

/**
 * The live event feed (Stage 5, task 6).
 *
 * Append-only, like the audit log, but written by the game itself: tags,
 * eliminations, zone shrinks, pauses and help alerts. It never carries a
 * position — the single exception is `help`, whose coordinates are only ever
 * returned to an invigilator of the match.
 */
export type MatchEventKind =
  | "tag"
  | "elimination"
  | "removal"
  | "shrink"
  | "pause"
  | "resume"
  | "phase"
  | "help";

export interface MatchEventRow {
  id: string;
  matchId: string;
  at: number;
  kind: MatchEventKind;
  /** Player the event is about: the tagged Shadow, the eliminated player. */
  playerId: string | null;
  /** Who did it. Hidden from the feed until the match has ended. */
  actorId: string | null;
  detail: string | null;
  /** Deduplicates scheduled events (one shrink per minute), like the ledger. */
  refId: string | null;
  /** Only ever shown to invigilators. */
  lat: number | null;
  lng: number | null;
}

export interface MatchEventRepository {
  append(
    ctx: RepoContext,
    input: {
      matchId: string;
      at: number;
      kind: MatchEventKind;
      playerId?: string | null;
      actorId?: string | null;
      detail?: string | null;
      refId?: string | null;
      lat?: number | null;
      lng?: number | null;
    },
  ): Promise<string>;
  /** Oldest first: a feed reads in the order things happened. */
  listByMatch(ctx: RepoContext, matchId: string): Promise<MatchEventRow[]>;
  /** Has this scheduled event already been written? */
  existsByRef(ctx: RepoContext, matchId: string, refId: string): Promise<boolean>;
}
