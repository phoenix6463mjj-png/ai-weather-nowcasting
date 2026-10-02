// UX fixes from review: routes ("/" = Dashboard, /overview), attribution bars, Event check width + Expand,
// Shelter options (choosing a location, plain English, plain pin numbers), layer defaults, the map toolbar,
// the mini legend, the compact alert popup and the uncovered map share.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();
const SIZES = [[1920, 1080], [1366, 768]];
const MALANA = { ep: 'REF051', ts: '20240731T1500Z' };

async function shot(page, name) {
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-pane img')].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
const loaded = (page, key = /REF051/) => expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', key, { timeout: 60_000 });
async function openDrawer(page, s) {
    if ((await page.getByTestId('drawer').getAttribute('data-open')) !== s) await page.getByTestId(`drawer-tab-${s}`).click();
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', s);
}
// share of the map covered by the panels drawn over it (layers, legend, popup, Start here)
const covered = (page) => page.evaluate(() => {
    const m = document.querySelector('.leaflet-container').getBoundingClientRect();
    const sel = '[data-testid="layers-panel"], [data-testid="map-legend"], [data-testid="start-here"], .leaflet-popup';
    const a = [...document.querySelectorAll(sel)].reduce((s, el) => {
        const r = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(r.right, m.right) - Math.max(r.left, m.left));
        const y = Math.max(0, Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top));
        return s + x * y;
    }, 0);
    return a / (m.width * m.height);
});

// ------------------------------------------------------------------ 1 routes and navigation
test('routes: "/" is the Dashboard with the briefing card, /overview the Overview, /dashboard redirects to "/"', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    const card = page.getByTestId('dashboard-briefing-card');
    await expect(card).toContainText('New here? See the system briefing');
    await expect(page.getByTestId('dashboard-briefing-link')).toHaveAttribute('href', '/overview');
    expect(await card.innerText()).not.toMatch(/\bsafe\b/i);
    await expect(page.getByTestId('site-nav').locator('a, button')).toHaveText(
        ['Dashboard', 'Overview', 'Explore map', 'Results', 'Analytics', 'Current weather (rule-based)']);
    await page.getByTestId('nav-rule-menu').click();
    await expect(page.getByTestId('nav-rule-items').getByRole('menuitem')).toHaveText(['Forecast', 'Alerts', 'Reports']);
    await page.keyboard.press('Escape');
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/');
        await expect(card).toBeVisible();
        await shot(page, `ux_dashboard_card_${w}x${h}`);
    }
    await page.getByTestId('dashboard-briefing-link').click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByTestId('overview-heading')).toHaveText('System briefing');
    await page.reload();
    await expect(page.getByTestId('overview-heading')).toHaveText('System briefing');
    // old /dashboard links (with their search) land on "/"
    await page.goto('/dashboard?city=Pune');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await page.goto('/dashboard');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    // the rule-based pages' "back" links and Start here point to the new routes
    await page.goto('/reports');
    await expect(page.getByRole('link', { name: /Dashboard/ }).first()).toHaveAttribute('href', '/');
    const vercel = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'frontend', 'frontend-react', 'vercel.json'), 'utf8'));
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
});

test.describe('first visit', () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test('Start here links to /overview', async ({ page }) => {
        await page.goto('/nowcast');
        await expect(page.getByTestId('start-here-overview')).toHaveAttribute('href', '/overview');
    });
});

