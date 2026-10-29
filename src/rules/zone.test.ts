import { describe, expect, it } from "bun:test";
import { RULES_CONFIG } from "./config";
import {
  circlePolygon,
  distanceMetres,
  nextShrinkAtMs,
  outOfZoneState,
  radiusForPlayerCount,
  zoneProgress,
  zoneRadiusAtMinute,
} from "./zone";

const config = RULES_CONFIG;

describe("radius from player count", () => {
  it("reads the radius table by roster size", () => {
    expect(radiusForPlayerCount(1, config)).toBe(300);
    expect(radiusForPlayerCount(5, config)).toBe(300);
    expect(radiusForPlayerCount(6, config)).toBe(450);
    expect(radiusForPlayerCount(10, config)).toBe(450);
    expect(radiusForPlayerCount(11, config)).toBe(600);
    expect(radiusForPlayerCount(25, config)).toBe(1000);
    expect(radiusForPlayerCount(99, config)).toBe(1000);
  });

  it("fails loudly when the table has no tier for the count", () => {
    const tuned = {
      ...config,
      radiusTable: [{ minPlayers: 6, radiusMetres: 500 }],
    };
    expect(() => radiusForPlayerCount(4, tuned)).toThrow(/no tier/);
  });

  it("fails loudly on an empty table", () => {
    expect(() =>
      radiusForPlayerCount(10, { ...config, radiusTable: [] }),
    ).toThrow(/empty/);
  });
});

describe("zone radius at a given minute", () => {
  const base = { initialRadiusMetres: 450, config };

  it("starts at the roster's radius", () => {
    expect(
      zoneRadiusAtMinute({ ...base, minute: 0, activePlayerCount: 6 }),
    ).toBe(450);
  });

  it("shrinks every 10 minutes", () => {
    expect(
      zoneRadiusAtMinute({ ...base, minute: 9, activePlayerCount: 6 }),
    ).toBeCloseTo(450, 6);
    expect(
      zoneRadiusAtMinute({ ...base, minute: 10, activePlayerCount: 6 }),
    ).toBeCloseTo(450 * 0.85, 6);
    expect(
      zoneRadiusAtMinute({ ...base, minute: 25, activePlayerCount: 6 }),
    ).toBeCloseTo(450 * 0.85 ** 2, 6);
    expect(
      zoneRadiusAtMinute({ ...base, minute: 59, activePlayerCount: 6 }),
    ).toBeCloseTo(450 * 0.85 ** 5, 6);
  });

  it("shrinks further while the area is large for the players left", () => {
    const withSix = zoneRadiusAtMinute({
      ...base,
      minute: 10,
      activePlayerCount: 6,
    });
    const withThree = zoneRadiusAtMinute({
      ...base,
      minute: 10,
      activePlayerCount: 3,
    });
    expect(withThree).toBeLessThan(withSix);

    // One regular step plus one extra step: 3 players in a 382 m circle still
    // leaves 153,000 m² each, over the configured threshold, but the step after
    // that brings them under it so the loop stops.
    expect(withThree).toBeCloseTo(450 * 0.85 ** 2, 6);
    expect((Math.PI * withThree ** 2) / 3).toBeLessThanOrEqual(
      config.extraShrinkAreaPerPlayerMetres2,
    );
  });

  it("leaves a full roster alone at kickoff", () => {
    expect(
      zoneRadiusAtMinute({ ...base, minute: 0, activePlayerCount: 6 }),
    ).toBe(450);
  });

  it("never grows as the match progresses", () => {
    for (const activePlayerCount of [6, 3, 20]) {
      let previous = Number.POSITIVE_INFINITY;
      for (let minute = 0; minute <= 180; minute += 1) {
        const radius = zoneRadiusAtMinute({
          ...base,
          minute,
          activePlayerCount,
        });
        expect(radius).toBeLessThanOrEqual(previous);
        previous = radius;
      }
    }
  });

  it("never grows when players are knocked out mid-match", () => {
    const atMinute5AsSix = zoneRadiusAtMinute({
      ...base,
      minute: 5,
      activePlayerCount: 6,
    });
    const atMinute6AsFive = zoneRadiusAtMinute({
      ...base,
      minute: 6,
      activePlayerCount: 5,
    });
    expect(atMinute6AsFive).toBeLessThanOrEqual(atMinute5AsSix);
  });
});

describe("zone progress", () => {
  it("runs 0 → 1 from kickoff radius to no radius", () => {
    expect(zoneProgress(450, 450)).toBe(0);
    expect(zoneProgress(0, 450)).toBe(1);
    expect(zoneProgress(225, 450)).toBeCloseTo(0.5, 6);
  });

  it("is clamped and guards against a zero initial radius", () => {
    expect(zoneProgress(500, 450)).toBe(0);
    expect(zoneProgress(100, 0)).toBe(0);
  });
});

describe("distance", () => {
  const metresPerDegree = 111_194.9266;

  it("is zero for the same point", () => {
    const point = { lat: 51.5, lng: -0.12 };
    expect(distanceMetres(point, point)).toBe(0);
  });

  it("measures a known latitude offset", () => {
    const a = { lat: 51.5, lng: -0.12 };
    const b = { lat: 51.5 + 100 / metresPerDegree, lng: -0.12 };
    expect(distanceMetres(a, b)).toBeCloseTo(100, 1);
  });

  it("measures across longitude as well", () => {
    const a = { lat: 51.5, lng: -0.12 };
    // A degree of longitude is shorter away from the equator.
    const metresPerDegreeLng =
      metresPerDegree * Math.cos((51.5 * Math.PI) / 180);
    const b = { lat: 51.5, lng: -0.12 + 250 / metresPerDegreeLng };
    expect(distanceMetres(a, b)).toBeCloseTo(250, 1);
  });
});

