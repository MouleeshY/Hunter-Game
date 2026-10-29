/**
 * Housekeeping.
 *
 * Position history is deleted `positionRetentionHours` (24 h) after a match
 * ends. Score events and the leaderboard are untouched, so results survive.
 */
import { internalMutation } from "./_generated/server";
import { purgeExpiredPositions } from "../server/positionService";

export const purgePositions = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await purgeExpiredPositions(ctx);
  },
});
