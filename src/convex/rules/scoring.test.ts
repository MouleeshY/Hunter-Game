import { describe, expect, it } from "bun:test";
import { RULES_CONFIG } from "./config";
import {
  allTaggedBonus,
  applyZoneDrain,
  aliveRatePerMinute,
  hunterTagPoints,
  rankLeaderboard,
  shadowAlivePoints,
  survivalBonus,
} from "./scoring";

const config = RULES_CONFIG;

describe("shadow alive points", () => {
  it("starts at 10 points per minute", () => {
    expect(aliveRatePerMinute(0, config)).toBe(10);
    expect(shadowAlivePoints({ minutes: 1, zoneProgress01: 0, config })).toBe(10);
  });

  it("rises linearly to the 25/min cap as the zone shrinks", () => {
    expect(aliveRatePerMinute(0.5, config)).toBe(17.5);
    expect(aliveRatePerMinute(1, config)).toBe(25);
    expect(shadowAlivePoints({ minutes: 4, zoneProgress01: 1, config })).toBe(100);
  });

  it("never exceeds the cap, whatever zone progress it is handed", () => {
    expect(aliveRatePerMinute(1.4, config)).toBe(25);
    expect(aliveRatePerMinute(-3, config)).toBe(10);
  });

  it("banks nothing for zero or negative minutes", () => {
    expect(shadowAlivePoints({ minutes: 0, zoneProgress01: 0.5, config })).toBe(0);
    expect(shadowAlivePoints({ minutes: -5, zoneProgress01: 0.5, config })).toBe(0);
  });
});

describe("hunter tag points", () => {
  it("starts at 100 points", () => {
    expect(hunterTagPoints({ zoneProgress01: 0, config })).toBe(100);
  });

  it("falls linearly to the floor of 40 as the zone shrinks", () => {
    expect(hunterTagPoints({ zoneProgress01: 0.5, config })).toBe(70);
    expect(hunterTagPoints({ zoneProgress01: 1, config })).toBe(40);
  });

  it("never drops below the floor", () => {
    expect(hunterTagPoints({ zoneProgress01: 2, config })).toBe(40);
  });
});

describe("bonuses", () => {
  it("uses the configured values", () => {
    expect(allTaggedBonus(config)).toBe(150);
    expect(survivalBonus(config)).toBe(100);
  });
});

describe("zone drain", () => {
  it("charges nothing before the first tick", () => {
    expect(applyZoneDrain({ points: 100, ticks: 0, config })).toBe(100);
    expect(applyZoneDrain({ points: 100, ticks: -4, config })).toBe(100);
  });

  it("removes the configured points per tick", () => {
    expect(config.drainPointsPerTick).toBe(5);
    expect(applyZoneDrain({ points: 100, ticks: 12, config })).toBe(40);
  });

  it("can take a player past zero", () => {
    expect(applyZoneDrain({ points: 10, ticks: 5, config })).toBe(-15);
  });
});

describe("leaderboard ranking", () => {
  it("orders by points descending", () => {
    const ranked = rankLeaderboard([
      { playerId: "a", displayName: "Ava", totalPoints: 40 },
      { playerId: "b", displayName: "Bo", totalPoints: 220 },
      { playerId: "c", displayName: "Cy", totalPoints: 120 },
    ]);
    expect(ranked.map((r) => r.displayName)).toEqual(["Bo", "Cy", "Ava"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shares a rank on a tie and skips the following rank", () => {
    const ranked = rankLeaderboard([
      { playerId: "a", displayName: "Ava", totalPoints: 100 },
      { playerId: "b", displayName: "Bo", totalPoints: 100 },
      { playerId: "c", displayName: "Cy", totalPoints: 50 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("is stable when totals are identical", () => {
    const ranked = rankLeaderboard([
      { playerId: "b", displayName: "Bo", totalPoints: 10 },
      { playerId: "a", displayName: "Ava", totalPoints: 10 },
    ]);
    expect(ranked.map((r) => r.displayName)).toEqual(["Ava", "Bo"]);
  });
});
