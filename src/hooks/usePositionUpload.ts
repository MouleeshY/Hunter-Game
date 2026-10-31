import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { MatchConfig } from "@/rules/config";
import type { GpsFix, GpsStatus } from "./useGeolocation";

export interface UploadState {
  lastSentAt: number | null;
  lastError: string | null;
  breach: {
    status: "inside" | "grace" | "draining" | "eliminated";
    secondsOutside: number;
    graceSecondsLeft: number;
  } | null;
  flagged: boolean;
}

/**
 * Sends the current fix every `uploadIntervalSeconds` while the match is live.
 * The server also enforces the interval and the head start, so this is a
 * convenience, not the rule.
 */
export function usePositionUpload(args: {
  matchId: string | null;
  enabled: boolean;
  fix: GpsFix | null;
  gpsStatus: GpsStatus;
  config: MatchConfig;
  /** Bump this to force one upload right now (opening the QR screen). */
  pulse?: number;
}): UploadState {
  const { matchId, enabled, fix, gpsStatus, config, pulse = 0 } = args;
  const upload = useMutation(api.matches.uploadPosition);
  const [state, setState] = useState<UploadState>({
    lastSentAt: null,
    lastError: null,
    breach: null,
    flagged: false,
  });
  const uploading = useRef(false);
  const latestFix = useRef<GpsFix | null>(fix);
  latestFix.current = fix;

  useEffect(() => {
    if (!matchId || !enabled) return;

    let cancelled = false;
    const tick = async () => {
      const current = latestFix.current;
      if (!current || uploading.current) return;
      if (gpsStatus !== "live" && gpsStatus !== "weak") return;
      if (Date.now() - current.atMs > 15_000) return;

      uploading.current = true;
      try {
        const result = await upload({
          matchId: matchId as Id<"matches">,
          lat: current.lat,
          lng: current.lng,
          accuracyMetres: current.accuracy,
        });
        if (cancelled) return;
        setState((previous) => ({
          lastSentAt: result.stored ? Date.now() : previous.lastSentAt,
          lastError: result.stored
            ? null
            : result.reason === "not_started"
              ? "Waiting for the head start to end."
              : null,
          breach: result.breach
            ? {
                status: result.breach.status,
                secondsOutside: result.breach.secondsOutside,
                graceSecondsLeft: result.breach.graceSecondsLeft,
              }
            : previous.breach,
          flagged: result.flagged,
        }));
      } catch (cause) {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            lastError:
              cause instanceof Error ? cause.message : "Upload failed.",
          }));
        }
      } finally {
        uploading.current = false;
      }
    };

    void tick();
    const id = setInterval(() => void tick(), config.uploadIntervalSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [matchId, enabled, gpsStatus, upload, config.uploadIntervalSeconds, pulse]);

  return state;
}