describe("out-of-zone grace time", () => {
  const zone = { zoneRadiusMetres: 200, config };
  const boundary = 200 + config.gpsToleranceMetres;

  it("is inside while within the radius plus the GPS tolerance", () => {
    const state = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: boundary,
      secondsOutside: 999,
    });
    expect(state.status).toBe("inside");
    expect(state.outside).toBe(false);
    expect(state.secondsOutside).toBe(0);
    expect(state.drainTicksOwed).toBe(0);
    expect(state.shouldEliminate).toBe(false);
  });

  it("counts as outside only past the tolerance buffer", () => {
    expect(
      outOfZoneState({
        ...zone,
        distanceFromCentreMetres: boundary + 0.1,
        secondsOutside: 0,
      }).outside,
    ).toBe(true);
    expect(
      outOfZoneState({
        ...zone,
        distanceFromCentreMetres: boundary,
        secondsOutside: 0,
      }).outside,
    ).toBe(false);
  });

  it("grants 60 seconds of grace after the warning", () => {
    const at0 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 0,
    });
    expect(at0.status).toBe("grace");
    expect(at0.graceSecondsLeft).toBe(60);
    expect(at0.drainTicksOwed).toBe(0);

    const at59 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 59,
    });
    expect(at59.status).toBe("grace");
    expect(at59.graceSecondsLeft).toBe(1);
    expect(at59.drainTicksOwed).toBe(0);
  });

  it("starts draining only once the grace period is spent", () => {
    const at60 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 60,
    });
    expect(at60.status).toBe("draining");
    expect(at60.drainTicksOwed).toBe(0);

    const at70 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 70,
    });
    expect(at70.status).toBe("draining");
    expect(at70.drainTicksOwed).toBe(1);

    const at79 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 79,
    });
    expect(at79.drainTicksOwed).toBe(1);

    const at80 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 80,
    });
    expect(at80.drainTicksOwed).toBe(2);
  });

  it("eliminates after 3 minutes outside in total", () => {
    const at179 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 179,
    });
    expect(at179.status).toBe("draining");
    expect(at179.shouldEliminate).toBe(false);

    const at180 = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 180,
    });
    expect(at180.status).toBe("eliminated");
    expect(at180.shouldEliminate).toBe(true);
    expect(at180.drainTicksOwed).toBe(12);

    const wayOver = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: 900,
    });
    expect(wayOver.status).toBe("eliminated");
    expect(wayOver.drainTicksOwed).toBe(12);
  });

  it("owes exactly the ticks the grace period does not cover", () => {
    const totalOutside = config.eliminationSecondsOutside;
    const chargeable = totalOutside - config.graceSeconds;
    const expected = Math.floor(chargeable / config.drainIntervalSeconds);
    const state = outOfZoneState({
      ...zone,
      distanceFromCentreMetres: 500,
      secondsOutside: totalOutside,
    });
    expect(state.drainTicksOwed).toBe(expected);
  });
});

describe("shrink schedule", () => {
  const start = 1_700_000_000_000;
  const interval = config.zoneShrinkIntervalMinutes * 60_000;

  it("counts down to the next 10-minute step", () => {
    expect(nextShrinkAtMs(start, start + 1_000, config)).toBe(start + interval);
    expect(nextShrinkAtMs(start, start + interval, config)).toBe(
      start + 2 * interval,
    );
    expect(nextShrinkAtMs(start, start + 25 * 60_000, config)).toBe(
      start + 3 * interval,
    );
  });
});

describe("circle polygon", () => {
  it("closes the ring and keeps every point on the radius", () => {
    const centre = { lat: 51.5074, lng: -0.1278 };
    const radius = 300;
    const ring = circlePolygon(centre, radius, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const point of ring) {
      expect(distanceMetres(centre, point)).toBeCloseTo(radius, 0);
    }
  });
});

describe("minimum zone radius", () => {
  it("never shrinks below the configured floor", () => {
    expect(config.minZoneRadiusMetres).toBe(100);
    const radius = zoneRadiusAtMinute({
      minute: 600,
      activePlayerCount: 1,
      initialRadiusMetres: 300,
      config,
    });
    expect(radius).toBe(config.minZoneRadiusMetres);
  });

  it("still shrinks normally above the floor", () => {
    const radius = zoneRadiusAtMinute({
      minute: 10,
      activePlayerCount: 40,
      initialRadiusMetres: 1000,
      config,
    });
    expect(radius).toBeCloseTo(850, 5);
    expect(radius).toBeGreaterThan(config.minZoneRadiusMetres);
  });

  it("stays at the floor for every late minute", () => {
    for (const minute of [60, 90, 120, 180]) {
      const radius = zoneRadiusAtMinute({
        minute,
        activePlayerCount: 2,
        initialRadiusMetres: 300,
        config,
      });
      expect(radius).toBeGreaterThanOrEqual(config.minZoneRadiusMetres);
    }
  });
});
