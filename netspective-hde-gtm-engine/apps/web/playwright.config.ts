import { defineConfig, devices } from "@playwright/test";

// Browser test for Scenario C (feature 006, task T071). Run with `pnpm test:e2e`; it is not part of the
// default gate because it needs a browser (`pnpm --filter @gtm/web exec playwright install chromium`).
// It starts the API in memory with the fake providers (e2e/support/api-stack.ts) and the web app.

const API_PORT = 3999;
const WEB_PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx e2e/support/api-stack.ts",
      url: `http://127.0.0.1:${API_PORT}/api/v1/public/offers/ccda-to-fhir-mapping-decision-register/form`,
      env: { E2E_API_PORT: String(API_PORT), NODE_ENV: "test" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next dev -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}/public/offers/ccda-to-fhir-mapping-decision-register`,
      env: {
        API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        AUTH_SECRET: "e2e-secret",
        NODE_ENV: "development",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
