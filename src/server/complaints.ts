/**
 * Filing a complaint.
 *
 * A Hunter taps "Shadow won't show code" and picks the Shadow from the list of
 * active Shadows. The decision itself is the pure `complaintPolicy` rule in
 * `src/rules`; this module resolves the players and writes the row.
 */
import {
  complaintPolicy,
  complaintRejectionMessage,
  statusForClock,
  type MatchStatus,
} from "../rules";
import { getRepos } from "./providers";
import type { ComplaintRow, MatchRow, PlayerRow, RepoContext } from "./repos";

function effectiveStatus(match: MatchRow, nowMs: number): MatchStatus {
  return statusForClock({
    stored: match.status,
    startedAtMs: match.startedAt,
    endsAtMs: match.endsAt,
    nowMs,
    config: match.config,
  });
}

export interface ComplaintTargets {
  isHunter: boolean;
  /** Active Shadows a Hunter may name. No positions, no user ids. */
  targets: { playerId: string; callSign: string; alreadyReported: boolean }[];
  mine: {
    id: string;
    accusedId: string;
    status: ComplaintRow["status"];
    createdAt: number;
    responseDueAt: number;
  }[];
}

/**
 * What the complaint form shows: the Shadows this Hunter may name, and the
 * complaints they have already filed. Moved here from the Convex function so
 * both backends serve the same list.
 */
export async function getComplaintTargets(
  ctx: RepoContext,
  input: { matchId: string; userId: string },
): Promise<ComplaintTargets> {
  const repos = getRepos();
  const [me, players, existing] = await Promise.all([
    repos.players.findByMatchAndUser(ctx, input.matchId, input.userId),
    repos.players.listByMatch(ctx, input.matchId),
    repos.complaints.listByMatch(ctx, input.matchId),
  ]);
  if (!me) throw new Error("You are not in this match.");

  const openByMe = new Set(
    existing
      .filter((row) => row.complainantId === me.id && row.status === "open")
      .map((row) => row.accusedId),
  );

  return {
    isHunter: me.role === "hunter",
    targets: players
      .filter(
        (player) =>
          player.role === "shadow" &&
          player.status === "active" &&
          player.taggedAt === null &&
          player.id !== me.id,
      )
      .map((player) => ({
        playerId: player.id,
        callSign: player.callSign,
        alreadyReported: openByMe.has(player.id),
      })),
    mine: existing
      .filter((row) => row.complainantId === me.id)
      .map((row) => ({
        id: row.id,
        accusedId: row.accusedId,
        status: row.status,
        createdAt: row.createdAt,
        responseDueAt: row.responseDueAt,
      })),
  };
}

export async function fileComplaint(
  ctx: RepoContext,
  input: {
    matchId: string;
    userId: string;
    accusedId: string;
    note?: string | null;
    /** When the incident happened; the phone sends this with the filing. */
    incidentAtMs?: number;
    nowMs?: number;
  },
): Promise<ComplaintRow> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();
  const incidentAt = input.incidentAtMs ?? now;

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");

  const players = await repos.players.listByMatch(ctx, match.id);
  const complainant: PlayerRow | null =
    players.find((player) => player.userId === input.userId) ?? null;
  const target: PlayerRow | null =
    players.find((player) => player.id === input.accusedId) ?? null;

  const existing = await repos.complaints.listByMatch(ctx, match.id);
  const status = effectiveStatus(match, now);

  const verdict = complaintPolicy({
    nowMs: now,
    incidentAtMs: incidentAt,
    matchActive: status === "live",
    matchPaused: match.pausedAt !== null,
    complainant: complainant && {
      id: complainant.id,
      role: complainant.role,
      status: complainant.status,
    },
    target: target && {
      id: target.id,
      role: target.role,
      status: target.status,
    },
    existing: existing.map((row) => ({
      complainantId: row.complainantId,
      accusedId: row.accusedId,
      status: row.status,
      createdAtMs: row.createdAt,
    })),
    config: match.config,
  });

  if (!verdict.ok) {
    throw new Error(complaintRejectionMessage(verdict.code));
  }

  return await repos.complaints.create(ctx, {
    matchId: match.id,
    complainantId: complainant!.id,
    accusedId: target!.id,
    note: input.note?.trim() ? input.note.trim() : null,
    configComplaintResponseMinutes: match.config.complaintResponseMinutes,
    nowMs: now,
  });
}
