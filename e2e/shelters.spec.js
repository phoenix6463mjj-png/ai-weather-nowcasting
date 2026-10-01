// Nearby shelter options (drawer section on /nowcast): OSM public buildings near a chosen point (map click
// or the selected alert's peak), checked against every alert of the issue/run. Every value shown is the
// API's (/ml/.../shelters, serve/shelters.py); the fixed wording is shown verbatim; never "safe".
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const WORDING = 'Candidate public buildings outside the current alert area, not verified shelters. Roads may be blocked. '
    + 'Follow evacuation instructions from district authorities and IMD. Emergency: 112.';
const SAFE = /\bsaf(e|er|ety|ely)\b/i;

async function openIssue(page, ep, ts) {
    await page.goto(`/nowcast?ep=${ep}&ts=${ts}`);
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `${ep}/${ts}`, { timeout: 30_000 });
}

// the section's candidates equal the API's for the point the panel shows
async function expectMatchesApi(page, base) {
    const pt = page.getByTestId('shelter-point');
    await expect(page.getByTestId('shelter-summary').or(page.getByTestId('shelter-not-available'))).toBeVisible();
    const [lat, lon] = [await pt.getAttribute('data-lat'), await pt.getAttribute('data-lon')];
    const r = await (await page.request.get(`${API}/ml/${base}/shelters?lat=${lat}&lon=${lon}`)).json();
    const items = page.getByTestId('shelter-candidate');
    await expect(items).toHaveCount(r.candidates.length);
    for (const [i, c] of r.candidates.entries()) {
        const it = items.nth(i);
        await expect(it).toContainText(c.name || `Unnamed ${c.type_label.toLowerCase()}`);
        await expect(it).toContainText(c.type_label);
        await expect(it.getByTestId('shelter-distance')).toHaveText(`${c.distance_km.toFixed(1)} km ${c.direction}`);
        await expect(it).toHaveAttribute('data-outside', String(c.outside_all_alerts));
        const leads = [...new Set(c.inside_alerts.map((a) => a.lead_time_h))].sort((a, b) => a - b);
        await expect(it.getByTestId('shelter-alert-status')).toHaveText(
            c.outside_all_alerts ? 'Outside all current alerts at every lead' : `Inside a current alert at +${leads.join(', +')} h`);
        await expect(it.getByTestId('shelter-slope')).toHaveText(c.slope_deg != null ? `${c.slope_deg}°` : 'no data');
    }
    const d = r.candidates.map((c) => c.distance_km);
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(d.every((x) => x <= r.radius_km)).toBe(true);
    await expect(page.locator('.nowcast-shelter-marker')).toHaveCount(r.candidates.length);
    await expect(page.locator('.nowcast-shelter-marker.inside')).toHaveCount(r.candidates.filter((c) => !c.outside_all_alerts).length);
    return r;
}

test('REF045: selected alert -> shelter options from its peak cell; inside-alert candidates flagged; markers on the map', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T1500Z');
    await page.getByTestId('drawer-tab-alert').click();
    await page.getByTestId('alert-row').first().locator('button').first().click();
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('drawer-panel-shelter')).toContainText('Nearby shelter options');
    await expect(page.getByTestId('shelter-wording')).toHaveText(WORDING);
    await expect(page.getByTestId('shelter-point')).toContainText('(selected alert’s peak cell)');
    const r = await expectMatchesApi(page, 'issues/REF045/20230813T1500Z');
    expect(r.available).toBe(true);
    expect(r.region).toBe('Uttarakhand');
    expect(r.candidates.some((c) => !c.outside_all_alerts)).toBe(true);           // near Pipalkoti: inside alerts
    await expect(page.locator('.nowcast-shelter-point')).toHaveCount(1);
    await expect(page.locator('.nowcast-shelter-radius')).toHaveCount(1);
    expect((await page.getByTestId('drawer-panel-shelter').innerText()).match(SAFE)).toBeNull();
    await expect(page.getByTestId('shelter-badge-in-sample')).toHaveCount(0);
    await expect(page.getByTestId('shelter-badge-live')).toHaveCount(0);
});

test('REF045: a map click (also on an alert) chooses the point and keeps the section open', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T1500Z');
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('drawer-panel-shelter')).toContainText('No point chosen yet.');
    const map = page.locator('.leaflet-container');
    const b = await map.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'shelter');
    await expect(page.getByTestId('shelter-point')).toContainText('(map click)');
    await expectMatchesApi(page, 'issues/REF045/20230813T1500Z');
    // markers disappear with the section (layers only while it is open)
    await page.getByTestId('drawer-close').click();
    await expect(page.locator('.nowcast-shelter-marker')).toHaveCount(0);
    await expect(page.locator('.nowcast-shelter-point')).toHaveCount(0);
});

test('REF051: selected alert -> candidates match the API', async ({ page }) => {
    await openIssue(page, 'REF051', '20240731T1400Z');
    await page.getByTestId('drawer-tab-alert').click();
    await page.getByTestId('alert-row').first().locator('button').first().click();
    await page.getByTestId('drawer-tab-shelter').click();
    const r = await expectMatchesApi(page, 'issues/REF051/20240731T1400Z');
    expect(['Himachal Pradesh', 'Uttarakhand']).toContain(r.region);          // REF051's patch spans both states
    await expect(page.getByTestId('shelter-wording')).toHaveText(WORDING);
});

test('REF025: in-sample badge in the section', async ({ page }) => {
    await openIssue(page, 'REF025', '20210717T1800Z');
    await page.getByTestId('drawer-tab-alert').click();
    await page.getByTestId('alert-row').first().locator('button').first().click();
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-badge-in-sample')).toHaveText('IN-SAMPLE: training-period event, shown for illustration only');
});

test('Live: "not validated"; a point outside the two states -> "Not available for this area yet."', async ({ page }) => {
    await page.goto('/nowcast');
    await page.getByTestId('tab-live').click();
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.waitForTimeout(800);
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-badge-live')).toContainText('Live output: not validated');
    const b = await page.locator('.leaflet-container').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height * 0.6);             // central India
    await expect(page.getByTestId('shelter-not-available')).toHaveText('Not available for this area yet.');
    await expect(page.getByTestId('shelter-candidate')).toHaveCount(0);
    await expect(page.locator('.nowcast-shelter-marker')).toHaveCount(0);
});

test('shelter options screenshots at 1920x1080 and 1366x768 (REF045 and REF051)', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const [ep, ts] of [['REF045', '20230813T1500Z'], ['REF051', '20240731T1400Z']]) {
            await openIssue(page, ep, ts);
            await page.getByTestId('drawer-tab-alert').click();
            await page.getByTestId('alert-row').first().locator('button').first().click();
            await page.getByTestId('drawer-tab-shelter').click();
            await expect(page.getByTestId('shelter-summary')).toBeVisible();
            await page.waitForTimeout(1200);
            await page.screenshot({ path: path.join(SHOTS, `shelters_${ep}_${w}x${h}.png`) });
        }
    }
});
