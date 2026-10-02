// The newest live run (issued 2 Oct 2026 02:30Z) is the Live tab's default and has NO alerts at any lead. The page
// must say so plainly, with numbers read from the run (highest thunderstorm probability, the only probability
// shown as %), and every section must handle 0 alerts cleanly: Live map + drawer (CAP line, INSAT summary),
// shelter options, Analytics (Live). The 26 Sep run (8 alerts) stays reachable via ?view=live&run=.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentenceNoAlertsRun } from '../frontend/frontend-react/src/utils/nowcastAnalytics.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();
const NEW_RUN = '20261002T0230Z';
const OLD_RUN = '20260926T0330Z';
const SAFE = /\bsafe(ly|ty)?\b/i;
const PIPALKOTI = [30.4335, 79.4284];

async function openLive(page) {
    await page.goto('/nowcast');
    await page.getByTestId('tab-live').click();
    await expect(page.getByTestId('lead-1')).toBeAttached({ timeout: 30_000 });
}

// pixel of (lat, lon) on the Live map, from the national terrain image (it spans the run's grid bounds, Web Mercator)
async function pointOnMap(page, meta, lat, lon) {
    const b = await page.locator('img.nowcast-terrain').boundingBox();
    const [[s, w], [n, e]] = meta.bounds;
    const my = (d) => Math.log(Math.tan(Math.PI / 4 + (d * Math.PI) / 360));
    return { x: b.x + ((lon - w) / (e - w)) * b.width, y: b.y + ((my(n) - my(lat)) / (my(n) - my(s))) * b.height };
}

test('Live default = the 2 Oct run: "No Watch or Warning in this run" with the highest thunderstorm probability; drawer per lead, CAP, INSAT', async ({ page }) => {
    const runs = (await api(page, 'live')).runs.map((r) => r.run);
    expect(runs[0]).toBe(NEW_RUN);
    expect(runs).toContain(OLD_RUN);
    const meta = await api(page, `live/${NEW_RUN}/meta`);
    const near = await api(page, `live/${NEW_RUN}/insat`);
    expect(meta.n_alerts).toBe(0);
    expect(meta.no_alert_text).toBe(`No Watch or Warning in this run (highest thunderstorm probability ${meta.thunderstorm_max.per_lead_text[meta.thunderstorm_max.lead]}, at +${meta.thunderstorm_max.lead} h).`);
    await openLive(page);
    await expect(page.getByTestId('live-not-validated')).toContainText('NOT validated');
    await expect(page.getByTestId('live-no-alerts')).toHaveText(meta.no_alert_text);
    await expect(page.locator('path.nowcast-alert-poly')).toHaveCount(0);
    await expect(page.locator('path.nowcast-peak-marker')).toHaveCount(0);
    await page.getByTestId('drawer-tab-alert').click();
    const empty = page.getByTestId('live-empty-run');
    for (const L of meta.leads_available) {
        await page.getByTestId(`lead-${L}`).click();
        await expect(page.getByTestId('live-empty-lead')).toHaveText(
            `At +${L} h the highest thunderstorm probability is ${meta.thunderstorm_max.per_lead_text[L]} (not validated).`);
    }
    await expect(page.getByTestId('live-empty-cap')).toHaveText('CAP review: no alerts in this run, so there is no CAP message to review.');
    await expect(page.getByTestId('live-empty-insat')).toHaveText(near.summary.text);
    expect(near.summary.n_alerts).toBe(0);
    await expect(page.getByTestId('alert-row')).toHaveCount(0);
    expect(await empty.innerText()).not.toMatch(/Also show Watch/);       // nothing hidden: there are no Watches either
    expect(await page.locator('body').innerText()).not.toMatch(SAFE);
});

test('the 26 Sep run stays reachable by URL with its 8 alerts', async ({ page }) => {
    const meta = await api(page, `live/${OLD_RUN}/meta`);
    await page.goto(`/nowcast?view=live&run=${OLD_RUN}`);
    await expect(page.getByTestId('lead-1')).toBeAttached({ timeout: 30_000 });
    await expect(page.getByTestId('live-not-validated')).toContainText('Issued');
    await expect(page.getByTestId('live-no-alerts')).toHaveCount(0);
    await page.getByTestId('watch-toggle').check();
    await page.getByTestId('drawer-tab-alert').click();
    await expect(page.getByTestId('live-empty-run')).toHaveCount(0);
    expect(meta.n_alerts).toBe(8);
});

