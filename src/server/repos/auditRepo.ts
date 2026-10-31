import type { RepoContext } from "./context";

/**
 * Append-only record of every invigilator and organiser action: who, when and
 * why. Rows are never updated or deleted.
 */
export interface AuditRow {
  id: string;
  matchId: string;
  at: number;
  actorUserId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  reason: string | null;
  detail: string | null;
}

export interface AuditRepository {
  append(
    ctx: RepoContext,
    input: {
      matchId: string;
      at: number;
      actorUserId: string;
      actorName: string;
      action: string;
      targetType: string;
      targetId?: string | null;
      targetLabel?: string | null;
      reason?: string | null;
      detail?: string | null;
    },
  ): Promise<string>;
  /** Newest last. Reading an audit trail must never reorder it. */
  listByMatch(ctx: RepoContext, matchId: string): Promise<AuditRow[]>;
}
