// Batch 1 honesty fixes on the team pages (audit A1–A6, F2), including backend-down states
// (Playwright route abort, so no server needs to be stopped).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const OFFICIAL_ADVICE = 'Follow official IMD and state advisories.';
// never on these pages ("official" in lower case is allowed: "Follow official IMD and state advisories.")
const BANNED = [/Validated/i, /certified/i, /\bOfficial\b/, /Doppler/i, /XGBoost/i, /evacuat/i, /\bstable\b/i,
    /confidence[^.\n]{0,20}\d+(\.\d+)?\s*%/i, /\d+(\.\d+)?\s*%[^.\n]{0,20}confidence/i, /Confidential/i, /AI-Generated/i, /radar network/i];

async function stubImages(page) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
}
async function expectNoBanned(page, testid = null) {
    const text = await (testid ? page.getByTestId(testid) : page.locator('body')).innerText();
    for (const re of BANNED) expect(text, `banned ${re}`).not.toMatch(re);
}
async function zoneSource(page) {
    return (await (await page.request.get(`${API}/alerts?limit=380`)).json()).summary.source;
}
// backend down: short wake-retry timings (utils/serverWake.js) so the page gives up quickly
const abortBackend = async (page, pattern) => {
    await page.addInitScript(() => { window.__SERVER_WAKE__ = { retryMs: 200, budgetMs: 1500, attemptMs: 1000 }; });
    await page.route(pattern, (r) => r.abort());
};
const UNAVAILABLE = 'Server unavailable — please refresh in a minute.';

