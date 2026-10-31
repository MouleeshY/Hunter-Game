/**
 * EVERY rule number in Shadow Hunt lives in this file.
 *
 * A match takes a snapshot of this object when it is created (see
 * `matches.config` in the schema), so retuning the rules later never changes a
 * match that has already been played.
 *
 * This module is pure TypeScript: no Convex, React or database imports. The
 * Convex validator for the same shape lives in `src/convex/validators.ts`.
 *
 * Provenance of each value:
 *   [RULE]  stated in the game rules — do not change without asking.
 *   [TUNED] not stated in the rules; provisional default picked so the engine
 *           can run at all. Ask before treating these as final.
 */
import type { PlayerMode } from "./types";

export interface MatchConfig {
  /** [RULE] One match runs inside a 2–3 hour event window. */
  eventWindowMinutes: { min: number; max: number };
  /** [TUNED] What the match timer counts down to. Organiser picks 60–180. */
  matchDurationMinutes: number;
  /** [RULE] The organiser may pick a match length inside this range. */
  matchDurationRangeMinutes: { min: number; max: number };

  /** [RULE] Shadows get a 5 minute head start; pings start after it. */
  headStartMinutes: number;
  /** [RULE] Location pings update every 3 minutes. */
  pingIntervalMinutes: number;

  /**
   * [RULE] Phones upload their position every few seconds; the 3-minute ping
   * only controls what Hunters are shown. These are separate.
   * [TUNED] 7 seconds sits inside the 5–10 s band.
   */
  uploadIntervalSeconds: number;

  /** [TUNED] Readings with accuracy worse than this are ignored on the phone. */
  maxGpsAccuracyMetres: number;
  /** [TUNED] Server spoof check: an accuracy this bad is impossible. */
  impossibleAccuracyMetres: number;
  /** [TUNED] Server spoof check: walking/running cannot beat this speed. */
  maxSpeedMetresPerSecond: number;
  /** [TUNED] How long a Hunter keeps seeing a ping ghost before it fades. */
  pingGhostFadeSeconds: number;
  /** [RULE] Spectators see everyone 60 seconds behind. */
  spectatorDelaySeconds: number;
  /** [TUNED] Position history is deleted this long after a match ends. */
  positionRetentionHours: number;

  /** [RULE] The play area shrinks every 10 minutes. */
  zoneShrinkIntervalMinutes: number;
  /** [TUNED] Fraction of the radius kept after each shrink step. */
  zoneShrinkFactor: number;
  /**
   * [TUNED] Area per remaining player above which the zone shrinks one extra
   * step. Kept above the area a full roster gets from the radius table, so the
   * rule tightens the zone once players have been knocked out.
   */
  extraShrinkAreaPerPlayerMetres2: number;
  /** [TUNED] Hard bound on how many extra shrink steps can be applied at once. */
  maxExtraShrinks: number;
  /**
   * [RULE] Radius is calculated from the player count. Tiers are open-ended
   * upwards; lookup takes the last tier whose minPlayers is <= the count.
   * [TUNED] The tier values themselves are provisional.
   */
  radiusTable: { minPlayers: number; radiusMetres: number }[];
  /** [TUNED] The zone never collapses below this radius. */
  minZoneRadiusMetres: number;

  /** [TUNED] GPS tolerance buffer added to the zone before a player is outside. */
  gpsToleranceMetres: number;
  /** [RULE] ~60 seconds of grace after leaving the zone. */
  graceSeconds: number;
  /** [RULE] Points drain every 10 seconds while outside past the grace period. */
  drainIntervalSeconds: number;
  /** [TUNED] Points removed per drain tick. */
  drainPointsPerTick: number;
  /** [RULE] ~3 minutes outside in total, then the player becomes a spectator. */
  eliminationSecondsOutside: number;

  /** [RULE] A tag is only accepted if both positions are within ~40 m. */
  tagProximityMetres: number;
  /** [RULE] A scan is rejected if either position is older than 30 seconds. */
  tagFreshnessSeconds: number;
  /**
   * [TUNED] How long after the incident a Hunter may still file a complaint.
   * The rules only say a complaint exists; 5 minutes keeps the report close to
   * what actually happened. Ask before treating it as final.
   */
  complaintFilingWindowMinutes: number;
  /** [TUNED] How long an invigilator has to respond to a complaint. */
  complaintResponseMinutes: number;
  /**
   * [TUNED] A Hunter may file at most this many complaints inside
   * `complaintRateWindowMinutes`. Stacks on top of the one-open-per-pair rule.
   */
  complaintRateLimit: number;
  complaintRateWindowMinutes: number;
  /** [RULE] 2–3 invigilators per match. */
  invigilatorCount: { min: number; max: number };