test('shelter options on the 0-alert run: candidates near Pipalkoti, all outside alerts, nothing inside', async ({ page }) => {
    const meta = await api(page, `live/${NEW_RUN}/meta`);
    await openLive(page);
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-badge-live')).toContainText('Live output: not validated');
    const p = await pointOnMap(page, meta, ...PIPALKOTI);
    await page.mouse.click(p.x, p.y);
    const pt = page.getByTestId('shelter-point');
    await expect(page.getByTestId('shelter-location-why')).toHaveText('Chosen: you clicked here');
    await expect(page.getByTestId('shelter-summary')).toBeVisible({ timeout: 30_000 });
    const r = await api(page, `live/${NEW_RUN}/shelters?lat=${await pt.getAttribute('data-lat')}&lon=${await pt.getAttribute('data-lon')}`);
    expect(r.n_inside).toBe(0);
    await expect(page.getByTestId('shelter-summary-count')).toContainText(`${r.n_within_radius} public building${r.n_within_radius === 1 ? '' : 's'} (`);
    await expect(page.getByTestId('shelter-summary-split')).toHaveText(r.n_within_radius === 1 ? 'It is outside all alert areas: listed below.'
        : `All ${r.n_within_radius} are outside all alert areas: listed below.`);
    await expect(page.getByTestId('shelter-outside-list').getByTestId('shelter-candidate')).toHaveCount(r.candidates.length);
    await expect(page.getByTestId('shelter-inside-toggle')).toHaveCount(0);
    await expect(page.getByTestId('shelter-alert-status').first()).toHaveText('Outside all alert areas (at every lead time)');
    expect(await page.getByTestId('drawer-panel-shelter').innerText()).not.toMatch(SAFE);
});

test('Analytics (Live) on the 0-alert run: run-level sentence, no empty chart', async ({ page }) => {
    const meta = await api(page, `live/${NEW_RUN}/meta`);
    await page.goto('/analytics');
    const sel = page.getByTestId('analytics-source');
    await expect(sel.locator('option', { hasText: 'Live run' })).toHaveCount(1, { timeout: 30_000 });
    await expect(sel.locator('option').first()).toContainText('issued 10-02 02:30Z');
    await expect(page.getByTestId('analytics-s1-sentence')).toHaveText(sentenceNoAlertsRun(meta, 4));
    // +4 h is this run's peak lead: the line is not repeated; another lead adds its own value
    expect(sentenceNoAlertsRun(meta, meta.thunderstorm_max.lead)).toBe(meta.no_alert_text);
    await page.getByTestId('analytics-lead-slider').fill('0');
    await expect(page.getByTestId('analytics-s1-sentence')).toHaveText(
        `${meta.no_alert_text} At +1 h the highest thunderstorm probability is ${meta.thunderstorm_max.per_lead_text[1]}.`);
    await expect(page.getByTestId('analytics-s2').locator('svg')).toHaveCount(0);
    await expect(page.getByTestId('analytics-s3').locator('svg').first()).toBeVisible();     // model-wide sections unchanged
    await expect(page.getByTestId('analytics-s4').locator('svg').first()).toBeVisible();
});

test('0-alert run screenshots at 1920x1080 and 1366x768: Live + INSAT layer, drawer, shelter, Analytics (Live)', async ({ page }) => {
    test.setTimeout(240_000);
    const meta = await api(page, `live/${NEW_RUN}/meta`);
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await openLive(page);
        const lp = page.getByTestId('layers-panel');
        if ((await lp.getAttribute('data-open')) === 'false') await page.getByTestId('layers-toggle').click();
        const t = page.getByTestId('live-insat-toggle');
        if (await t.isEnabled()) await t.check();
        await page.getByTestId('lead-4').click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(SHOTS, `live_oct_insat_${w}x${h}.png`) });
        await page.getByTestId('drawer-tab-alert').click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS, `live_oct_drawer_${w}x${h}.png`) });
        await page.getByTestId('drawer-tab-shelter').click();
        const p = await pointOnMap(page, meta, ...PIPALKOTI);
        await page.mouse.click(p.x, p.y);
        await expect(page.getByTestId('shelter-summary')).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(SHOTS, `live_oct_shelter_${w}x${h}.png`) });
        await page.goto('/analytics');
        await expect(page.getByTestId('analytics-source').locator('option', { hasText: 'Live run' })).toHaveCount(1, { timeout: 30_000 });
        await expect(page.getByTestId('analytics-s1-sentence')).toContainText('No Watch or Warning in this run');
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(SHOTS, `live_oct_analytics_${w}x${h}.png`) });
        await page.getByTestId('analytics-s2').scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS, `live_oct_analytics_s2_${w}x${h}.png`) });
    }
});
