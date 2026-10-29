import type { Id } from "../../convex/_generated/dataModel";

export interface InvigilatorRow {
  id: string;
  matchId: string;
  userId: string;
  displayName: string;
  active: boolean;
  addedAt: number;
}

export interface InvigilatorRepository {
  findByMatchAndUser(
    matchId: string,
    userId: string,
  ): Promise<InvigilatorRow | null>;
  listByMatch(matchId: string): Promise<InvigilatorRow[]>;
  create(input: {
    matchId: string;
    userId: string;
    displayName: string;
  }): Promise<InvigilatorRow>;
  patchActive(id: string, active: boolean): Promise<void>;
}
