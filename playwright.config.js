// E2E checks for the ML Nowcast page. Needs all three servers running (see INTEGRATION.md):
// nowcast serve API, the team backend (/ml proxy) and the Vite dev server.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_APP_URL || 'http://localhost:5173';
// "Start here" opens on the first visit to /nowcast. Specs written before it start with it dismissed
// (as for a returning visitor); e2e/judge_first.spec.js clears this to test the first visit.
const START_HERE_DISMISSED = {
    cookies: [],
    origins: [{ origin: new URL(BASE_URL).origin, localStorage: [{ name: 'nowcast.startHere.dismissed', value: '1' }] }],
};

export default defineConfig({
    testDir: './e2e',
    timeout: 90_000,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: BASE_URL,
        storageState: START_HERE_DISMISSED,
        viewport: { width: 1600, height: 1000 },
        ...devices['Desktop Chrome'],
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1600, height: 1000 } } }],
});
