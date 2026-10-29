import { describe, expect, it } from "bun:test";
import { RULES_CONFIG } from "./config";
import {
  eventWindowEndsAt,
  firstPingAt,
  matchEndState,
  matchEndsAt,
  pingSchedule,
  timerExpired,
  uploadSchedule,
  withinEventWindow,
} from "./match";

const config = RULES_CONFIG;
const START = 1_700_000_000_000;
const MINUTE = 60_000;

describe("ping schedule", () => {
  it("gives Shadows a 5 minute head start before the first ping", () => {
    expect(firstPingAt(START, config)).toBe(START + 5 * MINUTE);
    expect(config.headStartMinutes).toBe(5);
  });

  it("refuses pings until the head start is over", () => {
    const schedule = pingSchedule({
      startedAtMs: START,
      lastPingAtMs: null,
      nowMs: START + 4 * MINUTE,
      config,
    });
    expect(schedule.allowed).toBe(false);
    expect(schedule.reason).toBe("head_start");
    expect(schedule.nextAllowedAtMs).toBe(START + 5 * MINUTE);
  });

  it("accepts the first ping the moment the head start ends", () => {
    const schedule = pingSchedule({
      startedAtMs: START,
      lastPingAtMs: null,
      nowMs: START + 5 * MINUTE,
      config,
    });
    expect(schedule.allowed).toBe(true);
    expect(schedule.reason).toBeNull();
  });

  it("refuses pings more often than every 3 minutes", () => {
    const lastPing = START + 5 * MINUTE;
    const tooSoon = pingSchedule({
      startedAtMs: START,
      lastPingAtMs: lastPing,
      nowMs: lastPing + 2 * MINUTE + 59_000,
      config,
    });
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.reason).toBe("interval");
    expect(tooSoon.nextAllowedAtMs).toBe(lastPing + 3 * MINUTE);
  });

  it("accepts a ping exactly on the 3 minute mark", () => {
    const lastPing = START + 5 * MINUTE;
    const schedule = pingSchedule({
      startedAtMs: START,
      lastPingAtMs: lastPing,
      nowMs: lastPing + 3 * MINUTE,
      config,
    });
    expect(schedule.allowed).toBe(true);
  });

  it("refuses pings for a match that has not started", () => {
    const schedule = pingSchedule({
      startedAtMs: null,
      lastPingAtMs: null,
      nowMs: START,
      config,
    });
    expect(schedule.allowed).toBe(false);
    expect(schedule.reason).toBe("not_started");
    expect(schedule.nextAllowedAtMs).toBeNull();
  });
});

describe("match windows", () => {
  it("runs the match timer for the configured duration", () => {
    expect(matchEndsAt(START, config)).toBe(
      START + config.matchDurationMinutes * MINUTE,
    );
    expect(config.matchDurationMinutes).toBeGreaterThanOrEqual(
      config.eventWindowMinutes.min,
    );
    expect(config.matchDurationMinutes).toBeLessThanOrEqual(
      config.eventWindowMinutes.max,
    );
  });

  it("keeps the event window inside 2–3 hours", () => {
    expect(eventWindowEndsAt(START, config)).toBe(START + 180 * MINUTE);
    expect(
      withinEventWindow({ startedAtMs: START, nowMs: START, config }),
    ).toBe(true);
    expect(
      withinEventWindow({
        startedAtMs: START,
        nowMs: START + 179 * MINUTE,
        config,
      }),
    ).toBe(true);
    expect(
      withinEventWindow({
        startedAtMs: START,
        nowMs: START + 181 * MINUTE,
        config,
      }),
    ).toBe(false);
  });

  it("knows when the timer has expired", () => {
    const endsAt = matchEndsAt(START, config);
    expect(timerExpired({ nowMs: endsAt - 1, endsAtMs: endsAt })).toBe(false);
    expect(timerExpired({ nowMs: endsAt, endsAtMs: endsAt })).toBe(true);
    expect(timerExpired({ nowMs: START, endsAtMs: null })).toBe(false);
  });
});