// ------------------------------------------------------------------ 2 attribution bars
test('attribution bars: left-aligned, length = strength, direction from the sign, same order (Overview step 4 and the drawer)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const d = await api(page, 'overview');
    await page.goto('/overview');
    await expect(page.getByTestId('ov-text-2')).toContainText('mm/hr');
    await page.getByTestId('ov-dot-4').click();
    const rows = page.getByTestId('ov-reason');
    await expect(rows).toHaveCount(d.explain.reasons.length);
    const max = Math.max(...d.explain.reasons.map((r) => Math.abs(r.shap_logodds)));
    for (let i = 0; i < d.explain.reasons.length; i += 1) {
        const r = d.explain.reasons[i];
        const row = rows.nth(i);
        await expect(row).toContainText(r.text);
        await expect(row).toHaveAttribute('data-direction', r.shap_logodds > 0 ? 'raises' : 'lowers');
        await expect(row.getByTestId('attr-label')).toHaveText(r.shap_logodds > 0 ? 'raises risk' : 'lowers risk');
        const [bar, track] = await Promise.all([row.getByTestId('attr-bar').boundingBox(), row.getByTestId('attr-bar').locator('..').boundingBox()]);
        expect(Math.abs(bar.x - track.x)).toBeLessThan(1);                                   // starts at the left
        expect(bar.width / track.width).toBeCloseTo(Math.abs(r.shap_logodds) / max, 1);
    }
    await page.waitForTimeout(1200);
    await shot(page, 'ux_overview_step4_1920x1080');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByTestId('ov-dot-4').click();
    await expect(page.getByTestId('briefing-map')).toHaveAttribute('data-step', '4');
    await page.waitForTimeout(1500);
    await shot(page, 'ux_overview_step4_1366x768');

    // the Alert drawer's "Why" section: the same rows in the same order, with values
    const st = (await api(page, 'episodes')).start;
    const det = await api(page, `issues/${st.episode}/${st.ts}/alerts/${st.alert_id}`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/nowcast');
    await loaded(page);
    const why = page.getByTestId('why-row');
    await expect(why).toHaveCount(det.waterfall.length);
    for (let i = 0; i < det.waterfall.length; i += 1) {
        const w = det.waterfall[i];
        await expect(why.nth(i)).toContainText(w.text);
        if (w.shap_logodds_total != null) {
            await expect(why.nth(i)).toHaveAttribute('data-direction', w.shap_logodds_total > 0 ? 'raises' : 'lowers');
            await expect(why.nth(i).getByTestId('attr-label')).toHaveText(w.shap_logodds_total > 0 ? 'raises risk' : 'lowers risk');
        }
    }
});

