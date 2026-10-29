import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Position history is removed 24 h after a match ends; scores are kept.
crons.interval(
  "purge expired position history",
  { hours: 1 },
  internal.maintenance.purgePositions,
);

export default crons;
