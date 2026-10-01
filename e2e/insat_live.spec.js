// INSAT I3a: Live tab INSAT cloud-top layer (observation, off by default), per-alert coldest cloud top near the
// valid time, measured INSAT latency on Approach, and "INSAT at three cloudbursts IMERG barely saw" on Results.
// The serve API runs with the test fixtures (NOWCAST_INSAT_LIVE_DIR = serve/tests/fixtures/insat_live: 4 real
// 28 Sep 2026 frames; NOWCAST_INSAT_EVENTS_FILE = the analysis run on REF051's case files). Every value shown
// is the API's.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const LABEL = 'INSAT cloud tops (satellite observation, INSAT via MOSDAC)';
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();

async function openLive(page) {
    await page.goto('/nowcast');
    await page.getByTestId('tab-live').click();
    await expect(page.getByTestId('lead-1')).toBeAttached({ timeout: 30_000 });
    const lp = page.getByTestId('layers-panel');
    if (await lp.count() && (await lp.getAttribute('data-open')) === 'false') await page.getByTestId('layers-toggle').click();
}

test('Live: INSAT layer off by default; on = the latest frame with its satellite, scan time and measured latency', async ({ page }) => {
    const layer = await api(page, 'live-insat');
    test.skip(!layer.available, 'no live INSAT frames on the API (serve started without the fixtures)');
    await openLive(page);
    const t = page.getByTestId('live-insat-toggle');
    await expect(page.getByTestId('live-insat-control')).toContainText(LABEL);
    await expect(t).not.toBeChecked();
    await expect(page.locator('img.live-insat')).toHaveCount(0);
    await expect(page.getByTestId('legend-insat')).toHaveCount(0);
    await t.check();
    await expect(page.getByTestId('live-insat-caption')).toHaveText(layer.latest.caption);
    expect(layer.latest.caption).toMatch(/^INSAT-3D[RS] · acquired \d\d \w{3} \d\d:\d\dZ · measured latency \d+ min$/);
    await expect(page.locator('img.live-insat')).toHaveAttribute('src', new RegExp(`live-insat/frames/${layer.latest.id}\\.png$`));
    await expect(page.getByTestId('legend-insat-floor')).toHaveText(layer.latest.floor_line);
    await expect(page.getByTestId('legend-insat-floor')).toContainText("≤180 K = at or below the coldest value in the product's lookup table");
    await expect(page.getByTestId('insat-line').first()).toHaveText(layer.lines[0]);
    await expect(page.getByTestId('live-insat-control')).toContainText(layer.threshold_note);
    // the last few frames: newest first; a 3DS frame shows its own caption and the 3DS georef note
    await expect(page.getByTestId('live-insat-frame')).toHaveCount(layer.frames.length);
    const ds = layer.frames.find((f) => f.satellite === 'INSAT-3DS');
    await page.locator(`[data-testid="live-insat-frame"][data-frame="${ds.id}"]`).click();
    await expect(page.getByTestId('live-insat-caption')).toHaveText(ds.caption);
    await expect(page.getByTestId('legend-insat-floor')).toHaveText(ds.floor_line);
    await expect(page.getByTestId('live-insat-3ds-note')).toBeVisible();
    await expect(page.getByTestId('legend-insat-title')).toHaveText('INSAT-3DS cloud-top brightness temperature (K)');
    await expect(page.locator('img.live-insat')).toHaveAttribute('src', new RegExp(`${ds.id}\\.png$`));
    await t.uncheck();
    await expect(page.locator('img.live-insat')).toHaveCount(0);
});

test('Live alert: "No INSAT frame near this alert\'s valid time" (the run is 26 Sep; the frames are later)', async ({ page }) => {
    await openLive(page);
    const run = (await api(page, 'live')).runs[0].run;
    const near = await api(page, `live/${run}/insat`);
    await page.getByTestId('watch-toggle').check();                   // the live run has Watch alerts only
    await page.getByTestId('drawer-tab-alert').click();
    await page.getByTestId('alert-row').first().locator('button').first().click();
    await expect(page.getByTestId('live-alert-insat-text')).toHaveText("No INSAT frame near this alert's valid time");
    expect(Object.values(near.alerts).every((a) => !a.available)).toBe(true);
    expect(near.rule).toContain('±60 min');
});

test('Approach: measured INSAT latency line, read from docs/insat_latency.json', async ({ page }) => {
    const a = (await api(page, 'approach')).insat_latency;
    test.skip(!a, 'no INSAT latency measured');
    await page.goto('/nowcast/approach');
    const line = page.getByTestId('approach-insat-latency');
    await expect(line).toContainText(`INSAT latency (measured): ${a.text}`);
    await expect(line).toContainText(`Latency = ${a.definition}. Source: docs/insat_latency.json.`);
    const s = a.summary.all;
    expect(a.text).toContain(`${s.count} files, median ${s.median_min} min (range ${s.min_min}–${s.max_min} min)`);
});

test('Results: "INSAT at three cloudbursts IMERG barely saw" shows the file values (or says it is not available)', async ({ page }) => {
    const d = (await api(page, 'results')).insat_events;
    await page.goto('/nowcast/results');
    const sec = page.getByTestId('insat-events-section');
    await expect(sec).toContainText('INSAT at three cloudbursts IMERG barely saw');
    await expect(page.getByTestId('insat-events-scope')).toContainText('Three case studies, not a general result.');
    if (!d.available) {
        await expect(page.getByTestId('insat-events-unavailable')).toHaveText(d.note);
        return;
    }
    await expect(page.getByTestId('insat-event')).toHaveCount(d.events.length);
    for (const [i, e] of d.events.entries()) {
        const card = page.getByTestId('insat-event').nth(i);
        await expect(card.getByTestId('insat-event-summary')).toHaveText(e.summary);
        await expect(card.getByTestId('insat-event-row')).toHaveCount(e.insat.length);
        await expect(card.getByTestId('insat-event-alerts')).toContainText(`(lgbm_v0): ${e.alerts.length}`);
        if (e.gaps.length) await expect(card.getByTestId('insat-event-gaps')).toContainText(`${e.gaps.length} slot`);
    }
    await expect(page.getByTestId('insat-events-position')).toHaveText(d.position_line);
    await expect(sec).toContainText(d.timeline_note);
});

test('INSAT I3a screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await openLive(page);
        const t = page.getByTestId('live-insat-toggle');
        if (await t.isEnabled()) await t.check();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(SHOTS, `insat_live_${w}x${h}.png`) });
        await page.getByTestId('watch-toggle').check();
        await page.getByTestId('drawer-tab-alert').click();
        await page.getByTestId('alert-row').first().locator('button').first().click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SHOTS, `insat_live_alert_${w}x${h}.png`) });
        await page.goto('/nowcast/results');
        await page.getByTestId('insat-events-section').scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SHOTS, `insat_events_results_${w}x${h}.png`) });
        await page.goto('/nowcast/approach');
        await page.getByTestId('approach-insat-latency').scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS, `insat_latency_approach_${w}x${h}.png`) });
    }
});
