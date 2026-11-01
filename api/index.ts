/**
 * The API entry point.
 *
 * Deployable two ways from the same module:
 *
 *   plain Node server   → `api/node.ts` (node:http, no framework adapter)
 *   serverless function → import `createApp()` and expose `app.fetch`, which is
 *                         the standard Hono handler shape (Vercel, Netlify,
 *                         Cloudflare Workers, Bun.serve)
 *
 * Server-only by construction: it reads `DATABASE_URL`, `SUPABASE_JWT_SECRET`
 * (or `SUPABASE_URL`) and `TICK_SECRET` from the process environment. Nothing
 * here is imported by the browser bundle.
 */
import { createApiApp } from "./app";
import { createVerifierFromEnv } from "./auth";
import { getPostgresProvider } from "../src/server/providers/postgres";
import type { Hono } from "hono";

export { createApiApp } from "./app";
export type { ApiDeps } from "./app";

export type ApiEnv = {
  DATABASE_URL?: string;
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_URL?: string;
  TICK_SECRET?: string;
  DATA_PROVIDER?: string;
};

/** The app, wired to the process environment. */
export function createApp(env: ApiEnv = process.env as ApiEnv): Hono {
  return createApiApp({
    provider: getPostgresProvider(env.DATABASE_URL),
    verify: createVerifierFromEnv(env),
    tickSecret: env.TICK_SECRET,
  });
}

let app: Hono | null = null;

/** Lazy singleton, so importing this module never opens a connection. */
export function getApp(): Hono {
  if (app === null) app = createApp();
  return app;
}

/**
 * The serverless handler: `export default createApp().fetch` is the shape
 * every function platform accepts.
 */
export default {
  fetch: (request: Request) => getApp().fetch(request),
};
