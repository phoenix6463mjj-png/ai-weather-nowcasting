// Calm-down fix (team pages): primary-threat card only for HIGH zones, one explanation (never "No
// explanation available" + "Reason"), neutral info strip without HIGH zones, "Fetched HH:MM UTC" labels,
// flash flood Low with no rain. Zone data is mocked in the browser (backend /alerts only).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const DATA_TIME = '2026-09-29T18:30Z';
const NO_RAIN = 'no rain in the last hour';

function zone(city, risk, { rain = 0, hum = 84, wind = 1.8, reason, flood, thunder, cloud, note = null, lat, lon }) {
    const w = { temperature: 27.3, humidity: hum, rainfall: rain, wind_speed: wind, wind, pressure: 1010,
        source: 'open-meteo', observed_at: null, data_time: DATA_TIME, conditions: 'Mainly clear' };
    const pred = { risk_level: risk, risk_label: { HIGH: 2, MODERATE: 1, LOW: 0 }[risk], risk_text: risk,
        prob_flood: flood, prob_thunderstorm: thunder, prob_cloudburst: cloud, flood_note: note };
    if (reason !== undefined) pred.reason = reason;
    return { city, state: 'Test State', lat, lon, risk_level: risk, risk, severity: risk, reason,
        temperature: 27.3, humidity: hum, rainfall: rain, wind_speed: wind, timestamp: '2026-09-30T00:08:02',
        weather: w, source: 'open-meteo', prediction: pred,
        probabilities: { flash_flood: flood, thunderstorm: thunder, cloudburst: cloud } };
}

const HIGH = zone('Highville', 'HIGH', { rain: 24.0, hum: 93, wind: 9, reason: 'Heavy rainfall indicates flood risk', flood: 0.85, thunder: 0.8, cloud: 0.75, lat: 26.1, lon: 91.7 });
const MOD = zone('Mumbai', 'MODERATE', { reason: `Moderate convective indicators observed; flash flood Low (${NO_RAIN})`, flood: 0.08, thunder: 0.4, cloud: 0.35, note: NO_RAIN, lat: 18.97, lon: 72.83 });
const BARE = zone('Quietpur', 'MODERATE', { reason: null, flood: 0.08, thunder: 0.4, cloud: 0.35, note: NO_RAIN, lat: 23.2, lon: 77.4 });

function summaryOf(alerts) {
    const n = (r) => alerts.filter((a) => a.risk_level === r).length;
    return { total: alerts.length, high: n('HIGH'), moderate: n('MODERATE'), low: n('LOW'), source: 'open-meteo',
        n_sample: 0, latest_observed_at: null, data_time: DATA_TIME };
}

async function mockZones(page, alerts, selected) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route((u) => u.port === '8000' && u.pathname === '/alerts', (r) => r.fulfill({
        json: { alerts, summary: summaryOf(alerts), last_updated: '2026-09-30T00:08:02' } }).catch(() => {}));
    if (selected) await page.addInitScript((c) => localStorage.setItem('selected_city', c), selected);
}

const panelOf = (page, city) => page.locator('h2', { hasText: city }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

test('primary-threat card: shown for a HIGH zone, hidden for a Moderate one (panel opens with the weather)', async ({ page: first }) => {
    let page = first;
    await mockZones(page, [HIGH, MOD], 'Highville');
    await page.goto('/');
    let panel = panelOf(page, 'Highville');
    await expect(panel.getByTestId('primary-threat')).toBeVisible();
    await expect(panel.getByTestId('primary-threat')).toContainText('Flash Flood');

    const p2 = await page.context().newPage();                       // fresh page with Mumbai selected
    await mockZones(p2, [HIGH, MOD], 'Mumbai');
    await p2.goto('/');
    page = p2;
    panel = panelOf(page, 'Mumbai');
    await expect(panel).toContainText('MODERATE RISK');
    await expect(panel.getByTestId('primary-threat')).toHaveCount(0);
    await expect(panel).not.toContainText('Primary Threat');
    // first section = weather tiles, then hazard indicators, then the explanation
    const order = await panel.evaluate((el) => {
        const t = (id) => el.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top;
        return [t('panel-weather-source'), t('hazard-levels'), t('rule-explanation')];
    });
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    await expect(panel.getByTestId('hazard-levels')).toContainText('Hazard indicators (rule-based, not the ML model)');
    // flash flood gate: Low with the note
    const flood = panel.locator('[data-testid="hazard-level"][data-hazard="flood"]');
    await expect(flood).toHaveAttribute('data-level', 'Low');
    await expect(flood.getByTestId('hazard-note')).toHaveText(`(${NO_RAIN})`);
    await expect(panel.getByTestId('panel-fetched')).toHaveText(/^Fetched \d\d:\d\d UTC$/);
    await expect(panel).not.toContainText('Last Updated');
});

test('explanation: the reason once, never together with "No explanation available"', async ({ page }) => {
    await mockZones(page, [MOD, BARE], 'Mumbai');
    await page.goto('/');
    let expl = panelOf(page, 'Mumbai').getByTestId('rule-explanation');
    await expect(expl).toContainText(`Reason: ${MOD.reason}`);
    await expect(expl).not.toContainText('No explanation available');
    expect(await panelOf(page, 'Mumbai').getByText(/^Reason:/).count()).toBe(1);

    const p2 = await page.context().newPage();
    await mockZones(p2, [MOD, BARE], 'Quietpur');
    await p2.goto('/');
    expl = panelOf(p2, 'Quietpur').getByTestId('rule-explanation');
    await expect(expl).toContainText('No explanation available');
    await expect(expl).not.toContainText('Reason');
});

test('no warning banner with 0 HIGH zones: neutral info strip; warning banner only with HIGH zones', async ({ page }) => {
    await mockZones(page, [MOD, BARE], 'Mumbai');
    await page.goto('/');
    await expect(page.getByTestId('info-strip-text')).toHaveText(
        'Rule-based indicators: 2 moderate, 0 high zones (Open-Meteo model data). Not an official warning.');
    await expect(page.getByTestId('alert-banner-text')).toHaveCount(0);
    await expect(page.getByText('Advisory', { exact: true })).toHaveCount(0);
    await expect(page.getByText('High Alert', { exact: true })).toHaveCount(0);

    const p2 = await page.context().newPage();
    await mockZones(p2, [HIGH, MOD], 'Highville');
    await p2.goto('/');
    await expect(p2.getByTestId('alert-banner-text')).toHaveText('High Risk in 1 locations');
    await expect(p2.getByTestId('info-strip')).toHaveCount(0);
});

test('Alerts page: "Fetched HH:MM UTC", no local-time "Last updated"', async ({ page }) => {
    await mockZones(page, [HIGH, MOD]);
    await page.goto('/alerts');
    await expect(page.getByText(/^Fetched \d\d:\d\d UTC$/).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Last updated');
    await expect(page.locator('body')).not.toContainText('Reported:');
});

test('calm-down screenshots of / and /alerts at 1920x1080 and 1366x768 (live backend data)', async ({ page }) => {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/');
        await expect(page.getByTestId('dashboard-source-badge')).not.toHaveText('Loading weather source…');
        await expect(page.getByTestId('rule-explanation').or(page.getByTestId('sample-safety-net'))).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, `calm_dashboard_${w}x${h}.png`) });
        await page.goto('/alerts');
        await expect(page.getByText(/^Fetched \d\d:\d\d UTC$/).first()).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, `calm_alerts_${w}x${h}.png`) });
    }
});
