# Status

- Last Updated: 2026-11-14
- Current Phase: Stage 7A / migration cleanup; Stage 7B remains unverified
- Active Focus: verify the Stage 7B client/data-layer work with evidence; remove legacy Convex; finish the tidy-up items
- Active Task: Document the repo state in the AI memory files and session protocol

## Current State
The repo-level rules and server tests are passing in the current workspace. The real validation commands were run and succeeded:

- `bun test` — exit 0, 300 pass, 0 fail
- `bun tsc -b --noEmit` — exit 0
- `bunx eslint src` — exit 0, 10 warnings, 0 errors
- `bun run build` — exit 0; chunk-size warnings remain, but the build succeeds

This is still not browser-verified and no real-phone GPS run has been performed. The project is therefore functionally validated in the rules/server layer, but not yet proven in the browser or on real devices.

## Completed Recently
- Supabase-backed Postgres repo flow and PGlite contract tests are in-tree.
- Stage 7A postgres API work is present and validated by the repo tests.
- The rules package remains isolated and pure.
- The repo has a documented cleanup pass and migration away from the legacy Convex runtime is underway.

## In Progress
- Verify the Stage 7B Part A client data layer + Supabase Auth + polling + Realtime nudge work with concrete evidence.
- Remove the remaining Convex code path in Stage 7B Part B.
- Complete the tidy-up items: move `src/demo` behind a "demo only" header, add the README "Where things live" section, and add the missing `docs/game-rules.md` documentation.
- Run the first real browser simulation with GPS input and a mock map flow.

## Current Blockers
- No browser or real-phone verification yet.
- The Stage 7B report is vague and not backed by proof.
- Build emits chunk-size warnings and some large bundles remain.
- Spoof protection is basic rather than hardened.
- iPhone users cannot install from GitHub directly; the app is a PWA-only path.
- No screen has been rendered in a real browser session in this environment.

## Open Questions
- Radius table values are still provisional and need confirmation.
- Hosting choice is still open: Vercel vs Render.
- Tile provider is not finalised.
- Sign-in methods beyond Google are not yet confirmed.
- Whether Helpers or converted Hunters earn points is still unresolved; currently the code does not award them.

## Known Issues
- No browser or real-phone verification yet.
- 7B Part A is reported as done but remains unverified.
- Chunk-size build warnings remain during production build.
- Spoof protection is basic.
- iPhone cannot install directly from GitHub; the app is PWA-only.
- No screen has been rendered in a real browser run yet.
- Legacy Convex remains present in the repo while removal is still pending.

## Immediate Next Steps
1. Verify Stage 7B Part A with evidence from the actual client and API flow.
2. Remove Convex in 7B Part B.
3. Run the first real browser test with simulated GPS.
4. Finish the tidy-up tasks.
5. Advance to Stage 8 (PWA, HTTPS deploy, GitHub Actions, optional APK).
6. Complete Stage 9 field testing.

## Dependencies
- Supabase project with Postgres, Auth, Realtime and RLS.
- A deployable API host that matches the configured `app.tick_url` and `TICK_SECRET`.
- A tile provider for the production map.
- HTTPS for GPS and camera browser access.
- Google auth configuration or an approved alternate sign-in flow.

## Notes for the Next AI Session
- Check README.md first; then STATUS.md; then recent entries in PROGRESS.md; then relevant ADRs.
- Treat the code as the source of truth; correct stale docs when contradictions appear.
- Do not silently change game rules or numbers.
- Verify Stage 7B before claiming it is complete.

## Definition of Current Success
The current success criteria are:
- Stage 7B Part A is proven with actual evidence and real output.
- Convex removal is complete and the repo is fully Supabase-based.
- The app is running in a browser with simulated GPS and no blocking runtime errors.
- Tidy-up items are complete.
- The repo is ready to move into Stage 8 and field testing without hidden blockers.
