import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import { matchConfigValidator } from "./rules/config";
import {
  displayNameModeValidator,
  matchStatusValidator,
  playerModeValidator,
  playerStatusValidator,
  roleValidator as playerRoleValidator,
} from "./rules/types";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    /* ---------------------------------------------------------------- *
     * Matches — one row per match inside an organiser's event window.
     *
     * `config` is a snapshot of RULES_CONFIG taken when the match is
     * created, so retuning the rules never rewrites history.
     * `zone` stores only what is fixed at kickoff; the current radius is
     * derived on the server by `zoneRadiusAtMinute`.
     * ---------------------------------------------------------------- */
    matches: defineTable({
      status: matchStatusValidator,
      config: matchConfigValidator,
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      endsAt: v.optional(v.number()),
      eventWindowEndsAt: v.optional(v.number()),
      /** Set once the roster is locked at match start; roles never change after. */
      rosterLocked: v.boolean(),
      /** Organiser who set the match up. */
      createdBy: v.optional(v.id("users")),
      zone: v.object({
        centreLat: v.number(),
        centreLng: v.number(),
        initialRadiusMetres: v.number(),
      }),
      winner: v.optional(v.union(v.literal("hunters"), v.literal("shadows"))),
      endedAt: v.optional(v.number()),
    }).index("by_status", ["status"]),

    /* ---------------------------------------------------------------- *
     * Players — a person's place in one match.
     *
     * role:    assigned team, random, locked at start.
     * mode:    where a Shadow goes once tagged (chosen before the match,
     *          changeable until it happens).
     * status:  active | tagged (captured, now helping Hunters) |
     *          spectator (captured with spectator mode) |
     *          eliminated (removed by zone breach or invigilator).
     *
     * No photos anywhere: the only per-match identity is a plain QR token.
     * ---------------------------------------------------------------- */
    players: defineTable({
      matchId: v.id("matches"),
      userId: v.id("users"),
      role: playerRoleValidator,
      mode: playerModeValidator,
      status: playerStatusValidator,
      displayName: v.string(),
      displayNameMode: displayNameModeValidator,
      /** One plain QR code per match; the tag scan posts this token. */
      qrToken: v.string(),
      points: v.number(),
      joinedAt: v.number(),
      taggedAt: v.optional(v.number()),
      taggedById: v.optional(v.id("players")),
      zoneBreach: v.object({
        outsideSince: v.optional(v.number()),
        chargedDrainTicks: v.number(),
        warnedAt: v.optional(v.number()),
      }),
    })
      .index("by_match_user", ["matchId", "userId"])
      .index("by_match_qr", ["matchId", "qrToken"])
      .index("by_match_role", ["matchId", "role"]),

    /* ---------------------------------------------------------------- *
     * Locations — one row per ping. Written only through the server, only
     * during a ping window, and never read back to other players: the
     * server turns these into distances and never publishes coordinates.
     * ---------------------------------------------------------------- */
    locations: defineTable({
      matchId: v.id("matches"),
      playerId: v.id("players"),
      lat: v.number(),
      lng: v.number(),
      accuracyMetres: v.optional(v.number()),
      recordedAt: v.number(),
      pingIndex: v.number(),
    })
      .index("by_match_player_time", ["matchId", "playerId", "recordedAt"])
      .index("by_match_player_ping", ["matchId", "playerId", "pingIndex"]),

    /* ---------------------------------------------------------------- *
     * Tags — every scan attempt, accepted or not. Rejections award nothing
     * and change nothing; they exist so invigilators can audit a dispute.
     * ---------------------------------------------------------------- */
    tags: defineTable({
      matchId: v.id("matches"),
      hunterId: v.id("players"),
      shadowId: v.id("players"),
      status: v.union(v.literal("accepted"), v.literal("rejected")),
      rejectionCode: v.optional(v.string()),
      distanceMetres: v.optional(v.number()),
      /** Converted Hunter who helped with this capture. Recorded at capture. */
      assistedById: v.optional(v.id("players")),
      scoredPoints: v.number(),
      at: v.number(),
    })
      .index("by_match", ["matchId"])
      .index("by_match_shadow", ["matchId", "shadowId"]),

    /* ---------------------------------------------------------------- *
     * Complaints — a Hunter reports a Shadow who refuses to show a code.
     * The invigilator must respond before responseDueAt.
     * ---------------------------------------------------------------- */
    complaints: defineTable({
      matchId: v.id("matches"),
      complainantId: v.id("players"),
      accusedId: v.id("players"),
      note: v.optional(v.string()),
      createdAt: v.number(),
      responseDueAt: v.number(),
      status: v.union(
        v.literal("open"),
        v.literal("upheld"),
        v.literal("dismissed"),
      ),
      resolvedBy: v.optional(v.id("users")),
      resolvedAt: v.optional(v.number()),
      resolutionNote: v.optional(v.string()),
    })
      .index("by_match_status", ["matchId", "status"])
      .index("by_status_due", ["status", "responseDueAt"]),

    /* ---------------------------------------------------------------- *
     * Invigilators — 2–3 per match. They see complaints and may remove a
     * non-cooperating Shadow from the match entirely.
     * ---------------------------------------------------------------- */
    invigilators: defineTable({
      matchId: v.id("matches"),
      userId: v.id("users"),
      displayName: v.string(),
      active: v.boolean(),
      addedAt: v.number(),
    }).index("by_match", ["matchId"]),

    /* ---------------------------------------------------------------- *
     * Score events — append-only ledger. The leaderboard is derived from
     * this, so a total can always be explained event by event.
     * ---------------------------------------------------------------- */
    scoreEvents: defineTable({
      matchId: v.id("matches"),
      playerId: v.id("players"),
      kind: v.union(
        v.literal("shadow_alive"),
        v.literal("tag"),
        v.literal("all_tagged_bonus"),
        v.literal("survival_bonus"),
        v.literal("zone_drain"),
      ),
      /** Negative for zone drains. */
      points: v.number(),
      at: v.number(),
      source: v.union(v.literal("system"), v.literal("invigilator")),
      refId: v.optional(v.string()),
    })
      .index("by_match", ["matchId"])
      .index("by_match_player", ["matchId", "playerId"]),

    /* ---------------------------------------------------------------- *
     * Leaderboard — per match, public. Shows only the name the player
     * chose to publish and their points: no positions, ever.
     * ---------------------------------------------------------------- */
    leaderboard: defineTable({
      matchId: v.id("matches"),
      playerId: v.id("players"),
      displayName: v.string(),
      displayNameMode: displayNameModeValidator,
      totalPoints: v.number(),
      breakdown: v.object({
        alive: v.number(),
        tags: v.number(),
        bonuses: v.number(),
        drains: v.number(),
      }),
      updatedAt: v.number(),
    })
      .index("by_match_player", ["matchId", "playerId"])
      .index("by_match_points", ["matchId", "totalPoints"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
