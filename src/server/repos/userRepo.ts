import type { RepoContext } from "./context";

/**
 * The account behind a Supabase Auth JWT.
 *
 * The profile id is separate from the Supabase Auth id in `authId`. The latter
 * maps the token's `sub` claim to the profile without exposing auth ids as
 * game-domain user ids.
 */
export interface UserRow {
  id: string;
  authId: string;
  name: string | null;
  email: string | null;
}

export interface UserRepository {
  findByAuthId(ctx: RepoContext, authId: string): Promise<UserRow | null>;
  /** Create the profile on first sight; refresh name and email when they change. */
  upsert(
    ctx: RepoContext,
    input: { authId: string; name?: string | null; email?: string | null },
  ): Promise<UserRow>;
}

export function userRowOf(row: {
  id: string;
  authId: string;
  name?: string | null;
  email?: string | null;
}): UserRow {
  return {
    id: row.id,
    authId: row.authId,
    name: row.name ?? null,
    email: row.email ?? null,
  };
}
