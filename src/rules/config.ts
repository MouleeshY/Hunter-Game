// Every rule number in Shadow Hunt lives in this file.
//
// A match takes a snapshot of this object when it is created, so retuning the
// rules later never changes a match that has already been played.
//
// Provenance of each value:
//   [RULE]  stated in the game rules — do not change without asking.
//   [TUNED] not stated in the rules; provisional default picked so the engine
//           can run at all. Ask before treating these as final.

import type { PlayerMode } from "./types";

export interface MatchConfig {
  /** [RULE] One match runs inside a 2–3 hour event window. */
  eventWindowMinutes: { min: number; max: number };
  /** [TUNED] What the match timer counts down to. Rules say only "the match timer". */
  matchDurationMinutes: number;

  /** [RULE] Shadows get a 5 minute head start; pings start only once it ends. */
  headStartMinutes: number;
  /** [RULE] Phones upload their position every few seconds; the app reveals pings
   *   every 3 minutes. These are separate. */
  positionUploadSeconds: number;
  /** [RULE] Location pings are published to the app every 3 minutes. */
  pingIntervalMinutes: number;

  /** [RULE] The play area shrinks every 10 minutes. */
  zoneShrinkIntervalMinutes: number;
  /** [TUNED] Fraction of the radius kept after each shrink step. */
  zoneShrinkFactor: number;
  /** [TUNED] Area per remaining player above which the zone shrinks one extra step. */
  extraShrinkAreaPerPlayerMetres2: number;
  /** [TUNED] Hard bound on how many extra shrink steps can be applied at once. */
  maxExtraShrinks: number;
  /** [TUNED] See stability check below. */
  minimumZoneRadiusMetres: number;
  /** [RULE] Radius is calculated from the player count. The rules fix no min or max,
   *   so the table itself is the config: tiers are open-ended upwards, and lookup
   *   takes the last tier whose minPlayers is <= the count. The tier values are
   *   provisional and will be tuned in the field test. */
  radiusTable: { minPlayers: number; radiusMetres: number }[];

  /** [TUNED] GPS tolerance buffer added to the zone before a player counts as outside. */
  gpsToleranceMetres: number;
  /** [RULE] ~60 seconds of grace after leaving the zone. */
  graceSeconds: number;
  /** [RULE] Points drain every 10 seconds while outside past the grace period. */
  drainIntervalSeconds: number;
  /** [TUNED] How many points a single drain tick removes. Rules say "a points drain"
   *   without a value. */
  drainPointsPerTick: number;
  /** [RULE] ~3 minutes outside in total, then the player becomes a spectator. */
  eliminationSecondsOutside: number;

  /** [RULE] A scan is accepted only if both last known positions are within ~40 m.
   *   The Scanner's reading is its current GPS reading. The Shadow's phone sends a
   *   fresh position when its QR screen opens. Scans are rejected if either reading is
   *   older than the freshness window, or the two are more than 40 m apart. */
  tagFreshnessSeconds: number;
  tagProximityMetres: number;
  /** [TUNED] How long an invigilator has to respond to a complaint. */
  complaintResponseMinutes: number;
  /** [RULE] 2–3 invigilators per match. */
  invigilatorCount: { min: number; max: number };

  /** [RULE] Hunter-to-Shadow ratio at team assignment, configurable. */
  hunterSplit: { hunterCount: number; shadowCount: number };
  /** [RULE] Minimum players. [TUNED] default 4. */
  minPlayers: number;
  /** [TUNED] Soft cap. The organiser can start any time after the min; this is the
   *   largest roster the app supports (no hard cap stated beyond it). */
  softCapPlayers: number;
  /** Where the organiser may place the centre, as a distance from their position. */
  centrePickDistanceMetres: number;
  /** [RULE] What an eliminated Shadow turns into. Rules say "becomes a spectator". */
  eliminatedTurnsInto: PlayerMode;
  /** [RULE] What a removed Shadow gets. Rules say "no survival bonus". */
  removedSurvives: boolean;

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
  positionUploadSeconds: 5,
  pingIntervalMinutes: 3,

  zoneShrinkIntervalMinutes: 10,
  zoneShrinkFactor: 0.85,
  extraShrinkAreaPerPlayerMetres2: 130_000,
  maxExtraShrinks: 2,
  minimumZoneRadiusMetres: 100,
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

  tagFreshnessSeconds: 30,
  tagProximityMetres: 40,
  complaintResponseMinutes: 10,
  invigilatorCount: { min: 2, max: 3 },

  hunterSplit: { hunterCount: 8, shadowCount: 24 },
  minPlayers: 4,
  softCapPlayers: 40,
  centrePickDistanceMetres: 500,
  eliminatedTurnsInto: "spectator" as const,
  removedSurvives: false,

  shadowAlivePointsPerMinute: 10,
  shadowAlivePointsPerMinuteCap: 25,
  hunterTagPoints: 100,
  hunterTagPointsFloor: 40,
  allTaggedBonusPerHunter: 150,
  survivalBonusPerShadow: 100,
};

export type MatchConfigShape = MatchConfig;