// ------------------------------------------------------------------ 3 Event check width + Expand
test('Event check opens at the same width as the other sections, reflows, and Expand widens it to ~60 %', async ({ page }) => {
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/nowcast?ep=${MALANA.ep}&ts=${MALANA.ts}`);
        await loaded(page, `${MALANA.ep}/${MALANA.ts}`);
        const widths = {};
        for (const s of ['alert', 'caveats', 'event']) {
            await openDrawer(page, s);
            widths[s] = Number(await page.getByTestId(`drawer-panel-${s}`).getAttribute('data-width'));
        }
        expect(widths.event).toBe(widths.alert);
        expect(widths.alert).toBe(w >= 1600 ? 525 : 420);                                     // unchanged
        const tl = page.getByTestId('warning-timeline');
        await expect(tl).toHaveAttribute('data-compact', 'true');
        // no overlap: nothing in the timeline wider than the drawer; hour labels do not touch
        expect(await tl.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const gaps = await tl.evaluate((el) => {
            const xs = [...el.querySelectorAll('[data-testid="tl-hour"]')].map((s) => s.getBoundingClientRect()).sort((a, b) => a.left - b.left);
            return xs.slice(1).map((r, i) => r.left - xs[i].right);
        });
        expect(Math.min(...gaps, 99)).toBeGreaterThanOrEqual(2);
        await shot(page, `ux_event_check_normal_${w}x${h}`);
        await page.getByTestId('drawer-expand').click();
        const panel = page.getByTestId('drawer-panel-event');
        await expect(panel).toHaveAttribute('data-expanded', 'true');
        expect(Number(await panel.getAttribute('data-width'))).toBe(Math.round(w * 0.6));
        await expect(page.getByTestId('drawer-expand')).toHaveText(/Collapse/);
        await shot(page, `ux_event_check_expanded_${w}x${h}`);
        await page.getByTestId('drawer-expand').click();
        expect(Number(await panel.getAttribute('data-width'))).toBe(widths.alert);
        // only Event check has Expand
        await openDrawer(page, 'alert');
        await expect(page.getByTestId('drawer-expand')).toHaveCount(0);
    }
});

// ------------------------------------------------------------------ 4 + 5 Shelter options
async function openShelter(page) {
    await page.goto(`/nowcast?ep=${MALANA.ep}&ts=${MALANA.ts}`);
    await loaded(page, `${MALANA.ep}/${MALANA.ts}`);
    await openDrawer(page, 'shelter');
    await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-source', 'site', { timeout: 30_000 });
}
const llText = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;

test('Shelter options: intro, default location with why, plain summary, "How this is checked", plain numbers', async ({ page }) => {
    const dflt = await api(page, `issues/${MALANA.ep}/${MALANA.ts}/shelters/default-point`);
    const sh = await api(page, `issues/${MALANA.ep}/${MALANA.ts}/shelters?lat=${dflt.lat.toFixed(4)}&lon=${dflt.lon.toFixed(4)}`);
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await openShelter(page);
        await expect(page.getByTestId('shelter-intro')).toHaveText('Choose a location (where you are, or a place you care about). We list nearby public buildings outside the alert areas.');
        await expect(page.getByTestId('shelter-location')).toHaveText(`Location: ${llText(dflt.lat, dflt.lon)}, ${sh.point.elevation_m.toLocaleString('en-US')} m above sea level`);
        await expect(page.getByTestId('shelter-location-why')).toHaveText(`Chosen: the peak of the alert nearest ${dflt.site.name}`);
        const N = sh.n_within_radius;
        await expect(page.getByTestId('shelter-summary-count')).toContainText(`${N} public building${N === 1 ? '' : 's'} (`);
        await expect(page.getByTestId('shelter-summary-count')).toContainText(`within ${sh.radius_km} km of this location.`);
        const split = sh.n_outside === 0 ? `All ${N} are inside an alert area.`
            : sh.n_inside === 0 ? `All ${N} are outside all alert areas: listed below.`
                : `${sh.n_outside} ${sh.n_outside === 1 ? 'is' : 'are'} outside all alert areas: listed first below.`;
        await expect(page.getByTestId('shelter-summary-split')).toHaveText(split);
        await expect(page.getByTestId('shelter-straight-line')).toHaveText('Distances are straight-line, not road routes.');
        if (sh.widen_radius_km) await expect(page.getByTestId('shelter-widen')).toHaveText(`Search up to ${sh.widen_radius_km} km`);
        // the technical alert-check note sits behind "How this is checked"
        await expect(page.getByTestId('shelter-alert-check')).toBeHidden();
        await page.getByTestId('shelter-how-toggle').click();
        await expect(page.getByTestId('shelter-alert-check')).toHaveText(`Alert check: ${sh.n_alerts_checked} alerts of this issue (${sh.alert_scope}), not only those on the map.`);
        // plain words, plain numbers (no "i4"), filled = outside, hollow = inside
        const panel = page.getByTestId('shelter-panel');
        await expect(panel).not.toContainText('candidate outside all alerts');
        await expect(panel).not.toContainText('chosen point');
        if (sh.n_inside > 0) await page.getByTestId('shelter-inside-toggle').click();
        const nums = await page.getByTestId('shelter-number').allInnerTexts();
        expect(nums).toEqual(nums.map((_, i) => String(i + 1)));
        const pins = await page.locator('.nowcast-shelter-label').allInnerTexts();
        for (const t of pins) expect(t.trim()).toMatch(/^\d+$/);
        await shot(page, `ux_shelter_${w}x${h}`);
        // 3D view legend in plain words
        await page.getByTestId('shelter-3d').click();
        const lg = page.getByTestId('terrain3d-legend');
        await expect(lg).toContainText('Your chosen location');
        await expect(lg).toContainText('Public building outside all alert areas');
        await expect(lg).toContainText('Public building inside an alert area');
        await page.waitForTimeout(2500);
        await shot(page, `ux_3d_view_${w}x${h}`);
        await page.getByTestId('terrain3d-close').click();
    }
});

test.describe('geolocation inside the region', () => {
    test.use({ geolocation: { latitude: 31.10, longitude: 77.17 }, permissions: ['geolocation'] });     // Shimla (Himachal Pradesh)
    test('"Use my location": asked only on click, used for the distances, shown as "your location"', async ({ page }) => {
        await page.addInitScript(() => {
            window.__geoCalls = 0;
            const g = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
            navigator.geolocation.getCurrentPosition = (...a) => { window.__geoCalls += 1; return g(...a); };
        });
        await page.setViewportSize({ width: 1366, height: 768 });
        await openShelter(page);
        expect(await page.evaluate(() => window.__geoCalls)).toBe(0);                      // never without a click
        const asked = [];
        page.on('request', (r) => { if (r.url().includes('/shelters?')) asked.push(r.url()); });
        await page.getByTestId('shelter-geolocate').click();
        await expect.poll(() => asked.join(' '), { timeout: 15000 }).toContain('lat=31.1000&lon=77.1700');
        await expect(page.getByTestId('shelter-location')).toContainText('m above sea level');
        expect(await page.evaluate(() => window.__geoCalls)).toBe(1);
        await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-source', 'geo');
        await expect(page.getByTestId('shelter-location')).toContainText('Location: 31.10° N, 77.17° E');
        await expect(page.getByTestId('shelter-location-why')).toHaveText('Chosen: your location');
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
        expect(stored).not.toContain('31.1');
    });
});

test.describe('geolocation outside the region', () => {
    test.use({ geolocation: { latitude: 19.07, longitude: 72.88 }, permissions: ['geolocation'] });
    test('"Use my location" outside Uttarakhand and Himachal Pradesh: "Not available for this area yet"', async ({ page }) => {
        await openShelter(page);
        await page.getByTestId('shelter-geolocate').click();
        await expect(page.getByTestId('shelter-not-available')).toHaveText('Not available for this area yet.');
        await expect(page.getByTestId('shelter-location-why')).toHaveText('Chosen: your location');
    });
});

test.describe('geolocation denied', () => {
    test.use({ permissions: [] });
    test('"Use my location" with permission refused: a plain message, nothing else changes', async ({ page }) => {
        await page.addInitScript(() => {
            navigator.geolocation.getCurrentPosition = (_ok, err) => err({ code: 1, message: 'denied' });
        });
        await openShelter(page);
        await page.getByTestId('shelter-geolocate').click();
        await expect(page.getByTestId('shelter-location-msg')).toHaveText('Location permission was not given. Choose a place another way.');
        await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-source', 'site');
    });
});

test('"Try an example location: Kullu": coordinates from the locations file, labelled as an example', async ({ page }) => {
    const csv = await (await page.request.get('/india_locations.csv')).text();
    const row = csv.split(/\r?\n/).find((l) => l.startsWith('Kullu,')).split(',');
    const [lat, lon] = [Number(row[2]), Number(row[3])];
    await openShelter(page);
    await expect(page.getByTestId('shelter-example')).toHaveText('Try an example location: Kullu');
    await page.getByTestId('shelter-example').click();
    await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-source', 'example');
    await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-lat', lat.toFixed(4));
    await expect(page.getByTestId('shelter-location-why')).toHaveText('Chosen: example location (Kullu)');
    const sh = await api(page, `issues/${MALANA.ep}/${MALANA.ts}/shelters?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
    await expect(page.getByTestId('shelter-location')).toHaveText(`Location: ${llText(lat, lon)}, ${sh.point.elevation_m.toLocaleString('en-US')} m above sea level`);
});

// ------------------------------------------------------------------ 6 + 7 map defaults, toolbar, legend, popup
test('map defaults: observed and "outside displayed alerts" layers off; toggles in the Layers panel add them', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/nowcast');
    await loaded(page);
    await expect(page.locator('img.nowcast-raster.observed')).toHaveCount(0);
    await expect(page.locator('img.nowcast-raster.missed')).toHaveCount(0);
    await expect(page.getByTestId('observed-toggle')).not.toBeChecked();
    await expect(page.getByTestId('missed-toggle')).not.toBeChecked();
    await page.getByTestId('observed-toggle').check();
    await expect(page.locator('img.nowcast-raster.observed')).toHaveCount(1);
    await page.getByTestId('missed-toggle').check();
    await expect(page.locator('img.nowcast-raster.missed')).toHaveCount(1);
    await expect(page.getByTestId('legend-full')).toContainText('Observed');
});

