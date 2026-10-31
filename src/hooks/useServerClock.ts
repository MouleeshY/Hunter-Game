import { useEffect, useRef, useState } from "react";

/**
 * A clock that follows the server, not the phone.
 *
 * The offset is measured once, when fresh server time arrives, and then held —
 * so a countdown keeps running between queries but can never drift from the
 * server's schedule. While the match is paused the server clock stops, and so
 * does this one.
 *
 * Everything impure happens inside the ticker, never during render.
 */
export function useServerClock(args: {
  serverNowMs: number | null;
  paused: boolean;
}): number {
  const serverNowRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  // Reach the latest query data from the ticker without writing refs in render.
  useEffect(() => {
    serverNowRef.current = args.serverNowMs;
    pausedRef.current = args.paused;
  });

  // Measure the offset the moment new server time lands.
  useEffect(() => {
    if (args.serverNowMs !== null) {
      offsetRef.current = args.serverNowMs - Date.now();
    }
  }, [args.serverNowMs]);

  useEffect(() => {
    const tick = () => {
      const serverNow = serverNowRef.current;
      if (serverNow !== null && pausedRef.current) {
        setNow(serverNow);
        return;
      }
      setNow(Date.now() + offsetRef.current);
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}
