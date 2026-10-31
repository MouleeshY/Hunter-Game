/**
 * Convex validators for the rules shapes.
 *
 * The rules themselves live in `src/rules` and never import from here. This
 * file is the only Convex-aware mirror of those types, so the schema can store
 * them and the engine stays portable.
 */
import { v } from "convex/values";

export const roleValidator = v.union(v.literal("hunter"), v.literal("shadow"));

/** What a tagged Shadow does for the rest of the match. */
export const playerModeValidator = v.union(
  v.literal("spectator"),
  v.literal("hunter"),
  v.literal("helper"),
);

export const playerStatusValidator = v.union(
  v.literal("active"),
  v.literal("tagged"),
  v.literal("spectator"),
  v.literal("removed"),
  v.literal("eliminated"),
);

export const matchStatusValidator = v.union(
  v.literal("lobby"),
  v.literal("locked"),
  v.literal("headstart"),
  v.literal("live"),
  v.literal("ended"),
);

export const displayNameModeValidator = v.union(
  v.literal("nickname"),
  v.literal("real"),
);

/** Shape of the config snapshot stored on every match. */
export const matchConfigValidator = v.object({
  eventWindowMinutes: v.object({ min: v.number(), max: v.number() }),
  matchDurationMinutes: v.number(),
  matchDurationRangeMinutes: v.object({ min: v.number(), max: v.number() }),

  headStartMinutes: v.number(),
  pingIntervalMinutes: v.number(),
  uploadIntervalSeconds: v.number(),
  maxGpsAccuracyMetres: v.number(),
  impossibleAccuracyMetres: v.number(),
  maxSpeedMetresPerSecond: v.number(),
  pingGhostFadeSeconds: v.number(),
  spectatorDelaySeconds: v.number(),
  positionRetentionHours: v.number(),

  zoneShrinkIntervalMinutes: v.number(),
  zoneShrinkFactor: v.number(),
  extraShrinkAreaPerPlayerMetres2: v.number(),
  maxExtraShrinks: v.number(),
  radiusTable: v.array(
    v.object({ minPlayers: v.number(), radiusMetres: v.number() }),
  ),
  minZoneRadiusMetres: v.number(),

  gpsToleranceMetres: v.number(),
  graceSeconds: v.number(),
  drainIntervalSeconds: v.number(),
  drainPointsPerTick: v.number(),
  eliminationSecondsOutside: v.number(),

  tagProximityMetres: v.number(),
  tagFreshnessSeconds: v.number(),
  complaintFilingWindowMinutes: v.number(),
  complaintResponseMinutes: v.number(),
  complaintRateLimit: v.number(),
  complaintRateWindowMinutes: v.number(),
  invigilatorCount: v.object({ min: v.number(), max: v.number() }),
  aliveTickMinutes: v.number(),

  minPlayers: v.number(),
  softCapPlayers: v.number(),
  hunterSplit: v.object({
    hunterCount: v.number(),
    shadowCount: v.number(),
  }),
  roomCodeLength: v.number(),
  inviteCodeLength: v.number(),
  centrePickDistanceMetres: v.number(),
  eliminatedTurnsInto: playerModeValidator,
  removedSurvives: v.boolean(),

  shadowAlivePointsPerMinute: v.number(),
  shadowAlivePointsPerMinuteCap: v.number(),
  hunterTagPoints: v.number(),
  hunterTagPointsFloor: v.number(),
  allTaggedBonusPerHunter: v.number(),
  survivalBonusPerShadow: v.number(),
});
