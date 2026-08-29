import { defineConfig, devices } from "@playwright/test";
import * as nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

function requireLoopbackUrl(value: string, label: string): void {
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`${label} must point to a loopback instance for browser tests.`);
  }
}

// This suite creates and decides requests. Refuse remote app or database URLs
// before Playwright starts or reuses a web server.
requireLoopbackUrl(baseURL, "PLAYWRIGHT_BASE_URL");
if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  requireLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The portal projects intentionally share one seeded local database.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: process.env.CI ? "pnpm build && pnpm start" : "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
      grepInvert: /@mobile/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
      grep: /@mobile/,
    },
  ],
});
