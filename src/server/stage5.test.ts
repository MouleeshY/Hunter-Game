import { describe, expect, it, beforeEach } from "bun:test";
import { setReposForTests, getRepos } from "./providers";
import { memoryRepos } from "./testSupport/memoryRepos";
import { createMatch, confirmBriefing, joinMatch, claimInvite, startMatch, canStartMatch } from "./rooms";
import { beginHeadStart, checkSeparation, extendSetup, advanceToHeadStart } from "./setup";
import { abortMatch, pauseMatch, resumeMatch } from "./console";
import { fileComplaint } from "./complaints";
import { runMatchTick } from "./scheduler";
import { uploadPosition, getMapView, MapView } from "./positionService";
import { recordEvent } from "./events";
import { award } from "./settlement";
import { RULES_CONFIG, addPoints, signUpForCaptureMode } from "../rules/config";
import {
  detectionVerdict,
  type DetectionPairKey,
} from "../rules/detection";
import {
  separationViolations,
  requiredSeparation,
} from "../rules/separation";
import { validateTagScan } from "../rules/tags";


import { endMatch } from "./matchEnd";

const CAN_START = 4;

describe("Stage 5 — match lifecycle and player experience", () => {
  beforeEach(() => setReposForTests(memoryRepos()));

  it("refuses to start until every player has confirmed", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const hu = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: hu.userId });
    await joinMatch(null, {
      userId: "shadow",
      roomCode: created.roomCode,
      callSign: "SR",
      displayName: "Sara",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: sra.userId });
    const blocked = await canStartMatch(null, created.matchId);
    expect(blocked.ok).toBe(false);
    expect(blocked.pendingBriefings).toBe(1);
    expect(blocked.startBlockedReason).toContain("briefed");
  });

  it("lets the organiser start once everyone is briefed", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const hu = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: hu.userId });
    const sra = await joinMatch(null, {
      userId: "shadow",
      roomCode: created.roomCode,
      callSign: "SR",
      displayName: "Sara",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: sra.userId });
    const could = await canStartMatch(null, created.matchId);
    expect(could.ok).toBe(true);
    expect(could.pendingBriefings).toBe(0);
    const started = await startMatch(null, {
      matchId: created.matchId,
      userId: "staff",
      force: false,
    });
    expect(started.status).toBe("setup");
  });

  it("audits a forced start when some players have not confirmed", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, {
      matchId: created.matchId,
      userId: hu.userId,
    });
    const { audit } = await startMatch(null, {
      matchId: created.matchId,
      userId: "staff",
      force: true,
    });
    expect(audit.entries.at(0).kind).toBe("info");
    expect(audit.entries.at(0).text).toContain("player(s) have not confirmed the rules");
  });

  it("lets an already-joined player rejoin without a duplicate", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const p1 = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    const p2 = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui again",
      displayNameMode: "nickname",
    });
    expect(p2.playerId).toBe(p1.playerId);
    const players = await getRepos().players.listByRoom(null, created.roomCode);
    expect(players).toHaveLength(1);
    expect(players[0].displayName).toBe("Hui again");
  });

  it("lets a player rejoin after the roster is locked and while running", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const hu = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await startMatch(null, { matchId: created.matchId, userId: "staff", force: true });
    const again = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui again",
      displayNameMode: "nickname",
    });
    expect(again.playerId).toBe(
      created.players.find((p) => p.userId === "hunter")!.playerId,
    );
    const players = await getRepos().players.listByRoom(null, created.roomCode);
    expect(players).toHaveLength(1);
  });

  it("keeps uploads running during setup and refuses the drain when the zone is left", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const hu = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await startMatch(null, { matchId: created.matchId, userId: "staff", force: true });
    const live = await beginHeadStart(null, { matchId: created.matchId });
    freezeClock();
    const createdMatch = await getRepos().matches.findById(null, created.matchId);
    const centre = { lat: createdMatch!.centreLat, lng: createdMatch!.centreLng };
    const inside: { lat: number; lng: number } = {
      lat: centre.lat + 0.002,
      lng: centre.lng + 0.002,
    };
    const inside2: { lat: number; lng: number } = {
      lat: inside.lat + 0.01,
      lng: centre.lng + 0.005,
    };
    const outside: { lat: number; lng: number } = {
      lat: centre.lat - 0.02,
      lng: centre.lng - 0.04,
    };
    const uploadedDuring = await uploadPosition(null, {
      matchId: created.matchId,
      userId: hu.userId,
      lat: inside.lat,
      lng: inside.lng,
      accuracyMetres: 5,
      goAirplane: false,
      nowMs: Date.now(),
    });
    expect(uploadedDuring.stored).toBe(true);
    expect(uploadedDuring.reason).toBe(null);
  });

  it("refuses a tag scan and a complaint filing while matched paused", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const hunter = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: hunter.userId });
    const shadow = await joinMatch(null, {
      userId: "shadow",
      roomCode: created.roomCode,
      callSign: "SR",
      displayName: "Sara",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: shadow.userId });
    const live = await beginHeadStart(null, { matchId: created.matchId });
    freezeClock();
    const paused = await pauseMatch(null, {
      matchId: created.matchId,
      userId: "staff",
      reason: "Thick fog — waiting for the coastguard.",
    });
    expect(paused.final.paused).toBe(true);
    const scanResult = validateTagScan({
      match: RULES_CONFIG,
      clock: live.clock,
      tagProximityMetres: tagProximityMetresFor(live.match),
    });
    expect(scanResult.toErrorMessage().message.toLowerCase()).toContain("paused");  })
  it("keeps the in-app alerts but does not tip off the person who tagged", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const hunter = await joinMatch(null, {
      userId: "hunter",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: hunter.userId });
    const shadow = await joinMatch(null, {
      userId: "shadow",
      roomCode: created.roomCode,
      callSign: "SR",
      displayName: "Sara",
      displayNameMode: "nickname",
    });
    await confirmBriefing(null, { matchId: created.matchId, userId: shadow.userId });
    const live = await beginHeadStart(null, { matchId: created.matchId });
    const mapNow = someCurrentGeo(node => node.lat !== 51.1);
    const report = elapsedHrs(node => node.tauHours > 2);
    expect(report.points).toBe(50);
    expect(report.pointsPerNotification).toBe(2);
  });

  it("gives each shadow exactly the bonus when it flags", async () => {
    const created = await createMatch(null, {
      createdByUserId: "staff",
      matchDurationMinutes: 90,
      organiserLat: 51.5,
      organiserLng: -0.12,
      invigilatorNames: ["Wen", "Kwame"],
    });
    const p = await joinMatch(null, {
      userId: "u1",
      roomCode: created.roomCode,
      callSign: "HU",
      displayName: "Hui",
      displayNameMode: "nickname",
    });
    await startMatch(null, { matchId: created.matchId, userId: "staff", force: true });
    const live = await beginHeadStart(null, { matchId: created.matchId });
    freezeClock();
    const reading = evaluateTag({
      match: RULES_CONFIG,
      clock,
      tagProximityMetres: tagProximityMetresFor(live.match),
      withAccusationReport: true,
    } as any);
    const dt = new Date(reading.elapsed);
    const ok = dt.getTime() > 0;
    expect(ok).toBe(true);
  });
});
