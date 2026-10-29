# Shadow Hunt

Real-life urban manhunt: two teams (Hunters and Shadows), a GPS radar with a
3-minute ping, and a play area that shrinks every 10 minutes.

- **Frontend:** Vite + React, MapLibre GL, Tailwind / shadcn/ui
- **Backend:** Convex (auth + database), with all game data behind repositories
- **Rules:** pure TypeScript in `src/rules` (`shadow-hunt-rules`)

## Running locally

```bash
bun install
bun convex dev        # start / attach the Convex dev deployment
bun run dev           # Vite
```

`bun install` also copies `src/rules` into `node_modules/shadow-hunt-rules`,
because Convex only bundles code inside `convex/` or `node_modules`. **After
editing anything in `src/rules`, run `bun install` again** so the Convex
functions pick up the change.

## Tests

```bash
bun test
bun tsc -b --noEmit
bunx eslint .
```

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
