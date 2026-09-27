// E2E checks for the ML Nowcast page. Needs all three servers running (see INTEGRATION.md):
// nowcast serve API, the team backend (/ml proxy) and the Vite dev server.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 90_000,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: process.env.E2E_APP_URL || 'http://localhost:5173',
        viewport: { width: 1600, height: 1000 },
        ...devices['Desktop Chrome'],
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1600, height: 1000 } } }],
});
