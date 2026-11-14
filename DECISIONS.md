# Decisions

## ADR 001 — Local Markdown files as AI memory
- ID: ADR-001
- Date: 2026-11-14 (approximate, needs verification)
- Status: Accepted
- Decision Type: Process / documentation
- Context: The project needs a stable, copyable AI orientation layer that can survive session resets and help new agents understand the repo quickly.
- Options Considered:
  - Keep a single README-only context.
  - Add root-level status and progress logs.
  - Add a decision log and session protocol.
- Decision: Use four local Markdown files in the repo root: README, STATUS, PROGRESS, and DECISIONS, plus the session protocol in CLAUDE.md and `.github/copilot-instructions.md`.
- Rationale: The repo is complex enough that a single doc cannot hold both stable orientation and change history without becoming stale.
- Consequences:
  - Positive: faster onboarding, clearer state, less stale context drift.
  - Negative: requires maintenance and discipline to keep docs aligned with code.
- Alternatives Rejected: A single, growing README; informal chat-only memory; no documented session protocol.
- Revisit Conditions: If the repo changes shape significantly or the memory files become stale again.

## ADR 002 — Pure rules engine in `src/rules` with no database or framework imports
- ID: ADR-002
- Date: 2026-10-29 (approximate, needs verification)
- Status: Accepted
- Decision Type: Architecture
- Context: The game logic is complex enough that it should be portable and testable, independent from the database and UI framework.
- Options Considered:
  - Couple rules directly to React or Convex.
  - Keep a pure TypeScript rules package.
  - Duplicate rules in multiple layers.
- Decision: Put the rules layer in `src/rules` and keep it free of framework and database imports.
- Rationale: The current `src/rules/config.ts` and package exports make the engine portable across tests, server code, and client code.
- Consequences:
  - Positive: portable, testable, easy to reason about.
  - Negative: requires adapters if the server or UI needs the data model.
- Alternatives Rejected: Mixed rules logic at the framework boundary; database-first logic.
- Revisit Conditions: If rules are coupled to a runtime dependency again or the package must cross a real API boundary.

## ADR 003 — Server-authoritative game logic
- ID: ADR-003
- Date: 2026-10-29 (approximate, needs verification)
- Status: Accepted
- Decision Type: Security / architecture
- Context: Tag validation, zone logic, scoring, visibility rules, and spoof checks must not be trusted from the client.
- Options Considered:
  - Client-side validation only.
  - Hybrid client plus server validation.
  - Server-authoritative enforcement only.
- Decision: All tag validation, zone checks, scoring, and visibility decisions run on the server.
- Rationale: The repo explicitly separates game rules from database imports and the server services enforce the logic.
- Consequences:
  - Positive: prevents cheating and logic drift.
  - Negative: more server work, more careful API contracts.
- Alternatives Rejected: Client-owned rule enforcement; allowing the UI to decide state transitions.
- Revisit Conditions: If a product requirement requires a trusted client-side precheck that is not authoritative.

## ADR 004 — Repository layer with swappable providers and in-memory repos for tests
- ID: ADR-004
- Date: 2026-10-29 (approximate, needs verification)
- Status: Accepted
- Decision Type: Architecture
- Context: The same game states need to run under test and production without direct DB coupling.
- Options Considered:
  - Direct database access in services.
  - Repository abstraction with in-memory implementations.
  - Multiple app-specific DAO layers.
- Decision: All DB access goes through repositories; tests use in-memory/contract providers.
- Rationale: `src/server/repos` and `src/server/providers` are the seam that isolates the app from the backend implementation.
- Consequences:
  - Positive: closer to testability and portability.
  - Negative: some additional indirection and a larger interface surface.
- Alternatives Rejected: Direct service-to-DB coupling; per-service ad hoc data access.
- Revisit Conditions: If the repo layer becomes a bottleneck for performance or complexity.

## ADR 005 — Move from Convex to Supabase Postgres with a Hono API
- ID: ADR-005
- Date: 2026-11-02 (approximate, needs verification)
- Status: Accepted
- Decision Type: Platform migration
- Context: The project was history-bound to Convex, but the active stack uses Supabase/Postgres and the Hono API.
- Options Considered:
  - Keep Convex and add a parallel Supabase path.
  - Cut over to Supabase only.
  - Use Supabase Edge Functions only.
- Decision: Move to Supabase Postgres with a Hono API and do not keep a dual client path; Convex is legacy and the repo is moving away from it.
- Rationale: The codebase and migrations are aligned to Supabase; Convex cannot run in Codespaces because its auth issuer was tied to the old Vly host.
- Consequences:
  - Positive: a single active backend stack and simpler environment setup.
  - Negative: migration work remains and legacy Convex code must be removed.
