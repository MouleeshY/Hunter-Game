import { v } from "convex/values";

/**
 * EVERY rule number in Shadow Hunt lives in this file.
 *
 * A match takes a snapshot of this object when it is created (see
 * `matches.config` in the schema), so retuning the rules later never changes a
 * match that has already been played.
 *
 * Provenance of each value:
 *   [RULE]  stated in the game rules — do not change without asking.
 *   [TUNED] not stated in the rules; provisional default picked so the engine
 *           can run at all. Ask before treating these as final.
 */
export interface MatchConfig {
  /** [RULE] One match runs inside a 2–3 hour event window. */
  eventWindowMinutes: { min: number; max: number };
  /** [TUNED] What the match timer counts down to. Rules say only "the match timer". */
  matchDurationMinutes: number;

  /** [RULE] Shadows get a 5 minute head start; pings start after it. */
  headStartMinutes: number;
  /** [RULE] Location pings update every 3 minutes. */
  pingIntervalMinutes: number;

  /** [RULE] The play area shrinks every 10 minutes. */
  zoneShrinkIntervalMinutes: number;
  /** [TUNED] Fraction of the radius kept after each shrink step. */
  zoneShrinkFactor: number;
  /**
   * [TUNED] Area per remaining player above which the zone shrinks one extra
   * step. Kept above the area a full roster gets from the radius table, so the
   * rule tightens the zone once players have been knocked out — as the rules
   * describe — instead of discounting the table from kickoff.
   */
  extraShrinkAreaPerPlayerMetres2: number;
  /** [TUNED] Hard bound on how many extra shrink steps can be applied at once. */
  maxExtraShrinks: number;
  /**
   * [RULE] Radius is calculated from the player count. The rules fix no min or
   * max, so the table itself is the config: tiers are open-ended upwards, and
   * lookup takes the last tier whose minPlayers is <= the count.
   * [TUNED] The tier values themselves are provisional.
   */
  radiusTable: { minPlayers: number; radiusMetres: number }[];

  /** [TUNED] GPS tolerance buffer added to the zone before a player counts as outside. */
  gpsToleranceMetres: number;
  /** [RULE] ~60 seconds of grace after leaving the zone. */
  graceSeconds: number;
  /** [RULE] Points drain every 10 seconds while outside past the grace period. */
  drainIntervalSeconds: number;
  /** [TUNED] How many points a single drain tick removes. Rules say "a points drain" without a value. */
  drainPointsPerTick: number;
  /** [RULE] ~3 minutes outside in total, then the player becomes a spectator. */
  eliminationSecondsOutside: number;

  /** [RULE] A tag is only accepted if both last known positions are within ~40 m. */
  tagProximityMetres: number;
  /** [TUNED] How long an invigilator has to respond to a complaint. */
  complaintResponseMinutes: number;
  /** [RULE] 2–3 invigilators per match. */
  invigilatorCount: { min: number; max: number };

  /** [RULE] Shadow alive: 10 points/min. */
  shadowAlivePointsPerMinute: number;
  /** [RULE] …rising linearly to a cap of 25/min as the zone shrinks. */
  shadowAlivePointsPerMinuteCap: number;
  /** [RULE] Hunter tag: 100 points. */
  hunterTagPoints: number;
  /** [RULE] …falling linearly to a floor of 40 as the zone shrinks. */
  hunterTagPointsFloor: number;
  /** [RULE] All Shadows tagged: 150 bonus per Hunter. */
  allTaggedBonusPerHunter: number;
  /** [RULE] Shadow survives to the end: 100 bonus per surviving Shadow. */
  survivalBonusPerShadow: number;
}

export const RULES_CONFIG: MatchConfig = {
  eventWindowMinutes: { min: 120, max: 180 },
  matchDurationMinutes: 120,

  headStartMinutes: 5,
  pingIntervalMinutes: 3,

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

  gpsToleranceMetres: 15,
  graceSeconds: 60,
  drainIntervalSeconds: 10,
  drainPointsPerTick: 5,
  eliminationSecondsOutside: 180,

  tagProximityMetres: 40,
  complaintResponseMinutes: 10,
  invigilatorCount: { min: 2, max: 3 },

  shadowAlivePointsPerMinute: 10,
  shadowAlivePointsPerMinuteCap: 25,
  hunterTagPoints: 100,
  hunterTagPointsFloor: 40,
  allTaggedBonusPerHunter: 150,
  survivalBonusPerShadow: 100,
};

/** Shape of the config object stored on every match. Keep in step with MatchConfig. */
export const matchConfigValidator = v.object({
  eventWindowMinutes: v.object({ min: v.number(), max: v.number() }),
  matchDurationMinutes: v.number(),

  headStartMinutes: v.number(),
  pingIntervalMinutes: v.number(),

  zoneShrinkIntervalMinutes: v.number(),
  zoneShrinkFactor: v.number(),
  extraShrinkAreaPerPlayerMetres2: v.number(),
  maxExtraShrinks: v.number(),
  radiusTable: v.array(
    v.object({ minPlayers: v.number(), radiusMetres: v.number() }),
  ),

  gpsToleranceMetres: v.number(),
  graceSeconds: v.number(),
  drainIntervalSeconds: v.number(),
  drainPointsPerTick: v.number(),
  eliminationSecondsOutside: v.number(),

  tagProximityMetres: v.number(),
  complaintResponseMinutes: v.number(),
  invigilatorCount: v.object({ min: v.number(), max: v.number() }),

  shadowAlivePointsPerMinute: v.number(),
  shadowAlivePointsPerMinuteCap: v.number(),
  hunterTagPoints: v.number(),
  hunterTagPointsFloor: v.number(),
  allTaggedBonusPerHunter: v.number(),
  survivalBonusPerShadow: v.number(),
});
