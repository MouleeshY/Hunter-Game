import type { RepoContext } from "./context";

/**
 * An invigilator is named by the organiser at setup, is not a player and has no
 * score. `userId` stays null until someone accepts the invite code.
 */
export interface InvigilatorRow {
  id: string;
  matchId: string;
  userId: string | null;
  displayName: string;
  inviteCode: string;
  active: boolean;
  addedAt: number;
}

export interface InvigilatorRepository {
  findById(ctx: RepoContext, id: string): Promise<InvigilatorRow | null>;
  findByInviteCode(
    ctx: RepoContext,
    inviteCode: string,
  ): Promise<InvigilatorRow | null>;
  findByMatchAndUser(
    ctx: RepoContext,
    matchId: string,
    userId: string,
  ): Promise<InvigilatorRow | null>;
  listByMatch(ctx: RepoContext, matchId: string): Promise<InvigilatorRow[]>;
  create(
    ctx: RepoContext,
    input: {
      matchId: string;
      displayName: string;
      inviteCode: string;
      addedAt: number;
    },
  ): Promise<InvigilatorRow>;
  claim(
    ctx: RepoContext,
    id: string,
    userId: string,
  ): Promise<void>;
  patchActive(
    ctx: RepoContext,
    id: string,
    active: boolean,
  ): Promise<void>;
}
