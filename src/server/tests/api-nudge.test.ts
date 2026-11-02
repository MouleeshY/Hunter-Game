import { describe, expect, it } from "bun:test";
import { createApiApp } from "../../../api/app";
import { createPostgresTestDatabase } from "./testSupport/pglite";

describe("API Realtime nudges", () => {
  it("publishes the match id after a successful mutation commits", async () => {
    const database = await createPostgresTestDatabase();
    const published: string[] = [];
    const app = createApiApp({
      provider: database.provider,
      verify: async () => ({
        authId: "11111111-1111-4111-8111-111111111111",
        email: "organiser@example.test",
        name: "Organiser",
      }),
      tickSecret: "test-tick-secret",
      publishNudge: async (matchId) => {
        const rows = await database.query<{ id: string }>(
          "select id from matches where id = $1::uuid",
          [matchId],
        );
        expect(rows).toHaveLength(1);
        published.push(matchId);
      },
    });

    try {
      const response = await app.fetch(
        new Request("http://api.test/api/rooms/createRoom", {
          method: "POST",
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            matchDurationMinutes: 60,
            organiserLat: 51.5074,
            organiserLng: -0.1278,
            invigilatorNames: ["Ines", "Kwame"],
          }),
        }),
      );
      const result: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(result).toHaveProperty("matchId");
      expect(published).toEqual([
        (result as { matchId: string }).matchId,
      ]);
    } finally {
      await database.close();
    }
  });

  it("does not publish a nudge for a refused mutation", async () => {
    const database = await createPostgresTestDatabase();
    const published: string[] = [];
    const app = createApiApp({
      provider: database.provider,
      verify: async () => ({
        authId: "11111111-1111-4111-8111-111111111111",
        email: null,
        name: null,
      }),
      tickSecret: "test-tick-secret",
      publishNudge: async (matchId) => {
        published.push(matchId);
      },
    });

    try {
      const response = await app.fetch(
        new Request("http://api.test/api/rooms/startRoom", {
          method: "POST",
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            matchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          }),
        }),
      );

      expect(response.status).toBe(400);
      expect(published).toEqual([]);
    } finally {
      await database.close();
    }
  });
});
