// The three weather sources, mocked in the browser: the real backend responses are fetched and their
// source fields rewritten, so every page is checked for "sample", "openweather" and "open-meteo"
// independently of the network and of any API key.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const TIME = '2026-09-29T13:45:00Z';
const SAMPLE = 'Sample data — no live weather feed';
const EXPECT = {
    sample: { badge: SAMPLE, credit: 0, live: false },
    openweather: { badge: 'OpenWeather (current weather), updated 13:45 UTC', credit: 0, live: true },
    'open-meteo': { badge: 'Open-Meteo (model data), updated 13:45 UTC', credit: 1, live: true },
};

function rewrite(item, src) {
    const w = { ...(item.weather || {}), source: src };
    w.observed_at = src === 'openweather' ? TIME : null;
    w.data_time = src === 'sample' ? null : TIME;
    const zone_source = { sample: 'sample', openweather: 'openweather', 'open-meteo': 'open_meteo' }[src];
    return { ...item, source: src, zone_source, weather: { ...w, stale: false } };
}

async function mockSource(page, src) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    // backend API only (the SPA also has an /alerts page route)
    await page.route((u) => u.port === '8000' && /^\/(alerts|batch_predict)$/.test(u.pathname), async (route) => {
        let res, body;
        try {
            res = await route.fetch();
            body = await res.json();
        } catch {
            return;                     // the page navigated away while this request was pending
        }
        let out;
        if (Array.isArray(body)) out = body.map((a) => rewrite(a, src));
        else {
            out = { ...body, alerts: (body.alerts || []).map((a) => rewrite(a, src)) };
            const zk = { sample: 'sample', openweather: 'openweather', 'open-meteo': 'open_meteo' }[src];
            const zone_sources = { openweather: 0, openweather_stale: 0, open_meteo: 0, open_meteo_stale: 0, sample: 0, [zk]: out.alerts.length };
            out.summary = { ...body.summary, source: src, zone_sources, source_times: {}, latest_observed_at: src === 'openweather' ? TIME : null,
                data_time: src === 'sample' ? null : TIME, data_time_min: src === 'sample' ? null : TIME, stale: false };
        }
        await route.fulfill({ response: res, json: out }).catch(() => {});
    });
}

for (const src of ['sample', 'openweather', 'open-meteo']) {
    const e = EXPECT[src];
    test(`weather source "${src}": badges, live wording and Open-Meteo credit on /, Alerts, Forecast, Analytics`, async ({ page }) => {
        await mockSource(page, src);
        // "/"
        await page.goto('/');
        await expect(page.getByTestId('dashboard-source-badge')).toHaveText(e.badge);
        await expect(page.getByTestId('panel-weather-source')).toContainText(e.badge);
        await expect(page.getByTestId('sidebar-live')).toHaveCount(e.live ? 1 : 0);
        if (src === 'open-meteo') await expect(page.getByTestId('open-meteo-credit').first()).toBeVisible();
        else await expect(page.getByTestId('open-meteo-credit')).toHaveCount(0);
        // OpenWeather terms: "Weather data © OpenWeather" on the screen where its data appear
        if (src === 'openweather') await expect(page.getByTestId('openweather-credit').first()).toContainText('Weather data © OpenWeather');
        else await expect(page.getByTestId('openweather-credit')).toHaveCount(0);
        // sample data: the safety net replaces every rule-based indicator (sample_safety.spec.js)
        if (src === 'sample') {
            await expect(page.getByTestId('sample-safety-net')).toBeVisible();
            await expect(page.getByTestId('rule-label')).toHaveCount(0);
        } else await expect(page.getByTestId('rule-label')).toHaveText('(rule-based, not the ML model)');
        if (src !== 'openweather') await expect(page.locator('body')).not.toContainText('observed');
        // Alerts
        await page.goto('/alerts');
        const badge = page.getByTestId('alerts-source-badge');
        if (e.live) await expect(badge).toContainText('Rule-based indicators from ');
        else await expect(badge).toHaveText(SAMPLE);
        if (src === 'open-meteo') {
            await expect(badge).toContainText('Open-Meteo (model data), updated 13:45 UTC');
            await expect(page.getByTestId('open-meteo-credit')).toHaveCount(1);
        }
        // Forecast
        await page.goto('/forecast');
        await expect(page.getByTestId('forecast-source-badge')).toHaveText(e.badge);
        await expect(page.getByTestId('open-meteo-credit')).toHaveCount(e.credit);
        await expect(page.locator('body')).not.toContainText('Continuous data ingest');
        await expect(page.locator('body')).not.toContainText('Short-Range (24h NWP)');
        await expect(page.locator('body')).not.toContainText('Extended Outlook');
        await expect(page.locator('body')).not.toContainText('safeguards recommended');
        const ftext = await page.locator('body').innerText();
        expect(ftext).not.toMatch(/hybrid ML|sensor/i);
        if (src !== 'openweather') expect(ftext).not.toMatch(/observ/i);      // model or sample data are never "observed"
        // Analytics
        await page.goto('/analytics');
        const label = { sample: 'sample data', openweather: 'OpenWeather data', 'open-meteo': 'Open-Meteo data (model data)' }[src];
        await expect(page.getByTestId('open-meteo-credit')).toHaveCount(e.credit);
        await expect(page.locator('body')).not.toContainText('convective probability');
        if (src === 'sample') {
            await expect(page.getByTestId('sample-safety-net')).toBeVisible();
            await expect(page.getByTestId('analytics-summary-source')).toHaveCount(0);
        } else {
            await expect(page.getByTestId('analytics-summary-source')).toHaveText(`Rule-based summary of ${label}`);
            await expect(page.getByTestId('analytics-model-label')).toHaveText('Rule-based indicator (not the ML model)');
        }
    });
}

test('Open-Meteo credit links: open-meteo.com and CC BY 4.0', async ({ page }) => {
    await mockSource(page, 'open-meteo');
    await page.goto('/forecast');
    const c = page.getByTestId('open-meteo-credit');
    await expect(c.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toHaveAttribute('href', 'https://open-meteo.com/');
    await expect(c.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
});

test('Open-Meteo screenshots of /, Forecast, Alerts, Analytics at 1920x1080 and 1366x768', async ({ page }) => {
    await mockSource(page, 'open-meteo');
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const r of ['', 'forecast', 'alerts', 'analytics']) {
            await page.goto(`/${r}`);
            await page.waitForTimeout(1500);
            await page.screenshot({ path: path.join(SHOTS, `openmeteo_${r || 'dashboard'}_${w}x${h}.png`) });
        }
    }
});
