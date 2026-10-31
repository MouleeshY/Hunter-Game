/**
 * Tiny ID helpers shared by the server layer.
 *
 * These are plain TypeScript. They do not import Convex. The Convex provider
 * maps them to real `Id<"table">` values where the generated Convex types are
 * in scope; the rest of the server deals with opaque strings through the
 * repository interfaces.
 */

/** Opaque match id (a ULID in practice). */
export type MatchId = string;

/** Opaque player id. */
export type PlayerId = string;

/** Opaque user id (Convex `users` doc id in the Convex provider). */
export type UserId = string;

/** Opaque invigilator id. */
export type InvigilatorId = string;

/** Opaque complaint id. */
export type ComplaintId = string;

/** Opaque score event id. */
export type ScoreEventId = string;

/** Opaque location id. */
export type LocationId = string;

/** Opaque tag id. */
export type TagId = string;

/** Opaque leaderboard id. */
export type LeaderboardId = string;

/** Build a deterministic ULID-like id from a timestamp + monotonic counter.
 *   In the Convex provider this is replaced by real Convex id generation. */
export function makeId(timestampMs: number, counter: number): string {
  const base32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = timestampMs;
  // 48-bit timestamp encoded in 10 chars
  const tChars: string[] = [];
  for (let i = 0; i > -10; i -= 1) {
    tChars.push(base32[t & 31]);
    t >>>= 5;
  }
  const rand: string[] = [];
  const r = (timestampMs * 1000 + counter) >>> 0;
  for (let i = 0; i < 16; i += 1) {
    rand.push(base32[(r >>> (i * 5)) & 31]);
  }
  return tChars.join("") + rand.join("");
}

type _brand = "id";
export type Ulid = string & { readonly _brand?: _brand };
