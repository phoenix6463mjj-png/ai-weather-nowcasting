// Team pages honesty patch: banners on Reports / Analytics, weather source on Forecast and /alerts.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const SAMPLE = 'Sample data — no live weather feed';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function stubImages(page) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
}

async function zoneSource(page) {
    return (await (await page.request.get(`${API}/alerts?limit=380`)).json()).summary.source;
}

// visible text without the sample badge itself ("no live weather feed" is the honest label)
async function bodyText(page) {
    return (await page.locator('body').innerText()).split(SAMPLE).join('');
}

for (const [route, name] of [['/reports', 'Reports'], ['/analytics', 'Analytics']]) {
    test(`${name}: illustrative-figures banner links to the measured results`, async ({ page }) => {
        await stubImages(page);
        await page.goto(route);
        const b = page.getByTestId('honesty-banner-illustrative');
        await expect(b).toHaveText('Illustrative figures — not from the ML model. Measured skill: ML Nowcast → Results');
        await expect(b.getByRole('link', { name: 'ML Nowcast → Results' })).toHaveAttribute('href', '/nowcast/results');
        await expect(page.getByTestId('honesty-banner-illustrative')).toHaveCount(1);
    });
}

test('Forecast: source line follows the backend; rule-based Score banner; no "Live" / "Real-Time" on sample data', async ({ page }) => {
    await stubImages(page);
    const src = await zoneSource(page);
    await page.goto('/forecast');
    await expect(page.getByTestId('honesty-banner-rule-score')).toContainText('"Score" and the risk levels on this page are a rule-based indicator, not the ML model.');
    const badge = page.getByTestId('forecast-source-badge');
    await expect(page.getByTestId('forecast-stream')).toBeVisible();
    if (src === 'sample') {
        await expect(badge).toHaveText(SAMPLE);
        await expect(page.getByTestId('forecast-stream')).toHaveText(SAMPLE);
        const text = await bodyText(page);
        expect(text).not.toMatch(/real-time/i);
        expect(text).not.toMatch(/\blive\b/i);
    } else if (src === 'openweather') {
        await expect(badge).toContainText('OpenWeather');
    }
});

test('/alerts: "Live" only for OpenWeather; sample badge otherwise', async ({ page }) => {
    await stubImages(page);
    const src = await zoneSource(page);
    await page.goto('/alerts');
    const badge = page.getByTestId('alerts-source-badge');
    await expect(badge).not.toHaveText('Loading…');
    if (src === 'openweather') {
        await expect(badge).toHaveText('Live Feed');
        return;
    }
    await expect(badge).toHaveText(SAMPLE);
    await expect(page.getByTestId('alert-card-source').first()).toHaveText(SAMPLE);
    const text = await bodyText(page);
    expect(text).not.toMatch(/Live Feed|Live •/);
    expect(text).not.toMatch(/real-time/i);
    expect(text).not.toMatch(/\blive\b/i);
});

test('Team pages screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    await stubImages(page);
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const r of ['reports', 'analytics', 'forecast', 'alerts']) {
            await page.goto(`/${r}`);
            await page.waitForTimeout(1500);
            await page.screenshot({ path: path.join(SHOTS, `team_${r}_${w}x${h}.png`) });
        }
    }
});
