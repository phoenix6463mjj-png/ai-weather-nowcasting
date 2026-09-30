// Pre-hosting fix: Alerts card sentence = the rule(s) that fired (backend rules_fired); "N min ago" and
// "Fetched HH:MM UTC" from the backend's UTC times (browser in India time); Forecast has no hourly outlook.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const HOURLY = 'Hourly forecasts are not available on this page. Calibrated 1–6 h nowcasts: ML Nowcast →';

test.use({ timezoneId: 'Asia/Kolkata' });           // browser 5:30 h ahead of UTC

function zone(city, risk, rules, { rain = 0, hum = 84, wind = 1.8, ts }) {
    const sev = risk;
    return { city, state: 'Test State', lat: 20, lon: 78, risk_level: risk, risk, severity: sev,
        type: risk === 'LOW' ? 'Normal' : 'Moderate Risk', message: `${risk} in ${city}`, rules_fired: rules,
        reason: 'r', temperature: 27.3, humidity: hum, rainfall: rain, wind_speed: wind, timestamp: ts,
        weather: { temperature: 27.3, humidity: hum, rainfall: rain, wind_speed: wind, source: 'open-meteo',
            observed_at: null, data_time: '2026-09-30T18:00Z' },
        source: 'open-meteo', prediction: { risk_level: risk }, probabilities: { flash_flood: 0.08, thunderstorm: 0.4, cloudburst: 0.35 } };
}

async function mock(page, alerts, lastUpdated) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    const n = (r) => alerts.filter((a) => a.risk_level === r).length;
    const summary = { total: alerts.length, high: n('HIGH'), moderate: n('MODERATE'), low: n('LOW'),
        source: 'open-meteo', n_sample: 0, latest_observed_at: null, data_time: '2026-09-30T18:00Z' };
    await page.route((u) => u.port === '8000' && u.pathname === '/alerts', (r) => r.fulfill({
        json: { alerts, summary, last_updated: lastUpdated } }).catch(() => {}));
    await page.route((u) => u.port === '8000' && u.pathname === '/batch_predict', (r) => r.fulfill({ json: alerts }).catch(() => {}));
}

const card = (page, city) => page.locator('h3', { hasText: city }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');

test('Alerts cards: the sentence names the rule(s) that fired, never a generic "rainfall or wind" line', async ({ page }) => {
    const ts = new Date().toISOString();
    await mock(page, [
        zone('Highville', 'HIGH', ['Humidity above 90 % with wind above 8 m/s'], { hum: 95, wind: 9, ts }),
        zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], { ts }),
        zone('Windpur', 'MODERATE', ['Rain above 5 mm in the last hour', 'Wind above 6 m/s'], { rain: 6.2, hum: 50, wind: 7, ts }),
        zone('Calmabad', 'LOW', [], { hum: 50, ts }),
    ], ts);
    await page.goto('/alerts');
    await expect(card(page, 'Mumbai')).toContainText('Humidity above 70 % (rule-based).');
    // HIGH from humidity + wind: no hazard named (primary_threat.spec.js)
    await expect(card(page, 'Highville')).toContainText('Rule-based HIGH: Humidity above 90 % with wind above 8 m/s.');
    await expect(card(page, 'Windpur')).toContainText('Rain above 5 mm in the last hour; Wind above 6 m/s (rule-based).');
    await expect(card(page, 'Calmabad')).toContainText('No rule-based hazard flagged for this zone.');
    const body = page.locator('body');
    await expect(body).not.toContainText('rainfall or wind');
    await expect(body).not.toContainText('Heavy rainfall may cause flooding');
    await expect(body).not.toContainText('Severe thunderstorm activity');
});