describe("end conditions", () => {
  const endsAt = START + 120 * MINUTE;

  it("keeps the match running while Shadows remain active", () => {
    const end = matchEndState({
      totalShadows: 3,
      activeShadows: 1,
      nowMs: START + 30 * MINUTE,
      endsAtMs: endsAt,
    });
    expect(end.ended).toBe(false);
    expect(end.winner).toBeNull();
  });

  it("gives the Hunters the win the moment the last Shadow is tagged", () => {
    const end = matchEndState({
      totalShadows: 3,
      activeShadows: 0,
      nowMs: START + 30 * MINUTE,
      endsAtMs: endsAt,
    });
    expect(end).toEqual({
      ended: true,
      winner: "hunters",
      reason: "no_active_shadows",
    });
  });

  it("counts a Shadow removed by an invigilator towards the Hunters' win", () => {
    // One Shadow tagged, one removed, one eliminated: no active Shadow is left.
    const end = matchEndState({
      totalShadows: 3,
      activeShadows: 0,
      nowMs: START + 40 * MINUTE,
      endsAtMs: endsAt,
    });
    expect(end.winner).toBe("hunters");
    expect(end.reason).toBe("no_active_shadows");
  });

  it("gives the Hunters a tag landed on the final whistle", () => {
    const end = matchEndState({
      totalShadows: 1,
      activeShadows: 0,
      nowMs: endsAt + 30_000,
      endsAtMs: endsAt,
    });
    expect(end.winner).toBe("hunters");
    expect(end.reason).toBe("no_active_shadows");
  });

  it("gives surviving Shadows the win when the timer runs out", () => {
    const end = matchEndState({
      totalShadows: 3,
      activeShadows: 1,
      nowMs: endsAt,
      endsAtMs: endsAt,
    });
    expect(end).toEqual({
      ended: true,
      winner: "shadows",
      reason: "timer_expired",
    });
  });

  it("never ends before the timer with Shadows still out", () => {
    const end = matchEndState({
      totalShadows: 3,
      activeShadows: 3,
      nowMs: endsAt - 1,
      endsAtMs: endsAt,
    });
    expect(end.ended).toBe(false);
  });

  it("refuses to end on a roster with no Shadows", () => {
    const end = matchEndState({
      totalShadows: 0,
      activeShadows: 0,
      nowMs: endsAt + 10 * MINUTE,
      endsAtMs: endsAt,
    });
    expect(end.ended).toBe(false);
    expect(end.winner).toBeNull();
  });
});

describe("position uploads", () => {
  const live = START + 20 * MINUTE;

  it("accepts uploads every few seconds, not every three minutes", () => {
    const first = uploadSchedule({
      status: "live",
      lastUploadAtMs: null,
      nowMs: live,
      config,
    });
    expect(first.allowed).toBe(true);

    const tooSoon = uploadSchedule({
      status: "live",
      lastUploadAtMs: live,
      nowMs: live + config.uploadIntervalSeconds * 1000 - 1,
      config,
    });
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.reason).toBe("too_soon");

    const next = uploadSchedule({
      status: "live",
      lastUploadAtMs: live,
      nowMs: live + config.uploadIntervalSeconds * 1000,
      config,
    });
    expect(next.allowed).toBe(true);
  });

  it("allows many uploads inside one three-minute ping window", () => {
    const intervalMs = config.uploadIntervalSeconds * 1000;
    let last: number | null = live;
    let accepted = 0;
    for (let t = live + intervalMs; t < live + config.pingIntervalMinutes * 60_000; t += intervalMs) {
      const schedule = uploadSchedule({
        status: "live",
        lastUploadAtMs: last,
        nowMs: t,
        config,
      });
      if (schedule.allowed) {
        accepted += 1;
        last = t;
      }
    }
    expect(accepted).toBeGreaterThan(10);
  });

  it("refuses uploads before the head start ends", () => {
    for (const status of ["lobby", "locked", "headstart"] as const) {
      expect(
        uploadSchedule({
          status,
          lastUploadAtMs: null,
          nowMs: live,
          config,
        }).allowed,
      ).toBe(false);
    }
  });

  it("refuses uploads after the match ends", () => {
    expect(
      uploadSchedule({
        status: "ended",
        lastUploadAtMs: null,
        nowMs: live,
        config,
      }).reason,
    ).toBe("not_live");
  });
});