test('Analytics: rule-based labels, no validation/XGBoost/94.6%, donut draws with no console errors', async ({ page }) => {
    await stubImages(page);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const src = await zoneSource(page);
    await page.goto('/analytics');
    if (src === 'sample') {                     // safety net: no summary, donut or ranking on sample data
        await expect(page.getByTestId('sample-safety-net')).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Real-Time');
        await expectNoBanned(page);
        return;
    }
    await expect(page.getByTestId('analytics-model-label')).toHaveText('Rule-based indicator (not the ML model)');
    const label = { openweather: 'OpenWeather data', 'open-meteo': 'Open-Meteo data (model data)' }[src] || 'sample data';
    await expect(page.getByTestId('analytics-summary-source')).toHaveText(`Rule-based summary of ${label}`);
    await expect(page.getByText('Rule-based summary', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('94.6');
    await expect(page.locator('body')).not.toContainText('live sensor');
    await expectNoBanned(page);
    const paths = page.locator('[data-testid="donut-chart"] path');
    await expect(paths.first()).toBeVisible();
    for (const d of await paths.evaluateAll((ps) => ps.map((p) => p.getAttribute('d')))) expect(d).not.toContain('NaN');
    await page.waitForTimeout(800);
    expect(errors, errors.join('\n')).toEqual([]);
});

test('Analytics with the backend down: says the data is the built-in example', async ({ page }) => {
    await stubImages(page);
    await abortBackend(page, '**/batch_predict**');
    await page.goto('/analytics');
    await expect(page.getByTestId('analytics-summary-source')).toHaveText('Rule-based summary of built-in example data (server unavailable)');
});

test('Reports: every card labelled as an example; no official/Doppler/accuracy/Confidential claims; export footer honest', async ({ page }) => {
    await stubImages(page);
    await page.goto('/reports');
    await expect(page.getByTestId('honesty-banner-illustrative')).toBeVisible();
    const cards = page.getByTestId('report-example-label');
    await expect(cards).toHaveCount(4);
    for (const c of await cards.all()) await expect(c).toHaveText('Example report (illustrative)');
    await expect(page.locator('body')).not.toContainText('94.6');
    await expect(page.locator('body')).not.toContainText('zero false-negative');
    await expect(page.locator('body')).not.toContainText('Validation 9');
    await expectNoBanned(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export PDF/ }).first().click();
    const text = fs.readFileSync(await (await dl).path(), 'utf-8');
    expect(text).toContain('Example report (illustrative) - not an official bulletin');
    for (const re of BANNED) expect(text).not.toMatch(re);
});

test('Forecast: no confidence value, rule-based alert label, "Backend Synchronized" only after a successful fetch', async ({ page }) => {
    await stubImages(page);
    await page.goto('/forecast');
    await expect(page.getByTestId('forecast-backend-sync')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Model Confidence');
    await expect(page.locator('body')).not.toContainText('CRITICAL NOWCAST ALERT');
    const body = await page.locator('body').innerText();
    if (/Rule-based alert on/.test(body)) expect(body).toMatch(/Rule-based alert on (sample|OpenWeather) data/i);
    await expectNoBanned(page);
});

test('Forecast with the backend down: "Server unavailable", no built-in Mumbai record, no "Synchronized"', async ({ page }) => {
    await stubImages(page);
    await abortBackend(page, '**/batch_predict**');
    await page.goto('/forecast');
    await expect(page.getByTestId('forecast-status')).toHaveText(UNAVAILABLE);
    await expect(page.getByTestId('forecast-backend-sync')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Mumbai');
    await expectNoBanned(page);
});

test('Alerts: official-advisory line instead of action advice; no evacuation / stable text', async ({ page }) => {
    await stubImages(page);
    test.skip(await zoneSource(page) === 'sample', 'risk UI is hidden on sample data (safety net, sample_safety.spec.js)');
    await page.goto('/alerts');
    await expect(page.getByText(OFFICIAL_ADVICE).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('drainage');
    await expect(page.locator('body')).not.toContainText('Immediate action');
    await expectNoBanned(page);
});

test('Alerts with the backend down: "Server unavailable", badge not stuck on Loading, never "stable"', async ({ page }) => {
    await stubImages(page);
    await abortBackend(page, '**/alerts?limit=380');
    await page.goto('/alerts');
    await expect(page.getByTestId('alerts-error')).toHaveText(UNAVAILABLE);
    await expect(page.getByTestId('alerts-source-badge')).toHaveText('Server unavailable');
    await expect(page.locator('body')).not.toContainText('No alerts in this data');
    await expectNoBanned(page);
});

test('Dashboard banner: "(sample data, rule-based)" on sample data; backend down shows an error, never a "no high-risk" banner', async ({ page }) => {
    await stubImages(page);
    const src = await zoneSource(page);
    await page.goto('/');
    // HIGH zones: warning banner; none: the neutral info strip (calm-down fix)
    const summary = (await (await page.request.get(`${API}/alerts?limit=380`)).json()).summary;
    const banner = page.getByTestId(summary.high > 0 ? 'alert-banner-text' : 'info-strip-text');
    if (src === 'sample') {                     // safety net: no banner or strip on sample data
        await expect(page.getByTestId('sample-safety-net')).toBeVisible();
        await expect(page.getByTestId('alert-banner-text')).toHaveCount(0);
        await expect(page.getByTestId('info-strip')).toHaveCount(0);
    } else await expect(banner).not.toContainText('sample data');
    const p2 = await page.context().newPage();
    await stubImages(p2);
    await abortBackend(p2, '**/alerts?limit=380');
    await p2.goto('/');
    await expect(p2.getByText(UNAVAILABLE).first()).toBeVisible();
    await expect(p2.getByTestId('alert-banner-text')).toHaveCount(0);
    await expect(p2.getByTestId('info-strip')).toHaveCount(0);
    await expect(p2.locator('body')).not.toContainText('No high-risk zones');
});

test('Batch 1 screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    await stubImages(page);
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const r of ['analytics', 'reports', 'forecast', 'alerts', '']) {
            await page.goto(`/${r}`);
            await page.waitForTimeout(1500);
            await page.screenshot({ path: path.join(SHOTS, `batch1_${r || 'dashboard'}_${w}x${h}.png`) });
        }
    }
});
