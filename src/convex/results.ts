/**
 * Public results (Stage 6).
 *
 * These functions only resolve auth and shape arguments. The projection, the
 * publication rules and the stats live in `src/server/results.ts`, behind the
 * repositories, so they can be tested without a deployment.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getPlayerResult,
  getPublicResult,
  getResultTools,
  getResultToolsBySlug,
  listPublicResults,
  setResultPublished,
} from "../server/results";

/** The public page itself: no account needed, null until the result is public. */
export const getPublic = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await getPublicResult(ctx, { slug: args.slug });
  },
});

/** Published results, newest first; `club` narrows it to one club. */
export const listPublic = query({
  args: { club: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await listPublicResults(ctx, { club: args.club ?? null });
  },
});

/** The Match End screen: own breakdown, rank and who caught whom. */
export const mine = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    return await getPlayerResult(ctx, { matchId: args.matchId, userId });
  },
});

/** Organiser tools for the lobby after the whistle. */
export const manage = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await getResultTools(ctx, { matchId: args.matchId, userId });
  },
});

/** Organiser tools on the public page; null for everyone else, signed in or not. */
export const tools = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    return await getResultToolsBySlug(ctx, { slug: args.slug, userId });
  },
});

/** Publish or hide a finished result. Organiser only, audited. */
export const publish = mutation({
  args: { matchId: v.id("matches"), publish: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    return await setResultPublished(ctx, {
      matchId: args.matchId,
      userId,
      publish: args.publish,
    });
  },
});
