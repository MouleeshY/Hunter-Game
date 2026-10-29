import type { MatchConfig } from "./config";

/**
 * Scoring is computed only here, on the server. The phone never does this
 * arithmetic — it only renders numbers the server has already produced.
 *
 * Both curves are driven by `zoneProgress` (0 → 1, how far the zone has
 * contracted). See `zoneProgress` in zone.ts.
 */

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Points per minute for a living Shadow at a given zone contraction. */
export function aliveRatePerMinute(
  zoneProgress01: number,
  config: MatchConfig,
): number {
  return lerp(
    config.shadowAlivePointsPerMinute,
    config.shadowAlivePointsPerMinuteCap,
    clamp01(zoneProgress01),
  );
}

/**
 * Points a Shadow banks for staying untagged.
 * Call once per minute with the zone progress at that minute, because the rate
 * moves with the zone.
 */
export function shadowAlivePoints(args: {
  minutes: number;
  zoneProgress01: number;
  config: MatchConfig;
}): number {
  const { minutes, zoneProgress01, config } = args;
  if (minutes <= 0) return 0;
  return minutes * aliveRatePerMinute(zoneProgress01, config);
}

/** Points for a Hunter landing a tag: 100 at kickoff, 40 once fully contracted. */
export function hunterTagPoints(args: {
  zoneProgress01: number;
  config: MatchConfig;
}): number {
  const { zoneProgress01, config } = args;
  const points = lerp(
    config.hunterTagPoints,
    config.hunterTagPointsFloor,
    clamp01(zoneProgress01),
  );
  return Math.max(config.hunterTagPointsFloor, points);
}

/** Awarded to each scoring Hunter once every Shadow is tagged. */
export function allTaggedBonus(config: MatchConfig): number {
  return config.allTaggedBonusPerHunter;
}

/** Awarded to each Shadow that is still untagged when the timer expires. */
export function survivalBonus(config: MatchConfig): number {
  return config.survivalBonusPerShadow;
}

/**
 * Points removed for time spent outside the zone past the grace period.
 * The caller passes how many new ticks to charge, so a player is only ever
 * charged once per tick.
 */
export function applyZoneDrain(args: {
  points: number;
  ticks: number;
  config: MatchConfig;
}): number {
  const { points, ticks, config } = args;
  if (ticks <= 0) return points;
  return points - ticks * config.drainPointsPerTick;
}

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

export interface LeaderboardInput {
  playerId: string;
  displayName: string;
  totalPoints: number;
}

export interface LeaderboardRow extends LeaderboardInput {
  rank: number;
}

/**
 * Competition ranking for the per-match public leaderboard: equal totals share
 * a rank, and the next rank counts the rows it actually follows.
 */
export function rankLeaderboard(entries: LeaderboardInput[]): LeaderboardRow[] {
  const sorted = [...entries].sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      a.displayName.localeCompare(b.displayName) ||
      a.playerId.localeCompare(b.playerId),
  );
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((entry, index) => {
    if (previous === null || entry.totalPoints !== previous) {
      rank = index + 1;
      previous = entry.totalPoints;
    }
    return { ...entry, rank };
  });
}
