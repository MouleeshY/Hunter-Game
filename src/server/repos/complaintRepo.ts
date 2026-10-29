export type ComplaintStatus = "open" | "upheld" | "dismissed";

export interface ComplaintRow {
  id: string;
  matchId: string;
  complainantId: string;
  accusedId: string;
  note: string | null;
  createdAt: number;
  responseDueAt: number;
  status: ComplaintStatus;
  resolvedByUserId: string | null;
  resolvedAt: number | null;
  resolutionNote: string | null;
}

export interface ComplaintRepository {
  create(input: {
    matchId: string;
    complainantId: string;
    accusedId: string;
    note: string | null;
    configComplaintResponseMinutes: number;
  }): Promise<ComplaintRow>;
  listOpenByMatch(matchId: string): Promise<ComplaintRow[]>;
  patch(
    id: string,
    patch: {
      status?: ComplaintStatus;
      resolvedByUserId?: string;
      resolvedAt?: number;
      resolutionNote?: string;
    },
  ): Promise<void>;
}
