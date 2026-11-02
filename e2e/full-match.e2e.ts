import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  makeBrowserSession,
  makeTestJwt,
  TEST_TICK_SECRET,
  type TestIdentity,
} from "./testAuth";

const ORGANISER: TestIdentity = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "E2E Organiser",
};
const PLAYERS: TestIdentity[] = [
  { id: "33333333-3333-4333-8333-333333333301", name: "E2E Player 1" },
  { id: "33333333-3333-4333-8333-333333333302", name: "E2E Player 2" },
  { id: "33333333-3333-4333-8333-333333333303", name: "E2E Player 3" },
  { id: "33333333-3333-4333-8333-333333333304", name: "E2E Player 4" },
];
const STORAGE_KEY = "sb-test-project-auth-token";

interface E2eMatch {
  id: string;
  room_code: string;
  public_slug: string;
  zone_lat: number;
  zone_lng: number;
}

interface E2ePlayer {
  auth_id: string;
  role: "hunter" | "shadow";
  qr_token: string;
}

async function responseJson<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`Test support endpoint failed (${response.status()}).`);
  }
  const body: unknown = await response.json();
  return body as T;
}

async function seedSession(page: Page, identity: TestIdentity): Promise<void> {
  const session = await makeBrowserSession(identity);
  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: session },
  );
}

async function switchIdentity(page: Page, identity: TestIdentity): Promise<void> {
  const session = await makeBrowserSession(identity);
  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: session },
  );
  await page.goto("/play");
}

async function waitForApi(response: Promise<unknown>): Promise<void> {
  await response;
}

