# Copilot Instructions

## Project rules
- Game rules live in `src/rules` and stay pure.
- All database access goes through the repositories.
- Tag validation, zone, scoring and visibility are enforced on the server only.
- No photos stored. Live positions never public.
- Do not change any game rule or number without asking the project owner.
- No `any`, `@ts-ignore`, eslint-disable or loosened config.
- Before reporting, run plain `bun test` (no folder arguments), `bun tsc -b --noEmit`, `bunx eslint src`, and `bun run build` and show real output tails. Never call work done while a test fails.
- One stage at a time; report and wait for approval.

## AI Development Guidelines
Start of every session:
1. Read README.md, then STATUS.md, then recent PROGRESS.md entries, then relevant DECISIONS.md entries.
2. Inspect the real code before making a change; code wins over stale markdown.
3. Fix any discrepancy between docs and code, but do not change game rules or numbers without owner approval.

End of every meaningful session:
1. Update STATUS.md (remove obsolete items, update date and next steps).
2. Add a new PROGRESS.md entry at the top.
3. Add or supersede an ADR if a significant decision was made.
4. Update README.md only if stable structure, setup or purpose changed.

Never claim work was completed or tested unless it was.
