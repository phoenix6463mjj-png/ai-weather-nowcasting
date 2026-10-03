// OpenWeather path on the team pages (mocked in the browser: the real backend responses are rewritten;
// no key is used): badges from real counts, the required "Weather data © OpenWeather" attribution, the
// per-zone sample rule, and Analytics Key Insights built only from the zones' own values.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const T_OW = '2026-10-01T13:45:00Z';
const T_OM = '2026-10-01T13:30Z';

// kind per zone index; `plan(i)` -> 'openweather' | 'open_meteo' | 'sample'
function rewrite(item, i, plan, risk = null) {
    const kind = plan(i);
    const src = { openweather: 'openweather', open_meteo: 'open-meteo', sample: 'sample' }[kind];
    const w = { ...(item.weather || {}), source: src, stale: false,
        observed_at: kind === 'openweather' ? T_OW : null,
        data_time: kind === 'openweather' ? T_OW : kind === 'open_meteo' ? T_OM : null,
        conditions: kind === 'sample' ? null : 'Light rain' };
    const out = { ...item, source: src, zone_source: kind, weather: w };
    if (kind === 'sample') {
        return { ...out, risk_level: null, risk: null, severity: null, prediction: null, probabilities: null, rules_fired: [] };
    }
    if (risk) return { ...out, ...risk(i, out) };
    return out;
}

function summaryOf(alerts, extra = {}) {
    const rated = alerts.filter((a) => a.zone_source !== 'sample');
    const n = (r) => rated.filter((a) => a.severity === r).length;
    const zs = { openweather: 0, openweather_stale: 0, open_meteo: 0, open_meteo_stale: 0, sample: 0 };
    alerts.forEach((a) => { zs[a.zone_source] += 1; });
    const src = [...new Set(alerts.map((a) => a.source))];
    const st = {};
    if (zs.openweather) st.openweather = { min: T_OW, max: T_OW };
    if (zs.open_meteo) st['open-meteo'] = { min: T_OM, max: T_OM };
    const times = alerts.map((a) => a.weather.data_time).filter(Boolean).sort();
    return { total: alerts.length, high: n('HIGH'), moderate: n('MODERATE'), low: n('LOW'), n_rated: rated.length,
        n_sample: zs.sample, zone_sources: zs, source: src.length === 1 ? src[0] : 'mixed',
        latest_observed_at: zs.openweather ? T_OW : null, data_time: times.at(-1) || null, data_time_min: times[0] || null,
        source_times: st, stale: false, ...extra };
}

async function mock(page, plan, risk = null, { tiles = false } = {}) {
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
        if (Array.isArray(body)) out = body.map((a, i) => rewrite(a, i, plan, risk));
        else {
            const alerts = (body.alerts || []).map((a, i) => rewrite(a, i, plan, risk));
            out = { ...body, alerts, summary: summaryOf(alerts) };
        }
        await route.fulfill({ response: res, json: out }).catch(() => {});
    });
}

const allOW = () => 'openweather';
const owAndSample = (i) => (i % 4 === 0 ? 'sample' : 'openweather');
const threeWay = (i) => (i % 3 === 0 ? 'sample' : i % 3 === 1 ? 'openweather' : 'open_meteo');