test('Alerts: "N min ago" and "Fetched HH:MM UTC" from the backend UTC time (browser in India time)', async ({ page }) => {
    const t = new Date(Date.now() - 7 * 60_000 - 5_000);
    const iso = t.toISOString().replace(/\.\d{3}Z$/, 'Z');           // as the backend emits it
    await mock(page, [zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], { ts: iso })], iso);
    await page.goto('/alerts');
    await expect(card(page, 'Mumbai').getByTestId('alert-card-source')).toHaveText('Live • 7 min ago');
    await expect(page.getByText(`Fetched ${iso.slice(11, 16)} UTC`, { exact: true }).first()).toBeVisible();
});

test('Alerts: a naive (no time zone) backend time is not read as browser-local time', async ({ page }) => {
    const naive = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 19);    // no Z
    await mock(page, [zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], { ts: naive })], naive);
    await page.goto('/alerts');
    await expect(card(page, 'Mumbai').getByTestId('alert-card-source')).toHaveText('Live • Just now');   // falls back to the fetch time
    await expect(page.getByText(/^Fetched \d\d:\d\d UTC$/).first()).toBeVisible();
});

test('Forecast: no hourly outlook; one line linking to the ML Nowcast', async ({ page }) => {
    const ts = new Date().toISOString();
    await mock(page, [zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], { ts })], ts);
    await page.goto('/forecast');
    const note = page.getByTestId('forecast-hourly-note');
    await expect(note).toHaveText(HOURLY);
    await expect(note.getByRole('link', { name: 'ML Nowcast →' })).toHaveAttribute('href', '/nowcast');
    await expect(page.locator('input[type="range"]')).toHaveCount(0);
    const text = await page.locator('main').innerText();
    for (const s of ['+1h', '+2h', '+3h', '+4h', '0–4', 'Rainfall Trend Chart', 'Risk Progression', 'Now vs +4h',
        'Projection', 'projected', 'expected in +', 'Trajectory', 'Surge', 'Extrapolation', 'extrapolat']) {
        expect(text, s).not.toContain(s);
    }
    await expect(page.getByTestId('forecast-backend-sync')).toBeVisible();
    await expect(page.locator('main')).toContainText('84%');                         // current values still shown
});

test('pre-hosting screenshots of /alerts and /forecast at 1920x1080 and 1366x768 (live backend data)', async ({ page }) => {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/alerts');
        await expect(page.getByTestId('alert-card-source').first().or(page.getByTestId('sample-safety-net'))).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, `prehost_alerts_${w}x${h}.png`) });
        await page.goto('/forecast');
        await expect(page.getByTestId('forecast-hourly-note')).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, `prehost_forecast_${w}x${h}.png`) });
        await page.getByTestId('forecast-hourly-note').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `prehost_forecast_note_${w}x${h}.png`) });
    }
});

test('Alerts wording: zones monitored, rule-based subtitle with ML Nowcast link, card captions', async ({ page }) => {
    const ts = new Date().toISOString();
    await mock(page, [
        zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], { ts }),
        zone('Calmabad', 'LOW', [], { hum: 50, ts }),
    ], ts);
    await page.goto('/alerts');
    const sub = page.getByTestId('alerts-subtitle');
    await expect(sub).toHaveText('Rule-based indicators from current weather (not the ML model). ML forecasts: ML Nowcast →');
    await expect(sub.getByRole('link', { name: 'ML Nowcast →' })).toHaveAttribute('href', '/nowcast');
    await expect(page.getByTestId('alerts-card-total')).toContainText('Zones monitored');
    await expect(page.getByTestId('alerts-card-total')).toContainText('2');
    await expect(page.getByTestId('alerts-card-total')).toContainText('rule-based indicators from current weather');
    await expect(page.getByTestId('alerts-card-moderate')).toContainText('Moderate on rule-based indicators');
    await expect(page.getByTestId('alerts-card-low')).toContainText('No rule fired');
    const text = await page.locator('main').innerText();
    for (const s of ['Total Alerts', 'Active alerts across India', 'Real-time weather threats', 'emergency notifications',
        'Advisory watch status', 'Controlled baseline']) expect(text, s).not.toContain(s);
});
