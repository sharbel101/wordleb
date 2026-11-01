import { defineConfig } from '@playwright/test'

const PORT = 5199

// Uses the Chrome already installed on the machine, so no browser download is needed.
// Override with PW_CHANNEL=msedge if Chrome is not available.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Tests run against the production build (what players get), not the dev server.
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Baked in at build time. The Supabase calls are intercepted by the tests; nothing real is contacted.
      VITE_SUPABASE_URL: 'https://mock.supabase.test',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
