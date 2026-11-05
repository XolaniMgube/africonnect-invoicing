import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROME_PATH || "/opt/google/chrome/chrome",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
