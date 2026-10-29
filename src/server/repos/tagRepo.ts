export type TagStatus = "accepted" | "rejected";

export interface TagRow {
  id: string;
  matchId: string;
  hunterId: string;
  shadowId: string;
  status: TagStatus;
  rejectionCode: string | null;
  distanceMetres: number | null;
  assistedById: string | null;
  scoredPoints: number;
  at: number;
}

export interface TagRepository {
  insert(input: {
    matchId: string;
    hunterId: string;
    shadowId: string;
    status: TagStatus;
    rejectionCode: string | null;
    distanceMetres: number | null;
    assistedById: string | null;
    scoredPoints: number;
    at: number;
  }): Promise<string>;
}