test('toolbar always visible and working at 1920, 1366 and 390 px; Layers collapsed at 1366, open at 1920, never closed by a map click', async ({ page }) => {
    for (const [w, h] of [...SIZES, [390, 844]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast');
        await loaded(page);
        const tb = page.getByTestId('map-toolbar');
        await expect(tb).toBeVisible();
        for (const id of ['episode-select', 'issue-select', 'lead-2', 'watch-toggle']) await expect(tb.getByTestId(id)).toBeAttached();
        await tb.getByTestId('lead-2').scrollIntoViewIfNeeded();
        await tb.getByTestId('lead-2').click();
        await expect(tb.getByTestId('lead-2')).toHaveAttribute('aria-pressed', 'true');
        await tb.getByTestId('watch-toggle').check();
        await expect(tb.getByTestId('watch-toggle')).toBeChecked();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (w === 390) continue;
        await expect(page.getByTestId('layers-panel')).toHaveAttribute('data-open', String(w >= 1600));
        if (w < 1600) await page.getByTestId('layers-toggle').click();
        // a map click never closes the Layers panel or the full legend
        await page.getByTestId('legend-toggle').click();
        await expect(page.getByTestId('legend-full')).toBeVisible();
        const box = await page.locator('.leaflet-container').boundingBox();
        await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.15);
        await expect(page.getByTestId('layers-panel')).toHaveAttribute('data-open', 'true');
        await expect(page.getByTestId('legend-full')).toBeVisible();
    }
});