- Alternatives Rejected: Dual Convex/Supabase client; Supabase Edge Functions as the primary path.
- Revisit Conditions: If deployment or auth constraints force a new platform decision.

## ADR 006 — RLS enabled and forced on all tables; the API connects as the Postgres role
- ID: ADR-006
- Date: 2026-11-02 (approximate, needs verification)
- Status: Accepted
- Decision Type: Security / database
- Context: The app needs protected game data while still allowing server-side enforcement.
- Options Considered:
  - Client reading game data directly.
  - Disable RLS for convenience.
  - Keep RLS on and require server-side role access.
- Decision: RLS stays on and the API connects as the privileged Postgres role so the repositories can enforce app logic while the browser only receives anon access.
- Rationale: The README explicitly notes that the client cannot read protected game tables using only the anon key.
- Consequences:
  - Positive: stronger access boundaries and safer data separation.
  - Negative: requires careful schema setup and deployment configuration.
- Alternatives Rejected: Broad client access; public tables for game state.
- Revisit Conditions: If the app architecture changes or a different database identity model is required.

## ADR 007 — Client polling plus a no-payload Realtime broadcast nudge
- ID: ADR-007
- Date: 2026-11-02 (approximate, needs verification)
- Status: Accepted
- Decision Type: Real-time architecture
- Context: Match state should update without enabling broad Realtime access on the game tables.
- Options Considered:
  - Enable Realtime on every game table.
  - Use polling alone.
  - Use polling plus a minimal broadcast nudge.
- Decision: Use polling for the client and a lightweight Realtime broadcast nudge without exposing game tables directly.
- Rationale: The Supabase configuration notes state that only the API publishes Realtime broadcast nudges and game tables should not use Realtime directly.
- Consequences:
  - Positive: less data exposure and lower complexity.
  - Negative: slightly more client polling and more careful state merge logic.
- Alternatives Rejected: Direct Realtime subscriptions to the game tables; a poll-only model with no push updates.
- Revisit Conditions: If the app needs aggressive real-time reactivity or a heavier event model.

## ADR 008 — Visibility matrix for different roles
- ID: ADR-008
- Date: 2026-10-31 (approximate, needs verification)
- Status: Accepted
- Decision Type: Game logic
- Context: Players should not see the same information as invigilators or spectators; the rules engine must model role-based visibility.
- Options Considered:
  - One shared map view for everyone.
  - Role-specific map views.
  - Strict visibility matrix by role and state.
- Decision: Hunters see Shadows only as 3-minute ping ghosts; Shadows never see Hunters; spectators/helpers see Hunters live and Shadows as ghosts; invigilators see all; public sees no positions.
- Rationale: The repo’s `src/rules/visibility.ts` and tests encode these expectations, and the README describes the same visibility model.
- Consequences:
  - Positive: privacy and fairness are preserved.
  - Negative: more complex role logic and viewer state handling.
- Alternatives Rejected: Shared or fully public map data; visible enemy locations outside the configured windows.
- Revisit Conditions: If a new role needs additional data or a club requirement changes the rules.

## ADR 009 — QR tagging with 40 m proximity and a 30 s freshness window
- ID: ADR-009
- Date: 2026-10-31 (approximate, needs verification)
- Status: Accepted
- Decision Type: Game rule / security
- Context: Tags must be both close in space and fresh in time to be accepted, while still allowing a fair match.
- Options Considered:
  - Loose proximity and no freshness check.
  - Strict tag validation with a narrow freshness window.
  - Viable distance and freshness thresholds.
- Decision: A tag is only accepted within approximately 40 m and only when both locations are fresh enough to meet the 30 s rule. Flagged positions are rejected.
- Rationale: `src/rules/config.ts` states these exact thresholds and the tests enforce them.
- Consequences:
  - Positive: fairer and less cheatable captures.
  - Negative: some captures fail when GPS data is stale or poor.
- Alternatives Rejected: No proximity rule; no freshness rule; hardcoded distance values.
- Revisit Conditions: If the real-world play rules change or the environment proves a different threshold is required.

## ADR 010 — One transaction per mutating service with row locks and ledger uniqueness
- ID: ADR-010
- Date: 2026-11-02 (approximate, needs verification)
- Status: Accepted
- Decision Type: Data integrity
- Context: Match services mutate multiple tables and must avoid double-awards and race conditions.
- Options Considered:
  - Best-effort mutation with client retries.
  - Transactional mutation with row locks.
  - Full database event-sourcing layer.
- Decision: All mutating services run in one transaction with row locks and ledger uniqueness keyed by match/player/kind/ref.
- Rationale: The repo tests include uniqueness and constraint checks for tags, awards, complaints, and leaderboard rows.
- Consequences:
  - Positive: reduces duplicate awards and stale transitions.
  - Negative: some operations become more serialized and more complex to reason about.
