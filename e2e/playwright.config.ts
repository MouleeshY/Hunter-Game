import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "bun e2e/api-server.ts",
      cwd: "..",
      url: "http://127.0.0.1:8787/__test/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "bunx vite --host 127.0.0.1 --port 5173 --strictPort",
      cwd: "..",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_SUPABASE_URL: "https://test-project.supabase.co",
        VITE_SUPABASE_ANON_KEY: "stage-7b-test-anon-key",
        VITE_API_URL: "",
      },
    },
  ],
});
