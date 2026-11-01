import type { RepoContext } from "./context";

/**
 * The account behind a Supabase Auth JWT.
 *
 * Only the profile the game displays lives here — the credential itself stays
 * with the auth provider. On Supabase, `id` is the `auth.users.id` the token's
 * `sub` claim names; the API creates the row on first sight so a match can
 * always be joined by the same person.
 */
export interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
}

export interface UserRepository {
  findById(ctx: RepoContext, id: string): Promise<UserRow | null>;
  /** Create the profile on first sight; refresh name and email when they change. */
  upsert(
    ctx: RepoContext,
    input: { id: string; name?: string | null; email?: string | null },
  ): Promise<UserRow>;
}

export function userRowOf(row: {
  id: string;
  name?: string | null;
  email?: string | null;
}): UserRow {
  return {
    id: row.id,
    name: row.name ?? null,
    email: row.email ?? null,
  };
}
