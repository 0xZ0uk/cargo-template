import { defineConfig, devices } from '@playwright/test'

/**
 * Load and validate environment variables from `.env.schema`.
 * https://varlock.dev/integrations/javascript/
 */
import 'varlock/auto-load'

// Port of the dev server the specs start (`E2E_PORT`, default 3000). Set `E2E_BASE_URL` to test
// a server you started yourself instead (e.g. `vite preview`). It must use the local D1: the
// admin specs seed their user through the Local API.
const port = Number(process.env.E2E_PORT || 3000)
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${port}`

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* One worker, locally and on CI: the spec files share one database and seed the same admin
     user (delete + create), so running them in parallel makes one file's seed or cleanup delete
     the user another file is logging in as. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // `--strictPort`: if the port is taken, fail instead of testing whatever app holds it.
        command: `pnpm dev --port ${port} --strictPort`,
        // Locally, reuse a dev server you already started on that port. CI always starts its own.
        reuseExistingServer: !process.env.CI,
        // The first dev request compiles the admin. The local D1 must be migrated first
        // (`pnpm web migrate`): Payload doesn't push the schema.
        timeout: 180_000,
        url: baseURL,
        // The admin assistant answers with its scripted test model (localhost only, never with
        // APP_ENV=production or staging), so the assistant spec needs no OpenRouter key.
        env: { ASSISTANT_TEST_MODEL: '1' },
      },
})
