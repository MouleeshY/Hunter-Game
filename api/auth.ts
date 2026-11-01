/**
 * Who is calling: the Supabase JWT in the `Authorization` header.
 *
 * Supabase issues either an HS256 token (signed with the project JWT secret)
 * or an ES256 token verified against the project JWKS. Both are supported:
 *
 *   SUPABASE_JWT_SECRET  → HS256 with that secret (no network)
 *   SUPABASE_URL         → JWKS at <url>/auth/v1/.well-known/jwks.json
 *
 * The token's `sub` is the `auth.users.id`, which is the id the game stores on
 * `users`, `players.user_id`, `matches.created_by` and the audit trail. The
 * profile row is created on first sight so a match can always be joined by the
 * same person.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { RepoContext } from "../src/server/repos/context";
import type { Repos } from "../src/server/repos";

export interface VerifiedUser {
  userId: string;
  email: string | null;
  name: string | null;
}

export type TokenVerifier = (token: string) => Promise<VerifiedUser>;

function userFrom(payload: JWTPayload): VerifiedUser {
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Token has no subject.");
  }
  const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : typeof payload.name === "string"
          ? payload.name
          : null;
  const email = typeof payload.email === "string" ? payload.email : null;
  return { userId: sub, email, name };
}

/** A verifier for the two token flavours Supabase issues, or null if unconfigured. */
export function createVerifierFromEnv(
  env: Record<string, string | undefined> = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env ?? {},
): TokenVerifier | null {
  const secret = env.SUPABASE_JWT_SECRET;
  if (secret) {
    const key = new TextEncoder().encode(secret);
    return async (token) => {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["HS256"],
      });
      return userFrom(payload);
    };
  }

  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  if (url) {
    const jwks = createRemoteJWKSet(
      new URL(`${url}/auth/v1/.well-known/jwks.json`),
    );
    return async (token) => {
      const { payload } = await jwtVerify(token, jwks);
      return userFrom(payload);
    };
  }

  return null;
}

/**
 * Make sure the profile row exists. Called once per token, after verification:
 * an upsert of an already-known user is skipped by the cache below, so a client
 * polling every two seconds does not write a row every two seconds.
 */
export async function resolveUser(
  ctx: RepoContext,
  repos: Repos,
  user: VerifiedUser,
): Promise<VerifiedUser> {
  const known = await repos.users.findById(ctx, user.userId);
  if (known !== null) return user;
  await repos.users.upsert(ctx, {
    id: user.userId,
    name: user.name,
    email: user.email,
  });
  return user;
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/** SHA-256 + constant-time compare, so a short secret cannot be guessed faster. */
export async function secretMatches(
  provided: string | null | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected || typeof provided !== "string") return false;
  const encoder = new TextEncoder();
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const a = createHash("sha256").update(encoder.encode(provided)).digest();
  const b = createHash("sha256").update(encoder.encode(expected)).digest();
  return timingSafeEqual(a, b);
}
