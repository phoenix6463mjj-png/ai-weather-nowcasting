// Forecast leftovers: Risk Indicator shows the level only ("rule-based", no %); "Rule-based summary" names
// the weather source from the backend's source field; the footer states the rule that fired now.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function zone(city, risk, rules, source, { rain = 0, hum = 84, wind = 1.8 } = {}) {
    return { city, state: 'Test State', lat: 20, lon: 78, risk_level: risk, risk, severity: risk, rules_fired: rules,
        reason: 'Moderate convective indicators observed', temperature: 27.3, humidity: hum, rainfall: rain,
        wind_speed: wind, timestamp: new Date().toISOString(), source,
        weather: { temperature: 27.3, humidity: hum, rainfall: rain, wind_speed: wind, source,
            observed_at: source === 'openweather' ? '2026-09-30T18:00:00Z' : null, data_time: '2026-09-30T18:00Z' },
        prediction: { risk_level: risk }, probabilities: { flash_flood: 0.08, thunderstorm: 0.4, cloudburst: 0.35 } };
}

async function open(page, zones) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route((u) => u.port === '8000' && u.pathname === '/batch_predict', (r) => r.fulfill({ json: zones }).catch(() => {}));
    await page.addInitScript((c) => localStorage.setItem('selected_city', c), zones[0].city);
    await page.goto('/forecast');
    await expect(page.getByTestId('forecast-backend-sync')).toBeVisible();
}

test('Risk Indicator: level only, labelled rule-based, no % score; footer = the rule that fired now', async ({ page }) => {
    await open(page, [zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], 'open-meteo')]);
    await expect(page.getByTestId('forecast-risk-level')).toHaveText('Level: Moderate (rule-based)');
    await expect(page.getByTestId('forecast-fired-rules')).toHaveText('Humidity above 70 % (rule-based)');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/Score:/);
    expect(text).not.toMatch(/\b(90|55|20)%/);
    for (const s of ['Elevated precipitation expected', 'High convective activity expected', 'expected']) expect(text, s).not.toContain(s);
});

for (const [risk, rules, level, fired] of [
    ['HIGH', ['Humidity above 90 % with wind above 8 m/s'], 'High', 'Humidity above 90 % with wind above 8 m/s (rule-based)'],
    ['MODERATE', ['Rain above 5 mm in the last hour', 'Humidity above 70 %'], 'Moderate', 'Rain above 5 mm in the last hour; Humidity above 70 % (rule-based)'],
    ['LOW', [], 'Low', 'No rule fired (rule-based)'],
]) {
    test(`Risk Indicator for a ${risk} zone: "Level: ${level} (rule-based)", footer "${fired}"`, async ({ page }) => {
        await open(page, [zone('Testpur', risk, rules, 'open-meteo', { rain: 6, hum: 95, wind: 9 })]);
        await expect(page.getByTestId('forecast-risk-level')).toHaveText(`Level: ${level} (rule-based)`);
        await expect(page.getByTestId('forecast-fired-rules')).toHaveText(fired);
    });
}

for (const [source, name] of [['open-meteo', 'Open-Meteo model data'], ['openweather', 'OpenWeather observations']]) {
    test(`"Rule-based summary" names the weather source: ${source}`, async ({ page }) => {
        await open(page, [zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], source)]);
        await expect(page.getByTestId('forecast-summary-title')).toHaveText('Rule-based summary');
        await expect(page.getByTestId('forecast-summary-source')).toHaveText(`Evaluated for Mumbai with fixed rules (${name}).`);
        const text = await page.locator('main').innerText();
        expect(text).not.toContain('AI Forecast Insight');
        expect(text).not.toMatch(/\bXAI\b/);
        if (source !== 'openweather') expect(text).not.toContain('OpenWeather');
    });
}

// sample data: no rule-based summary at all (safety net, sample_safety.spec.js)
test('"Rule-based summary" is not shown on sample data', async ({ page }) => {
    await open(page, [zone('Mumbai', 'MODERATE', ['Humidity above 70 %'], 'sample')]);
    await expect(page.getByTestId('sample-safety-net')).toBeVisible();
    await expect(page.getByTestId('forecast-summary-title')).toHaveCount(0);
    await expect(page.getByTestId('forecast-risk-level')).toHaveCount(0);
});

test('Forecast leftovers screenshots at 1920x1080 and 1366x768 (live backend data)', async ({ page }) => {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/forecast');
        const end = page.getByTestId('forecast-risk-level').or(page.getByTestId('sample-safety-net'));   // sample: safety net
        await expect(end).toBeVisible();
        await end.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `forecast_leftovers_${w}x${h}.png`) });
    }
});
