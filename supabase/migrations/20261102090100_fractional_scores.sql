-- Scoring rules interpolate values, so valid score events can be fractional.
alter table public.players
  alter column points type double precision using points::double precision;

alter table public.tags
  alter column scored_points type double precision using scored_points::double precision;

alter table public.score_events
  alter column points type double precision using points::double precision;

alter table public.leaderboard
  alter column total_points type double precision using total_points::double precision;
