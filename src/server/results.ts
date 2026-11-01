/**
 * Public match results and stats (Stage 6).
 *
 * Two audiences, two shapes, one source of truth:
 *
 *   - `getPublicResult` / `listPublicResults` — what anyone with the link may
 *     read. Built by `publicView`, which is the only place a public response is
 *     assembled and which deliberately copies a fixed set of fields onto a new
 *     object. No positions, qr tokens, user ids, emails, complaints, audit rows,
 *     spoof flags, invigilator names, room codes or invite codes can leave
 *     through it, because nothing else is ever attached.
 *   - `getPlayerResult` — the Match End screen: a player's own breakdown, rank,
 *     time survived and the who-caught-whom list, open only to that match's
 *     players, invigilators and organiser.
 *
 * A result is public only once the match has ENDED (see `isResultPublic`), and
 * an aborted match needs the organiser to publish it by hand.
 */
import {
  canChangePublication,
  isResultPublic,
  matchStats,
  overrideOf,
  rankLeaderboard,
  survivedMinutes,
  type MatchStats,
  type PublishOverride,
  type Role,
} from "../rules";
import { activeShadows } from "./matchEnd";
import { getRepos } from "./providers";
import type { LeaderboardBreakdown } from "./repos";
import type { MatchRow, PlayerRow, RepoContext } from "./repos";

const DEFAULT_TITLE = "Shadow Hunt match";

/** How a player finished, in the words the public table uses. */
export type FinalStatus = "survived" | "tagged" | "eliminated" | "removed";

export interface PublicResultRow {
  rank: number;
  displayName: string;
  role: Role;
  points: number;
  /** Tags landed — Hunters only. */
  tags: number | null;
  /** Whole minutes in the match — Shadows only. */
  minutesSurvived: number | null;
  status: FinalStatus;
}

export interface PublicResultSummary {
  slug: string;
  title: string;
  clubName: string | null;
  endedAt: number;
  winner: "hunters" | "shadows" | null;
  aborted: boolean;
  totalPlayers: number;
}

