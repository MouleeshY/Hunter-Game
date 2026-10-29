/**
 * Shadow Hunt rules package.
 *
 * Pure TypeScript. No Convex, no React. The only thing it re-exports is what
 * consumers need: config, types, and the pure functions that implement the
 * game rules.
 *
 * Consumers that care about the Convex shape of the config (for example the
 * schema) import the validator from `src/convex/rules/config` instead, because
 * the convex-specific validator uses `v` and belongs next to the schema. This
 * package stays database-independent.
 */

export { RULES_CONFIG, type MatchConfig } from "./config";
export * from "./types";
export * from "./zone";
export * from "./scoring";
export * from "./match";
export * from "./tags";
