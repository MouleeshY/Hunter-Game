-- Shadow Hunt — game schema, mirroring src/convex/schema.ts one table at a time.
--
-- Conventions
--   * primary keys are uuid (`gen_random_uuid()`), never Convex document ids
--   * every instant is `timestamptz`; the API converts to/from epoch
--     milliseconds at the repository boundary
--   * a match's rule snapshot (`config`) is `jsonb`, exactly like the Convex
--     document, so retuning the rules never rewrites a played match
--   * user ids are the Supabase Auth `auth.users.id` values. They are stored as
--     plain uuid without a foreign key, because the profile row lives in
--     `public.users` and an account may be deleted from Auth independently.
--
-- Convex's own auth tables (`authAccounts`, `authSessions`, `authRefreshTokens`,
-- `authVerificationCodes`, `authVerifiers`, `authRateLimits`) are replaced by
-- Supabase Auth, which owns them in the `auth` schema. This migration creates
-- only the `users` profile table the game reads names and emails from.

-- ---------------------------------------------------------------- users ------

create table if not exists public.users (
  id uuid primary key,
  name text,
  image text,
  email text,
  email_verified_at timestamptz,
  is_anonymous boolean not null default false,
  role text,
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_key
  on public.users (lower(email))
  where email is not null;

-- -------------------------------------------------------------- matches ------

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  -- Five-character code players type to join.
  room_code text not null,
  -- Random 128-bit hex id for the public result link; never derived from the
  -- room code.
  public_slug text,
  -- Optional, set by the organiser at setup, shown on the public page.
  title text,
  club_name text,
  -- true = public, false = hidden, null = the default applies (public once
  -- ended, unless the match was aborted).
  published boolean,
  status text not null
    check (status in ('lobby', 'locked', 'setup', 'headstart', 'live', 'ended')),
  -- Snapshot of RULES_CONFIG taken when the match was created.
  config jsonb not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz,
  event_window_ends_at timestamptz,
  roster_locked boolean not null default false,
  created_by uuid,
  -- Only what is fixed at kickoff; the current radius is derived in the rules.
  zone_lat double precision not null,
  zone_lng double precision not null,
  initial_radius_metres double precision not null,
  -- Where the organiser stood at setup. Used for centre re-rolls only, never
  -- returned to any client.
  organiser_lat double precision,
  organiser_lng double precision,
  last_ping_at timestamptz,
  setup_started_at timestamptz,
  setup_ends_at timestamptz,
  paused_at timestamptz,
  paused_total_ms integer not null default 0,
  pause_reason text,
  alive_up_to_minute integer not null default -1,
  winner text check (winner in ('hunters', 'shadows')),
  ended_at timestamptz,
  end_reason text
    check (end_reason in ('no_active_shadows', 'timer_expired', 'staff_end', 'aborted'))
);

-- A room code is unique among the matches that are still open; two finished
-- matches may reuse a code, which is the same rule the engine relies on when it
-- allocates a code.
create unique index if not exists matches_active_room_code_key
  on public.matches (room_code)
  where status <> 'ended';

create unique index if not exists matches_public_slug_key
  on public.matches (public_slug)
  where public_slug is not null;

create index if not exists matches_by_status on public.matches (status);
create index if not exists matches_by_room_code on public.matches (room_code);
create index if not exists matches_by_ended_at on public.matches (ended_at);

-- -------------------------------------------------------------- players ------

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('hunter', 'shadow')),
  -- What a tagged Shadow does for the rest of the match.
  mode text not null check (mode in ('spectator', 'hunter', 'helper')),
  status text not null
    check (status in ('active', 'tagged', 'spectator', 'removed', 'eliminated')),
  call_sign text not null,
  -- Leaderboard name: the nickname or real name chosen for this match.
  display_name text not null,
  display_name_mode text not null check (display_name_mode in ('nickname', 'real')),
  -- One plain QR code per match. No photos anywhere.
  qr_token text not null,
  points integer not null default 0,
  joined_at timestamptz not null,
  tagged_at timestamptz,
  tagged_by_id uuid references public.players (id) on delete set null,
  capture_chosen_at timestamptz,
  briefed_at timestamptz,
  -- Out-of-zone state, written by the position-upload path.
  outside_since timestamptz,
  outside_seconds_total integer not null default 0,
  charged_drain_ticks integer not null default 0,
  warned_at timestamptz
);

-- One player per user per match: a second join is refused by the database even
-- if two requests race.
create unique index if not exists players_match_user_key
  on public.players (match_id, user_id);

create unique index if not exists players_match_qr_key
  on public.players (match_id, qr_token);

create index if not exists players_by_match_role on public.players (match_id, role);

-- ------------------------------------------------------------ locations ------

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_metres double precision,
  recorded_at timestamptz not null,
  ping_index integer not null default 0,
  -- Spoof check: impossible jump or accuracy.
  suspicious boolean not null default false,
  suspicious_reason text
);

create index if not exists locations_match_player_time
  on public.locations (match_id, player_id, recorded_at desc);

create index if not exists locations_match_player_ping
  on public.locations (match_id, player_id, ping_index);

