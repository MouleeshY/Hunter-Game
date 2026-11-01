import { useEffect, useRef, useState } from "react";

/**
 * "Reconnecting" state (Stage 5, task 5).
 *
 * Two ways a phone stops talking to the server: the network drops, or the app
 * goes to the background and the live subscription stops delivering. Either
 * way we keep the last screen and the last position — nothing is thrown away —
 * and the banner clears the moment fresh data lands again.
 *
 * Returning from the background remembers the heartbeat that was on screen at
 * that moment; `awaiting` stays true only while the server is still reporting
 * that same value. The next heartbeat clears it with no state written from an
 * effect, so a quiet match never shows a false "reconnecting".
 */
export function useConnection(args: {
  /** Fresh server time from the last query, or null before the first load. */
  heartbeat: number | null;
}): { online: boolean; awaiting: boolean; reconnecting: boolean } {
  const { heartbeat } = args;

  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [awaitingFrom, setAwaitingFrom] = useState<number | null>(null);

  const heartbeatRef = useRef(heartbeat);
  useEffect(() => {
    heartbeatRef.current = heartbeat;
  }, [heartbeat]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const visible = () => {
      if (document.visibilityState === "visible") {
        setAwaitingFrom(heartbeatRef.current);
      }
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const awaiting =
    awaitingFrom !== null && heartbeat !== null && heartbeat === awaitingFrom;

  return { online, awaiting, reconnecting: !online || awaiting };
}
