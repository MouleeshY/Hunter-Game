import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { GameMap, type MapMarkerInput } from "@/components/map/GameMap";
import { QrCard } from "@/components/match/QrCard";
import { Scanner } from "@/components/match/Scanner";
import { ComplaintForm } from "@/components/match/ComplaintForm";
import { CaptureChoice } from "@/components/match/CaptureChoice";
import { AlertBar } from "@/components/match/AlertBar";
import { Briefing } from "@/components/match/Briefing";
import { EventFeed } from "@/components/match/EventFeed";
import { MatchEnded } from "@/components/match/MatchEnded";
import { MatchHud } from "@/components/match/MatchHud";
import { SetupPanel } from "@/components/match/SetupPanel";
import { StaffPanel } from "@/components/console/StaffPanel";
import { useConnection } from "@/hooks/useConnection";
import { useMatchAlerts } from "@/hooks/useMatchAlerts";
import { useGeolocation, useWakeLock } from "@/hooks/useGeolocation";
import { usePositionUpload } from "@/hooks/usePositionUpload";
import { useServerClock } from "@/hooks/useServerClock";
import { RULES_CONFIG } from "@/rules/config";
import { simulatedFixAt, simulatedGpsAvailable } from "@/lib/simulatedGps";

const GPS_LABEL: Record<string, string> = {
  idle: "GPS off",
  requesting: "Finding GPS…",
  live: "GPS live",
  weak: "GPS weak",
  lost: "GPS lost",
  denied: "GPS blocked",
  unsupported: "No GPS",
};

const GPS_CLASS: Record<string, string> = {
  idle: "bg-muted text-muted-foreground",
  requesting: "bg-muted text-muted-foreground",
  live: "bg-foreground text-background",
  weak: "bg-amber-100 text-amber-900",
  lost: "bg-destructive/10 text-destructive",
  denied: "bg-destructive/10 text-destructive",
  unsupported: "bg-destructive/10 text-destructive",
};

/** What the server said about a scan, in the words a Hunter needs. */
const SCAN_COPY: Record<string, string> = {
  too_far: "Too far apart to tag — get closer and try again.",
  stale_location:
    "Location too old — one of you has not updated in the last 30 seconds.",
  flagged_location:
    "One of the two positions was flagged as impossible, so the tag does not count.",
  missing_location: "No recent position for one of you. Wait for a fix.",
  target_already_tagged: "Already tagged — that Shadow is out of the game.",
  target_not_in_play: "That Shadow is no longer in play.",
  target_not_shadow: "That code is not a Shadow.",
  self_scan: "That is your own code.",
  unknown_target: "That code is not in this match.",
  scanner_not_hunter: "Only Hunters can scan codes.",
  scanner_not_active: "You are not in play.",
  match_not_active: "The match is not running right now.",
  match_paused: "The match is paused — tags open again when it resumes.",
};

type Panel = "none" | "qr" | "scan" | "complaint";