test('OpenWeather for every zone: badge "OpenWeather (current weather), updated HH:MM UTC" and the attribution', async ({ page }) => {
    await mock(page, allOW);
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-source-badge')).toHaveText('OpenWeather (current weather), updated 13:45 UTC');
    await expect(page.getByTestId('openweather-credit').first()).toContainText('Weather data © OpenWeather');
    await expect(page.getByTestId('openweather-credit').first().getByRole('link', { name: 'Weather data © OpenWeather' }))
        .toHaveAttribute('href', 'https://openweathermap.org/');
    await expect(page.getByTestId('open-meteo-credit')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('observed');
    await page.goto('/alerts');
    await expect(page.getByTestId('alerts-source-badge')).toContainText('OpenWeather (current weather), updated 13:45 UTC');
    await expect(page.getByTestId('openweather-credit')).toHaveCount(1);
    await page.goto('/forecast');
    await expect(page.getByTestId('forecast-source-badge')).toHaveText('OpenWeather (current weather), updated 13:45 UTC');
    await expect(page.getByTestId('openweather-credit')).toHaveCount(1);
});

test('OpenWeather + sample: badge from real counts; sample zones unrated (per-zone rule unchanged)', async ({ page }) => {
    await mock(page, owAndSample);
    await page.goto('/dashboard');
    const data = await (await page.request.get('http://127.0.0.1:8000/alerts?limit=380')).json();
    const T = data.alerts.length;
    const nSample = data.alerts.filter((_, i) => owAndSample(i) === 'sample').length;
    await expect(page.getByTestId('dashboard-source-badge')).toHaveText(`OpenWeather (current weather) for ${T - nSample} of ${T} zones, updated 13:45 UTC`);
    await expect(page.getByTestId('openweather-credit').first()).toBeVisible();
    await expect(page.getByTestId('dashboard-markers')).toHaveAttribute('data-unrated', String(nSample));
    await page.goto('/alerts');
    await expect(page.getByTestId('alerts-source-badge')).toHaveText(`OpenWeather (current weather) for ${T - nSample} of ${T} zones, updated 13:45 UTC`);
    await expect(page.getByTestId('alert-card-source')).toHaveCount(T - nSample);
});

test('OpenWeather + Open-Meteo + sample: one part per source, each with its own time', async ({ page }) => {
    await mock(page, threeWay);
    await page.goto('/dashboard');
    const data = await (await page.request.get('http://127.0.0.1:8000/alerts?limit=380')).json();
    const T = data.alerts.length;
    const c = (k) => data.alerts.filter((_, i) => threeWay(i) === k).length;
    await expect(page.getByTestId('dashboard-source-badge')).toHaveText(
        `OpenWeather (current weather) for ${c('openweather')} of ${T} zones, updated 13:45 UTC; `
        + `Open-Meteo (model data) for ${c('open_meteo')} of ${T} zones, updated 13:30 UTC`);
    await expect(page.getByTestId('openweather-credit').first()).toBeVisible();
    await expect(page.getByTestId('open-meteo-credit').first()).toBeVisible();
    // the map's one-line summary: real counts, the newest time; on a narrow map the counts shorten, the time stays whole
    const line = page.getByTestId('dashboard-source-line');
    await expect(line).toHaveText(`OpenWeather ${c('openweather')}/${T} · Open-Meteo ${c('open_meteo')}/${T} · sample data ${c('sample')}/${T} · updated 13:45 UTC`);
    await page.setViewportSize({ width: 1366, height: 768 });
    const clip = await line.evaluate((el) => {
        const t = el.lastElementChild.getBoundingClientRect(), box = el.getBoundingClientRect();
        const gap = t.left - el.firstElementChild.getBoundingClientRect().right;      // the space before "·" is kept
        return { text: el.lastElementChild.textContent, spaced: gap >= 0 && el.lastElementChild.getBoundingClientRect().width > 0
            && getComputedStyle(el.lastElementChild).whiteSpace === 'pre', inside: t.left >= box.left - 0.5 && t.right <= box.right + 0.5 && el.lastElementChild.scrollWidth <= el.lastElementChild.clientWidth + 1 };
    });
    expect(clip).toEqual({ text: ' · updated 13:45 UTC', spaced: true, inside: true });
});

// Key Insights: a HIGH zone with only 0.4 mm of rain (HIGH from humidity + wind). No invented rain figure.
const HIGH_LOW_RAIN = (i, z) => {
    if (i === 0) {
        const weather = { ...z.weather, rainfall: 0.4, humidity: 96, wind_speed: 9.3 };
        return { risk_level: 'HIGH', risk: 'HIGH', severity: 'HIGH', rainfall: 0.4, humidity: 96, wind_speed: 9.3, weather,
            rules_fired: ['Humidity above 90 % with wind above 8 m/s'],
            prediction: { ...(z.prediction || {}), risk_level: 'HIGH', risk_text: 'HIGH' } };
    }
    const weather = { ...z.weather, rainfall: 0.0, humidity: 50, wind_speed: 2.0 };
    return { risk_level: 'LOW', risk: 'LOW', severity: 'LOW', rainfall: 0.0, humidity: 50, wind_speed: 2.0, weather,
        rules_fired: [], prediction: { ...(z.prediction || {}), risk_level: 'LOW', risk_text: 'LOW' } };
};

test('OpenWeather screenshots of / and Analytics at 1920x1080 and 1366x768', async ({ page }) => {
    await mock(page, (i) => (i % 4 === 3 ? 'sample' : 'openweather'), HIGH_LOW_RAIN, { tiles: true });
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/dashboard');
        await expect(page.getByTestId('openweather-credit').first()).toBeVisible();
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(SHOTS, `openweather_dashboard_${w}x${h}.png`) });
    }
});
