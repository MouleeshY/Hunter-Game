-- Scheduled jobs: the minute tick and the position-retention purge.
--
-- Enable the two extensions once, in the Supabase dashboard
-- (Database → Extensions) or by hand:
--
--     create extension if not exists pg_cron;
--     create extension if not exists pg_net;
--
-- Then give the jobs the API's address and the shared tick secret. These are
-- database settings, not committed secrets — set them on the project's
-- database once:
--
--     alter database postgres set app.tick_url     = 'https://<your-api-host>';
--     alter database postgres set app.tick_secret  = '<TICK_SECRET>';
--
-- (Use `alter database postgres reset app.tick_secret` to rotate it.) Until
-- they are set, both jobs return immediately and do nothing: a project without
-- the API deployed never logs an error every minute.
--
-- WHY HTTP AND NOT SQL: the tick is game logic. It lives in `src/server`
-- (`runMatchTick`) behind the same rules and repositories as everything else,
-- so Postgres must not reimplement it. The job is a nudge — one authenticated
-- POST — and the endpoint is idempotent: a duplicate delivery pays nothing
-- twice and ends nothing twice (awards are keyed by `score_events.ref_id`,
-- endings are skipped once the match is `ended`).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- tick -------

create or replace function public.shadow_hunt_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text := nullif(current_setting('app.tick_url', true), '');
  secret   text := nullif(current_setting('app.tick_secret', true), '');
begin
  if base_url is null or secret is null then
    return;
  end if;

  perform net.http_post(
    url := base_url || '/api/tick',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-tick-secret', secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

-- ------------------------------------------------- position retention --------
-- Positions are deleted 24 hours after a match ends (the number itself lives in
-- `src/rules/config.ts` as `positionRetentionHours`, so the server decides).

create or replace function public.shadow_hunt_purge_positions()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text := nullif(current_setting('app.tick_url', true), '');
  secret   text := nullif(current_setting('app.tick_secret', true), '');
begin
  if base_url is null or secret is null then
    return;
  end if;

  perform net.http_post(
    url := base_url || '/api/maintenance/purge-positions',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-tick-secret', secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

-- Neither helper is callable from the browser.
revoke all on function public.shadow_hunt_tick() from public;
revoke all on function public.shadow_hunt_purge_positions() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.shadow_hunt_tick() from anon';
    execute 'revoke all on function public.shadow_hunt_purge_positions() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.shadow_hunt_tick() from authenticated';
    execute 'revoke all on function public.shadow_hunt_purge_positions() from authenticated';
  end if;
end
$$;

-- Every minute, on the minute.
select cron.schedule(
  'shadow-hunt-tick',
  '* * * * *',
  $$select public.shadow_hunt_tick()$$
);

-- Hourly, at :17, so the purge never competes with the tick.
select cron.schedule(
  'shadow-hunt-purge-positions',
  '17 * * * *',
  $$select public.shadow_hunt_purge_positions()$$
);