-- ----------------------------------------------------------------- tags ------
-- Every scan attempt, accepted or not: rejections award nothing and exist so an
-- invigilator can audit a dispute.

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  hunter_id uuid not null references public.players (id) on delete cascade,
  shadow_id uuid not null references public.players (id) on delete cascade,
  status text not null check (status in ('accepted', 'rejected')),
  rejection_code text,
  distance_metres double precision,
  -- Converted Hunter who helped with this capture.
  assisted_by_id uuid references public.players (id) on delete set null,
  -- The mode on offer at the moment of capture.
  capture_mode text check (capture_mode in ('spectator', 'hunter', 'helper')),
  forced boolean not null default false,
  forced_by uuid,
  scored_points integer not null default 0,
  "at" timestamptz not null
);

-- A Shadow can be caught once: two scans landing at the same moment cannot both
-- be accepted, so the tag points can never be paid twice.
create unique index if not exists tags_one_accepted_per_shadow
  on public.tags (match_id, shadow_id)
  where status = 'accepted';

create index if not exists tags_by_match on public.tags (match_id);

-- ----------------------------------------------------------- complaints ------

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  complainant_id uuid not null references public.players (id) on delete cascade,
  accused_id uuid not null references public.players (id) on delete cascade,
  note text,
  created_at timestamptz not null,
  response_due_at timestamptz not null,
  status text not null check (status in ('open', 'upheld', 'dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text
);

-- One open complaint per Hunter and Shadow pair.
create unique index if not exists complaints_one_open_per_pair
  on public.complaints (match_id, complainant_id, accused_id)
  where status = 'open';

create index if not exists complaints_by_match_status
  on public.complaints (match_id, status);

create index if not exists complaints_by_status_due
  on public.complaints (status, response_due_at);

-- --------------------------------------------------------- invigilators ------
-- Named by the organiser at setup. `user_id` stays null until the invite code
-- is accepted.

create table if not exists public.invigilators (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid,
  display_name text not null,
  invite_code text not null,
  active boolean not null default true,
  added_at timestamptz not null
);

create unique index if not exists invigilators_invite_code_key
  on public.invigilators (invite_code);

create unique index if not exists invigilators_match_user_key
  on public.invigilators (match_id, user_id)
  where user_id is not null;

create index if not exists invigilators_by_match on public.invigilators (match_id);

-- --------------------------------------------------------- score_events ------
-- Append-only ledger; the leaderboard is derived from it.

create table if not exists public.score_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  kind text not null
    check (kind in ('shadow_alive', 'tag', 'all_tagged_bonus', 'survival_bonus', 'zone_drain')),
  -- Negative for zone drains.
  points integer not null,
  "at" timestamptz not null,
  source text not null check (source in ('system', 'invigilator')),
  ref_id text
);

-- An award can never be written twice.
--
-- The dedupe key deliberately includes `player_id` and `kind` on top of
-- `(match_id, ref_id)`: the minute tick's ref id is `alive:<minute>`, which is
-- shared by every active Shadow in the match, so a unique index on
-- `(match_id, ref_id)` alone would refuse to pay the second Shadow of the same
-- minute. This is exactly the key `ScoreRepository.existsByRef` checks before
-- awarding, so a racing double-award now fails at the database instead of
-- silently duplicating points.
create unique index if not exists score_events_award_key
  on public.score_events (match_id, player_id, kind, ref_id)
  where ref_id is not null;

create index if not exists score_events_by_match on public.score_events (match_id);
create index if not exists score_events_by_match_player
  on public.score_events (match_id, player_id);

-- ---------------------------------------------------------- leaderboard ------

create table if not exists public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  display_name text not null,
  display_name_mode text not null check (display_name_mode in ('nickname', 'real')),
  total_points integer not null,
  breakdown jsonb not null,
  updated_at timestamptz not null
);

create unique index if not exists leaderboard_match_player_key
  on public.leaderboard (match_id, player_id);

create index if not exists leaderboard_by_match_points
  on public.leaderboard (match_id, total_points);

-- ------------------------------------------------------------ audit_log ------
-- Append-only: every invigilator and organiser action, who, when and why.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  "at" timestamptz not null,
  actor_user_id uuid not null,
  actor_name text not null,
  action text not null,
  target_type text not null,
  target_id text,
  target_label text,
  reason text,
  detail text
);

create index if not exists audit_log_by_match_time
  on public.audit_log (match_id, "at");

-- --------------------------------------------------------- match_events ------
-- The live feed. Never carries a position, except a help alert's coordinates,
-- which are only ever returned to an invigilator of the match.

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  "at" timestamptz not null,
  kind text not null
    check (kind in ('tag', 'elimination', 'removal', 'shrink', 'pause', 'resume', 'phase', 'help', 'detection')),
  player_id uuid references public.players (id) on delete set null,
  actor_id uuid references public.players (id) on delete set null,
  detail text,
  ref_id text,
  distance_metres double precision,
  lat double precision,
  lng double precision
);

-- One scheduled event per ref id: a minute's zone shrink cannot be announced
-- twice.
create unique index if not exists match_events_ref_key
  on public.match_events (match_id, ref_id)
  where ref_id is not null;

create index if not exists match_events_by_match_time
  on public.match_events (match_id, "at");

create index if not exists match_events_by_match_kind
  on public.match_events (match_id, kind);
