import { defineConfig } from "@playwright/test";

const port = 5174;
const previewPort = 4174;

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
  projects: [
    { name: "app", testIgnore: /csp\.spec\.ts/ },
    // The production build carries the CSP; checked on its own server.
    {
      name: "csp",
      testMatch: /csp\.spec\.ts/,
      use: { baseURL: `http://localhost:${previewPort}/soberemsya-tg/` },
    },
  ],
  webServer: [
    {
      command: `vite --port ${port} --strictPort`,
      url: `http://localhost:${port}/soberemsya-tg/`,
      reuseExistingServer: !process.env.CI,
      env: { VITE_USE_MOCK_TELEGRAM: "true", VITE_USE_MOCK_API: "true" },
    },
    {
      command: `vite build --outDir dist-e2e --emptyOutDir && vite preview --outDir dist-e2e --port ${previewPort} --strictPort`,
      url: `http://localhost:${previewPort}/soberemsya-tg/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        VITE_USE_MOCK_TELEGRAM: "true",
        VITE_USE_MOCK_API: "true",
        VITE_SERVER_FUNCTION_URL: "https://example.supabase.co/functions/v1/telegram-api",
      },
    },
  ],
});
