// Safety net: when the backend has no weather feed (every Open-Meteo request failed -> "sample"),
// the team pages show no rule-based alarms. The real backend responses are fetched and rewritten in
// the browser to "sample" with HIGH / MODERATE zones in them, so the net is tested on data that would
// otherwise raise banners. A stale Open-Meteo list keeps its risk UI, labelled with its real time.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const NET = 'Sample data — no live weather feed. Risk indicators are not shown on sample data.';
const TIME = '2026-09-30T06:15Z';

function rewrite(item, i, src) {
    const risk = i < 3 ? 'HIGH' : i < 8 ? 'MODERATE' : 'LOW';
    const w = { ...(item.weather || {}), source: src, observed_at: null, data_time: src === 'sample' ? null : TIME,
        stale: src !== 'sample', ...(src === 'sample' ? { conditions: null, weather_code: null } : {}) };
    const probs = { flash_flood: 0.85, thunderstorm: 0.8, cloudburst: 0.75 };
    const zone_source = src === 'sample' ? 'sample' : 'open_meteo_stale';
    return { ...item, source: src, zone_source, weather: w, risk_level: risk, risk, severity: risk, rules_fired: ['Rain at least 20 mm'],
        prediction: { ...(item.prediction || {}), risk_level: risk, risk_text: risk, prob_flood: 0.85, prob_thunderstorm: 0.8, prob_cloudburst: 0.75 },
        probabilities: probs };
}

async function mockSource(page, src) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route((u) => u.port === '8000' && /^\/(alerts|batch_predict)$/.test(u.pathname), async (route) => {
        let res, body;
        try {
            res = await route.fetch();
            body = await res.json();
        } catch {
            return;
        }
        let out;
        if (Array.isArray(body)) out = body.map((a, i) => rewrite(a, i, src));
        else {
            const alerts = (body.alerts || []).map((a, i) => rewrite(a, i, src));
            const n = (r) => alerts.filter((a) => a.severity === r).length;
            const zk = src === 'sample' ? 'sample' : 'open_meteo_stale';
            const zone_sources = { openweather: 0, openweather_stale: 0, open_meteo: 0, open_meteo_stale: 0, sample: 0, [zk]: alerts.length };
            out = { ...body, alerts, summary: { ...body.summary, source: src, zone_sources, source_times: {}, high: n('HIGH'), moderate: n('MODERATE'), low: n('LOW'),
                latest_observed_at: null, data_time: src === 'sample' ? null : TIME, stale: src !== 'sample' } };
        }
        await route.fulfill({ response: res, json: out }).catch(() => {});
    });
}

async function expectNet(page) {
    const net = page.getByTestId('sample-safety-net');
    await expect(net).toBeVisible();
    await expect(net.getByTestId('sample-safety-text')).toHaveText(NET);
    await expect(net.getByTestId('sample-safety-ml-link')).toHaveAttribute('href', '/nowcast');
}

async function noAlarmWords(page) {
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/HIGH RISK|MODERATE RISK|High Risk in|High Alert|Primary Threat|SEVERITY|Top Risk Cities|Risk Distribution/);
    expect(text).not.toMatch(/\bHIGH\b|\bMODERATE\b/);
}

