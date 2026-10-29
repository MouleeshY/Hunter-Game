import { describe, expect, it } from "bun:test";
import { RULES_CONFIG } from "./config";
import { validateTagScan } from "./tags";
import type { LocationSnapshot, PlayerSnapshot } from "./types";

const config = RULES_CONFIG;
const NOW = 1_700_000_000_000;
const METRES_PER_DEGREE = 111_194.9266;

const hunter = (over: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: "hunter-1",
  role: "hunter",
  mode: "spectator",
  status: "active",
  taggedAtMs: null,
  ...over,
});

const shadow = (over: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: "shadow-1",
  role: "shadow",
  mode: "spectator",
  status: "active",
  taggedAtMs: null,
  ...over,
});

const atMetres = (metres: number): LocationSnapshot => ({
  lat: 51.5 + metres / METRES_PER_DEGREE,
  lng: -0.12,
  recordedAtMs: NOW,
});

const base = {
  nowMs: NOW,
  match: {
    status: "active" as const,
    startedAtMs: NOW - 600_000,
    endsAtMs: NOW + 3_600_000,
  },
  scanner: hunter(),
  target: shadow(),
  scannerLocation: atMetres(0),
  targetLocation: atMetres(0),
  config,
};

describe("tag scan — proximity", () => {
  it("accepts a scan well inside 40 m", () => {
    const verdict = validateTagScan({
      ...base,
      targetLocation: atMetres(39.9),
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.scores).toBe(true);
      expect(verdict.distanceMetres).toBeGreaterThan(39);
      expect(verdict.distanceMetres).toBeLessThan(40);
    }
  });

  it("rejects a scan just over 40 m and reports how far", () => {
    const verdict = validateTagScan({
      ...base,
      targetLocation: atMetres(40.1),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe("too_far");
      expect(verdict.distanceMetres).toBeGreaterThan(40);
    }
  });

  it("rejects a scan across the city", () => {
    const verdict = validateTagScan({
      ...base,
      targetLocation: atMetres(5_000),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("too_far");
  });

  it("uses the configured distance, not a hard-coded 40", () => {
    const verdict = validateTagScan({
      ...base,
      targetLocation: atMetres(45),
      config: { ...config, tagProximityMetres: 50 },
    });
    expect(verdict.ok).toBe(true);
  });

  it("needs a last known position for both players", () => {
    const noScanner = validateTagScan({ ...base, scannerLocation: null });
    expect(noScanner.ok).toBe(false);
    if (!noScanner.ok) expect(noScanner.code).toBe("missing_location");

    const noTarget = validateTagScan({ ...base, targetLocation: null });
    expect(noTarget.ok).toBe(false);
    if (!noTarget.ok) expect(noTarget.code).toBe("missing_location");
  });
});

describe("tag scan — role checks", () => {
  it("rejects a Shadow who has not been captured", () => {
    const verdict = validateTagScan({ ...base, scanner: shadow() });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("scanner_not_hunter");
  });

  it("rejects a Hunter who is no longer in play", () => {
    for (const status of ["spectator", "eliminated", "tagged"] as const) {
      const verdict = validateTagScan({ ...base, scanner: hunter({ status }) });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe("scanner_not_active");
    }
  });

  it("rejects a captured Shadow who chose to spectate", () => {
    const verdict = validateTagScan({
      ...base,
      scanner: shadow({
        mode: "spectator",
        status: "spectator",
        taggedAtMs: NOW - 1000,
      }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("scanner_not_hunter");
  });

  it("lets a captured Shadow who switched sides land a tag, but scores nothing", () => {
    const verdict = validateTagScan({
      ...base,
      scanner: shadow({
        id: "converted-1",
        mode: "hunter",
        status: "tagged",
        taggedAtMs: NOW - 60_000,
      }),
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.scores).toBe(false);
  });

  it("rejects a scan of a Hunter", () => {
    const verdict = validateTagScan({
      ...base,
      target: hunter({ id: "hunter-2" }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("target_not_shadow");
  });

  it("rejects scanning yourself", () => {
    const me = hunter();
    const verdict = validateTagScan({ ...base, scanner: me, target: me });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("self_scan");
  });

  it("rejects a Shadow scanning their own code before anything else", () => {
    const me = shadow();
    const verdict = validateTagScan({ ...base, scanner: me, target: me });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("scanner_not_hunter");
  });

  it("rejects an unknown QR token", () => {
    const verdict = validateTagScan({ ...base, target: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("unknown_target");
  });

  it("rejects a missing scanner", () => {
    const verdict = validateTagScan({ ...base, scanner: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("unknown_scanner");
  });
});

describe("tag scan — no scoring after being tagged", () => {
  it("refuses a Shadow who has already been tagged", () => {
    const verdict = validateTagScan({
      ...base,
      target: shadow({ status: "tagged", taggedAtMs: NOW - 500 }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("target_already_tagged");
  });

  it("refuses a Shadow who was already captured with spectator mode", () => {
    const verdict = validateTagScan({
      ...base,
      target: shadow({ status: "spectator", taggedAtMs: NOW - 500 }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("target_already_tagged");
  });

  it("refuses a Shadow removed from the match", () => {
    const verdict = validateTagScan({
      ...base,
      target: shadow({ status: "eliminated" }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("target_not_in_play");
  });
});

describe("tag scan — match state", () => {
  it("rejects before the match is running", () => {
    const verdict = validateTagScan({
      ...base,
      match: { ...base.match, status: "setup" },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("match_not_active");
  });

  it("rejects once the match has ended", () => {
    const verdict = validateTagScan({
      ...base,
      match: { ...base.match, status: "ended" },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("match_not_active");
  });

  it("rejects a match that never started", () => {
    const verdict = validateTagScan({
      ...base,
      match: { ...base.match, startedAtMs: null },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("match_not_active");
  });

  it("rejects a scan after the match timer has run out", () => {
    const verdict = validateTagScan({
      ...base,
      nowMs: base.match.endsAtMs! + 1,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("match_not_active");
  });

  it("accepts a scan on the final second of the match", () => {
    const verdict = validateTagScan({ ...base, nowMs: base.match.endsAtMs! });
    expect(verdict.ok).toBe(true);
  });
});
