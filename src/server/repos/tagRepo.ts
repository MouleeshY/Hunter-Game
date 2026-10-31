import type { PlayerMode } from "../../rules/types";
import type { RepoContext } from "./context";

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
  /** The mode on offer when the Shadow was captured — their default choice. */
  captureMode: PlayerMode | null;
  /** True when an invigilator forced the tag instead of a real scan. */
  forced: boolean;
  forcedByUserId: string | null;
  scoredPoints: number;
  at: number;
}

export interface TagRepository {
  insert(
    ctx: RepoContext,
    input: {
      matchId: string;
      hunterId: string;
      shadowId: string;
      status: TagStatus;
      rejectionCode?: string | null;
      distanceMetres?: number | null;
      assistedById?: string | null;
      captureMode?: PlayerMode | null;
      forced?: boolean;
      forcedByUserId?: string | null;
      scoredPoints: number;
      at: number;
    },
  ): Promise<string>;
  /** Record the mode the captured Shadow finally chose. */
  patch(
    ctx: RepoContext,
    id: string,
    patch: { captureMode?: PlayerMode },
  ): Promise<void>;
  listByMatch(ctx: RepoContext, matchId: string): Promise<TagRow[]>;
}
