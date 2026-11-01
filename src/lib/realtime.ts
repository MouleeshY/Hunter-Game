/**
 * The optional live nudge (Stage 7, task 7).
 *
 * The client polls the HTTP API on `REFRESH_INTERVALS` from `src/rules/config`.
 * On top of that it MAY open one Supabase Realtime *Broadcast* channel per
 * match, and the only thing that ever travels on it is "something changed, go
 * refetch".
 *
 * Two rules make this safe:
 *
 *   1. The message is a single fixed token. No positions, no names, no scores,
 *      no ids beyond the channel name the client already knows. A subscriber
 *      learns nothing it could not learn by refetching through the API, which
 *      applies the visibility rules itself.
 *   2. Realtime is never enabled on the game tables. Table replication would
 *      stream raw rows — coordinates, QR tokens, complaints — straight to any
 *      client, bypassing every rule in `src/server`. The Broadcast channel is
 *      deliberately not attached to any table.
 *
 * `nudgeMessage()` returns the frozen object; the test in
 * `src/server/stage7a.test.ts` serialises it and asserts it carries no payload
 * fields at all.
 */

/** The whole message. One key, one value, nothing else. */
export const NUDGE_EVENT = "changed" as const;

export interface MatchNudge {
  type: typeof NUDGE_EVENT;
}

const MESSAGE: MatchNudge = Object.freeze({ type: NUDGE_EVENT });

/** The nudge a match publishes. Frozen: nobody can add a field to it. */
export function nudgeMessage(): MatchNudge {
  return MESSAGE;
}

/** One channel per match, named by the id the client already has. */
export function nudgeChannelName(matchId: string): string {
  return `match:${matchId}:changed`;
}

/**
 * The slice of the Supabase Realtime client the helper needs. Declared
 * structurally so this module imports nothing from `@supabase/supabase-js`:
 * the app can use the SDK (or none at all) without this file changing.
 */
export interface BroadcastChannelLike {
  on(
    type: "broadcast",
    filter: { event: string },
    callback: (message: { event: string; payload?: unknown }) => void,
  ): BroadcastChannelLike;
  subscribe(status?: (status: string) => void): unknown;
  unsubscribe(): unknown;
}

export interface RealtimeClientLike {
  channel(name: string, options?: Record<string, unknown>): BroadcastChannelLike;
}

/**
 * Subscribe to a match's nudge and call `onNudge` every time it fires.
 * Returns the unsubscribe function.
 */
export function subscribeToMatchNudge(
  client: RealtimeClientLike,
  matchId: string,
  onNudge: () => void,
): () => void {
  const channel = client.channel(nudgeChannelName(matchId), {
    config: { broadcast: { self: false } },
  });
  channel.on("broadcast", { event: NUDGE_EVENT }, () => onNudge());
  channel.subscribe();
  return () => {
    channel.unsubscribe();
  };
}
