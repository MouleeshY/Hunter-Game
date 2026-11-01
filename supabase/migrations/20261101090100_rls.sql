-- Row Level Security for every game table.
--
-- WHY THIS EXISTS
-- The browser ships the Supabase anon key (it has to, for Auth). That key is a
-- JWT for the `anon` role. If a game table were readable by `anon` or
-- `authenticated`, anyone could ask PostgREST/Supabase directly for coordinates,
-- QR tokens, complaints or the audit trail — completely bypassing the
-- per-role visibility rules the game enforces in `src/server`. So:
--
--   1. RLS is enabled AND forced on every table in `public`.
--   2. No policies are created for `anon` or `authenticated`. With RLS on and
--      no policy, every row is invisible and every write is refused.
--   3. Direct table privileges are revoked as well, so PostgREST cannot even
--      describe the tables.
--
-- The API in `/api` is the only reader and writer. It connects to Postgres with
-- the server-only pooler connection string (`DATABASE_URL`) as the database
-- owner, which bypasses RLS — the same way a backend service does in the
-- standard Supabase architecture. Realtime is NOT enabled on these tables for
-- the same reason: table replication would stream rows to subscribers. The
-- optional live nudge uses a Broadcast channel, which has no table access.
--
-- `src/server/providers/postgres/rls.test.ts` fails if any table in `public`
-- is missing RLS, forced RLS or has a policy.

alter table public.users enable row level security;
alter table public.users force row level security;

alter table public.matches enable row level security;
alter table public.matches force row level security;

alter table public.players enable row level security;
alter table public.players force row level security;

alter table public.locations enable row level security;
alter table public.locations force row level security;

alter table public.tags enable row level security;
alter table public.tags force row level security;

alter table public.complaints enable row level security;
alter table public.complaints force row level security;

alter table public.invigilators enable row level security;
alter table public.invigilators force row level security;

alter table public.score_events enable row level security;
alter table public.score_events force row level security;

alter table public.leaderboard enable row level security;
alter table public.leaderboard force row level security;

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

alter table public.match_events enable row level security;
alter table public.match_events force row level security;

-- Belt and braces: even with a policy added by mistake later, the browser roles
-- never hold table privileges. `anon` and `authenticated` exist on Supabase but
-- not on a bare Postgres (PGlite), so this is guarded.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
  end if;
end
$$;

comment on table public.matches is
  'Shadow Hunt matches. RLS on, no policies: only the server API (DATABASE_URL) reads or writes.';
