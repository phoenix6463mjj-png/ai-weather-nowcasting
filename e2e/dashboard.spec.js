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
    await page.goto('/dashboard');
    const data = await (await alerts).json();
    await expect(page.getByTestId('dashboard-source-badge')).not.toHaveText('Loading weather source…');
    return data;
}

test('Dashboard: source badge follows the backend weather source; no LIVE badge on sample data', async ({ page }) => {
    const data = await openDashboard(page);
    const src = data.summary.source;
    expect(['sample', 'openweather', 'open-meteo', 'mixed']).toContain(src);
    const badge = page.getByTestId('dashboard-source-badge');
    if (src === 'sample') {
        await expect(badge).toHaveText('Sample data — no live weather feed');
        await expect(page.getByTestId('sidebar-live')).toHaveCount(0);
        await expect(page.getByText('Real-time insights', { exact: false })).toHaveCount(0);
        await expect(page.getByTestId('panel-weather-source')).toHaveText('Sample data — no live weather feed');
    } else if (src === 'openweather') {
        await expect(badge).toContainText('OpenWeather (current weather), updated');
        await expect(page.getByTestId('sidebar-live')).toHaveText('Current weather');
    } else if (src === 'open-meteo') {
        await expect(badge).toContainText('Open-Meteo (model data), updated');
        await expect(badge).not.toContainText('observed');
        await expect(page.getByTestId('sidebar-live')).toHaveText('Current weather');
        await expect(page.getByTestId('open-meteo-credit').first()).toBeVisible();
    }
    await expect(page.getByText('Live AI Nowcasting')).toHaveCount(0);
    await expect(page.getByText('AI Decision Transparency')).toHaveCount(0);
    if (src === 'sample') await expect(page.getByText('Rule-based explanation')).toHaveCount(0);      // safety net
    else await expect(page.getByText('Rule-based explanation')).toBeVisible();
    await expect(page.getByText('Partly Cloudy')).toHaveCount(0);
});

