import { describe, expect, it } from "bun:test";
import { visibilityFor, type Viewer } from "./visibility";
import type { PlayerStatus } from "./types";

const hunter: Viewer = {
  kind: "player",
  playerId: "h1",
  role: "hunter",
  status: "active",
};
const shadow: Viewer = {
  kind: "player",
  playerId: "s1",
  role: "shadow",
  status: "active",
};
const spectator = (status: PlayerStatus): Viewer => ({
  kind: "player",
  playerId: "s2",
  role: "shadow",
  status,
});
const invigilator: Viewer = { kind: "invigilator" };

const candidate = (
  playerId: string,
  role: "hunter" | "shadow",
  status: PlayerStatus = "active",
) => ({ playerId, role, status });

describe("hunters", () => {
  it("see their own team live", () => {
    expect(visibilityFor(hunter, candidate("h2", "hunter"))).toBe("live");
  });

  it("see an active Shadow only at the ping, never live", () => {
    expect(visibilityFor(hunter, candidate("s2", "shadow"))).toBe("ping");
  });

  it("never return a live mode for any Shadow", () => {
    for (const status of ["active", "tagged", "spectator", "eliminated"] as const) {
      const mode = visibilityFor(hunter, candidate("s3", "shadow", status));
      expect(mode).not.toBe("live");
    }
  });
});

describe("shadows", () => {
  it("see their own team live", () => {
    expect(visibilityFor(shadow, candidate("s2", "shadow"))).toBe("live");
  });

  it("are not shown the Hunters", () => {
    expect(visibilityFor(shadow, candidate("h2", "hunter"))).toBeNull();
  });
});

describe("spectators", () => {
  it("see everyone delayed, including teammates", () => {
    for (const status of ["tagged", "spectator", "eliminated"] as const) {
      expect(visibilityFor(spectator(status), candidate("s3", "shadow"))).toBe(
        "delayed",
      );
      expect(visibilityFor(spectator(status), candidate("h3", "hunter"))).toBe(
        "delayed",
      );
    }
  });

  it("never get a live view", () => {
    expect(visibilityFor(spectator("tagged"), candidate("s3", "shadow"))).not.toBe(
      "live",
    );
  });
});

describe("invigilators and self", () => {
  it("invigilators see everyone live", () => {
    expect(visibilityFor(invigilator, candidate("h2", "hunter"))).toBe("live");
    expect(visibilityFor(invigilator, candidate("s2", "shadow"))).toBe("live");
  });

  it("a player always sees their own position live", () => {
    expect(visibilityFor(hunter, candidate("h1", "hunter"))).toBe("live");
    expect(visibilityFor(shadow, candidate("s1", "shadow"))).toBe("live");
  });

  it("removed players are never shown", () => {
    expect(visibilityFor(invigilator, candidate("s9", "shadow", "removed"))).toBeNull();
    expect(visibilityFor(hunter, candidate("h9", "hunter", "removed"))).toBeNull();
  });
});
