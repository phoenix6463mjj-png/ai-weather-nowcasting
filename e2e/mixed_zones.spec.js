// Mixed zone lists: some zones have Open-Meteo data (fresh or stale), some only sample values. The real
// backend responses are fetched and rewritten in the browser. Sample zones keep HIGH risk fields here on
// purpose (worse than the backend, which strips them) so the pages are shown to hide them by zone source.
// Also: the Analytics server-unavailable fallback shows no figures at all.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const T_NEW = '2026-10-01T06:15Z';
const T_OLD = '2026-10-01T05:15Z';
const NET = 'Sample data — no live weather feed. Risk indicators are not shown on sample data.';

// zone i: i % 3 == 0 -> sample; 1 -> Open-Meteo fresh; 2 -> Open-Meteo stale (older time)
const kindOf = (i) => ['sample', 'open_meteo', 'open_meteo_stale'][i % 3];
function riskOf(i) {
    if (kindOf(i) === 'sample') return 'HIGH';                  // must never be shown
    if (i < 30) return 'HIGH';
    if (i < 90) return 'MODERATE';
    return 'LOW';
}

function rewrite(item, i) {
    const kind = kindOf(i);
    const src = kind === 'sample' ? 'sample' : 'open-meteo';
    const risk = riskOf(i);
    const w = { ...(item.weather || {}), source: src, observed_at: null, stale: kind === 'open_meteo_stale',
        data_time: kind === 'sample' ? null : (kind === 'open_meteo_stale' ? T_OLD : T_NEW),
        conditions: kind === 'sample' ? null : 'Slight rain' };
    return { ...item, source: src, zone_source: kind, weather: w, risk_level: risk, risk, severity: risk,
        rules_fired: ['Rain above 20 mm in the last hour'], reason: 'Rain above 20 mm (rule-based)',
        prediction: { ...(item.prediction || {}), risk_level: risk, risk_text: risk, prob_flood: 0.85, prob_thunderstorm: 0.8, prob_cloudburst: 0.75 },
        probabilities: { flash_flood: 0.85, thunderstorm: 0.8, cloudburst: 0.75 } };
}

function summaryOf(alerts) {
    const rated = alerts.filter((a) => a.zone_source !== 'sample');
    const n = (r) => rated.filter((a) => a.severity === r).length;
    const zs = { openweather: 0, open_meteo: 0, open_meteo_stale: 0, sample: 0 };
    alerts.forEach((a) => { zs[a.zone_source] += 1; });
    return { total: alerts.length, high: n('HIGH'), moderate: n('MODERATE'), low: n('LOW'), n_rated: rated.length,
        n_sample: zs.sample, zone_sources: zs, source: 'mixed', latest_observed_at: null,
        data_time: T_NEW, data_time_min: T_OLD, stale: true };
}


async function mockMixed(page, { tiles = false } = {}) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    if (!tiles) await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route((u) => u.port === '8000' && /^\/(alerts|batch_predict)$/.test(u.pathname), async (route) => {
        let res, body;
        try {
            res = await route.fetch();
            body = await res.json();
        } catch {
            return;
        }
        let out;
        if (Array.isArray(body)) out = body.map((a, i) => rewrite(a, i));
        else {
            const alerts = (body.alerts || []).map((a, i) => rewrite(a, i));
            out = { ...body, alerts, summary: summaryOf(alerts) };
        }
        await route.fulfill({ response: res, json: out }).catch(() => {});
    });
}

async function selectCity(page, city) {
    await page.addInitScript((c) => {
        try {
            localStorage.setItem('selected_city', c);
            localStorage.setItem('selectedCity', c);
        } catch { /* ignore */ }
    }, city);
}

async function alertsList(page) {
    const API = 'http://127.0.0.1:8000';
    const body = await (await page.request.get(`${API}/alerts?limit=380`)).json();
    const alerts = body.alerts.map((a, i) => rewrite(a, i));
    return { alerts, summary: summaryOf(alerts) };
}

