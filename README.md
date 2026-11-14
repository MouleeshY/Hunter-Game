# Shadow Hunt

## Overview
Shadow Hunt is a daytime, club-only, real-life manhunt game played on phones with GPS. Hunters and Shadows play inside a shrinking map circle, Shadows earn points by surviving, Hunters score by tagging, and invigilators monitor a separate control view.

The app is built as a Vite + React + TypeScript frontend with a Hono API and a Supabase/Postgres backend. The game rules are intentionally isolated in `src/rules` so the same logic can be used by the client, the server, and tests without database or framework coupling.

## Goals
- Deliver a fair, privacy-safe live GPS game for a small club audience.
- Keep the rule engine pure and testable outside the database layer.
- Enforce tag validation, zone logic, scoring, and visibility on the server.
- Publish public results only after a match ends and remove live positions from public view.
- Support a staged delivery path: rules → lobby → live map → tagging → invigilator tooling → public leaderboard.

## Current Stage
This repository is in the Stage 7A / Stage 7B migration window. The rules engine, server services, and Supabase-backed repositories are in place and the repo-level validation checks pass, but Stage 7B verification and the first real browser run are still pending. See [STATUS.md](./STATUS.md) for the current state.

## Tech Stack
- Language: TypeScript, Bun, Vite
- Frontend: React, Tailwind, shadcn/ui, MapLibre GL, browser GPS/camera hooks
- Backend / API: Hono in `api/`, server-authoritative services in `src/server`
- Database / storage: Supabase Postgres, RLS, Realtime, PGlite for contract tests
- Auth: Supabase Auth with Google as the direct sign-in path; email OTP requires SMTP
- Map: MapLibre GL over OSM or a paid tile provider
- Infrastructure / deployment: Supabase project + API host; HTTPS required for GPS and camera access
- Testing: Bun test, TypeScript build, ESLint, Playwright for browser automation

## Project Structure
```text
api/                       Server API entrypoints and auth helpers
supabase/migrations/      Supabase schema, RLS, cron and score migrations
docs/                     Project notes and rule docs (keep repository-level docs in root)
public/                   Static assets and public files
src/
  rules/                  Pure game-logic package (`shadow-hunt-rules`)
  server/                 Repositories, services, scheduler, match logic, tests
  convex/                 Legacy Convex code; scheduled for removal
  pages/                  Route-level screens
  components/             UI components
  hooks/                 React hooks
  lib/                   Shared client utilities
  demo/                  Demo-only code; should carry a demo-only header
src/types/                Shared TypeScript types
src/assets/               Static app assets
src/client/               Client-side API helpers
src/components/           Frontend UI tree
```

## Important Components
- Rules engine: pure checks in `src/rules` for zones, tags, scoring, visibility, setup, and results.
- Repositories/providers: `src/server/repos` and `src/server/providers` abstract database access and are the only place data is read or written.
- Hono API: `api/` hosts the server-side entrypoints and auth plumbing.
- Scheduler/tick: server tick and job logic enforce time-driven points, setup, and match progression.
- Visibility service: enforces what each role may see, with Shadows hidden from Hunters and public results restricted.
- Map: live map rendering, GPS uploads, zone boundaries, and map UI.
- QR flow: tag validation, freshness, proximity checks, complaint handling, and audit capture.
- Invigilator console: staff-only monitor and intervention actions.
- Public results: privacy projection plus the published result page and leaderboard.

## Development Workflow
1. Read the root AI memory files before touching the code: README, STATUS, recent PROGRESS entries, and relevant ADRs.
2. Work on one stage at a time and keep rules in `src/rules` pure.
3. Validate with the real repo checks before reporting completion.
4. If a significant decision changes, update the ADR history and the project status notes.

## Important Commands
```bash
bun install
bun run dev:supabase
bun test
bun tsc -b --noEmit
bunx eslint src
bun run build
```

Notes:
- `bun run dev:supabase` starts the local API and Vite app together using `.env.local`.
- The API expects server-only variables in `.env.local`; browser-safe values remain in `VITE_*`.
- The project uses Bun as the package manager and test runner; do not add a second lockfile.

## Environment and Configuration
- Copy `.env.example` to `.env.local` before running the local stack.
- Server-only variables include `DATABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `TICK_SECRET`, and `PORT`.
- Browser-safe values begin with `VITE_` and must not contain server-only secrets.
- Supabase setup: link the CLI to the project and apply every migration with `supabase db push`; enable `pg_cron` and `pg_net` in the database extensions UI if they are not already present.
- `TICK_SECRET` must be the same long random value used when the database job is configured.
- The map uses MapLibre GL and OpenStreetMap tiles by default; before launch, switch to a production-friendly provider and set `VITE_MAP_TILE_URL` plus `VITE_MAP_ATTRIBUTION`.
- HTTPS is required for GPS and camera access in the browser, and Google sign-in is the main auth path because the built-in Supabase email flow is rate-limited.
- The API uses the Supabase Postgres role with `BYPASSRLS` to enforce authorization in application code; the browser only receives the anon key and cannot read the protected game tables.
- `app.tick_url` and `app.tick_secret` must be configured in Postgres for the scheduled tick.

## Where things live
- Rules: `src/rules`
- Server services: `src/server`
- Database repos: `src/server/repos`
- API: `api/`
- Supabase migrations: `supabase/migrations/`
- Front-end screens: `src/pages/`
- Reusable UI: `src/components/`
- SDK/client helpers: `src/client/` and `src/lib/`
- Legacy Convex source: `src/convex/` (to be removed)
- Public result pages: `src/components/results/` and `src/pages/` via result routing

## AI Development Guidelines
Start of every session:
1. Read README.md, then STATUS.md, then recent PROGRESS.md entries, then relevant DECISIONS.md entries.
2. Inspect the real code before making a change; code wins over stale markdown.
3. Fix any discrepancy between docs and code, but do not change game rules or numbers without owner approval.

End of every meaningful session:
1. Update STATUS.md with the current state and blockers.
2. Add a new top entry to PROGRESS.md with the real validation results.
3. Add or supersede an ADR if a significant decision was made.
4. Update README.md only if the stable structure, setup instructions, or purpose changed.

Project rules:
- Game rules live in `src/rules` and stay pure.
- All database access goes through the repositories.
- Tag validation, zone logic, scoring, and visibility are enforced on the server only.
- No photos are stored and live positions are never public.
- Do not change any game rule or number without asking the project owner.
- No `any`, `@ts-ignore`, eslint-disable comments, or relaxed config.
- Before reporting, run plain `bun test`, `bun tsc -b --noEmit`, `bunx eslint src`, and `bun run build`, and show real output tails.
- One stage at a time; report and wait for approval.

## Memory Files
- [README.md](./README.md)
- [STATUS.md](./STATUS.md)
- [PROGRESS.md](./PROGRESS.md)
- [DECISIONS.md](./DECISIONS.md)
