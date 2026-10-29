import type { Role, PlayerMode, PlayerStatus, PlayerSnapshot } from "../../rules/types";

export interface PlayerRow {
  id: string;
  matchId: string;
  userId: string;
  role: Role;
  mode: PlayerMode;
  status: PlayerStatus;
  displayName: string;
  displayNameMode: "nickname" | "real";
  /** One plain QR token per match; the tag scan posts this token. */
  qrToken: string;
  points: number;
  joinedAt: number;
  taggedAt: number | null;
  taggedById: string | null;
  /** Out-of-zone state kept up to date by the position-upload path. */
  outsideSince: number | null;
  outsideSecondsTotal: number;
  chargedDrainTicks: number;
  warnedAt: number | null;
}

export interface PlayerRepository {
  findByMatchAndUser(matchId: string, userId: string): Promise<PlayerRow | null>;
  findByMatchAndToken(matchId: string, qrToken: string): Promise<PlayerRow | null>;
  listByMatch(matchId: string): Promise<PlayerRow[]>;
  /** Players still in play: active + converted Hunters (tagged with hunter mode). */
  listActiveByMatch(matchId: string): Promise<PlayerRow[]>;
  create(input: {
    matchId: string;
    userId: string;
    role: Role;
    mode: PlayerMode;
    status: PlayerStatus;
    displayName: string;
    displayNameMode: "nickname" | "real";
    qrToken: string;
    joinedAt: number;
  }): Promise<PlayerRow>;
  patch(id: string, patch: Partial<PlayerRow>): Promise<void>;
  patchOutZoneState(
    id: string,
    state: {
      outsideSince?: number | null;
      outsideSecondsTotal?: number;
      chargedDrainTicks?: number;
      warnedAt?: number | null;
      status?: PlayerStatus;
    },
  ): Promise<void>;
}

export function snapshotOf(row: PlayerRow): PlayerSnapshot {
  return {
    id: row.id,
    role: row.role,
    mode: row.mode,
    status: row.status,
    taggedAtMs: row.taggedAt,
  };
}