test('mini legend: hazard colours + Warning (Watch only when shown), at most two lines; full legend closed by default', async ({ page }) => {
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast');
        await loaded(page);
        const mini = page.getByTestId('mini-legend');
        await expect(mini).toContainText('Warning');
        await expect(mini).not.toContainText('Watch');
        await expect(page.getByTestId('legend-full')).toBeHidden();
        const lines = await mini.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || 20)));
        expect(lines).toBeLessThanOrEqual(2);
        await page.getByTestId('watch-toggle').check();
        await expect(mini).toContainText('Watch');
    }
});

test('alert popup: at most 2 short lines + "Details" (opens the Alert section); verification text only in the drawer', async ({ page }) => {
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/nowcast?ep=${MALANA.ep}&ts=${MALANA.ts}`);
        await loaded(page, `${MALANA.ep}/${MALANA.ts}`);
        if ((await page.getByTestId('drawer').getAttribute('data-open')) !== '') await page.getByTestId('drawer-close').click();
        const poly = page.locator('path.nowcast-alert-poly').first();
        const b = await poly.boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        const pop = page.getByTestId('alert-popup');
        await expect(pop).toBeVisible();
        const lines = (await pop.innerText()).split('\n').map((l) => l.trim()).filter((l) => l && l !== 'Details');
        expect(lines.length).toBeLessThanOrEqual(2);
        await expect(pop).not.toContainText('IMERG');
        await expect(pop).not.toContainText('documented');
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', '');
        await shot(page, `ux_alert_popup_${w}x${h}`);
        const id = await pop.getAttribute('data-alert-id');
        await page.getByTestId('alert-popup-details').click();
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
        await expect(page.getByTestId('explain-panel')).toContainText(id);
    }
});

test('/nowcast default at 1920 and 1366: drawer open, >= ~70 % of the map uncovered, toolbar visible', async ({ page }) => {
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast');
        await loaded(page);
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
        await expect(page.getByTestId('map-toolbar')).toBeVisible();
        expect(await covered(page), `covered share at ${w}`).toBeLessThanOrEqual(0.3);
        await shot(page, `ux_nowcast_default_${w}x${h}`);
    }
});
