/**
 * The database handle the repositories operate on.
 *
 * Deliberately opaque: the interfaces in this directory are database-agnostic.
 * Each provider knows what the handle really is (a Convex `QueryCtx` /
 * `MutationCtx` today, a Supabase client later) and casts once, in its own
 * module.
 */
export type RepoContext = unknown;