export default function Match() {
  const { roomCode = "" } = useParams();
  const navigate = useNavigate();
  const lobby = useQuery(
    api.rooms.lobby,
    roomCode ? { roomCode: roomCode.toUpperCase() } : "skip",
  );
  const matchId = lobby?.matchId ?? null;
  const view = useQuery(
    api.map.view,
    matchId ? { matchId: matchId as Id<"matches"> } : "skip",
  );
  const feed = useQuery(
    api.events.feed,
    matchId ? { matchId: matchId as Id<"matches"> } : "skip",
  );
  const scan = useMutation(api.matches.submitTagScan);
  const sendHelp = useMutation(api.events.help);

  // The match's own config snapshot — never the default RULES_CONFIG.
  const config = view?.config ?? RULES_CONFIG;

  const gps = useGeolocation(config);
  const [simulate, setSimulate] = useState(false);
  const [simElapsed, setSimElapsed] = useState(0);
  const devMode = simulatedGpsAvailable();

  const status = view?.status ?? null;
  const paused = view?.paused ?? false;
  const ended = status === "ended";
  const setupActive = status === "setup";
  const live = status === "live";

  // Stage 6: the frozen end screen's own numbers (points breakdown, rank, who
  // caught whom). Loaded only once the whistle has gone.
  const myResult = useQuery(
    api.results.mine,
    ended && matchId ? { matchId: matchId as Id<"matches"> } : "skip",
  );

  // Countdowns run on the server clock, never the phone's.
  const now = useServerClock({
    serverNowMs: view?.serverNowMs ?? null,
    paused,
  });

  // Anything arriving from the server counts as a heartbeat for reconnecting.
  const connection = useConnection({ heartbeat: lobby?.serverNowMs ?? null });

  const serverBreach = view?.me.breach ?? null;
  const alerts = useMatchAlerts({
    status,
    paused,
    playerStatus: lobby?.me.status ?? null,
    outside: serverBreach !== null && serverBreach.status !== "inside",
    lastPingAtMs: view?.ping.lastPingAtMs ?? null,
    msToShrink:
      view?.zone.nextShrinkAtMs === null || view?.zone.nextShrinkAtMs === undefined
        ? null
        : view.zone.nextShrinkAtMs - now,
    shrinkWarningMs: config.shrinkWarningSeconds * 1000,
    detection: feed?.alerts ?? [],
  });

  useEffect(() => {
    if (!simulate) return;
    const started = Date.now();
    const id = setInterval(() => setSimElapsed(Date.now() - started), 1000);
    return () => clearInterval(id);
  }, [simulate]);

  const simFix = useMemo(() => {
    if (!view) return null;
    return simulatedFixAt({
      centre: { lat: view.zone.centreLat, lng: view.zone.centreLng },
      radiusMetres: view.zone.radiusMetres,
      elapsedMs: simElapsed,
    });
  }, [view, simElapsed]);

  const fix = simulate ? simFix : gps.fix;
  const gpsStatus = simulate ? "live" : gps.status;

  // The screen stays awake only while there is something to watch.
  useWakeLock(live || setupActive);

  // Opening the QR screen bumps this so a fresh reading goes up immediately.
  const [uploadPulse, setUploadPulse] = useState(0);
  const [panelChoice, setPanelChoice] = useState<Panel>("none");
  // Stage 5, task 7: an ended match shows the frozen result, never a panel.
  const panel: Panel = ended ? "none" : panelChoice;
  const setPanel = setPanelChoice;
  const [scanResult, setScanResult] = useState<
    { ok: boolean; message: string } | null
  >(null);
  const [helpState, setHelpState] = useState<string | null>(null);

  // Stage 5, task 7: an ended match stops uploads, GPS and the wake lock.
  // The panel closes through the derived value above, not through an effect.
  useEffect(() => {
    if (!ended) return;
    gps.stop();
  }, [ended, gps]);

  const uploadState = usePositionUpload({
    matchId,
    enabled:
      (live || setupActive) && fix !== null && (gpsStatus === "live" || gpsStatus === "weak"),
    fix,
    gpsStatus,
    config,
    pulse: uploadPulse,
  });

  // Ping pulse: fire when the server's last ping advances.
  const lastPing = view?.ping.lastPingAtMs ?? null;
  const previousPing = useRef<number | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (lastPing === null) return;
    if (previousPing.current !== null && lastPing !== previousPing.current) {
      setPulseKey((key) => key + 1);
    }
    previousPing.current = lastPing;
  }, [lastPing]);

  const submitScan = async (token: string) => {
    if (!matchId || !fix) {
      setScanResult({
        ok: false,
        message: "No GPS fix yet — wait for a lock, then try again.",
      });
      return;
    }
    try {
      const result = await scan({
        matchId: matchId as Id<"matches">,
        scannedToken: token,
        scannerLat: fix.lat,
        scannerLng: fix.lng,
        scannerAccuracyMetres: fix.accuracy,
      });
      if (result.ok) {
        setScanResult({
          ok: true,
          message: `Tagged ${Math.round(result.distanceMetres ?? 0)} m away · +${result.points} points${
            result.matchEnded ? " · match over" : ""
          }`,
        });
        setPanel("none");
      } else {
        setScanResult({
          ok: false,
          message: SCAN_COPY[result.code ?? ""] ?? "That scan was refused.",
        });
      }
    } catch (cause) {
      setScanResult({
        ok: false,
        message: cause instanceof Error ? cause.message : "Scan failed.",
      });
    }
  };

  const askForHelp = async () => {
    if (!matchId) return;
    setHelpState(null);
    try {
      await sendHelp({
        matchId: matchId as Id<"matches">,
        lat: fix?.lat,
        lng: fix?.lng,
        accuracyMetres: fix?.accuracy,
      });
      setHelpState("Sent. Every invigilator can see your last position.");
    } catch (cause) {
      setHelpState(
        cause instanceof Error ? cause.message : "Could not send that.",
      );
    }
  };

  if (!roomCode) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-[13px] text-muted-foreground">No room selected.</p>
        <Button asChild className="mt-6">
          <Link to="/play">Back to rooms</Link>
        </Button>
      </main>
    );
  }

  if (lobby === undefined || view === undefined || feed === undefined) {
    return (
      <p className="px-4 py-16 text-center text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
        Loading the match…
      </p>
    );
  }

  if (lobby === null || view === null) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-[13px] text-muted-foreground">
          That match is not available to you.
        </p>
        <Button asChild className="mt-6">
          <Link to="/play">Back to rooms</Link>
        </Button>
      </main>
    );
  }

  const me = lobby.me;
  const needsBriefing = me.briefedAt === null && me.playerId !== null;
  const iAmActiveShadow = me.role === "shadow" && me.status === "active";
  const iCanScan =
    (me.role === "hunter" && me.status === "active") ||
    (me.mode === "hunter" && me.status === "tagged");
  const iCanComplain = me.role === "hunter" && me.status === "active";
  const needsCaptureChoice =
    me.role === "shadow" &&
    me.status === "tagged" &&
    me.captureChosenAt === null;

  const needPermission =
    !simulate && (gps.status === "idle" || gps.status === "requesting");
  const breach = uploadState.breach ?? view.me.breach;
  const secondsOutsideNow = breach
    ? breach.status === "inside"
      ? 0
      : breach.secondsOutside +
        (uploadState.lastSentAt
          ? Math.max(0, (now - uploadState.lastSentAt) / 1000)
          : 0)
    : 0;
  const graceLeft = Math.max(
    0,
    Math.ceil(config.graceSeconds - secondsOutsideNow),
  );

  const markers: MapMarkerInput[] = view.markers.map(
    (marker: (typeof view.markers)[number]) => ({
      id: marker.playerId,
      lat: marker.lat,
      lng: marker.lng,
    kind: marker.kind,
      label:
        marker.kind === "ping"
          ? `${marker.callSign} · ${Math.max(1, Math.round(marker.ageMs / 60_000))}m ago`
          : marker.callSign,
      ageMs: marker.ageMs,
      accuracyMetres: marker.accuracyMetres,
    }),
  );

  const detectionOff =
    !config.proximityDetectionEnabled
      ? "Proximity alerts are switched off for this match."
      : live && view.zone.radiusMetres < config.detectionMinZoneRadiusMetres
        ? `Proximity alerts are off below a ${config.detectionMinZoneRadiusMetres} m zone.`
        : null;

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-8 text-foreground sm:px-6">
      <main className="mx-auto max-w-3xl">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Shadow Hunt · room {view.roomCode} · {me.callSign ?? "staff"}
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">
              {status === "headstart"
                ? "Head start"
                : status === "live"
                  ? "Match live"
                  : status === "setup"
                    ? "Setup"
                    : status === "ended"
                      ? "Match ended"
                      : "Play area"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {connection.reconnecting && (
              <span className="rounded-full bg-amber-500 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-black">
                Reconnecting
              </span>
            )}
            <span
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${GPS_CLASS[gpsStatus] ?? GPS_CLASS.idle}`}
            >
              {GPS_LABEL[gpsStatus] ?? gpsStatus}
            </span>
            <Button asChild variant="outline" className="h-9">
              <Link to="/play">Rooms</Link>
            </Button>
          </div>
        </header>

        <AlertBar
          banners={alerts.banners}
          mute={alerts.mute}
          onToggleMute={alerts.toggleMute}
          onDismiss={alerts.dismiss}
        />

        {connection.reconnecting && (
          <div className="mb-4 rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950">
            <p className="text-[15px] font-semibold">Reconnecting…</p>
            <p className="mt-1 text-[13px]">
              Your last position is kept. Uploads resume on their own as soon as
              the signal is back.
            </p>
          </div>
        )}

        {/* ---- Frozen end state ------------------------------------------- */}
        {ended ? (
          <MatchEnded
            view={view}
            result={myResult ?? null}
            onBack={() => navigate("/play")}
          />
        ) : (
          <>
            {needsBriefing && (
              <div className="mb-4">
                <Briefing
                  matchId={matchId as Id<"matches"> | null}
                  confirmedAt={me.briefedAt}
                />
              </div>
            )}

            <MatchHud view={view} nowMs={now} />

            {setupActive && (
              <div className="mt-4">
                <SetupPanel
                  view={view}
                  matchId={matchId as Id<"matches">}
                  nowMs={now}
                />
              </div>
            )}

            {view.staff && <div className="mt-4"><StaffPanel view={view} nowMs={now} /></div>}

            {detectionOff && (
              <p className="mt-3 text-[12px] text-muted-foreground">
                {detectionOff}
              </p>
            )}

            {paused && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                <p className="text-[11px] uppercase tracking-[0.2em]">
                  Match paused
                </p>
                <p className="mt-1 text-[14px]">
                  {view.pauseReason ??
                    "The clock, the zone and the drain are frozen for everyone."}
                </p>
                <p className="mt-1 text-[13px]">
                  Tags and complaints open again when it resumes.
                </p>
              </div>
            )}

            <div className="mt-4">
              <GameMap
                centre={{ lat: view.zone.centreLat, lng: view.zone.centreLng }}
                radiusMetres={view.zone.radiusMetres}
                markers={markers}
                pulseKey={pulseKey}
                className="h-[420px]"
              />
            </div>

            {/* ---- Capture choice ----------------------------------------- */}
            {live && needsCaptureChoice && panel === "none" && (
              <div className="mt-4">
                <CaptureChoice
                  matchId={matchId as Id<"matches">}
                  defaultMode={me.mode ?? "spectator"}
                  onChosen={() => setScanResult(null)}
                />
              </div>
            )}

            {/* ---- Play actions -------------------------------------------- */}
            {live && panel === "none" && (
              <div className="mt-4 flex flex-wrap gap-3">
                {iAmActiveShadow && (
                  <Button
                    size="lg"
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() => setPanel("qr")}
                  >
                    I'm caught — show my code
                  </Button>
                )}
                {iCanScan && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() => {
                      setScanResult(null);
                      setPanel("scan");
                    }}
                  >
                    Scan a code
                  </Button>
                )}
                {iCanComplain && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() => setPanel("complaint")}
                  >
                    Shadow won't show code
                  </Button>
                )}
              </div>
            )}

            {scanResult && panel === "none" && (
              <p
                className={`mt-3 text-[13px] ${
                  scanResult.ok ? "text-foreground" : "text-destructive"
                }`}
              >
                {scanResult.ok ? "✓ " : "✕ "}
                {scanResult.message}
              </p>
            )}

            {panel === "qr" && me.qrToken && (
              <div className="mt-4">
                <QrCard
                  token={me.qrToken}
                  callSign={me.callSign}
                  proximityMetres={config.tagProximityMetres}
                  devMode={devMode}
                  onOpened={() => setUploadPulse((value) => value + 1)}
                  onClose={() => setPanel("none")}
                />
              </div>
            )}

            {panel === "scan" && (
              <div className="mt-4">
                <Scanner
                  devMode={devMode}
                  onScan={(token) => void submitScan(token)}
                  onClose={() => setPanel("none")}
                />
              </div>
            )}

            {panel === "complaint" && matchId && (
              <div className="mt-4">
                <ComplaintForm
                  matchId={matchId as Id<"matches">}
                  onClose={() => setPanel("none")}
                  onFiled={() => {
                    setPanel("none");
                    setScanResult({
                      ok: true,
                      message:
                        "Complaint filed. Every invigilator has been notified.",
                    });
                  }}
                />
              </div>
            )}

            {breach && breach.status !== "inside" && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                <p className="text-[11px] uppercase tracking-[0.2em]">
                  {setupActive ? "Outside the area" : "Outside the zone"}
                </p>
                <p className="mt-1 text-[14px]">
                  {setupActive
                    ? "Move back inside the play area before the setup ends."
                    : breach.status === "grace"
                      ? `Get back inside. Points start draining in ${graceLeft}s.`
                      : breach.status === "draining"
                        ? `Draining ${config.drainPointsPerTick} points every ${config.drainIntervalSeconds}s. Out for ${Math.round(secondsOutsideNow)}s.`
                        : "Eliminated: you spent too long outside the zone."}
                </p>
              </div>
            )}

            {uploadState.lastError && (
              <p className="mt-3 text-[12px] text-muted-foreground">
                {uploadState.lastError}
              </p>
            )}
            {uploadState.flagged && (
              <p className="mt-3 text-[12px] text-destructive">
                This phone's position was flagged by the server (impossible jump
                or accuracy). It will not count for tags.
              </p>
            )}

            <div className="mt-4">
              <EventFeed items={feed.items} ended={feed.ended} />
            </div>

            {/* ---- Safety --------------------------------------------------- */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 border-destructive uppercase tracking-[0.18em] text-destructive hover:text-destructive"
                onClick={() => void askForHelp()}
              >
                I need help
              </Button>
              {helpState && (
                <p className="text-[13px] text-muted-foreground">{helpState}</p>
              )}
            </div>

            {devMode && (
              <label className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={simulate}
                  onChange={(event) => {
                    setSimulate(event.target.checked);
                    setSimElapsed(0);
                  }}
                />
                Simulated GPS (development only) — replays a scripted walk
              </label>
            )}

            {needPermission && (
              <div className="mt-6 rounded-xl border border-hairline p-6">
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  Location permission
                </p>
                <p className="mt-3 text-[14px]">
                  Shadow Hunt needs your location while a match is running so
                  teammates and invigilators can see you, so the setup spacing
                  can be checked, and so Hunters get the{" "}
                  {config.pingIntervalMinutes}-minute ping.
                </p>
                <ul className="mt-3 grid gap-1 text-[12px] text-muted-foreground">
                  <li>· Positions are never public — only your match sees them.</li>
                  <li>
                    · Position history is deleted {config.positionRetentionHours}{" "}
                    hours after the match ends. Scores are kept.
                  </li>
                  <li>
                    · Readings worse than {config.maxGpsAccuracyMetres} m are
                    ignored.
                  </li>
                </ul>
                <Button
                  className="mt-5 h-11 uppercase tracking-[0.18em]"
                  onClick={gps.request}
                >
                  Enable location
                </Button>
              </div>
            )}

            {!simulate && gps.status === "denied" && (
              <div className="mt-4 rounded-xl border border-hairline p-4">
                <p className="text-[13px]">
                  Location is blocked. Enable it for this site in your browser
                  settings, then try again.
                </p>
                <Button variant="outline" className="mt-3" onClick={gps.request}>
                  Try again
                </Button>
              </div>
            )}

            {!simulate && gps.status === "lost" && (
              <p className="mt-4 text-[13px] text-amber-800">
                GPS signal lost. Move into the open and keep the app open; uploads
                resume automatically.
              </p>
            )}

            {status === "headstart" && (
              <p className="mt-4 text-[13px] text-muted-foreground">
                The head start is running: nobody's position is uploaded or
                revealed until it ends.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
