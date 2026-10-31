import type {
  DisplayNameMode,
  PlayerMode,
  PlayerSnapshot,
  PlayerStatus,
  Role,
} from "../../rules/types";
import type { RepoContext } from "./context";

export interface PlayerRow {
  id: string;
  matchId: string;
  userId: string;
  role: Role;
  mode: PlayerMode;
  status: PlayerStatus;
  /** What other players see in the lobby. */
  callSign: string;
  /** Leaderboard name: nickname or real name, chosen by the player. */
  displayName: string;
  displayNameMode: DisplayNameMode;
  /** One plain QR token per match; the tag scan posts this token. */
  qrToken: string;
  points: number;
  joinedAt: number;
  taggedAt: number | null;
  taggedById: string | null;
  /** Set once the tagged player has picked Spectator / Hunters / Helper. */
  captureChosenAt: number | null;
  /** Set when the player tapped "I understand" on the rules briefing. */
  briefedAt: number | null;
  outsideSince: number | null;
  outsideSecondsTotal: number;
  chargedDrainTicks: number;
  warnedAt: number | null;
}

export interface PlayerRepository {
  findById(ctx: RepoContext, id: string): Promise<PlayerRow | null>;
  findByMatchAndUser(
    ctx: RepoContext,
    matchId: string,
    userId: string,
  ): Promise<PlayerRow | null>;
  findByMatchAndToken(
    ctx: RepoContext,
    matchId: string,
    qrToken: string,
  ): Promise<PlayerRow | null>;
  listByMatch(ctx: RepoContext, matchId: string): Promise<PlayerRow[]>;
  create(
    ctx: RepoContext,
    input: {
      matchId: string;
      userId: string;
      role: Role;
      mode: PlayerMode;
      status: PlayerStatus;
      callSign: string;
      displayName: string;
      displayNameMode: DisplayNameMode;
      qrToken: string;
      joinedAt: number;
    },
  ): Promise<PlayerRow>;
  patch(
    ctx: RepoContext,
    id: string,
    patch: {
      role?: Role;
      mode?: PlayerMode;
      status?: PlayerStatus;
      points?: number;
      taggedAt?: number | null;
      taggedById?: string | null;
      captureChosenAt?: number | null;
      briefedAt?: number | null;
    },
  ): Promise<void>;
  /** Out-of-zone state written by the position-upload path. */
  patchOutZoneState(
    ctx: RepoContext,
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

export function playerSnapshotOf(row: PlayerRow): PlayerSnapshot {
  return {
    id: row.id,
    role: row.role,
    mode: row.mode,
    status: row.status,
    taggedAtMs: row.taggedAt,
  };
}
