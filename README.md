# Shadow Hunt

Real-life urban manhunt: two teams (Hunters and Shadows), a GPS radar with a
3-minute ping, and a play area that shrinks every 10 minutes.

- **Frontend:** Vite + React, MapLibre GL, Tailwind / shadcn/ui
- **Backend:** Supabase Auth + a Node API backed by Postgres, with all game data
  behind repositories
- **Rules:** pure TypeScript in `src/rules` (`shadow-hunt-rules`)

## Running locally

```bash
bun install
bun run dev:supabase
```

Copy `.env.example` to `.env.local` and fill in the browser-safe and server-only
values before starting the API and Vite together. The Vite development proxy
forwards `/api` requests to the local API on port 8787 when `VITE_API_URL` is
empty. The legacy Convex source is retained temporarily for the separately
gated removal stage; the active screens and runtime use Supabase.

## Tests

```bash
bun test
bun tsc -b --noEmit
bunx eslint src
bun run build
bun run test:e2e
```

## Supabase setup for a manual test

1. Link the Supabase CLI to the project and apply every migration:
   `supabase db push`. This includes
   `20261102090000_users_auth_id.sql` and
   `20261102090100_fractional_scores.sql`, in addition to the earlier schema,
   RLS, and scheduled-job migrations.
2. In **Database → Extensions**, enable `pg_cron` and `pg_net`. The scheduled
   migration also creates them if available on the project.
3. Deploy the Node API with the server-only variables from `.env.example`.
   Set `DATABASE_URL` to the Supabase Postgres pooler connection using user
   `postgres.<project-ref>` (not `anon` or `authenticated`). The Supabase
   `postgres` database role is privileged and has `BYPASSRLS`; the API uses
   that role so repositories can enforce authorization in application
   services. The browser only receives the anon key. RLS stays enabled, and a
   client using only that anon key cannot read the game tables.
4. Set the database job settings once, using the deployed API origin (without
   `/api`) and the same long random value used for server `TICK_SECRET`:

   ```sql
   alter database postgres set app.tick_url = 'https://<your-api-host>';
   alter database postgres set app.tick_secret = '<same-value-as-TICK_SECRET>';
   ```

5. In **Authentication → Providers → Google**, enable Google and add the OAuth
   client ID and secret. Register Supabase's callback URL
   `https://<project-ref>.supabase.co/auth/v1/callback` with Google. In
   **Authentication → URL Configuration**, set the site URL and allow the
   app's callback URLs, including `http://localhost:5173/auth` for local work
   and `https://<your-app-host>/auth` when deployed.
6. Email one-time codes require a working SMTP server. Configure it under
   **Authentication → SMTP Settings**; otherwise the email option will report
   that SMTP must be configured.
7. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `DATABASE_URL`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (for
   HS256 tokens), and `TICK_SECRET`. Keep every server-only value out of
   `VITE_*` variables. `SUPABASE_URL` also lets the API verify asymmetric
   tokens through the project's JWKS endpoint.

## Map tiles

The map uses MapLibre GL with OpenStreetMap raster tiles. The public OSM tile
server is fine for development and small private playtests but **is not meant
for heavy use** and must not be relied on for launch.

Before launch, switch to a free-tier tile provider (for example MapTiler,
Stadia Maps, Thunderforest or Protomaps) and set:

```
VITE_MAP_TILE_URL=https://your-provider/{z}/{x}/{y}.png?key=...
VITE_MAP_ATTRIBUTION=© Your Provider · © OpenStreetMap contributors
```

Attribution is rendered by MapLibre's attribution control and must stay visible
on the map.

## How the stages fit together

- **Stage 1–2:** rules engine, data layer, rooms and lobby.
- **Stage 3 (this one):** real map, GPS uploads, viewer-specific visibility,
  zone drain, spoof flags, position retention, simulated GPS for development.
- **Stage 4 (not built):** QR tagging UI, complaints, invigilator console.

Positions are never public. Only players in a match and its invigilators get a
map; Hunters only ever see Shadow ping ghosts, spectators see a 60-second
delayed view, and position history is deleted 24 hours after a match ends.