test('mixed "/": badge states real counts; banner/strip counts exclude sample zones; sample zone panel shows no risk', async ({ page }) => {
    const { alerts, summary } = await alertsList(page);
    const sampleCity = alerts.find((a) => a.zone_source === 'sample').city;
    await mockMixed(page);
    await selectCity(page, sampleCity);
    await page.goto('/');
    const nOM = summary.zone_sources.open_meteo + summary.zone_sources.open_meteo_stale;
    await expect(page.getByTestId('dashboard-source-badge'))
        .toHaveText(`Open-Meteo (model data) for ${nOM} of ${summary.total} zones, updated 05:15–06:15 UTC`);
    await expect(page.getByTestId('open-meteo-credit').first()).toBeVisible();
    await expect(page.getByTestId('sample-safety-net')).toHaveCount(0);
    // banner counts = rated HIGH zones only
    await expect(page.getByTestId('alert-banner-text')).toHaveText(`High Risk in ${summary.high} locations (rule-based, zones with weather data only)`);
    // Risk Distribution: rated zones, plus the unrated line
    await expect(page.getByText(`(${summary.n_rated} Zones)`)).toBeVisible();
    await expect(page.getByTestId('risk-unrated')).toHaveText(`+${summary.n_sample} with sample data (risk not shown)`);
    // map: sample zones are grey and unrated
    await expect(page.getByTestId('dashboard-markers')).toHaveAttribute('data-unrated', String(summary.n_sample));
    await expect(page.getByTestId('legend-unrated')).toHaveText('Grey: sample data — risk not shown');
    // right panel on a sample zone: no risk pill, primary threat, hazard levels or explanation
    await expect(page.getByRole('heading', { name: new RegExp(`^${sampleCity}`) })).toBeVisible();
    await expect(page.getByTestId('panel-no-risk')).toHaveText('Sample data — risk not shown');
    await expect(page.getByTestId('primary-threat')).toHaveCount(0);
    await expect(page.getByTestId('hazard-levels')).toHaveCount(0);
    await expect(page.getByTestId('rule-explanation')).toHaveCount(0);
    await expect(page.getByTestId('panel-weather-source')).toHaveText('Sample data — no live weather feed');
});

test('mixed "/": an Open-Meteo HIGH zone keeps its risk, primary threat and hazard levels', async ({ page }) => {
    const { alerts } = await alertsList(page);
    const highCity = alerts.find((a) => a.zone_source !== 'sample' && a.severity === 'HIGH').city;
    await mockMixed(page);
    await selectCity(page, highCity);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: new RegExp(`^${highCity}`) })).toBeVisible();
    await expect(page.getByTestId('panel-no-risk')).toHaveCount(0);
    await expect(page.getByTestId('primary-threat')).toBeVisible();
    await expect(page.getByTestId('hazard-levels')).toBeVisible();
});

test('mixed "/": the neutral strip counts exclude sample zones', async ({ page }) => {
    await mockMixed(page);
    // no HIGH among the rated zones -> neutral strip
    await page.route((u) => u.port === '8000' && u.pathname === '/alerts', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        const alerts = body.alerts.map((a, i) => {
            const z = rewrite(a, i);
            return z.zone_source === 'sample' ? z : { ...z, risk_level: i < 90 ? 'MODERATE' : 'LOW', risk: i < 90 ? 'MODERATE' : 'LOW', severity: i < 90 ? 'MODERATE' : 'LOW' };
        });
        const summary = summaryOf(alerts);
        await route.fulfill({ response: res, json: { ...body, alerts, summary } });
    });
    await page.goto('/');
    const strip = page.getByTestId('info-strip-text');
    await expect(strip).toContainText(/Rule-based indicators: \d+ moderate, 0 high zones \(zones with weather data only; \d+ zones with sample data: risk not shown\)\. Not an official warning\./);
    const text = await strip.innerText();
    const mod = Number(text.match(/(\d+) moderate/)[1]);
    const unrated = Number(text.match(/; (\d+) zones with sample/)[1]);
    expect(mod).toBe(60);                                       // zones i < 90 that are not sample: 60 of 90
    expect(unrated).toBeGreaterThan(100);
});

test('mixed Alerts: no card for sample zones; counts are rated zones only; badge states the counts', async ({ page }) => {
    const { alerts, summary } = await alertsList(page);
    await mockMixed(page);
    await page.goto('/alerts');
    const nOM = summary.zone_sources.open_meteo + summary.zone_sources.open_meteo_stale;
    await expect(page.getByTestId('alerts-source-badge'))
        .toHaveText(`Open-Meteo (model data) for ${nOM} of ${summary.total} zones, updated 05:15–06:15 UTC`);
    await expect(page.getByTestId('sample-safety-net')).toHaveCount(0);
    await expect(page.getByTestId('alerts-total-caption')).toHaveText(`${summary.n_sample} zones with sample data: risk not shown`);
    await expect(page.getByRole('button', { name: `All (${summary.n_rated})` })).toBeVisible();
    await expect(page.getByRole('button', { name: `High (${summary.high})` })).toBeVisible();
    await expect(page.getByTestId('alert-card-source')).toHaveCount(summary.n_rated);
    const cards = await page.locator('h3').allInnerTexts();
    const sampleCities = new Set(alerts.filter((a) => a.zone_source === 'sample').map((a) => a.city));
    const ratedCities = new Set(alerts.filter((a) => a.zone_source !== 'sample').map((a) => a.city));
    for (const c of cards) if (sampleCities.has(c) && !ratedCities.has(c)) throw new Error(`card for sample zone ${c}`);
});

