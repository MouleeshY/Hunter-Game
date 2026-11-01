import { useCallback, useEffect, useRef, useState } from "react";
import { RULES_CONFIG } from "@/rules/config";

/**
 * In-app alerts (Stage 5, task 4): a banner, a buzz and a short tone for
 * everything that matters during a match.
 *
 * No operating-system notifications are used — they would do nothing once the
 * app is closed, which is exactly when a player is not looking at their phone.
 * The mute toggle is remembered on the device.
 */

export type AlertTone = "info" | "good" | "warn" | "danger";

export interface AlertBanner {
  id: string;
  tone: AlertTone;
  text: string;
  at: number;
}

const MUTE_KEY = "shadow-hunt:muted";

let audioContext: AudioContext | null = null;

function toneOf(tone: AlertTone): number {
  if (tone === "danger") return 920;
  if (tone === "warn") return 740;
  if (tone === "good") return 560;
  return 480;
}

/** A short, quiet blip. Never throws: audio is a bonus, not a requirement. */
function playTone(tone: AlertTone): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    const ctx = audioContext;
    if (ctx.state === "suspended") void ctx.resume();

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = toneOf(tone);
    const start = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.45);
  } catch {
    // Blocked autoplay or no audio device: the banner still shows.
  }
}

function vibrate(): void {
  try {
    navigator.vibrate?.([90, 50, 90]);
  } catch {
    // Some browsers throw on a denied vibration permission.
  }
}

/** The bits of the last payload an alert is derived from. */
interface AlertSnapshot {
  status: string | null;
  paused: boolean;
  playerStatus: string | null;
  outside: boolean;
  lastPingAtMs: number | null;
}

export interface MatchAlertInput {
  /** setup | headstart | live | ended | lobby | locked | null while loading */
  status: string | null;
  paused: boolean;
  playerStatus: string | null;
  outside: boolean;
  lastPingAtMs: number | null;
  /** Milliseconds until the next shrink, or null. */
  msToShrink: number | null;
  shrinkWarningMs: number;
  /** Proximity alerts addressed to this player, from the feed. */
  detection: { id: string; from: "hunter" | "shadow"; band: string }[];
}

export function useMatchAlerts(input: MatchAlertInput): {
  banners: AlertBanner[];
  mute: boolean;
  toggleMute: () => void;
  dismiss: (id: string) => void;
} {
  const [mute, setMute] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [banners, setBanners] = useState<AlertBanner[]>([]);
  const seen = useRef<Set<string>>(new Set());

  const push = useCallback(
    (key: string, text: string, tone: AlertTone) => {
      if (seen.current.has(key)) return;
      seen.current.add(key);
      setBanners((current) =>
        [{ id: key, tone, text, at: Date.now() }, ...current].slice(0, 5),
      );
      if (!mute) {
        playTone(tone);
        vibrate();
      }
    },
    [mute],
  );

  const toggleMute = useCallback(() => {
    setMute((current) => {
      const next = !current;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // Private browsing: the toggle still works for this session.
      }
      return next;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setBanners((current) => current.filter((banner) => banner.id !== id));
    seen.current.delete(id);
  }, []);

  // Everything below compares the payload with the one before it. The snapshot
  // lives in a ref that is only ever read and written inside effects, so no
  // state is written during render.
  const previous = useRef<AlertSnapshot | null>(null);

  useEffect(() => {
    const last = previous.current;
    previous.current = {
      status: input.status,
      paused: input.paused,
      playerStatus: input.playerStatus,
      outside: input.outside,
      lastPingAtMs: input.lastPingAtMs,
    };
    // First payload after opening the screen: remember where things stand
    // instead of buzzing about something that already happened.
    if (last === null) return;

    // ---- phase -----------------------------------------------------------
    if (last.status !== input.status) {
      if (input.status === "live" && last.status === "headstart") {
        push("phase:live", "The head start is over — the match is live.", "good");
      }
      if (input.status === "ended") {
        push("phase:ended", "Match over.", "info");
      }
      if (input.status === "headstart" && last.status === "setup") {
        push(
          "phase:headstart",
          "Setup finished — the head start has begun.",
          "info",
        );
      }
    }

    // ---- pause / resume --------------------------------------------------
    if (last.paused !== input.paused) {
      if (input.paused) {
        push("pause", "Match paused. The clock is frozen for everyone.", "warn");
      } else {
        push("resume", "The match is running again.", "good");
      }
    }

    // ---- being tagged ----------------------------------------------------
    if (last.playerStatus !== input.playerStatus) {
      if (
        last.playerStatus === "active" &&
        (input.playerStatus === "tagged" || input.playerStatus === "spectator")
      ) {
        push("tagged", "You have been tagged.", "danger");
      }
      if (
        input.playerStatus === "eliminated" &&
        last.playerStatus === "active"
      ) {
        push("eliminated", "You are out: too long outside the area.", "danger");
      }
    }

    // ---- leaving the zone ------------------------------------------------
    if (last.outside !== input.outside && input.outside) {
      push("outside", "You have left the play area — get back inside.", "warn");
    }

    // ---- each ping -------------------------------------------------------
    if (
      last.lastPingAtMs !== null &&
      input.lastPingAtMs !== null &&
      input.lastPingAtMs !== last.lastPingAtMs
    ) {
      push("ping", "Radar ping: positions have updated.", "info");
    }
  }, [
    input.status,
    input.paused,
    input.playerStatus,
    input.outside,
    input.lastPingAtMs,
    push,
  ]);

  // ---- 30 seconds before a shrink ---------------------------------------
  const shrinkWarned = useRef(false);
  useEffect(() => {
    const ms = input.msToShrink;
    if (ms === null) {
      shrinkWarned.current = false;
      return;
    }
    if (ms > input.shrinkWarningMs) {
      shrinkWarned.current = false;
      return;
    }
    if (shrinkWarned.current) return;
    shrinkWarned.current = true;
    push("shrink", "The play area shrinks in 30 seconds.", "warn");
  }, [input.msToShrink, input.shrinkWarningMs, push]);

  // ---- proximity detection ----------------------------------------------
  const primed = useRef(false);
  useEffect(() => {
    if (!primed.current) {
      // First payload after a reload: remember what already happened instead
      // of buzzing about a warning the player has already seen.
      primed.current = true;
      for (const alert of input.detection) seen.current.add(`det:${alert.id}`);
      return;
    }
    for (const alert of input.detection) {
      const who = alert.from === "shadow" ? "Shadow" : "Hunter";
      push(
        `det:${alert.id}`,
        `A ${who} is close, about ${alert.band}.`,
        "warn",
      );
    }
  }, [input.detection, push]);

  return { banners, mute, toggleMute, dismiss };
}

/** Shrink warnings are always this far ahead (config, [TUNED]). */
export const SHRINK_WARNING_MS = RULES_CONFIG.shrinkWarningSeconds * 1000;