test("plays a complete Supabase-backed match with two contexts and simulated GPS", async ({
  browser,
  request,
}) => {
  const organizerContext = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 51.5074, longitude: -0.1278 },
  });
  const playerContext = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 51.5074, longitude: -0.1278 },
  });
  const organizerPage = await organizerContext.newPage();
  const playerPage = await playerContext.newPage();
  let publicContext: BrowserContext | null = null;

  try {
    await organizerPage.goto("/");
    await seedSession(organizerPage, ORGANISER);
    await organizerPage.goto("/play");
    await organizerPage.getByRole("button", { name: /Create a room/ }).click();
    await organizerPage.locator('[name="matchTitle"]').fill("Stage 7B browser match");
    await organizerPage.locator('[name="invigilatorOne"]').fill("E2E Invigilator One");
    await organizerPage.locator('[name="invigilatorTwo"]').fill("E2E Invigilator Two");
    const createResponse = organizerPage.waitForResponse(
      (response) => response.url().includes("/api/rooms/createRoom"),
    );
    await organizerPage.getByRole("button", { name: "Create room", exact: true }).click();
    await createResponse;
    await expect(organizerPage.getByText("Room code")).toBeVisible();

    const matchResponse = await request.get(
      `http://127.0.0.1:8787/__test/match?authId=${ORGANISER.id}`,
    );
    const match = await responseJson<E2eMatch | null>(matchResponse);
    if (!match) throw new Error("The API did not create an E2E match.");
    const accelerated = await request.post(
      "http://127.0.0.1:8787/__test/accelerate",
      { data: { matchId: match.id } },
    );
    expect(accelerated.ok()).toBe(true);

    for (const [index, identity] of PLAYERS.entries()) {
      if (index === 0) {
        await playerPage.goto("/");
        await seedSession(playerPage, identity);
        await playerPage.goto("/play");
      } else {
        await switchIdentity(playerPage, identity);
      }
      await playerPage.getByRole("button", { name: /Join a room/ }).click();
      await playerPage.locator('[name="roomCode"]').fill(match.room_code);
      await playerPage.locator('[name="callSign"]').fill(`E2E${index + 1}`);
      await playerPage.locator('[name="displayName"]').fill(identity.name);
      const joinResponse = playerPage.waitForResponse(
        (response) => response.url().includes("/api/rooms/joinRoom"),
      );
      await playerPage.getByRole("button", { name: "Join room", exact: true }).click();
      await waitForApi(joinResponse);
      const briefingResponse = playerPage.waitForResponse(
        (response) =>
          response.url().includes("/api/rooms/acknowledgeBriefing"),
      );
      await playerPage.getByRole("button", { name: "I understand" }).click();
      await waitForApi(briefingResponse);
    }

    await expect(organizerPage.getByText(/4 \/ 40/)).toBeVisible();
    await organizerPage.getByRole("button", { name: "Lock roster" }).click();
    await expect(organizerPage.getByRole("button", { name: "Start setup" })).toBeEnabled();
    await organizerPage.getByRole("button", { name: "Start setup" }).click();
    await expect(organizerPage.getByText(/^Setup period —/)).toBeVisible();

    const beginHeadStartResponse = () =>
      organizerPage.waitForResponse((response) =>
        response.url().includes("/api/rooms/beginHeadStartRoom"),
      );
    let headStartResponse = beginHeadStartResponse();
    await organizerPage.getByRole("button", { name: "Start the head start" }).click();
    const forceHeadStart = organizerPage.getByRole("button", {
      name: "Yes, start anyway",
    });
    let response = await headStartResponse;
    if (!response.ok()) {
      await expect(forceHeadStart).toBeVisible();
      headStartResponse = beginHeadStartResponse();
      await forceHeadStart.click();
      response = await headStartResponse;
    }
    expect(response.ok()).toBe(true);
    const headStartResult: unknown = await response.json();
    expect(headStartResult).toMatchObject({ status: "headstart" });
    await expect(organizerPage.getByText("Match live")).toBeVisible();

    const tickResponse = await request.post("/api/tick", {
      headers: { "x-tick-secret": TEST_TICK_SECRET },
      data: {},
    });
    expect(tickResponse.ok()).toBe(true);
    await expect(organizerPage.getByText("Match live")).toBeVisible();

    const playersResponse = await request.get(
      `http://127.0.0.1:8787/__test/players?matchId=${match.id}`,
    );
    const playerRows = await responseJson<E2ePlayer[]>(playersResponse);
    const hunter = playerRows.find((player) => player.role === "hunter");
    const shadow = playerRows.find((player) => player.role === "shadow");
    if (!hunter || !shadow) throw new Error("The server did not assign both teams.");

    for (const identity of [hunter.auth_id, shadow.auth_id]) {
      const token = await makeTestJwt({
        id: identity,
        name: identity === hunter.auth_id ? "E2E Hunter" : "E2E Shadow",
      });
      const uploaded = await request.post("/api/matches/uploadPosition", {
        headers: { authorization: `Bearer ${token}` },
        data: {
          matchId: match.id,
          lat: match.zone_lat,
          lng: match.zone_lng,
          accuracyMetres: 5,
        },
      });
      expect(uploaded.ok()).toBe(true);
    }

    await playerContext.setGeolocation({
      latitude: match.zone_lat,
      longitude: match.zone_lng,
    });
    await switchIdentity(
      playerPage,
      PLAYERS.find((player) => player.id === hunter.auth_id) ?? {
        id: hunter.auth_id,
        name: "E2E Hunter",
      },
    );
    await playerPage.goto(`/match/${match.room_code}`);
    await playerPage.getByRole("button", { name: "Enable location" }).click();
    await expect(playerPage.getByText("GPS live")).toBeVisible();
    await playerPage.getByRole("button", { name: "Scan a code" }).click();
    await playerPage.getByPlaceholder("Paste a QR token").fill(shadow.qr_token);
    const scanResponse = playerPage.waitForResponse(
      (response) => response.url().includes("/api/matches/submitTagScan"),
    );
    await playerPage.getByRole("button", { name: "Scan", exact: true }).click();
    await scanResponse;
    await expect(playerPage.getByText(/Tagged .* points/)).toBeVisible();

    const status = async () => {
      const response = await request.get(
        `http://127.0.0.1:8787/__test/status?matchId=${match.id}`,
      );
      const result = await responseJson<{ status: string } | null>(response);
      return result?.status;
    };
    if ((await status()) !== "ended") {
      await organizerPage.getByRole("button", { name: "End match" }).click();
    }
    await expect.poll(status).toBe("ended");
    const organizerToken = await makeTestJwt(ORGANISER);
    const managedResult = await request.post("/api/results/manage", {
      headers: { authorization: ["Bearer", organizerToken].join(" ") },
      data: { matchId: match.id },
    });
    expect(managedResult.ok()).toBe(true);
    const resultTools: unknown = await managedResult.json();
    expect(resultTools).toMatchObject({ canPublish: true });
    const publishButton = organizerPage.getByRole("button", {
      name: "Publish result",
    });
    await expect(publishButton).toBeEnabled();
    await publishButton.click();
    await expect(organizerPage.getByRole("button", { name: "Unpublish result" })).toBeVisible();

    publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`/results/${match.public_slug}`);
    await expect(
      publicPage.getByRole("heading", { name: "Stage 7B browser match" }),
    ).toBeVisible();
    await expect(publicPage.getByText("Shadows win")).toBeVisible();
  } finally {
    await publicContext?.close();
    await organizerContext.close();
    await playerContext.close();
  }
});