test('Dashboard: no % for any hazard, rule-based levels, primary threat agrees with the risk level, no Safe / All Clear', async ({ page }) => {
    const data = await openDashboard(page);
    test.skip(data.summary.source === 'sample', 'risk UI is hidden on sample data (safety net, sample_safety.spec.js)');
    await expect(page.getByTestId('hazard-level')).toHaveCount(3);
    await expect(page.getByTestId('rule-label')).toHaveText('(rule-based, not the ML model)');
    for (const lv of await page.getByTestId('hazard-level').all()) {
        expect(['Low', 'Moderate', 'High', 'Not rated']).toContain(await lv.getAttribute('data-level'));   // Not rated: no rule points to it
    }
    // the only % left on the page are humidity values
    const body = await page.locator('body').innerText();
    const pctLines = body.split('\n').map((l) => l.trim()).filter((l) => l.includes('%'));
    for (const l of pctLines) expect(l, `unexpected % line: ${l}`).toMatch(/^\d+(\.\d+)?%$/);
    for (const re of [/(cloudburst|flash flood|flood|thunderstorm)[^\n]{0,40}\d+\s*%/i, /\bSafe\b/, /All Clear/i]) {
        expect(body).not.toMatch(re);
    }
    await expect(page.getByTestId('dashboard-legend')).not.toContainText('%');
    // the default zone is the first alert (HIGH first): primary-threat card only for HIGH, no "stable" text,
    // the rule reason once (never together with "No explanation available")
    const first = data.alerts[0];
    const panel = page.locator('h2', { hasText: first.city }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
    await expect(panel).toContainText(`${first.risk_level} RISK`);
    await expect(panel.getByTestId('primary-threat')).toHaveCount(first.risk_level === 'HIGH' ? 1 : 0);
    if (first.risk_level !== 'LOW') await expect(panel).not.toContainText(/stable/i);
    const expl = panel.getByTestId('rule-explanation');
    if (first.reason) {
        await expect(expl).toContainText(`Reason: ${first.reason}`);
        await expect(expl).not.toContainText('No explanation available');
    } else await expect(expl).toHaveText(/Rule-based explanation\s*No explanation available/);
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
    const notice = (await (await page.request.get(`${process.env.E2E_API_URL || 'http://127.0.0.1:8000'}/ml/credits`)).json()).credits.find((c) => c.id === 'copernicus_dem').text;
    await expect(page.getByTestId('terrain-attribution')).toHaveText(`Terrain (Copernicus DEM GLO-90): ${notice}`);   // full notice, as in the credits
    await expect(page.getByTestId('basemap-terrain')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('basemap-map')).toHaveAttribute('aria-pressed', 'false');
});

test('Dashboard: View Details goes to /alerts; the timeline card and the ML line go to /nowcast', async ({ page }) => {
    const data = await openDashboard(page);
    test.skip(data.summary.source === 'sample', 'risk UI is hidden on sample data (safety net, sample_safety.spec.js)');
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

// primary threat, computed here independently of the page: a hazard only when the fired rule points to it
// (the rain rules -> flood: the HIGH rain rule for a HIGH zone, the MODERATE rain rule for a MODERATE one)
function threatOf(a) {
    const r = String(a.risk_level).toUpperCase();
    const rules = a.rules_fired || [];
    if (r === 'HIGH') return rules.includes('Rain above 20 mm in the last hour') ? 'flood' : null;
    if (r === 'MODERATE') return rules.includes('Rain above 5 mm in the last hour') ? 'flood' : null;
    return null;
}

test('Dashboard: event-layer toggles filter markers by primary threat; low-risk zones stay visible', async ({ page }) => {
    const data = await openDashboard(page);
    test.skip(data.summary.source === 'sample', 'risk UI is hidden on sample data (safety net, sample_safety.spec.js)');
    const zones = data.alerts;
    const low = zones.filter((a) => threatOf(a) == null).length;
    const markers = page.getByTestId('dashboard-markers');
    await expect(markers).toHaveAttribute('data-count', String(zones.length));
    const layers = [['thunderstorm', 'Toggle Thunderstorm Filter'], ['cloudburst', 'Toggle Cloudburst Filter'], ['flood', 'Toggle Flash Flood Filter']];
    const off = new Set();
    for (const [key, label] of layers) {
        await page.getByRole('switch', { name: label }).click();
        off.add(key);
        const expected = zones.filter((a) => { const t = threatOf(a); return t == null || !off.has(t); }).length;
        await expect(markers).toHaveAttribute('data-count', String(expected));
        await expect(markers).toHaveAttribute('data-low', String(low));          // low-risk zones never hidden
    }
    // all three off: exactly the low-risk zones remain; back on: everything again
    await expect(markers).toHaveAttribute('data-count', String(low));
    for (const [, label] of layers) await page.getByRole('switch', { name: label }).click();
    await expect(markers).toHaveAttribute('data-count', String(zones.length));
});

// Map declutter: the zone list is frozen at its first response (OpenWeather may still be filling the list),
// so the expected line is computed from exactly the data the page shows.
async function freezeAlerts(page) {
    let frozen = null;
    await page.route((u) => u.href.startsWith(API) && u.pathname === '/alerts', async (route) => {
        const res = await route.fetch();
        if (!frozen) frozen = await res.json();
        await route.fulfill({ response: res, json: frozen });
    });
}

// "OpenWeather N/T · Open-Meteo M/T · sample data S/T · updated HH:MM UTC", computed here from the summary
function expectedLine(s) {
    if (s.source === 'sample') return 'Sample data · no live weather feed';
    const z = s.zone_sources;
    const ow = z.openweather + z.openweather_stale, om = z.open_meteo + z.open_meteo_stale;
    const parts = [];
    if (ow) parts.push(`OpenWeather ${ow}/${s.total}`);
    if (om) parts.push(`Open-Meteo ${om}/${s.total}`);
    if (z.sample) parts.push(`sample data ${z.sample}/${s.total}`);
    const t = [s.source_times?.openweather?.max, s.source_times?.['open-meteo']?.max, s.data_time, s.latest_observed_at]
        .filter(Boolean).map((x) => new Date(x)).sort((a, b) => a - b).at(-1);
    if (t) parts.push(`updated ${t.toISOString().slice(11, 16)} UTC`);
    return parts.join(' · ');
}

test('Dashboard map: one-line source from the real counts, full wording in its (i), licence credits in the attribution corner', async ({ page }) => {
    await freezeAlerts(page);
    const data = await openDashboard(page);
    const s = data.summary;
    const line = page.getByTestId('dashboard-source-line');
    await expect(line).toHaveText(expectedLine(s));
    expect((await line.boundingBox()).height, 'one line').toBeLessThan(26);
    // full wording hidden until the (i) is clicked; Esc and a click outside close it
    const full = page.getByTestId('dashboard-source-badge');
    await expect(full).toBeHidden();
    await page.getByTestId('dashboard-source-info-button').click();
    await expect(full).toBeVisible();
    if (s.source === 'mixed' && s.openweather_filling) await expect(full).toContainText('the rest switch to OpenWeather as they are fetched');
    await page.keyboard.press('Escape');
    await expect(full).toBeHidden();
    await page.getByTestId('dashboard-source-info-button').click();
    await page.getByTestId('dashboard-map').click({ position: { x: 300, y: 300 } });
    await expect(full).toBeHidden();
    // legend (i)
    if (s.source !== 'sample') {
        await expect(page.getByTestId('legend-info')).toBeHidden();
        await page.getByTestId('legend-info-button').click();
        await expect(page.getByTestId('legend-info')).toHaveText("Marker colour = the zone's rule-based risk level (not the ML model).");
        await page.keyboard.press('Escape');
    }
    // licence credits stay visible in the attribution corner for every source whose data appear
    const attr = page.locator('.leaflet-control-attribution');
    const z = s.zone_sources;
    const usesOW = s.source === 'openweather' || z.openweather + z.openweather_stale > 0;
    const usesOM = s.source === 'open-meteo' || z.open_meteo + z.open_meteo_stale > 0;
    if (usesOW) {
        await expect(attr.getByTestId('openweather-credit')).toBeVisible();
        await expect(attr.getByRole('link', { name: 'Weather data © OpenWeather' })).toHaveAttribute('href', 'https://openweathermap.org/');
        await expect(attr.getByRole('link', { name: 'ODbL' })).toHaveAttribute('href', 'https://opendatacommons.org/licenses/odbl/');
    } else await expect(attr.getByTestId('openweather-credit')).toHaveCount(0);
    if (usesOM) {
        await expect(attr.getByTestId('open-meteo-credit')).toBeVisible();
        await expect(attr.getByRole('link', { name: 'Open-Meteo.com' })).toHaveAttribute('href', 'https://open-meteo.com/');
        await expect(attr.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    } else await expect(attr.getByTestId('open-meteo-credit')).toHaveCount(0);
});

const OVERLAYS = ['dashboard-basemap', 'dashboard-source', 'dashboard-legend'];

// overlay share of the map area, overlaps with the attribution / zoom controls / each other, overlay font sizes
async function overlayGeometry(page) {
    return page.evaluate((ids) => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const hit = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
        const map = box(document.querySelector('[data-testid="dashboard-map"]'));
        const ov = ids.map((id) => document.querySelector(`[data-testid="${id}"]`)).filter(Boolean);
        const boxes = ov.map(box);
        const controls = [...document.querySelectorAll('[data-testid="dashboard-map"] .leaflet-control-attribution, [data-testid="dashboard-map"] .leaflet-control-zoom')].map(box);
        const fonts = ov.flatMap((el) => [el, ...el.querySelectorAll('*')])
            .filter((el) => el.closest('[role="note"]') == null && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            .map((el) => parseFloat(getComputedStyle(el).fontSize));
        return {
            n: ov.length,
            share: boxes.reduce((a, b) => a + b.w * b.h, 0) / (map.w * map.h),
            controlHits: boxes.flatMap((b, i) => controls.filter((c) => hit(b, c)).map(() => ids[i])),
            pairHits: boxes.flatMap((b, i) => boxes.slice(i + 1).filter((c) => hit(b, c)).map(() => ids[i])),
            inside: boxes.every((b) => b.x >= map.x - 1 && b.r <= map.r + 1 && b.y >= map.y - 1 && b.b <= map.b + 1),
            legendH: document.querySelector('[data-testid="dashboard-legend"]')?.getBoundingClientRect().height ?? 0,
            minFont: Math.min(...fonts), maxFont: Math.max(...fonts),
        };
    }, OVERLAYS);
}

test('Dashboard map: overlays cover at most 15 % of the map and overlap neither the attribution nor each other (1920x1080, 1366x768, all base maps)', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        const data = await openDashboard(page);
        await expect(page.locator('[data-testid="dashboard-map"] .leaflet-control-attribution')).toBeVisible();
        for (const base of ['map', 'satellite', 'terrain']) {
            await page.getByTestId(`basemap-${base}`).click();
            if (base === 'terrain') await expect(page.getByTestId('terrain-attribution')).toBeVisible();      // the long DEM notice wraps
            await page.waitForTimeout(400);
            const g = await overlayGeometry(page);
            const at = `${w}x${h} ${base}`;
            expect(g.n, at).toBe(data.summary.source === 'sample' ? 2 : 3);
            expect(g.share, `${at}: overlay share ${(g.share * 100).toFixed(1)} %`).toBeLessThanOrEqual(0.15);
            expect(g.controlHits, at).toEqual([]);
            expect(g.pairHits, at).toEqual([]);
            expect(g.inside, at).toBe(true);
            if (data.summary.source !== 'sample') expect(g.legendH, `${at}: legend in one row`).toBeLessThan(32);
            expect(g.minFont, at).toBeGreaterThanOrEqual(13);               // approved exception on this map only: 13-14 px
            expect(g.maxFont, at).toBeLessThanOrEqual(14);
        }
    }
});

test('Dashboard screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await openDashboard(page);
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(SHOTS, `dashboard_${w}x${h}.png`) });
        // the map itself (below the fold at 1366x768), and with the source (i) open
        const map = page.getByTestId('dashboard-map');
        await map.scrollIntoViewIfNeeded();
        await map.screenshot({ path: path.join(SHOTS, `dashboard_map_${w}x${h}.png`) });
        await page.getByTestId('dashboard-source-info-button').click();
        await map.screenshot({ path: path.join(SHOTS, `dashboard_map_info_${w}x${h}.png`) });
        await page.keyboard.press('Escape');
        await page.getByTestId('basemap-terrain').click();                  // the long DEM notice wraps the attribution
        await expect(page.getByTestId('terrain-attribution')).toBeVisible();
        await page.waitForTimeout(500);
        await map.screenshot({ path: path.join(SHOTS, `dashboard_map_terrain_${w}x${h}.png`) });
    }
});
