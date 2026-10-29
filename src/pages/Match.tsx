import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { GameMap, type MapMarkerInput } from "@/components/map/GameMap";
import { useGeolocation, useWakeLock } from "@/hooks/useGeolocation";
import { usePositionUpload } from "@/hooks/usePositionUpload";
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

  const gps = useGeolocation(RULES_CONFIG);
  const [simulate, setSimulate] = useState(false);
  const [simElapsed, setSimElapsed] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const devMode = simulatedGpsAvailable();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  const uploadState = usePositionUpload({
    matchId,
    enabled: live && fix !== null && (gpsStatus === "live" || gpsStatus === "weak"),
    fix,
    gpsStatus,
    config: RULES_CONFIG,
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

  const needPermission =
    !simulate && (gps.status === "idle" || gps.status === "requesting");
  const breach = uploadState.breach ?? view.me.breach;
  const secondsOutsideNow = breach
    ? breach.status === "inside"
      ? 0
      : breach.secondsOutside +
        (uploadState.lastSentAt ? (now - uploadState.lastSentAt) / 1000 : 0)
    : 0;
  const graceLeft = Math.max(
    0,
    Math.ceil(RULES_CONFIG.graceSeconds - secondsOutsideNow),
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
              Shadow Hunt · room {view.roomCode}
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
              {RULES_CONFIG.zoneShrinkIntervalMinutes} min steps
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
              {view.me.role === "hunter"
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

        {breach && breach.status !== "inside" && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="text-[11px] uppercase tracking-[0.2em]">
              Outside the zone
            </p>
            <p className="mt-1 text-[14px]">
              {breach.status === "grace"
                ? `Get back inside. Points start draining in ${graceLeft}s.`
                : breach.status === "draining"
                  ? `Draining ${RULES_CONFIG.drainPointsPerTick} points every ${RULES_CONFIG.drainIntervalSeconds}s. Out for ${Math.round(secondsOutsideNow)}s.`
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
              and invigilators can see you, and so Hunters get the 3-minute ping.
            </p>
            <ul className="mt-3 grid gap-1 text-[12px] text-muted-foreground">
              <li>· Positions are never public — only your match can see them.</li>
              <li>
                · Position history is deleted{" "}
                {RULES_CONFIG.positionRetentionHours} hours after the match ends.
                Scores are kept.
              </li>
              <li>
                · Readings worse than {RULES_CONFIG.maxGpsAccuracyMetres} m are
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
            {RULES_CONFIG.positionRetentionHours} hours after the end.
          </p>
        )}
      </main>
    </div>
  );
}
