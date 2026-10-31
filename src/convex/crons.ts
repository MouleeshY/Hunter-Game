import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The minute tick: alive points and auto-settlement for every live match.
crons.interval("match tick", { minutes: 1 }, internal.scheduler.tick);

// Position history is removed 24 h after a match ends; scores are kept.
crons.interval(
  "purge expired position history",
  { hours: 1 },
  internal.maintenance.purgePositions,
);

export default crons;
