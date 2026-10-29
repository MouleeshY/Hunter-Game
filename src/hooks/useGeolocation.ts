import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchConfig } from "@/rules/config";

export type GpsStatus =
  | "idle"
  | "requesting"
  | "live"
  | "weak"
  | "lost"
  | "denied"
  | "unsupported";

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
  atMs: number;
}

/**
 * Phone GPS.
 *
 * Nothing is requested until `request()` is called, so the permission screen
 * always comes first. Readings worse than `maxGpsAccuracyMetres` are ignored,
 * and accepted readings are lightly smoothed.
 */
export function useGeolocation(config: MatchConfig) {
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [fix, setFix] = useState<GpsFix | null>(null);
  const watchId = useRef<number | null>(null);
  const lastGoodAt = useRef<number>(0);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    if (watchId.current !== null) return;

    setStatus("requesting");
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(accuracy) || accuracy > config.maxGpsAccuracyMetres) {
          setStatus("weak");
          return;
        }
        const atMs = position.timestamp || Date.now();
        lastGoodAt.current = Date.now();
        setFix((previous) => {
          if (!previous) return { lat: latitude, lng: longitude, accuracy, atMs };
          const weight = 0.35;
          return {
            lat: previous.lat + (latitude - previous.lat) * weight,
            lng: previous.lng + (longitude - previous.lng) * weight,
            accuracy,
            atMs,
          };
        });
        setStatus("live");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setStatus("denied");
        else setStatus("lost");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      },
    );
  }, [config.maxGpsAccuracyMetres]);

  // Forget the fix if the phone stops reporting for a while.
  useEffect(() => {
    const id = setInterval(() => {
      if (watchId.current === null) return;
      if (lastGoodAt.current === 0) return;
      const silence = Date.now() - lastGoodAt.current;
      if (silence > 20_000) {
        setStatus((current) => (current === "denied" ? current : "lost"));
      } else if (silence > 8_000) {
        setStatus((current) =>
          current === "denied" || current === "lost" ? current : "weak",
        );
      }
    }, 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => stop, [stop]);

  return { status, fix, request, stop };
}

/** Keep the screen awake while the match is live, and after tab switches. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    type Sentry = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<Sentry> };
    };
    if (!nav.wakeLock) return;

    let sentry: Sentry | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentry = await nav.wakeLock!.request("screen");
      } catch {
        // Denied or unsupported: the match still works, the screen may dim.
      }
    };

    const release = () => {
      void sentry?.release().catch(() => undefined);
      sentry = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
      else release();
    };

    if (enabled) void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled]);
}
