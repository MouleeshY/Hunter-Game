import { SignJWT } from "jose";

export const TEST_JWT_SECRET = "stage-7b-playwright-test-only-secret";
export const TEST_TICK_SECRET = "stage-7b-playwright-tick-secret";

export interface TestIdentity {
  id: string;
  name: string;
}

export interface BrowserSession {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: {
    id: string;
    aud: "authenticated";
    role: "authenticated";
    email: string;
    app_metadata: { provider: "google"; providers: ["google"] };
    user_metadata: { full_name: string; name: string };
    created_at: string;
  };
}

export async function makeTestJwt(identity: TestIdentity): Promise<string> {
  return new SignJWT({
    email: `${identity.id}@example.test`,
    role: "authenticated",
    user_metadata: {
      full_name: identity.name,
      name: identity.name,
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.id)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

export async function makeBrowserSession(
  identity: TestIdentity,
): Promise<BrowserSession> {
  const accessToken = await makeTestJwt(identity);
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 7200,
    expires_at: nowSeconds + 7200,
    refresh_token: `test-refresh-${identity.id}`,
    user: {
      id: identity.id,
      aud: "authenticated",
      role: "authenticated",
      email: `${identity.id}@example.test`,
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: { full_name: identity.name, name: identity.name },
      created_at: new Date().toISOString(),
    },
  };
}