- Alternatives Rejected: Multiple independent writes without validation; duplicate ledger rows.
- Revisit Conditions: If the system needs a different concurrency model or ledger design.

## ADR 011 — Setup period before the head start, and proximity detection only while the zone is large
- ID: ADR-011
- Date: 2026-10-31 (approximate, needs verification)
- Status: Accepted
- Decision Type: Game rule / flow
- Context: The game needs an initial separation phase and should not trigger proximity alerts once the play area becomes too small.
- Options Considered:
  - Start immediately with no setup phase.
  - Begin proximity detection as soon as the game starts.
  - Use a setup period and radius-based trigger gating.
- Decision: A setup period runs before the head start and proximity detection only operates while the zone is still wide enough to matter.
- Rationale: The config values in `src/rules/config.ts` define the setup timers and the minimum detection radius.
- Consequences:
  - Positive: fairness and better real-world separation.
  - Negative: requires the organizer to schedule and enforce the pre-match setup correctly.
- Alternatives Rejected: Instant match start in the same location; detection all game long regardless of map size.
- Revisit Conditions: If the match format changes or the gameplay makes the setup phase unnecessary.

## ADR 012 — Public results only after the match ends, with a privacy projection and 24 h retention
- ID: ADR-012
- Date: 2026-11-01 (approximate, needs verification)
- Status: Accepted
- Decision Type: Privacy / feature
- Context: The game needs a public leaderboard without exposing live positions or sensitive match data.
- Options Considered:
  - Publish live match data.
  - Publish after the match ends with a public slug.
  - Publish after match end and delete positions after 24 h.
- Decision: Results are published only after the match ends, use an unguessable slug, and delete positions after 24 h.
- Rationale: The rules and results service explicitly record the slug and retention window, and the README states that positions are never public.
- Consequences:
  - Positive: public competition without live location leakage.
  - Negative: data retention and cleanup need to be monitored.
- Alternatives Rejected: Live leaderboard; guessable result codes; long-term position retention.
- Revisit Conditions: If a club or legal requirement changes the publication model.

## ADR 013 — No photos stored in the app
- ID: ADR-013
- Date: 2026-10-29 (approximate, needs verification)
- Status: Accepted
- Decision Type: Privacy / product
- Context: The club needs a game without storing sensitive imagery or personal media.
- Options Considered:
  - Allow user-uploaded photos.
  - Store only event metadata.
  - Store no photos at all.
- Decision: The app stores no photos; club documentation takes place outside the app.
- Rationale: This is a repeated repo rule and appears in the project documentation and game rules comments.
- Consequences:
  - Positive: stronger privacy and less data retention risk.
  - Negative: some club-documentation workflows must happen outside the app.
- Alternatives Rejected: Photo-based evidence or documentation in-app.
- Revisit Conditions: If a future requirement specifically needs evidence capture that is reviewed and approved.

## ADR 014 — Bun as package manager and test runner; `bun.lock` only
- ID: ADR-014
- Date: 2026-10-29 (approximate, needs verification)
- Status: Accepted
- Decision Type: Tooling
- Context: The project needs a single, consistent runtime and dependency manager.
- Options Considered:
  - npm / package-lock.json.
  - pnpm.
  - Bun with a single lockfile.
- Decision: Use Bun as the package manager and test runner, with a single `bun.lock` lockfile.
- Rationale: The repo scripts use `bun` throughout and `package.json` describes Bun as the active runtime and runner.
- Consequences:
  - Positive: consistent commands and faster local workflows.
  - Negative: any environment without Bun must install it first.
- Alternatives Rejected: Node/npm lockfile parity; mixed toolchains.
- Revisit Conditions: If the project needs a different runtime ecosystem or a multi-language build pipeline.

## ADR 015 — Survival minutes and alive points exclude the 5-minute head start
- ID: ADR-015
- Date: 2026-10-31 (approximate, needs verification)
- Status: Accepted
- Decision Type: Game rule / scoring
- Context: Alive points and survival metrics should measure actual active play, not the start-up setup and head start.
- Options Considered:
  - Count the entire timed match against survival scoring.
  - Exclude only the setup period.
  - Exclude the 5-minute head start and count only live play.
- Decision: Survival minutes and alive points are calculated excluding the 5-minute head start.
- Rationale: The rules config and scoring tests refer to a 5-minute head-start and this is part of the explicit match-flow behavior.
- Consequences:
  - Positive: the rules match the intended live-game timing.
  - Negative: players and organizers must understand the timing split between setup and live play.
- Alternatives Rejected: Counting the setup and head start as active play; a different scoring offset.
- Revisit Conditions: If the game format changes or the club explicitly changes the timing model.
