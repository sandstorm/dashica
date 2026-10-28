import {defineConfig, devices} from '@playwright/test';

// E2E suite for the workbench flows (docs/2026-10-28-workbench.md §3.10).
//
// Prerequisites (NOT started by this config — see e2e/README.md):
//   1. frontend bundle built (user runs the build),
//   2. dev ClickHouse with sample data,
//   3. the app serving on DASHICA_E2E_BASE_URL (default http://127.0.0.1:8081).
export default defineConfig({
    testDir: './e2e',
    // The app is shared state: run serially.
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 30_000,
    expect: {timeout: 15_000}, // charts appear after debounce (~400ms) + ClickHouse query
    use: {
        baseURL: process.env.DASHICA_E2E_BASE_URL || 'http://127.0.0.1:8081',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {name: 'chromium', use: {...devices['Desktop Chrome']}},
    ],
});
