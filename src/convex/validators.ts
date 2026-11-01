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
  v.literal("setup"),
  v.literal("headstart"),
  v.literal("live"),
  v.literal("ended"),
);

export const displayNameModeValidator = v.union(
  v.literal("nickname"),
  v.literal("real"),
);

/** How a match finished, written once on the match record. */
export const matchEndReasonValidator = v.union(
  v.literal("no_active_shadows"),
  v.literal("timer_expired"),
  v.literal("staff_end"),
  v.literal("aborted"),
);

/** Lines of the live match feed. Nothing here ever carries a position. */
export const matchEventKindValidator = v.union(
  v.literal("tag"),
  v.literal("elimination"),
  v.literal("removal"),
  v.literal("shrink"),
  v.literal("pause"),
  v.literal("resume"),
  v.literal("phase"),
  v.literal("help"),
  v.literal("detection"),
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
  shrinkWarningSeconds: v.number(),

  setupDurationSeconds: v.number(),
  setupExtensionSeconds: v.number(),
  setupMaxDurationSeconds: v.number(),
  minSeparationMetres: v.number(),
  minHunterShadowSeparationMetres: v.number(),

  proximityDetectionEnabled: v.boolean(),
  detectionRadiusMetres: v.number(),
  detectionMinZoneRadiusMetres: v.number(),
  detectionCooldownSeconds: v.number(),
  detectionStaleSeconds: v.number(),

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
  defaultCaptureMode: playerModeValidator,

  shadowAlivePointsPerMinute: v.number(),
  shadowAlivePointsPerMinuteCap: v.number(),
  hunterTagPoints: v.number(),
  hunterTagPointsFloor: v.number(),
  allTaggedBonusPerHunter: v.number(),
  survivalBonusPerShadow: v.number(),

  publicSlugBytes: v.number(),
  matchTitleMaxLength: v.number(),
  clubNameMaxLength: v.number(),
});
