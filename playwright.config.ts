import { defineConfig } from "@playwright/test";

// E2E is kept out of `pnpm test`. Run `pnpm test:e2e` after `pnpm exec playwright install chromium`.
export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
  use: { baseURL: "http://localhost:3000" },
});
