// Honesty fixes batch (1 Oct 2026): no "safe"/"safer"/"safety" in visible text on any page; header subtitle
// and title (no clipping at 1366 px with a long place name); no dead sidebar/avatar controls; Alerts,
// Analytics and Reports figures and wording built from the real source and counts; Forecast banner.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const PAGES = ['/', '/dashboard', '/forecast', '/analytics', '/alerts', '/reports', '/nowcast', '/nowcast/results', '/nowcast/approach'];
// No sentence on any page is approved to contain "safe" (no official-advice sentence is shown).
const SAFE = /\bsaf(e|er|ety|ely)\b/i;
const LONG = 'Thiruvananthapuram Municipal Corporation Ward';

async function stubImages(page) {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
}
const lvl = (z) => String(z.risk_level || z.risk || 'LOW').toUpperCase();

test('no visible text on any page contains "safe" / "safer" / "safety"', async ({ page }) => {
    await stubImages(page);
    for (const route of PAGES) {
        await page.goto(route);
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        const text = await page.locator('body').innerText();
        expect(text.match(SAFE)?.[0], route).toBeUndefined();
    }
});

test('header: neutral subtitle on every page; no avatar', async ({ page }) => {
    await stubImages(page);
    for (const route of PAGES) {
        await page.goto(route);
        await expect(page.getByTestId('header-subtitle'), route).toHaveText('Hyper-Local Early Warning System');
        await expect(page.locator('header').getByText('A', { exact: true }), route).toHaveCount(0);
    }
});

test('header at 1366x768 with a long place name: the title is not clipped, the name is cut with an ellipsis', async ({ page }) => {
    await stubImages(page);
    const zones = (await (await page.request.get(`${API}/alerts?limit=380`)).json());
    zones.alerts[0] = { ...zones.alerts[0], city: LONG, fullName: LONG };
    await page.route((u) => u.port === '8000' && u.pathname === '/alerts', (r) => r.fulfill({ json: zones }).catch(() => {}));
    await page.addInitScript(() => { try { localStorage.removeItem('selected_city'); } catch { /* ignore */ } });
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/dashboard');
        const city = page.getByTestId('header-city');
        await expect(city).toHaveAttribute('title', LONG);
        if (w < 1600) {                                   // declutter pass: the place pill is shown from 1600 px
            await expect(city).toBeHidden();
            continue;
        }
        for (const id of ['header-title', 'header-subtitle']) {
            const fits = await page.getByTestId(id).evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
            expect(fits, `${id} at ${w}`).toBe(true);
        }
        const [t, c, nav] = await Promise.all([page.getByTestId('header-title').boundingBox(), city.boundingBox(),
            page.locator('header nav').boundingBox()]);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width, `title before the place name at ${w}`).toBeLessThanOrEqual(c.x);
        expect(c.x + c.width, `place name before the nav at ${w}`).toBeLessThanOrEqual(nav.x + 1);
        await page.screenshot({ path: path.join(SHOTS, `honesty_header_long_city_${w}x${h}.png`), clip: { x: 0, y: 0, width: w, height: 160 } });
    }
});