test('everything fails -> sample: "/" shows the safety net, weather tiles labelled sample, no risk UI', async ({ page }) => {
    await mockSource(page, 'sample');
    await page.goto('/');
    await expectNet(page);
    await expect(page.getByTestId('dashboard-source-badge')).toHaveText('Sample data — no live weather feed');
    await expect(page.getByTestId('alert-banner-text')).toHaveCount(0);
    await expect(page.getByTestId('info-strip')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-legend')).toHaveCount(0);
    await expect(page.getByTestId('risk-view-details')).toHaveCount(0);           // Risk Distribution card
    await expect(page.getByTestId('sample-zone-count')).toContainText('zones (sample data)');
    // right panel: weather tiles with the sample label; no risk pill, primary threat or hazard levels
    await expect(page.getByTestId('panel-weather-source')).toHaveText('Sample data — no live weather feed');
    await expect(page.getByTestId('panel-no-risk')).toHaveText('Sample data — risk not shown');
    await expect(page.getByTestId('primary-threat')).toHaveCount(0);
    await expect(page.getByTestId('hazard-levels')).toHaveCount(0);
    await expect(page.getByTestId('rule-explanation')).toHaveCount(0);
    await expect(page.locator('header').getByText(/^\d+$/)).toHaveCount(0);       // no High count bubble
    await noAlarmWords(page);
    await page.getByTestId('sample-safety-ml-link').click();
    await expect(page).toHaveURL(/\/nowcast$/);
});

test('everything fails -> sample: Alerts shows no counts, filters or alert cards', async ({ page }) => {
    await mockSource(page, 'sample');
    await page.goto('/alerts');
    await expectNet(page);
    await expect(page.getByTestId('alerts-source-badge')).toHaveText('Sample data — no live weather feed');
    await expect(page.getByTestId('alerts-card-total')).toHaveCount(0);
    await expect(page.getByTestId('alerts-card-moderate')).toHaveCount(0);
    await expect(page.getByTestId('alert-card-source')).toHaveCount(0);
    await expect(page.getByText('No active alerts found')).toHaveCount(0);
    await expect(page.getByTestId('alerts-sample-zones')).toContainText('zones loaded (sample data)');
    await noAlarmWords(page);
});

test('everything fails -> sample: Forecast shows current values only, no level, pill or summary', async ({ page }) => {
    await mockSource(page, 'sample');
    await page.goto('/forecast');
    await expectNet(page);
    await expect(page.getByTestId('forecast-source-badge')).toHaveText('Sample data — no live weather feed');
    await expect(page.getByTestId('forecast-panel-risk')).toHaveCount(0);
    await expect(page.getByTestId('forecast-risk-level')).toHaveCount(0);
    await expect(page.getByTestId('forecast-summary-title')).toHaveCount(0);
    await expect(page.getByTestId('forecast-fired-rules')).toHaveCount(0);
    await expect(page.getByText('Nowcast Panel (sample data)')).toBeVisible();
    await noAlarmWords(page);
});

test('everything fails -> sample: Analytics shows no distribution, insights or ranking', async ({ page }) => {
    await mockSource(page, 'sample');
    await page.goto('/analytics');
    await expectNet(page);
    await expect(page.getByText('City Rainfall Comparison (sample data)')).toBeVisible();
    await expect(page.getByTestId('analytics-summary-source')).toHaveCount(0);
    await noAlarmWords(page);
});

test('stale Open-Meteo data keeps the risk UI, labelled "Open-Meteo (model data), updated HH:MM UTC"', async ({ page }) => {
    await mockSource(page, 'open-meteo');
    await page.goto('/');
    await expect(page.getByTestId('dashboard-source-badge')).toHaveText('Open-Meteo (model data), updated 06:15 UTC');
    await expect(page.getByTestId('sample-safety-net')).toHaveCount(0);
    await expect(page.getByTestId('alert-banner-text')).toContainText('High Risk in 3 locations');
    await page.goto('/alerts');
    await expect(page.getByTestId('alerts-source-badge')).toContainText('Open-Meteo (model data), updated 06:15 UTC');
    await expect(page.getByTestId('sample-safety-net')).toHaveCount(0);
    await expect(page.getByTestId('alert-card-source').first()).toBeVisible();
});

test('sample safety net screenshots of /, Alerts, Forecast, Analytics at 1920x1080 and 1366x768', async ({ page }) => {
    await mockSource(page, 'sample');
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const r of ['', 'alerts', 'forecast', 'analytics']) {
            await page.goto(`/${r}`);
            await expect(page.getByTestId('sample-safety-net')).toBeVisible();
            await page.waitForTimeout(1200);
            await page.screenshot({ path: path.join(SHOTS, `sample_net_${r || 'dashboard'}_${w}x${h}.png`) });
        }
    }
});
