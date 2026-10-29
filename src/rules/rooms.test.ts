import { describe, expect, it } from "bun:test";
import { RULES_CONFIG } from "./config";
import {
  callSignError,
  canStartMatch,
  generateInviteCode,
  generateRoomCode,
  isValidRoomCode,
  joinPolicy,
  nextMatchStatus,
  normalizeRoomCode,
  roomCodeError,
  statusForClock,
} from "./rooms";
import type { MatchConfig } from "./config";

const config: MatchConfig = RULES_CONFIG;

describe("room codes", () => {
  it("generates a five-character code from the unambiguous alphabet", () => {
    const code = generateRoomCode(() => 0.5, config.roomCodeLength);
    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}$/);
    expect(isValidRoomCode(code, config)).toBe(true);
  });

  it("never generates the confusable characters 0, O, 1 or I", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoomCode(() => Math.random(), config.roomCodeLength);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("normalises what a player types", () => {
    expect(normalizeRoomCode(" ab-2cd ")).toBe("AB2CD");
    expect(normalizeRoomCode("ab 2cd")).toBe("AB2CD");
  });

  it("rejects codes of the wrong length or alphabet", () => {
    expect(roomCodeError("", config)).not.toBeNull();
    expect(roomCodeError("ABCD", config)).not.toBeNull();
    expect(roomCodeError("ABCDEF", config)).not.toBeNull();
    expect(roomCodeError("ABCD0", config)).not.toBeNull();
    expect(roomCodeError("ab2cd", config)).toBeNull();
  });

  it("gives each invigilator a distinct invite code length", () => {
    const code = generateInviteCode(() => 0.42, config.inviteCodeLength);
    expect(code).toHaveLength(config.inviteCodeLength);
  });
});

describe("player details", () => {
  it("requires a call sign of at least two characters", () => {
    expect(callSignError("A")).not.toBeNull();
    expect(callSignError("  ")).not.toBeNull();
    expect(callSignError("Nightjar")).toBeNull();
    expect(callSignError("x".repeat(25))).not.toBeNull();
  });
});

describe("join policy", () => {
  const base = {
    status: "lobby" as const,
    rosterLocked: false,
    playerCount: 4,
    alreadyJoined: false,
    callSignTaken: false,
    config,
  };

  it("allows a new player into an open lobby", () => {
    expect(joinPolicy(base)).toBeNull();
  });

  it("refuses once the roster is locked", () => {
    expect(joinPolicy({ ...base, rosterLocked: true })).toBe("roster_locked");
  });

  it("refuses once the match has started", () => {
    for (const status of ["headstart", "live", "ended"] as const) {
      expect(joinPolicy({ ...base, status })).toBe("match_started");
    }
  });

  it("names the locked roster as the reason while still in the lobby", () => {
    expect(joinPolicy({ ...base, status: "locked" })).toBe("roster_locked");
  });

  it("enforces the soft cap with no hard maximum beyond it", () => {
    expect(
      joinPolicy({ ...base, playerCount: config.softCapPlayers }),
    ).toBe("full");
    expect(
      joinPolicy({ ...base, playerCount: config.softCapPlayers - 1 }),
    ).toBeNull();
  });

  it("refuses a duplicate player or call sign", () => {
    expect(joinPolicy({ ...base, alreadyJoined: true })).toBe("already_joined");
    expect(joinPolicy({ ...base, callSignTaken: true })).toBe(
      "duplicate_call_sign",
    );
  });
});

describe("start conditions", () => {
  it("unlocks at the configured minimum", () => {
    expect(config.minPlayers).toBe(4);
    expect(canStartMatch({ status: "lobby", playerCount: 3, config }).allowed).toBe(
      false,
    );
    expect(canStartMatch({ status: "lobby", playerCount: 4, config }).allowed).toBe(
      true,
    );
  });

  it("allows the organiser to start any time after the minimum", () => {
    for (const playerCount of [4, 6, 20, 40]) {
      expect(canStartMatch({ status: "lobby", playerCount, config }).allowed).toBe(
        true,
      );
      expect(canStartMatch({ status: "locked", playerCount, config }).allowed).toBe(
        true,
      );
    }
  });

  it("refuses to start a match that has already begun", () => {
    expect(
      canStartMatch({ status: "headstart", playerCount: 10, config }).allowed,
    ).toBe(false);
    expect(canStartMatch({ status: "live", playerCount: 10, config }).allowed).toBe(
      false,
    );
  });
});

describe("match state transitions", () => {
  it("walks lobby → locked → headstart → live → ended", () => {
    expect(nextMatchStatus("lobby", "lock")).toBe("locked");
    expect(nextMatchStatus("locked", "start")).toBe("headstart");
    expect(nextMatchStatus("headstart", "start")).toBe("live");
    expect(nextMatchStatus("live", "end")).toBe("ended");
  });

  it("lets the organiser start straight from the lobby", () => {
    expect(nextMatchStatus("lobby", "start")).toBe("headstart");
  });

  it("lets the organiser unlock a locked roster", () => {
    expect(nextMatchStatus("locked", "unlock")).toBe("lobby");
  });

  it("refuses illegal transitions", () => {
    expect(nextMatchStatus("lobby", "end")).toBeNull();
    expect(nextMatchStatus("locked", "lock")).toBeNull();
    expect(nextMatchStatus("headstart", "lock")).toBeNull();
    expect(nextMatchStatus("live", "start")).toBeNull();
    expect(nextMatchStatus("ended", "start")).toBeNull();
    expect(nextMatchStatus("ended", "lock")).toBeNull();
  });
});

describe("clock-driven status", () => {
  const start = 1_700_000_000_000;
  const headStartMs = config.headStartMinutes * 60_000;
  const endsAt = start + config.matchDurationMinutes * 60_000;

  it("stays in the head start for five minutes", () => {
    expect(
      statusForClock({
        stored: "headstart",
        startedAtMs: start,
        endsAtMs: endsAt,
        nowMs: start + headStartMs - 1,
        config,
      }),
    ).toBe("headstart");
  });

  it("becomes live when the head start ends", () => {
    expect(
      statusForClock({
        stored: "headstart",
        startedAtMs: start,
        endsAtMs: endsAt,
        nowMs: start + headStartMs,
        config,
      }),
    ).toBe("live");
  });

  it("becomes ended when the timer runs out", () => {
    expect(
      statusForClock({
        stored: "live",
        startedAtMs: start,
        endsAtMs: endsAt,
        nowMs: endsAt,
        config,
      }),
    ).toBe("ended");
  });

  it("leaves lobby and locked alone", () => {
    for (const stored of ["lobby", "locked"] as const) {
      expect(
        statusForClock({
          stored,
          startedAtMs: null,
          endsAtMs: null,
          nowMs: start,
          config,
        }),
      ).toBe(stored);
    }
  });
});
