// Dashboard ("/"), option A honesty fixes. Tile requests are intercepted, so these tests do not
// depend on OSM / NASA GIBS being reachable.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
// 1x1 transparent PNG for intercepted tiles
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function openDashboard(page, tiles = []) {
    await page.route('https://tile.openstreetmap.org/**', (r) => { tiles.push(r.request().url()); r.fulfill({ body: PNG, contentType: 'image/png' }); });
    await page.route('https://gibs.earthdata.nasa.gov/**', (r) => { tiles.push(r.request().url()); r.fulfill({ body: PNG, contentType: 'image/jpeg' }); });
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    const alerts = page.waitForResponse((r) => r.url().includes('/alerts?limit=380') && r.ok());
    await page.goto('/');
    const data = await (await alerts).json();
    await expect(page.getByTestId('dashboard-source-badge')).not.toHaveText('Loading weather source…');
    return data;
}

test('Dashboard: source badge follows the backend weather source; no LIVE badge on sample data', async ({ page }) => {
    const data = await openDashboard(page);
    const src = data.summary.source;
    expect(['sample', 'openweather', 'mixed']).toContain(src);
    const badge = page.getByTestId('dashboard-source-badge');
    if (src === 'sample') {
        await expect(badge).toHaveText('Sample data — no live weather feed');
        await expect(page.getByTestId('sidebar-live')).toHaveCount(0);
        await expect(page.getByText('Real-time insights', { exact: false })).toHaveCount(0);
        await expect(page.getByTestId('panel-weather-source')).toHaveText('Sample data — no live weather feed');
    } else if (src === 'openweather') {
        await expect(badge).toContainText('OpenWeather, observed');
        await expect(page.getByTestId('sidebar-live')).toHaveText('LIVE');
    }
    await expect(page.getByText('Live AI Nowcasting')).toHaveCount(0);
    await expect(page.getByText('AI Decision Transparency')).toHaveCount(0);
    await expect(page.getByText('Rule-based explanation')).toBeVisible();
    await expect(page.getByText('Partly Cloudy')).toHaveCount(0);
});

test('Dashboard: no % for any hazard, rule-based levels, primary threat agrees with the risk level, no Safe / All Clear', async ({ page }) => {
    const data = await openDashboard(page);
    await expect(page.getByTestId('hazard-level')).toHaveCount(3);
    await expect(page.getByTestId('rule-label')).toHaveText('rule-based indicator (not the ML model)');
    for (const lv of await page.getByTestId('hazard-level').all()) {
        expect(['Low', 'Moderate', 'High']).toContain(await lv.getAttribute('data-level'));
    }
    // the only % left on the page are humidity values
    const body = await page.locator('body').innerText();
    const pctLines = body.split('\n').map((l) => l.trim()).filter((l) => l.includes('%'));
    for (const l of pctLines) expect(l, `unexpected % line: ${l}`).toMatch(/^\d+(\.\d+)?%$/);
    for (const re of [/(cloudburst|flash flood|flood|thunderstorm)[^\n]{0,40}\d+\s*%/i, /\bSafe\b/, /All Clear/i]) {
        expect(body).not.toMatch(re);
    }
    await expect(page.getByTestId('dashboard-legend')).not.toContainText('%');
    // the default zone is the first alert (HIGH first): primary threat + no "stable" text
    const first = data.alerts[0];
    const panel = page.locator('h2', { hasText: first.city }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
    await expect(panel).toContainText(`${first.risk_level} RISK`);
    if (first.risk_level === 'LOW') await expect(panel).toContainText('No primary threat (low risk)');
    else {
        await expect(panel).not.toContainText('No primary threat');
        await expect(panel).not.toContainText(/stable/i);
    }
    await expect(panel).toContainText(first.explanation ? first.explanation : 'No explanation available');
});

test('Dashboard: tile switch requests OSM (single host), NASA GIBS VIIRS yesterday, and the DEM hillshade', async ({ page }) => {
    const tiles = [];
    await openDashboard(page, tiles);
    await expect(page.getByTestId('basemap-map')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => tiles.filter((u) => u.startsWith('https://tile.openstreetmap.org/')).length).toBeGreaterThan(0);
    expect(tiles.some((u) => /https:\/\/[abc]\.tile\.openstreetmap/.test(u))).toBe(false);

    await page.getByTestId('basemap-satellite').click();
    await expect(page.getByTestId('basemap-satellite')).toHaveAttribute('aria-pressed', 'true');
    const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    await expect.poll(() => tiles.filter((u) => u.includes('gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/'
        + `${yesterday}/GoogleMapsCompatible_Level9/`)).length).toBeGreaterThan(0);
    await expect(page.locator('.leaflet-control-attribution')).toContainText('NASA GIBS');

    const hill = page.waitForRequest((r) => r.url().endsWith('/ml/terrain/national.png'));
    await page.getByTestId('basemap-terrain').click();
    await hill;
    await expect(page.locator('img.dashboard-hillshade')).toHaveCount(1);
    await expect(page.locator('.leaflet-control-attribution')).toContainText('Copernicus DEM GLO-90');
    await expect(page.getByTestId('basemap-terrain')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('basemap-map')).toHaveAttribute('aria-pressed', 'false');
});

test('Dashboard: View Details goes to /alerts; the timeline card and the ML line go to /nowcast', async ({ page }) => {
    await openDashboard(page);
    const meta = await (await page.request.get(`${API}/ml/india/meta`)).json();
    await expect(page.getByTestId('dashboard-timeline-text')).toHaveText(`Per-lead forecasts (${meta.leads_available.join(', ')} h) → ML Nowcast`);
    await expect(page.getByTestId('dashboard-timeline-card')).toHaveAttribute('href', '/nowcast');
    await expect(page.getByTestId('dashboard-ml-link')).toHaveText('Calibrated 1–6 h nowcasts: ML Nowcast →');
    await expect(page.getByTestId('dashboard-ml-link')).toHaveAttribute('href', '/nowcast');
    await page.getByTestId('risk-view-details').click();
    await expect(page).toHaveURL(/\/alerts$/);
    await page.goBack();
    await page.getByTestId('dashboard-timeline-card').click();
    await expect(page).toHaveURL(/\/nowcast$/);
});

test('Dashboard screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await openDashboard(page);
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(SHOTS, `dashboard_${w}x${h}.png`) });
    }
});
