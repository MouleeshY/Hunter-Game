/**
 * Drives the HTTP API the way a phone would: a signed Supabase-style JWT, a
 * JSON body, a response. Everything runs against PGlite with the real
 * migrations, so a request here is the same request the API would serve on a
 * deployed Supabase project.
 */
import { SignJWT } from "jose";
import { createApiApp } from "../../../api/app";
import type { Hono } from "hono";
import {
  createPostgresTestDatabase,
  type TestDatabase,
} from "./pglite";

export const TICK_SECRET = "unit-test-tick-secret";
const JWT_SECRET = "unit-test-jwt-secret";

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export interface ApiHarness {
  db: TestDatabase;
  app: Hono;
  /** A valid HS256 Supabase token for a user id. */
  token(userId: string, options?: { email?: string; name?: string }): Promise<string>;
  post(
    path: string,
    body: unknown,
    options?: { token?: string | null; headers?: Record<string, string> },
  ): Promise<ApiResponse>;
  get(
    path: string,
    options?: { token?: string | null; headers?: Record<string, string> },
  ): Promise<ApiResponse>;
  close(): Promise<void>;
}

function headers(options?: {
  token?: string | null;
  headers?: Record<string, string>;
}): Record<string, string> {
  const result: Record<string, string> = { ...(options?.headers ?? {}) };
  if (options?.token) result.authorization = `Bearer ${options.token}`;
  return result;
}

export async function createApiHarness(): Promise<ApiHarness> {
  const db = await createPostgresTestDatabase();
  const app = createApiApp({
    provider: db.provider,
    verify: async (token) => {
      const { jwtVerify } = await import("jose");
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(JWT_SECRET),
        { algorithms: ["HS256"] },
      );
      const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
      return {
        userId: payload.sub as string,
        email: typeof payload.email === "string" ? payload.email : null,
        name: typeof metadata.full_name === "string" ? metadata.full_name : null,
      };
    },
    tickSecret: TICK_SECRET,
  });

  const call = async (
    method: "GET" | "POST",
    path: string,
    body: unknown,
    options?: { token?: string | null; headers?: Record<string, string> },
  ): Promise<ApiResponse> => {
    const response = await app.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...headers(options),
        },
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      json: text.length === 0 ? null : JSON.parse(text),
    };
  };

  return {
    db,
    app,
    token: async (userId, options = {}) =>
      await new SignJWT({
        user_metadata: options.name ? { full_name: options.name } : {},
        ...(options.email ? { email: options.email } : {}),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime("2h")
        .sign(new TextEncoder().encode(JWT_SECRET)),
    post: (path, body, options) => call("POST", path, body, options),
    get: (path, options) => call("GET", path, undefined, options),
    close: () => db.close(),
  };
}
