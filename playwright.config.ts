import { defineConfig } from "@playwright/test";

const port = 5174;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}/soberemsya-tg/`,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/soberemsya-tg/`,
    reuseExistingServer: !process.env.CI,
    env: { VITE_USE_MOCK_TELEGRAM: "true", VITE_USE_MOCK_API: "true" },
  },
});
