/**
 * Shadow Hunt rules package.
 *
 * Pure TypeScript. No Convex, no React, no database imports. Convex functions
 * and the client both import from here; Convex-specific validators live in
 * `src/convex/validators.ts` so this package stays portable.
 */

export { RULES_CONFIG, type MatchConfig } from "./config";
export * from "./types";
export * from "./zone";
export * from "./scoring";
export * from "./match";
export * from "./tags";
export * from "./rooms";
export * from "./complaints";
export * from "./teams";
export * from "./visibility";
