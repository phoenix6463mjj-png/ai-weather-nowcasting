// Team pages: a hazard is named only when the fired rule points to it (the team's rain rule -> Flash Flood).
// A HIGH zone from humidity + wind with only 0.4 mm of rain (flat scores flood 0.85 > thunder 0.80, which
// used to make it "Flash Flood") names no hazard on "/", Alerts or Forecast. Zones mocked in the browser.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const T = '2026-10-01T13:45Z';
const HUM_WIND = 'Humidity above 90 % with wind above 8 m/s';
const RAIN_HIGH = 'Rain above 20 mm in the last hour';

function zone(city, { rain, hum, wind, rules, lat, lon }) {
    const w = { temperature: 26.0, humidity: hum, rainfall: rain, wind_speed: wind, wind, pressure: 1006,
        source: 'open-meteo', zone_source: 'open_meteo', observed_at: null, data_time: T, conditions: 'Slight rain', stale: false };
    const pred = { risk_level: 'HIGH', risk_label: 2, risk_text: 'HIGH', prob_flood: 0.85, prob_thunderstorm: 0.8,
        prob_cloudburst: 0.75, reason: 'High humidity supports storm formation', flood_note: null };
    return { city, state: 'Test State', lat, lon, risk_level: 'HIGH', risk: 'HIGH', severity: 'HIGH', rules_fired: rules,
        type: rules.includes(RAIN_HIGH) ? 'Flash Flood' : 'Rule-based HIGH', reason: pred.reason,
        temperature: 26.0, humidity: hum, rainfall: rain, wind_speed: wind, timestamp: '2026-10-01T13:50:00Z',
        weather: w, source: 'open-meteo', zone_source: 'open_meteo', prediction: pred,
        probabilities: { flash_flood: 0.85, thunderstorm: 0.8, cloudburst: 0.75 } };
}

const HUMID = zone('Humidpur', { rain: 0.4, hum: 96, wind: 9.3, rules: [HUM_WIND], lat: 25.6, lon: 91.9 });
const RAINY = zone('Rainpur', { rain: 24.0, hum: 70, wind: 3.0, rules: [RAIN_HIGH], lat: 19.1, lon: 72.9 });
const ZONES = [HUMID, RAINY];
const summary = { total: 2, high: 2, moderate: 0, low: 0, n_rated: 2, n_sample: 0, source: 'open-meteo',
    zone_sources: { openweather: 0, openweather_stale: 0, open_meteo: 2, open_meteo_stale: 0, sample: 0 },
    latest_observed_at: null, data_time: T, data_time_min: T, stale: false };

async function mock(page, selected, { tiles = false } = {}) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    if (!tiles) await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route((u) => u.port === '8000' && u.pathname === '/alerts',
        (r) => r.fulfill({ json: { alerts: ZONES, summary, last_updated: '2026-10-01T13:50:00Z' } }).catch(() => {}));
    await page.route((u) => u.port === '8000' && u.pathname === '/batch_predict', (r) => r.fulfill({ json: ZONES }).catch(() => {}));
    await page.addInitScript((c) => {
        localStorage.setItem('selected_city', c);
        localStorage.setItem('selectedCity', c);
    }, selected);
}

const panelOf = (page, city) => page.locator('h2', { hasText: city }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
const card = (page, city) => page.locator('h3', { hasText: city }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');

test('"/": HIGH from humidity/wind with 0.4 mm rain names no hazard; the rain rule names Flash Flood', async ({ page }) => {
    await mock(page, 'Humidpur');
    await page.goto('/');
    let panel = panelOf(page, 'Humidpur');
    const threat = panel.getByTestId('primary-threat');
    await expect(threat).toHaveAttribute('data-hazard', '');
    await expect(threat.getByTestId('primary-threat-text')).toHaveText(`Rule-based HIGH: ${HUM_WIND}`);
    await expect(threat).toContainText('Rule-based level (no hazard named)');
    await expect(threat).not.toContainText(/Flash Flood|Thunderstorm|Cloudburst/);
    await expect(panel.locator('[data-testid="hazard-level"][data-hazard="flood"]')).toHaveAttribute('data-level', 'Low');
    for (const h of ['thunderstorm', 'cloudburst']) {
        const row = panel.locator(`[data-testid="hazard-level"][data-hazard="${h}"]`);
        await expect(row).toHaveAttribute('data-level', 'Not rated');
        await expect(row).toContainText('No rule');
    }
    const p2 = await page.context().newPage();
    await mock(p2, 'Rainpur');
    await p2.goto('/');
    panel = panelOf(p2, 'Rainpur');
    await expect(panel.getByTestId('primary-threat')).toHaveAttribute('data-hazard', 'flood');
    await expect(panel.getByTestId('primary-threat-text')).toHaveText('Flash Flood');
    await expect(panel.getByTestId('primary-threat')).toContainText('Primary Threat (rain rule)');
    await expect(panel.locator('[data-testid="hazard-level"][data-hazard="flood"]')).toHaveAttribute('data-level', 'High');
});

test('Alerts: the humidity/wind HIGH card names no hazard; the rain HIGH card names Flash Flood', async ({ page }) => {
    await mock(page, 'Humidpur');
    await page.goto('/alerts');
    const a = card(page, 'Humidpur');
    await expect(a).toContainText(`Rule-based HIGH: ${HUM_WIND}.`);
    await expect(a).not.toContainText(/Flash Flood|Thunderstorm/);
    await a.getByText('View Details →').click();
    await expect(a.getByTestId('alert-card-hazard')).toHaveText('None named (rule-based level)');
    const b = card(page, 'Rainpur');
    await expect(b).toContainText(`Flash Flood: ${RAIN_HIGH} (rule-based).`);
    await b.getByText('View Details →').click();
    await expect(b.getByTestId('alert-card-hazard')).toHaveText('Flash Flood (rain rule)');
});

test('Forecast: the summary names no hazard for humidity/wind HIGH, Flash Flood for the rain rule', async ({ page }) => {
    await mock(page, 'Humidpur');
    await page.goto('/forecast');
    await expect(page.getByTestId('forecast-summary-text')).toHaveText(`"Rule-based HIGH: ${HUM_WIND}"`);
    await expect(page.getByTestId('forecast-summary-text')).not.toContainText(/Flash Flood|thunderstorm|Flood risk/i);
    await expect(page.getByTestId('forecast-risk-level')).toHaveText('Level: High (rule-based)');
    await page.getByRole('button', { name: 'Rainpur', exact: true }).click();
    await expect(page.getByTestId('forecast-summary-text')).toHaveText(`"Flash Flood: ${RAIN_HIGH} (rule-based)"`);
});

test('Primary Threat screenshots of "/", Alerts and Forecast at 1920x1080 and 1366x768', async ({ page }) => {
    await mock(page, 'Humidpur', { tiles: true });
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/');
        await expect(page.getByTestId('primary-threat')).toBeVisible();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(SHOTS, `threat_dashboard_${w}x${h}.png`) });
        await page.goto('/alerts');
        await expect(card(page, 'Humidpur')).toBeVisible();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(SHOTS, `threat_alerts_${w}x${h}.png`) });
        await page.goto('/forecast');
        await page.getByTestId('forecast-summary-text').scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(SHOTS, `threat_forecast_${w}x${h}.png`) });
    }
});
