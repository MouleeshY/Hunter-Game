/**
 * The scheduled minute tick.
 *
 * Runs about once a minute for every match on the clock: pays each active
 * Shadow the alive rate for every completed minute exactly once, then ends the
 * match when the timer runs out or no Shadow is left active.
 */
import { internalMutation } from "./_generated/server";
import { runMatchTick } from "../server/scheduler";

export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await runMatchTick(ctx);
  },
});
