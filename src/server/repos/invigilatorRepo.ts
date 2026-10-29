import type { Id } from "../../lib/id";

export interface InvigilatorRow {
  id: string;
  matchId: string;
  userId: Id<"users">;
  displayName: string;
  active: boolean;
  addedAt: number;
}

export interface InvigilatorRepository {
  findByMatchAndUser(matchId: string, userId: Id<"users">): Promise<InvigilatorRow | null>;
  listByMatch(matchId: string): Promise<InvigilatorRow[]>;
  create(input: {
    matchId: string;
    userId: Id<"users">;
    displayName: string;
  }): Promise<InvigilatorRow>;
  patchActive(id: string, active: boolean): Promise<void>;
}