  /** [TUNED] How often the server awards one minute of Shadow alive points. */
  aliveTickMinutes: number;

  // ---- Roster --------------------------------------------------------------

  /** [RULE] Minimum players. */
  minPlayers: number;
  /** [TUNED] Soft cap; the organiser can start any time after the minimum. */
  softCapPlayers: number;
  /** [RULE] About 1 Hunter per 3 players, always at least 1 of each. */
  hunterSplit: { hunterCount: number; shadowCount: number };
  /** Length of the join code. [RULE] five characters. */
  roomCodeLength: number;
  /** Length of a per-invigilator invite code. */
  inviteCodeLength: number;
  /** [TUNED] How far from the organiser the random centre may fall. */
  centrePickDistanceMetres: number;
  /** [RULE] What an eliminated Shadow turns into. Rules say "becomes a spectator". */
  eliminatedTurnsInto: PlayerMode;
  /** [RULE] What a removed Shadow gets. Rules say "no survival bonus". */
  removedSurvives: boolean;

  // ---- Scoring -------------------------------------------------------------

  /** [RULE] Shadow alive: 10 points/min. */
  shadowAlivePointsPerMinute: number;
  /** [RULE] …rising linearly to a cap of 25/min as the zone shrinks. */
  shadowAlivePointsPerMinuteCap: number;
  /** [RULE] Hunter tag: 100 points. */
  hunterTagPoints: number;
  /** [RULE] …falling linearly to a floor of 40 as the zone shrinks. */
  hunterTagPointsFloor: number;
  /** [RULE] No Shadow left active: 150 bonus per original Hunter. */
  allTaggedBonusPerHunter: number;
  /** [RULE] Shadow survives to the end: 100 bonus per surviving Shadow. */
  survivalBonusPerShadow: number;
}

export const RULES_CONFIG: MatchConfig = {
  eventWindowMinutes: { min: 120, max: 180 },
  matchDurationMinutes: 120,
  matchDurationRangeMinutes: { min: 60, max: 180 },

  headStartMinutes: 5,
  pingIntervalMinutes: 3,
  uploadIntervalSeconds: 7,
  maxGpsAccuracyMetres: 30,
  impossibleAccuracyMetres: 500,
  maxSpeedMetresPerSecond: 15,
  pingGhostFadeSeconds: 45,
  spectatorDelaySeconds: 60,
  positionRetentionHours: 24,

  zoneShrinkIntervalMinutes: 10,
  zoneShrinkFactor: 0.85,
  extraShrinkAreaPerPlayerMetres2: 130_000,
  maxExtraShrinks: 2,
  radiusTable: [
    { minPlayers: 1, radiusMetres: 300 },
    { minPlayers: 6, radiusMetres: 450 },
    { minPlayers: 11, radiusMetres: 600 },
    { minPlayers: 17, radiusMetres: 800 },
    { minPlayers: 25, radiusMetres: 1000 },
  ],
  minZoneRadiusMetres: 100,

  gpsToleranceMetres: 15,
  graceSeconds: 60,
  drainIntervalSeconds: 10,
  drainPointsPerTick: 5,
  eliminationSecondsOutside: 180,

  tagProximityMetres: 40,
  tagFreshnessSeconds: 30,
  complaintFilingWindowMinutes: 5,
  complaintResponseMinutes: 10,
  complaintRateLimit: 3,
  complaintRateWindowMinutes: 15,
  invigilatorCount: { min: 2, max: 3 },
  aliveTickMinutes: 1,

  minPlayers: 4,
  softCapPlayers: 40,
  hunterSplit: { hunterCount: 1, shadowCount: 3 },
  roomCodeLength: 5,
  inviteCodeLength: 6,
  centrePickDistanceMetres: 500,
  eliminatedTurnsInto: "spectator",
  removedSurvives: false,

  shadowAlivePointsPerMinute: 10,
  shadowAlivePointsPerMinuteCap: 25,
  hunterTagPoints: 100,
  hunterTagPointsFloor: 40,
  allTaggedBonusPerHunter: 150,
  survivalBonusPerShadow: 100,
};