test('sidebar: Live Map opens the ML Nowcast map; no Locations / Settings; bottom card links to the ML Nowcast', async ({ page }) => {
    await stubImages(page);
    await page.goto('/dashboard');
    const aside = page.locator('aside');
    await expect(aside.getByText('Locations', { exact: true })).toHaveCount(0);
    await expect(aside.getByText('Settings', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nowcast-card')).toHaveAttribute('href', '/nowcast');
    await page.getByTestId('sidebar-live-map').click();
    await expect(page).toHaveURL(/\/nowcast$/);
    await expect(page.locator('.leaflet-container').first()).toBeVisible();
});

test('header search on another page runs the search on the dashboard (was a no-op)', async ({ page }) => {
    await stubImages(page);
    await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({
        json: [{ lat: '18.5204', lon: '73.8567', display_name: 'Pune, Maharashtra, India' }] }));
    await page.goto('/alerts');
    await page.locator('header').getByPlaceholder(/Search city/).fill('Pune');
    await page.locator('header').getByRole('button', { name: 'Find' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('header-city')).toHaveText('Pune', { timeout: 30_000 });
});

test('Alerts: the source badge states the real source (no "Live Feed")', async ({ page }) => {
    await stubImages(page);
    const s = (await (await page.request.get(`${API}/alerts?limit=380`)).json()).summary;
    await page.goto('/alerts');
    const badge = page.getByTestId('alerts-source-badge');
    await expect(badge).not.toHaveText('Loading…');
    await expect(badge).not.toContainText('Live Feed');
    if (s.source === 'openweather') await expect(badge).toContainText('Rule-based indicators from OpenWeather (current weather)');
    if (s.source === 'open-meteo') await expect(badge).toContainText('Rule-based indicators from Open-Meteo (model data)');
    await expect(page.locator('body')).not.toContainText(/Live •/);
});

test('Reports: every figure is counted from the current zone list; exports hold the same rows', async ({ page }) => {
    await stubImages(page);
    const { summary: s, alerts } = await (await page.request.get(`${API}/alerts?limit=380`)).json();
    await page.goto('/reports');
    await expect(page.getByTestId('reports-zones-value')).toHaveText(String(s.total));
    if (s.source === 'sample') {
        await expect(page.getByTestId('sample-safety-net')).toBeVisible();
        await expect(page.getByTestId('report-current')).toHaveCount(0);
        return;
    }
    await expect(page.getByTestId('reports-high-value')).toHaveText(String(s.high));
    await expect(page.getByTestId('reports-moderate-value')).toHaveText(String(s.moderate));
    await expect(page.getByTestId('reports-data-time-value')).toHaveText(s.data_time ? `${s.data_time.slice(11, 16)} UTC` : '—');
    await expect(page.getByTestId('report-counts')).toHaveText(`HIGH ${s.high}MODERATE ${s.moderate}LOW ${s.low}`);
    const flagged = alerts.filter((z) => ['HIGH', 'MODERATE'].includes(String(z.severity).toUpperCase()));
    await expect(page.getByTestId('report-zone')).toHaveCount(Math.min(10, flagged.length));
    for (const [i, z] of flagged.slice(0, 10).entries()) await expect(page.getByTestId('report-zone').nth(i)).toContainText(z.city);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export rated zones/ }).click();
    const csv = (await import('node:fs')).readFileSync(await (await dl).path(), 'utf-8').trim().split('\n');
    expect(csv.filter((l) => !l.startsWith('#')).length - 1).toBe(s.n_rated);
});

test('Forecast: banner sentence; no "Score"', async ({ page }) => {
    await stubImages(page);
    await page.goto('/forecast');
    await expect(page.getByTestId('honesty-banner-rule-score')).toContainText(
        'The risk levels on this page are a rule-based indicator, not the ML model.');
    await expect(page.locator('body')).not.toContainText(/\bScore\b/);
    await expect(page.locator('body')).not.toContainText(/Real-Time|Telemetry/);
});

test('honesty fixes screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    await stubImages(page);
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const [r, name] of [['/', 'dashboard'], ['/alerts', 'alerts'], ['/analytics', 'analytics'], ['/reports', 'reports'],
            ['/forecast', 'forecast']]) {
            await page.goto(r);
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(1200);
            await page.screenshot({ path: path.join(SHOTS, `honesty_${name}_${w}x${h}.png`) });
        }
        await page.goto('/nowcast/approach');
        await expect(page.getByTestId('approach-table')).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, `honesty_approach_table_${w}x${h}.png`) });
        await page.getByTestId('approach-compute-latency').scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS, `honesty_approach_compute_${w}x${h}.png`) });
    }
});
