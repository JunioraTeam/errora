import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite. Two web servers are started automatically:
 *   - the Django backend (throwaway SQLite, seeded by `seed_e2e`) on :8000
 *   - the Next.js dev server on :3000, pointed at that backend
 *
 * Specs drive the real UI in English (`/en/...`) against the seeded account.
 * Run with `npm run e2e` (add `--ui` or `--headed` for debugging).
 */
// Dedicated e2e ports so the suite never collides with a developer's running
// dev stack (which uses a different, non-seeded database).
const API_URL = "http://localhost:8001";
const BASE_URL = "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  // Serialized: the whole suite shares one seeded SQLite-backed backend, and
  // parallel async writers would hit SQLite lock contention (500s).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "bash e2e/run-backend.sh",
      url: `${API_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Production build+start (not `next dev`): Next allows only one dev server
      // per project dir, so dev would clash with a developer's running server.
      // Built to an isolated dist dir so it can run alongside that dev server.
      command: "next build && next start -p 3001",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_API_URL: API_URL,
        NEXT_PUBLIC_OTP_ENABLED: "false",
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
