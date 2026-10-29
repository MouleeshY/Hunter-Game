/**
 * Convex boot wiring for the swappable data layer.
 *
 * This module is the seam between Convex and the repository abstractions. The
 * repository interfaces in `src/server/repos/` are database-independent; this
 * file binds the generated Convex API to them once, then the rest of the server
 * imports the bound `repos` object rather than touching Convex directly.
 *
 * Import this from your Convex mutations/queries so the bindings happen before
 * any repo use. With `bun convex dev --once` this runs as part of the Convex
 * function bundle.
 */

import { bindConvexRepos } from "./server/providers/convex/bound";

// Bind the Convex-generated read/write helpers into the repository module
// exactly once, so every repo call in the server goes through Convex.
bindConvexRepos();

export const repos = INTERNAL.repos as const;
