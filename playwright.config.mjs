// The site tests (tests/site.spec.mjs, #89): the test site's build
// (TEST_SITE=1, the made-up test data) served under /astronomy/, at phone
// and desktop width. npm test builds it first.
import { defineConfig } from "@playwright/test";

const PORT = 8790;
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: `http://localhost:${PORT}/astronomy/` },
  projects: [
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 900 } } },
  ],
  webServer: { command: `node tests/serve.mjs ${PORT}`, port: PORT, reuseExistingServer: !process.env.CI },
});
