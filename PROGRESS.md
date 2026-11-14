# Progress

## 2026-11-14 — Initialized AI memory system
- Completed: Created the AI memory files and the session protocol, and preserved the existing Supabase setup and map tile guidance from the current README.
- Changed: Added root documentation for project orientation, current status, decision history, and session protocol.
- Problems Encountered: The environment was missing Bun, so Bun was installed before running the repo validation commands.
- Discoveries:
  - The repo validates successfully in the current workspace: `bun test` passed with 300 pass / 0 fail, `bun tsc -b --noEmit` passed, `bunx eslint src` passed with 10 warnings and no errors, and `bun run build` passed with chunk-size warnings only.
  - The project is not yet browser-verified and still has no real-phone GPS validation.
- Tests / Validation:
  - `bun test` → exit 0
  - `bun tsc -b --noEmit` → exit 0
  - `bunx eslint src` → exit 0, 10 warnings
  - `bun run build` → exit 0
- Decisions Made: Use plain Markdown memory files as the main AI context layer and keep the README stable while updating the status log and ADRs as needed.
- Next Steps: Verify Stage 7B with evidence; finish the tidy-up items; run the first browser simulation; continue to Stage 8.
- Notes: This is the current documentation baseline and must be updated with any significant new findings.

## 2026-11-02 — Supabase client migration and PGlite API flow
- Commit: `344a3ea`
- Completed: The frontend was migrated to the Supabase client path while the API and repository contract tests continued to use PGlite.
- Changed: The repo added the client-side data flow and moved development emphasis back onto the Supabase stack.
- Problems Encountered: Stage 7A work was still being reconciled with the client layer and the move away from Convex remained partial.
- Discoveries:
  - Three Stage 7A tests failed because API apps shared a process-global repository set; the fix was to isolate the repo set per app instance.
  - Postgres score columns were integers while the rules produce fractional points; this was fixed with a migration.
  - A scan test was using random positions outside the valid range.
- Tests / Validation: `bun test` passed in the current repo state; the stage-level validation is in the repo history but not browser-verified.
- Decisions Made: Keep the repository layer swappable and continue the move to Postgres-backed services.
- Next Steps: Verify the client data layer and continue the Convex removal plan.
- Notes: Needs verification — the reported 7B client work is not proven by a real browser run.

## 2026-11-02 — fix: complete stage 7a postgres API
- Commit: `484c783`
- Completed: The Stage 7A Postgres API was completed and the contract tests were stabilised.
- Changed: The server-side Postgres repository path was hardened and the API flow was completed.
- Problems Encountered: The earlier test pipeline showed stage-level drift as work crossed from the rules layer into server and client integration.
- Discoveries:
  - The earliest Stage 7A issues were consistent with a mismatch between the rules engine and the DB schema, especially on score precision and validation gaps.
  - Earlier test counts dropped only because a single folder was run in the suite, not because the rules were failing.
- Tests / Validation: The repo history reports this as a passing stage, and the current repo-level test suite confirms the rules/server path passes.
- Decisions Made: Use a Postgres-backed API with server-authoritative enforcement and keep the rules package pure.
- Next Steps: Confirm the live client path and keep removing legacy Convex code.
- Notes: Needs verification — this stage was reported as done but not proven in a real browser run.

## 2026-11-01 — chore: remove unused template UI, fix types and test paths
- Commit: `6deeb1c`
- Completed: Cleanup and housekeeping after the stage work; type and test path issues were fixed.
- Changed: Unused template UI and noise were removed, and repo structure was simplified.
- Problems Encountered: a small number of stale UI and test-path references needed cleanup before the repo read cleanly.
- Discoveries:
  - The repo still contains a legacy Convex path that is intentionally being removed in the later Stage 7B work.
  - The active runtime uses Supabase and the migration path is already present.
- Tests / Validation: Repo tests and the current build pass in this workspace; the remaining concerns are stage verification and browser-level proof.
- Decisions Made: Keep the codebase tidy and move toward a single active backend path.
- Next Steps: Continue to Stage 7B verification and final removal work.
- Notes: Needs verification — the client and browser path still need to be proven with a real run.

## 2026-11-01 — Stage 6 public leaderboard and Match Stats
- Commit: `6189b56`
- Completed: Public results and match stats work were merged.
- Changed: The game added a public leaderboard flow and privacy projection for result pages.
- Problems Encountered: The project was still in a staged process and multiple stage reports had not yet been fully verified in the browser.
- Discoveries:
  - Status is not the same as live verification: the result flow was added in code, but public result behavior still needs a real browser check.
  - Convex cannot run in Codespaces because the auth issuer variable belonged to the old Vly host.
- Tests / Validation: Repo tests passed in the current project state; browser verification is still missing.
- Decisions Made: Keep public results behind a privacy projection and publish only after the match ends.
- Next Steps: Verify the result flow in the browser and continue the Stage 7B migration work.
- Notes: Needs verification — public result flows and deployment assumptions have not been proven end-to-end.

## 2026-10-31 — Stage 5 completion and the setup-period add-on
- Commit: `a0b7422`
- Completed: Stage 5 was completed with the setup separation and proximity detection add-on.
- Changed: Setup period and proximity detection were added to the rules and service flow.
- Problems Encountered: Stage documentation and approval remained mixed across commits, which is why the memory files now formalise the current state.
- Discoveries:
  - The setup period is a real rule: the game separates players before the head start and only enables proximity detection once the zone is large enough.
  - The game rules are intentionally local and pure in `src/rules`.
- Tests / Validation: Current project tests pass; no real browser run was performed.
- Decisions Made: Keep setup logic and proximity detection as server-authoritative rules.
- Next Steps: Move into Stage 6 and then Stage 7A integration work.
- Notes: Needs verification — all stage-level claims remain code-level, not browser-level.