test('mixed Forecast: a sample node shows the safety net; a rated node its level; the list line states the counts', async ({ page }) => {
    await mockMixed(page);
    await page.goto('/forecast');
    await expect(page.getByTestId('forecast-list-source')).toContainText(/^Node list: Open-Meteo \(model data\) for \d+ of \d+ zones, updated 05:15–06:15 UTC; \d+ zones with sample data: risk not shown\.$/);
    // first node (index 0) is sample in the mock
    await expect(page.getByTestId('forecast-source-badge')).toHaveText('Sample data — no live weather feed');
    await expect(page.getByTestId('sample-safety-net')).toBeVisible();
    await expect(page.getByTestId('sample-safety-text')).toHaveText(NET);
    await expect(page.getByTestId('forecast-risk-level')).toHaveCount(0);
    await expect(page.getByTestId('forecast-panel-risk')).toHaveCount(0);
    // second node (index 1) has Open-Meteo data
    const second = (await (await page.request.get('http://127.0.0.1:8000/batch_predict?limit=100')).json())[1];
    await page.getByText(second.city, { exact: true }).first().click();
    await expect(page.getByTestId('forecast-source-badge')).toHaveText('Open-Meteo (model data), updated 06:15 UTC');
    await expect(page.getByTestId('sample-safety-net')).toHaveCount(0);
    await expect(page.getByTestId('forecast-risk-level')).toHaveText('Level: High (rule-based)');
});

test('mixed Analytics: figures and risk charts use only zones with weather data', async ({ page }) => {
    await mockMixed(page);
    const raw = await (await page.request.get('http://127.0.0.1:8000/batch_predict?limit=100')).json();
    const zones = raw.map((a, i) => rewrite(a, i));
    const rated = zones.filter((z) => z.zone_source !== 'sample');
    const nSample = zones.length - rated.length;
    await page.goto('/analytics');
    await expect(page.getByTestId('analytics-mixed-note')).toHaveText(
        `Open-Meteo (model data) for ${rated.length} of ${zones.length} zones, updated 05:15–06:15 UTC. ${nSample} zones with sample data: risk not shown; figures and charts below use the ${rated.length} zones with weather data.`);
    await expect(page.getByTestId('sample-safety-net')).toHaveCount(0);
    await expect(page.getByText(`Mean of ${rated.length} zones`)).toHaveCount(3);
    await expect(page.getByText(`Rule-based levels of ${rated.length} zones`)).toBeVisible();
    await expect(page.getByTestId("analytics-subtitle")).toContainText(`Rule-based indicators from Open-Meteo (model data) for ${rated.length} of ${zones.length} zones`);
    await expect(page.getByTestId('analytics-summary-source')).toContainText(`Rule-based summary of Open-Meteo (model data) for ${rated.length} of ${zones.length} zones`);
    // Top Risk Cities: none of them sample-only
    const sampleCities = new Set(zones.filter((z) => z.zone_source === 'sample').map((z) => z.city));
    const ratedCities = new Set(rated.map((z) => z.city));
    const top = await page.locator('h4').allInnerTexts();
    expect(top.length).toBeGreaterThan(0);
    for (const c of top) expect(sampleCities.has(c) && !ratedCities.has(c), c).toBe(false);
});

test('Analytics server unavailable: no example cities or figures; safety-net notice and ML link', async ({ page }) => {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.addInitScript(() => { window.__SERVER_WAKE__ = { retryMs: 100, budgetMs: 400, attemptMs: 300 }; });
    await page.route((u) => u.port === '8000' && u.pathname === '/batch_predict', (r) => r.abort());
    await page.goto('/analytics');
    await expect(page.getByTestId('sample-safety-net')).toBeVisible();
    await expect(page.getByTestId('sample-safety-text')).toHaveText(NET);
    await expect(page.getByTestId('sample-safety-ml-link')).toHaveAttribute('href', '/nowcast');
    await expect(page.getByTestId('analytics-unavailable')).toHaveText('Server unavailable — please refresh in a minute.');
    const text = await page.locator('main').innerText();
    for (const w of ['Vizianagaram', 'Ratnagiri', 'Mumbai', 'Avg Precipitation', 'Risk Distribution', 'Top Risk Cities', 'Key Insights', 'HIGH', 'MODERATE', ' mm'])
        expect(text, w).not.toContain(w);
    await page.screenshot({ path: path.join(SHOTS, 'analytics_unavailable_1600x1000.png') });
});

test('mixed screenshots of /, Alerts, Forecast, Analytics at 1920x1080 and 1366x768', async ({ page }) => {
    await mockMixed(page, { tiles: true });                  // real map tiles for the screenshots
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const [r, id] of [['', 'dashboard-source-badge'], ['alerts', 'alerts-total-caption'], ['forecast', 'forecast-list-source'], ['analytics', 'analytics-mixed-note']]) {
            await page.goto(`/${r}`);
            await expect(page.getByTestId(id)).toBeVisible();
            await page.waitForTimeout(r === '' ? 4000 : 1200);          // map tiles on "/"
            await page.screenshot({ path: path.join(SHOTS, `mixed_${r || 'dashboard'}_${w}x${h}.png`) });
        }
    }
});