export interface PublicResult extends PublicResultSummary {
  stats: MatchStats;
  rows: PublicResultRow[];
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function overrideFor(match: MatchRow): PublishOverride {
  return overrideOf(match.published);
}

export function isMatchResultPublic(match: MatchRow): boolean {
  return isResultPublic({
    status: match.status,
    endReason: match.endReason,
    override: overrideFor(match),
  });
}

function titleOf(match: MatchRow): string {
  const title = match.title?.trim();
  return title && title.length > 0 ? title : DEFAULT_TITLE;
}

function finalStatusOf(player: PlayerRow): FinalStatus {
  if (player.status === "removed") return "removed";
  if (player.status === "eliminated") return "eliminated";
  // Someone caught earlier stays "tagged" even if they joined the Hunters or
  // became a Helper afterwards: `role` is the team they were assigned.
  if (player.taggedAt !== null) return "tagged";
  return "survived";
}

function acceptedTagCounts(tags: { hunterId: string; status: string }[]) {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    if (tag.status !== "accepted") continue;
    counts.set(tag.hunterId, (counts.get(tag.hunterId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The ranked table. `rankLeaderboard` gives competition ranking, so equal
 * totals share a rank and the next row counts the rows it follows.
 *
 * The display name is the one stored on the player row at join — the nickname
 * or the real name they typed for this match, never an account email or id.
 */
function rankedRows(
  match: MatchRow,
  players: PlayerRow[],
  tags: { hunterId: string; status: string }[],
  nowMs: number,
): PublicResultRow[] {
  const tagCounts = acceptedTagCounts(tags);
  const byId = new Map(players.map((player) => [player.id, player]));
  const ranked = rankLeaderboard(
    players.map((player) => ({
      playerId: player.id,
      displayName: player.displayName,
      totalPoints: player.points,
    })),
  );

  return ranked.map((entry) => {
    const player = byId.get(entry.playerId)!;
    const shadow = player.role === "shadow";
    return {
      rank: entry.rank,
      displayName: entry.displayName,
      role: player.role,
      points: entry.totalPoints,
      tags: shadow ? null : (tagCounts.get(player.id) ?? 0),
      minutesSurvived: shadow
        ? survivedMinutes({
            startedAtMs: match.startedAt,
            untilMs: player.taggedAt ?? match.endedAt ?? nowMs,
            pausedTotalMs: match.pausedTotalMs,
            headStartMinutes: match.config.headStartMinutes,
          })
        : null,
      status: finalStatusOf(player),
    };
  });
}

/**
 * The private projection: a new object with only the fields Stage 6 allows.
 * Everything a caller might have loaded stays here.
 */
function publicView(args: {
  match: MatchRow;
  players: PlayerRow[];
  tags: { hunterId: string; status: string }[];
  proximityAlerts: number;
  nowMs: number;
}): PublicResult {
  const { match, players, tags, proximityAlerts, nowMs } = args;
  const stats = matchStats({
    startedAtMs: match.startedAt,
    endedAtMs: match.endedAt,
    nowMs,
    pausedTotalMs: match.pausedTotalMs,
    config: match.config,
    totalPlayers: players.length,
    shadowsTagged: players.filter(
      (player) => player.role === "shadow" && player.taggedAt !== null,
    ).length,
    shadowsSurvived: activeShadows(players).length,
    proximityAlerts,
  });

  return {
    slug: match.publicSlug ?? "",
    title: titleOf(match),
    clubName: match.clubName,
    endedAt: match.endedAt ?? nowMs,
    winner: match.winner,
    aborted: match.endReason === "aborted",
    totalPlayers: players.length,
    stats,
    rows: rankedRows(match, players, tags, nowMs),
  };
}

/* ------------------------------------------------------------------ *
 * Public reads
 * ------------------------------------------------------------------ */

/** The public result for a slug, or null when it is not public (yet). */
export async function getPublicResult(
  ctx: RepoContext,
  input: { slug: string; nowMs?: number },
): Promise<PublicResult | null> {
  const repos = getRepos();
  const slug = input.slug.trim().toLowerCase();
  if (slug.length === 0) return null;

  const match = await repos.matches.findByPublicSlug(ctx, slug);
  if (!match) return null;
  if (!isMatchResultPublic(match)) return null;

  const [players, tags, events] = await Promise.all([
    repos.players.listByMatch(ctx, match.id),
    repos.tags.listByMatch(ctx, match.id),
    repos.events.listByMatch(ctx, match.id),
  ]);

  return publicView({
    match,
    players,
    tags,
    proximityAlerts: events.filter((event) => event.kind === "detection").length,
    nowMs: input.nowMs ?? Date.now(),
  });
}

/**
 * The public list: published results only, newest first. An optional club name
 * narrows it to one club, which is what the result page's "all results" link
 * uses.
 */
export async function listPublicResults(
  ctx: RepoContext,
  input: { club?: string | null; nowMs?: number } = {},
): Promise<PublicResultSummary[]> {
  const repos = getRepos();
  const ended = await repos.matches.listEnded(ctx);
  const published = ended.filter(isMatchResultPublic);

  const wanted = input.club?.trim().toLowerCase() ?? "";
  const club = wanted
    ? published.filter(
        (match) => (match.clubName ?? "").trim().toLowerCase() === wanted,
      )
    : published;

  const summaries = await Promise.all(
    club.map(async (match) => {
      const players = await repos.players.listByMatch(ctx, match.id);
      const summary: PublicResultSummary = {
        slug: match.publicSlug ?? "",
        title: titleOf(match),
        clubName: match.clubName,
        endedAt: match.endedAt ?? 0,
        winner: match.winner,
        aborted: match.endReason === "aborted",
        totalPlayers: players.length,
      };
      return summary;
    }),
  );

  return summaries
    .filter((summary) => summary.slug !== "")
    .sort((a, b) => b.endedAt - a.endedAt);
}

/* ------------------------------------------------------------------ *
 * Organiser tools
 * ------------------------------------------------------------------ */

export interface ResultTools {
  matchId: string;
  slug: string;
  /** What the organiser chose, or null while the default applies. */
  override: PublishOverride;
  public: boolean;
  /** True when the organiser has not overridden the default. */
  automatic: boolean;
  canPublish: boolean;
}

function toolsFor(match: MatchRow): ResultTools {
  return {
    matchId: match.id,
    slug: match.publicSlug ?? "",
    override: overrideFor(match),
    public: isMatchResultPublic(match),
    automatic: match.published === null,
    canPublish: canChangePublication(match.status),
  };
}

/** Organiser-only tools, addressed by match id (the lobby after the whistle). */
export async function getResultTools(
  ctx: RepoContext,
  input: { matchId: string; userId: string },
): Promise<ResultTools | null> {
  const match = await getRepos().matches.findById(ctx, input.matchId);
  if (!match || match.createdByUserId !== input.userId) return null;
  return toolsFor(match);
}

/** Organiser-only tools, addressed by slug (the public page itself). */
export async function getResultToolsBySlug(
  ctx: RepoContext,
  input: { slug: string; userId: string | null },
): Promise<ResultTools | null> {
  if (input.userId === null) return null;
  const match = await getRepos().matches.findByPublicSlug(
    ctx,
    input.slug.trim().toLowerCase(),
  );
  if (!match || match.createdByUserId !== input.userId) return null;
  return toolsFor(match);
}

/**
 * Publish or hide a result. Only once the match has ended: a live table would
 * show the other players who is already out.
 */
export async function setResultPublished(
  ctx: RepoContext,
  input: {
    matchId: string;
    userId: string;
    publish: boolean;
    nowMs?: number;
  },
): Promise<{ published: boolean }> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");
  if (match.createdByUserId !== input.userId) {
    throw new Error("Only the organiser can publish this result.");
  }
  if (!canChangePublication(match.status)) {
    throw new Error("A result can only be published once the match has ended.");
  }

  await repos.matches.patch(ctx, match.id, { published: input.publish });
  await repos.audit.append(ctx, {
    matchId: match.id,
    at: now,
    actorUserId: input.userId,
    actorName: "Organiser",
    action: input.publish ? "result_published" : "result_unpublished",
    targetType: "match",
    targetId: match.id,
    targetLabel: match.publicSlug ?? match.roomCode,
    reason: input.publish
      ? "The organiser made this result public."
      : "The organiser hid this result.",
    detail: null,
  });

  return { published: input.publish };
}

/* ------------------------------------------------------------------ *
 * The player's own Match End screen
 * ------------------------------------------------------------------ */

export interface CatchLine {
  at: number;
  hunterName: string;
  shadowName: string;
  forced: boolean;
}

export interface PlayerResult {
  matchId: string;
  title: string;
  ended: boolean;
  aborted: boolean;
  winner: "hunters" | "shadows" | null;
  totalPlayers: number;
  role: Role | null;
  /** Points and the ledger breakdown behind them. */
  points: number;
  breakdown: LeaderboardBreakdown;
  rank: number | null;
  minutesSurvived: number | null;
  status: FinalStatus | null;
  /** Who caught whom — players, invigilators and the organiser only. */
  catches: CatchLine[];
  /** The public link, once the result is public. */
  publicSlug: string | null;
}

const EMPTY_BREAKDOWN: LeaderboardBreakdown = {
  alive: 0,
  tags: 0,
  bonuses: 0,
  drains: 0,
};

/**
 * The Match End screen. Open to the players of this match, its invigilators and
 * its organiser; the who-caught-whom list never leaves this function.
 */
export async function getPlayerResult(
  ctx: RepoContext,
  input: { matchId: string; userId: string; nowMs?: number },
): Promise<PlayerResult> {
  const repos = getRepos();
  const now = input.nowMs ?? Date.now();

  const match = await repos.matches.findById(ctx, input.matchId);
  if (!match) throw new Error("Match not found.");

  const [players, invigilator, tags, leaderboard] = await Promise.all([
    repos.players.listByMatch(ctx, match.id),
    repos.invigilators.findByMatchAndUser(ctx, match.id, input.userId),
    repos.tags.listByMatch(ctx, match.id),
    repos.leaderboard.listByMatch(ctx, match.id),
  ]);

  const me = players.find((player) => player.userId === input.userId) ?? null;
  const isOrganiser = match.createdByUserId === input.userId;
  if (!me && invigilator === null && !isOrganiser) {
    throw new Error("You are not in this match.");
  }

  const ranked = rankLeaderboard(
    players.map((player) => ({
      playerId: player.id,
      displayName: player.displayName,
      totalPoints: player.points,
    })),
  );
  const rank = me
    ? (ranked.find((entry) => entry.playerId === me.id)?.rank ?? null)
    : null;
  const breakdown =
    (me && leaderboard.find((row) => row.playerId === me.id)?.breakdown) ||
    EMPTY_BREAKDOWN;

  const byId = new Map(players.map((player) => [player.id, player]));
  const catches: CatchLine[] = tags
    .filter((tag) => tag.status === "accepted")
    .sort((a, b) => a.at - b.at)
    .map((tag) => ({
      at: tag.at,
      hunterName: byId.get(tag.hunterId)?.displayName ?? "A Hunter",
      shadowName: byId.get(tag.shadowId)?.displayName ?? "A Shadow",
      forced: tag.forced,
    }));

  return {
    matchId: match.id,
    title: titleOf(match),
    ended: match.status === "ended",
    aborted: match.endReason === "aborted",
    winner: match.winner,
    totalPlayers: players.length,
    role: me?.role ?? null,
    points: me?.points ?? 0,
    breakdown,
    rank,
    minutesSurvived:
      me && me.role === "shadow"
        ? survivedMinutes({
            startedAtMs: match.startedAt,
            untilMs: me.taggedAt ?? match.endedAt ?? now,
            pausedTotalMs: match.pausedTotalMs,
            headStartMinutes: match.config.headStartMinutes,
          })
        : null,
    status: me ? finalStatusOf(me) : null,
    catches,
    publicSlug: isMatchResultPublic(match) ? match.publicSlug : null,
  };
}

