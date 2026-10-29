/**
 * Thin typebox helpers re-exported for the rules layer only.
 *
 * This exists so the rules packages can keep using typebox shapes without
 * re-exporting `v` itself. The schema layer already owns the real Convex
 * validators; this module just forwards the helpers the rule files choose to
 * use.
 */

export { type Infer } from "convex/values";
