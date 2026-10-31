import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { GameMap, type MapMarkerInput } from "@/components/map/GameMap";
import { QrCard } from "@/components/match/QrCard";
import { Scanner } from "@/components/match/Scanner";
import { ComplaintForm } from "@/components/match/ComplaintForm";
import { CaptureChoice } from "@/components/match/CaptureChoice";
import { useGeolocation, useWakeLock } from "@/hooks/useGeolocation";
import { usePositionUpload } from "@/hooks/usePositionUpload";
import { useServerClock } from "@/hooks/useServerClock";
import { RULES_CONFIG } from "@/rules/config";
import { simulatedFixAt, simulatedGpsAvailable } from "@/lib/simulatedGps";

function formatCountdown(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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
};

type Panel = "none" | "qr" | "scan" | "complaint";

export default function Match() {
  const { roomCode = "" } = useParams();
  const lobby = useQuery(
    api.rooms.lobby,
    roomCode ? { roomCode: roomCode.toUpperCase() } : "skip",
  );
  const matchId = lobby?.matchId ?? null;
  const view = useQuery(
    api.map.view,
    matchId ? { matchId: matchId as Id<"matches"> } : "skip",
  );
  const scan = useMutation(api.matches.submitTagScan);

  // The match's own config snapshot — never the default RULES_CONFIG.
  const config = view?.config ?? RULES_CONFIG;

  const gps = useGeolocation(config);
  const [simulate, setSimulate] = useState(false);
  const [simElapsed, setSimElapsed] = useState(0);
  const devMode = simulatedGpsAvailable();

  // Countdowns run on the server clock, never the phone's.
  const paused = view?.paused ?? false;
  const now = useServerClock({
    serverNowMs: view?.serverNowMs ?? null,
    paused,
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
  const live = view?.status === "live";

  useWakeLock(live);

  // Opening the QR screen bumps this so a fresh reading goes up immediately.
  const [uploadPulse, setUploadPulse] = useState(0);
  const [panel, setPanel] = useState<Panel>("none");
  const [scanResult, setScanResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  const uploadState = usePositionUpload({
    matchId,
    enabled: live && fix !== null && (gpsStatus === "live" || gpsStatus === "weak"),
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
          message: SCAN_COPY[result.code] ?? "That scan was refused.",
        });
      }
    } catch (cause) {
      setScanResult({
        ok: false,
        message: cause instanceof Error ? cause.message : "Scan failed.",
      });
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

  if (lobby === undefined || view === undefined) {
    return (
      <p className="px-4 py-16 text-center text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
        Loading the map…
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
        (uploadState.lastSentAt ? Math.max(0, (now - uploadState.lastSentAt) / 1000) : 0)
    : 0;
  const graceLeft = Math.max(
    0,
    Math.ceil(config.graceSeconds - secondsOutsideNow),
  );

  const markers: MapMarkerInput[] = view.markers.map((marker) => ({
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
  }));

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-8 text-foreground sm:px-6">
      <main className="mx-auto max-w-3xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Shadow Hunt · room {view.roomCode} · {me.callSign ?? "staff"}
            </p>
            <h1 className="mt-2 font-display text-3xl tracking-tight">
              {view.status === "headstart"
                ? "Head start"
                : view.status === "live"
                  ? "Match live"
                  : view.status === "ended"
                    ? "Match ended"
                    : "Play area"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
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

        {paused && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="text-[11px] uppercase tracking-[0.2em]">
              Match paused
            </p>
            <p className="mt-1 text-[14px]">
              {view.pauseReason ??
                "The clock, the zone and the drain are frozen for everyone."}
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-hairline p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Zone shrinks in
            </p>
            <p className="mt-1 font-display text-2xl">
              {formatCountdown(
                view.zone.nextShrinkAtMs === null
                  ? null
                  : view.zone.nextShrinkAtMs - now,
              )}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Radius {Math.round(view.zone.radiusMetres)} m ·{" "}
              {config.zoneShrinkIntervalMinutes} min steps
            </p>
          </div>
          <div className="rounded-xl border border-hairline p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Next radar ping
            </p>
            <p className="mt-1 font-display text-2xl">
              {formatCountdown(
                view.ping.nextPingAtMs === null
                  ? null
                  : view.ping.nextPingAtMs - now,
              )}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {me.role === "hunter"
                ? "Shadows show as ping ghosts"
                : view.me.isInvigilator
                  ? "Invigilator view: everyone live"
                  : "Shadows: teammates live, Hunters hidden"}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <GameMap
            centre={{ lat: view.zone.centreLat, lng: view.zone.centreLng }}
            radiusMetres={view.zone.radiusMetres}
            markers={markers}
            pulseKey={pulseKey}
            className="h-[420px]"
          />
        </div>

        {/* ---- Capture choice ------------------------------------------------ */}
        {live && needsCaptureChoice && panel === "none" && (
          <div className="mt-4">
            <CaptureChoice
              matchId={matchId!}
              defaultMode={me.mode ?? "spectator"}
              onChosen={() => setScanResult(null)}
            />
          </div>
        )}

        {/* ---- Play actions -------------------------------------------------- */}
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
              matchId={matchId}
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
              Outside the zone
            </p>
            <p className="mt-1 text-[14px]">
              {breach.status === "grace"
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
            This phone's position was flagged by the server (impossible jump or
            accuracy). It will not count for tags.
          </p>
        )}

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
              Shadow Hunt needs your location while a match is live so teammates
              and invigilators can see you, and so Hunters get the{" "}
              {config.pingIntervalMinutes}-minute ping.
            </p>
            <ul className="mt-3 grid gap-1 text-[12px] text-muted-foreground">
              <li>· Positions are never public — only your match can see them.</li>
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

        {view.status === "headstart" && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Pings begin when the head start ends. Uploads start then too.
          </p>
        )}

        {view.status === "ended" && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Match ended. Position history is deleted{" "}
            {config.positionRetentionHours} hours after the end.
          </p>
        )}
      </main>
    </div>
  );
}
