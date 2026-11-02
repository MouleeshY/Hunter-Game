import { jwtVerify } from "jose";
import { createApiApp } from "../api/app";
import { createPostgresTestDatabase } from "../src/server/tests/testSupport/pglite";
import {
  TEST_JWT_SECRET,
  TEST_TICK_SECRET,
} from "./testAuth";

const database = await createPostgresTestDatabase();
const api = createApiApp({
  provider: database.provider,
  verify: async (token) => {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(TEST_JWT_SECRET),
      { algorithms: ["HS256"] },
    );
    if (typeof payload.sub !== "string") {
      throw new Error("Test JWT has no subject.");
    }
    const metadata = payload.user_metadata;
    const name =
      typeof metadata === "object" &&
      metadata !== null &&
      "full_name" in metadata &&
      typeof metadata.full_name === "string"
        ? metadata.full_name
        : null;
    return {
      authId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name,
    };
  },
  tickSecret: TEST_TICK_SECRET,
  publishNudge: async () => {},
});

async function handleTestRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/__test/health") {
    return Response.json({ ready: true });
  }
  if (url.pathname === "/__test/match") {
    const authId = url.searchParams.get("authId");
    if (!authId) return Response.json({ error: "authId required" }, { status: 400 });
    const matches = await database.query<{
      id: string;
      room_code: string;
      public_slug: string;
      zone_lat: number;
      zone_lng: number;
    }>(
      `select id, room_code, public_slug, zone_lat, zone_lng
         from matches
        where created_by = (select id from users where auth_id = $1::uuid)
        order by created_at desc
        limit 1`,
      [authId],
    );
    return Response.json(matches[0] ?? null);
  }
  if (url.pathname === "/__test/players") {
    const matchId = url.searchParams.get("matchId");
    if (!matchId) return Response.json({ error: "matchId required" }, { status: 400 });
    const players = await database.query<{
      auth_id: string;
      role: "hunter" | "shadow";
      qr_token: string;
    }>(
      `select u.auth_id, p.role, p.qr_token
         from players p join users u on u.id = p.user_id
        where p.match_id = $1::uuid`,
      [matchId],
    );
    return Response.json(players);
  }
  if (url.pathname === "/__test/accelerate" && request.method === "POST") {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("matchId" in body) ||
      typeof body.matchId !== "string"
    ) {
      return Response.json({ error: "matchId required" }, { status: 400 });
    }
    await database.query(
      `update matches
          set config = jsonb_set(
            jsonb_set(config, '{headStartMinutes}', '0'::jsonb),
            '{setupDurationSeconds}', '0'::jsonb
          ),
              published = false
        where id = $1::uuid`,
      [body.matchId],
    );
    return Response.json({ ok: true });
  }
  if (url.pathname === "/__test/status") {
    const matchId = url.searchParams.get("matchId");
    if (!matchId) return Response.json({ error: "matchId required" }, { status: 400 });
    const rows = await database.query<{ status: string }>(
      "select status from matches where id = $1::uuid",
      [matchId],
    );
    return Response.json(rows[0] ?? null);
  }
  return null;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 8787,
  fetch: async (request) =>
    (await handleTestRequest(request)) ?? api.fetch(request),
});

console.log(`PGlite test API ready at ${server.url}`);

async function shutdown(): Promise<void> {
  server.stop();
  await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
