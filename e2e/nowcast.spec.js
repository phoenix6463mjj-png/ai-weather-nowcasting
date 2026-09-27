// ML Nowcast page: DOM assertions + screenshots (saved to e2e/screenshots/, gitignored).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
// wait until the visible OSM tiles and overlay images have finished loading, then capture
async function shot(page, name) {
    await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll('.leaflet-pane img')];
        return imgs.length > 0 && imgs.every((i) => i.complete);
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// Open /nowcast and switch to (ep, ts); returns the ui-alerts JSON the page itself received.
async function openIssue(page, ep, ts) {
    const isTarget = (r) => r.url().includes(`/issues/${ep}/${ts}/ui-alerts`) && r.ok();
    const first = page.waitForResponse((r) => r.url().includes('/ui-alerts') && r.ok());
    await page.goto('/nowcast');
    const firstResp = await first;
    let body;
    if (isTarget(firstResp)) {
        body = await firstResp.json();
    } else {
        const target = page.waitForResponse(isTarget);
        if ((await page.getByTestId('episode-select').inputValue()) !== ep) {
            await page.getByTestId('episode-select').selectOption(ep);
        }
        await page.getByTestId('issue-select').selectOption(ts);
        body = await (await target).json();
    }
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `${ep}/${ts}`);
    return body.alerts;
}

async function activeLead(page) {
    const id = await page.locator('[data-testid^="lead-"][aria-pressed="true"]').getAttribute('data-testid');
    return Number(id.replace('lead-', ''));
}

// Map polygons and list rows must equal the API's alerts under the same filter.
async function expectCountsMatch(page, alerts, lead, withWatch) {
    const expected = alerts.filter((a) => a.lead_time_h === lead && (withWatch || a.level === 'Warning'));
    await expect(page.locator('path.nowcast-alert-poly')).toHaveCount(expected.length);
    await expect(page.getByTestId('alert-row')).toHaveCount(expected.length);
    return expected.length;
}

// No % next to any cloudburst / flash-flood value; thunderstorm values are percentages.
async function expectValueLabels(page) {
    const rows = page.getByTestId('alert-row');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
        const row = rows.nth(i);
        const hazard = await row.getAttribute('data-hazard');
        const value = await row.getByTestId('alert-value').innerText();
        if (hazard === 'thunderstorm') expect(value, `thunderstorm value ${value}`).toMatch(/^\d+%$/);
        else expect(value, `${hazard} value ${value}`).not.toContain('%');
    }
    return n;
}

const DEMO = [
    { ts: '20230812T2100Z', name: 'REF045_0812T2100Z_flashflood' },
    { ts: '20230813T1500Z', name: 'REF045_0813T1500Z_thunderstorm' },
    { ts: '20230813T2100Z', name: 'REF045_0813T2100Z_cloudburst' },
];

for (const { ts, name } of DEMO) {
    test(`REF045 ${ts}: polygons = API alerts at every lead, labels correct`, async ({ page }) => {
        const alerts = await openIssue(page, 'REF045', ts);
        await expect(page.getByTestId('oos-badge')).toBeVisible();
        await expect(page.getByTestId('in-sample-badge')).toHaveCount(0);

        const defaultL = await activeLead(page);
        const nWarn = await expectCountsMatch(page, alerts, defaultL, false);
        await expectValueLabels(page);
        await shot(page, `${name}_warnings_L${defaultL}`);

        await page.getByTestId('watch-toggle').check();
        const nAll = await expectCountsMatch(page, alerts, defaultL, true);
        expect(nAll).toBeGreaterThanOrEqual(nWarn);
        await expectValueLabels(page);
        await shot(page, `${name}_with_watch_L${defaultL}`);

        for (const L of [1, 2, 3, 4, 6]) {                   // every lead, both levels
            await page.getByTestId(`lead-${L}`).click();
            await expectCountsMatch(page, alerts, L, true);
            await expectValueLabels(page);
        }
        await page.getByTestId('watch-toggle').uncheck();
        for (const L of [1, 2, 3, 4, 6]) {
            await page.getByTestId(`lead-${L}`).click();
            await expectCountsMatch(page, alerts, L, false);
        }
    });
}

test('explain panel: cloudburst index is not shown as a percentage', async ({ page }) => {
    const alerts = await openIssue(page, 'REF045', '20230813T2100Z');
    const cb = alerts.find((a) => a.hazard === 'cloudburst' && a.level === 'Warning');
    await page.getByTestId(`lead-${cb.lead_time_h}`).click();
    await page.locator('[data-testid="alert-row"][data-hazard="cloudburst"]').first().locator('button').click();
    const panel = page.getByTestId('explain-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-hazard', 'cloudburst');
    await expect(page.getByTestId('explain-value')).not.toContainText('%');
    await expect(panel).toContainText('NOT a probability');
    await expect(panel).toContainText('How the number was calculated');
    await expect(panel).toContainText('Why: top 5 reasons');
    await expect(panel).toContainText('uncalibrated heuristic');
    await shot(page, 'explain_panel_cloudburst_REF045_0813T2100Z');
});

test('explain panel: flash flood shows a ratio with Watch/Warning, no %', async ({ page }) => {
    const alerts = await openIssue(page, 'REF045', '20230812T2100Z');
    const ff = alerts.find((a) => a.hazard === 'flash_flood' && a.level === 'Warning');
    await page.getByTestId(`lead-${ff.lead_time_h}`).click();
    await page.locator('[data-testid="alert-row"][data-hazard="flash_flood"]').first().locator('button').click();
    const panel = page.getByTestId('explain-panel');
    await expect(panel).toHaveAttribute('data-hazard', 'flash_flood');
    await expect(page.getByTestId('explain-value')).toContainText('ratio');
    await expect(page.getByTestId('explain-value')).not.toContainText('%');
    await expect(panel).toContainText('Warning');
    await expect(panel).toContainText('No skill score is claimed');
    await shot(page, 'explain_panel_flashflood_REF045_0812T2100Z');
});

test('REF025 shows the in-sample badge', async ({ page }) => {
    const alerts = await openIssue(page, 'REF025', '20210718T1800Z');
    await expect(page.getByTestId('in-sample-badge')).toBeVisible();
    await expect(page.getByTestId('in-sample-badge')).toContainText('IN-SAMPLE');
    await expect(page.getByTestId('oos-badge')).toHaveCount(0);
    await expectCountsMatch(page, alerts, await activeLead(page), false);
    await expectValueLabels(page);
    await shot(page, 'REF025_in_sample_badge');
});

// ---------------------------------------------------------------- overlays (checkpoint d)
async function overlayImgs(page) {
    return page.$$eval('img.nowcast-raster', (imgs) => imgs.map((i) => ({
        src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, cls: i.className,
    })));
}

test('observed and missed overlays are always on; missed follows the Watch toggle', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T2100Z');
    await page.getByTestId('lead-4').click();               // 211 observed >=30 cells at L4
    await expect(page.locator('img.nowcast-raster.observed')).toHaveCount(1);
    await expect(page.locator('img.nowcast-raster.missed')).toHaveCount(1);
    await expect(page.getByTestId('missed-legend')).toHaveText(
        'Heavy rain outside displayed alerts (derived by UI layer, not a model-verification output)');
    let imgs = await overlayImgs(page);
    await expect.poll(async () => (await overlayImgs(page)).every((i) => i.ok)).toBe(true);
    expect(imgs.find((i) => i.cls.includes('missed')).src).toContain('level=warning');
    await shot(page, 'overlays_REF045_0813T2100Z_L4_warnings');

    await page.getByTestId('watch-toggle').check();
    await expect(page.locator('img.nowcast-raster.missed')).toHaveAttribute('src', /level=all/);
    await shot(page, 'overlays_REF045_0813T2100Z_L4_with_watch');

    await page.locator('label', { hasText: 'Cloudburst' }).locator('input').uncheck();
    await expect(page.locator('img.nowcast-raster.missed')).toHaveAttribute('src', /hazard=thunderstorm%2Cflash_flood|hazard=thunderstorm,flash_flood/);
});

test('forecast rasters: legends carry the right units (index and ratio never %)', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T1500Z');
    await page.getByTestId('lead-3').click();
    const legend = page.getByTestId('map-legend');

    await page.getByTestId('field-select').selectOption('thunderstorm');
    await expect(page.locator('img.nowcast-raster.field-thunderstorm')).toHaveCount(1);
    await expect(page.getByTestId('raster-legend-label')).toContainText('probability');
    await expect(legend).toContainText('%');
    await shot(page, 'raster_thunderstorm_REF045_0813T1500Z_L3');

    await page.getByTestId('field-select').selectOption('cloudburst_index');
    await expect(page.getByTestId('raster-legend-label')).toContainText('NOT a probability');
    await expect(legend).not.toContainText('%');
    await shot(page, 'raster_cloudburst_REF045_0813T1500Z_L3');

    await page.getByTestId('field-select').selectOption('flash_flood');
    await expect(page.getByTestId('raster-legend-label')).toContainText('risk ratio');
    await expect(legend).toContainText('Watch (ratio 0.5-1)');
    await expect(legend).toContainText('Warning (ratio 1-2)');
    await expect(legend).not.toContainText('%');
    await expect.poll(async () => (await overlayImgs(page)).every((i) => i.ok)).toBe(true);
    await shot(page, 'raster_flashflood_REF045_0813T1500Z_L3');
});

test('lead without an observed frame says so instead of drawing verification overlays', async ({ page }) => {
    // REF045 14 Aug 03:00Z: observed frames exist for L1-L2 only (window ends); L6 has none
    await openIssue(page, 'REF045', '20230814T0300Z');
    await page.getByTestId('lead-6').click();
    await expect(page.locator('img.nowcast-raster.observed')).toHaveCount(0);
    await expect(page.locator('img.nowcast-raster.missed')).toHaveCount(0);
    await expect(page.getByTestId('map-legend')).toContainText('Observed frame unavailable');
    await page.getByTestId('lead-1').click();
    await expect(page.locator('img.nowcast-raster.observed')).toHaveCount(1);
});

// ---------------------------------------------------------------- National + Live (checkpoint e)
test('National tab: probability map only, no alerts, flash-flood placeholder stated', async ({ page }) => {
    await page.goto('/nowcast');
    await page.getByTestId('tab-india').click();
    const banner = page.getByTestId('india-banner');
    await expect(banner).toContainText('probability map only');
    await expect(banner).toContainText('No alerts are produced');
    await expect(banner).toContainText('placeholder');
    await expect(page.getByTestId('india-notes')).toContainText('Absence of alerts does not mean');
    await expect(page.locator('path.nowcast-alert-poly')).toHaveCount(0);
    await expect(page.getByTestId('field-select').locator('option[value="flash_flood"]')).toHaveCount(0);
    await expect(page.locator('img.nowcast-raster.field-thunderstorm')).toHaveCount(1);
    await expect.poll(async () => (await overlayImgs(page)).every((i) => i.ok)).toBe(true);
    await shot(page, 'national_thunderstorm_L1');
    await page.getByTestId('field-select').selectOption('cloudburst_index');
    await expect(page.getByTestId('map-legend')).not.toContainText('%');
});

test('Live tab: not-validated banner, polygons = API alerts, labels correct, nothing filtered', async ({ page }) => {
    const liveAlerts = page.waitForResponse((r) => r.url().includes('/live/') && r.url().includes('/ui-alerts') && r.ok());
    await page.goto('/nowcast');
    await page.getByTestId('tab-live').click();
    const alerts = (await (await liveAlerts).json()).alerts;
    const banner = page.getByTestId('live-not-validated');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('NOT validated');
    await expect(banner).toContainText('not validated warnings');
    expect(alerts.length).toBe(8);

    await page.getByTestId('watch-toggle').check();
    for (const L of [1, 2, 3, 4, 6]) {
        await page.getByTestId(`lead-${L}`).click();
        await expectCountsMatch(page, alerts, L, true);
        await expectValueLabels(page);
    }
    await page.getByTestId('watch-toggle').uncheck();
    for (const L of [1, 2, 3, 4, 6]) {
        await page.getByTestId(`lead-${L}`).click();
        await expectCountsMatch(page, alerts, L, false);
    }
    // the Andaman Sea / Myanmar-coast alert (peak 97.35E) must not be filtered out
    const far = alerts.find((a) => a.peak_cell[1] > 97);
    expect(far).toBeTruthy();
    await page.getByTestId('watch-toggle').check();
    await page.getByTestId(`lead-${far.lead_time_h}`).click();
    await expectCountsMatch(page, alerts, far.lead_time_h, true);
    // a peak marker per displayed live alert so single-cell alerts are visible at national zoom
    const shownN = alerts.filter((x) => x.lead_time_h === far.lead_time_h).length;
    await expect(page.locator('path.nowcast-peak-marker')).toHaveCount(shownN);
    await expect(page.getByTestId('map-legend')).not.toContainText('false alarm');
    await shot(page, `live_L${far.lead_time_h}_with_watch`);
    await page.getByTestId('alert-row').first().locator('button').click();
    await expect(page.getByTestId('explain-panel')).toContainText('NOT validated');
    await shot(page, 'live_alert_panel');
});

// ---------------------------------------------------------------- replay button (checkpoint f)
test('replay button re-runs the model and matches the precomputed files', async ({ page }) => {
    test.setTimeout(120_000);
    const alerts = await openIssue(page, 'REF045', '20230813T2100Z');
    const resp = page.waitForResponse((r) => r.url().endsWith('/replay') && r.request().method() === 'POST', { timeout: 90_000 });
    await page.getByTestId('replay-button').click();
    await expect(page.getByTestId('replay-button')).toContainText('Running');
    const body = await (await resp).json();
    await expect(page.getByTestId('replay-result')).toBeVisible({ timeout: 90_000 });
    expect(body.all_match).toBe(true);
    expect(body.n_alerts).toBe(alerts.length);
    await expect(page.getByTestId('replay-result')).toContainText('matches the precomputed files byte-for-byte');
    await expect(page.getByTestId('replay-result')).toContainText(`${alerts.length} alerts`);
    await shot(page, 'replay_button_REF045_0813T2100Z');
    // second click is served from the cache
    await page.getByTestId('replay-button').click();
    await expect(page.getByTestId('replay-result')).toContainText('replay cache', { timeout: 30_000 });
});

// ---------------------------------------------------------------- per-issue default lead + FF verification note
// Expected default leads computed independently from docs/demo_explain (Python, not this app's code):
// most observed >=30 cells; else most Warnings of the showcase hazard; else most Warnings overall.
const EXPECTED_DEFAULT_LEAD = {
    'REF045/20230812T1500Z': 3, 'REF045/20230812T1800Z': 4, 'REF045/20230812T2100Z': 6, 'REF045/20230813T0000Z': 6,
    'REF045/20230813T0300Z': 4, 'REF045/20230813T0600Z': 6, 'REF045/20230813T0900Z': 4, 'REF045/20230813T1200Z': 1,
    'REF045/20230813T1500Z': 2, 'REF045/20230813T1800Z': 6, 'REF045/20230813T2100Z': 4, 'REF045/20230814T0000Z': 1,
    'REF045/20230814T0300Z': 6, 'REF025/20210717T1500Z': 6, 'REF025/20210717T1800Z': 6, 'REF025/20210717T2100Z': 3,
    'REF025/20210718T0000Z': 6, 'REF025/20210718T0300Z': 6, 'REF025/20210718T0600Z': 2, 'REF025/20210718T0900Z': 6,
    'REF025/20210718T1200Z': 6, 'REF025/20210718T1500Z': 4, 'REF025/20210718T1800Z': 4, 'REF025/20210718T2100Z': 4,
    'REF025/20210719T0000Z': 4, 'REF025/20210719T0300Z': 2,
};

test('default lead per issue follows the observed / showcase-hazard rule (all 26 issues)', async ({ page }) => {
    test.setTimeout(180_000);
    for (const [key, lead] of Object.entries(EXPECTED_DEFAULT_LEAD)) {
        const [ep, ts] = key.split('/');
        await openIssue(page, ep, ts);
        expect(await activeLead(page), key).toBe(lead);
    }
});

const FF_NOTE = 'FF verification uses a rain-rate proxy (≥30 mm/hr observed), not basin accumulation.';

test('flash-flood verification note is shown in summary, legend, rows and panel', async ({ page }) => {
    await openIssue(page, 'REF045', '20230812T2100Z');           // default L6: 1 flash-flood Warning
    await expect(page.getByTestId('ff-verify-note-summary')).toHaveText(FF_NOTE);
    await expect(page.getByTestId('ff-verify-note-legend')).toHaveText(FF_NOTE);
    const ffRow = page.locator('[data-testid="alert-row"][data-hazard="flash_flood"]').first();
    await expect(ffRow.locator(`span[title="${FF_NOTE}"]`)).toHaveAttribute('title', FF_NOTE);
    await ffRow.locator('button').click();
    await expect(page.getByTestId('explain-panel')).toHaveAttribute('data-hazard', 'flash_flood');
    await expect(page.getByTestId('ff-verify-note-panel')).toHaveText(FF_NOTE);
    await shot(page, 'ff_verify_note_REF045_0812T2100Z');
    // not attached to other hazards' panels
    await page.getByTestId('explain-panel').locator('button[title="Back to list"]').click();
    await page.locator('[data-testid="alert-row"][data-hazard="cloudburst"]').first().locator('button').click();
    await expect(page.getByTestId('explain-panel')).toHaveAttribute('data-hazard', 'cloudburst');
    await expect(page.getByTestId('ff-verify-note-panel')).toHaveCount(0);
});

// ---------------------------------------------------------------- REF051 case study (2024 test, descriptive)
const CASE_LABEL = '2024 test period — descriptive case study; model frozen before this run; not a new test score.';

test('REF051 case study: test (2024) badge, descriptive label, both documented sites, polygons = API', async ({ page }) => {
    const alerts = await openIssue(page, 'REF051', '20240731T1800Z');
    await expect(page.getByTestId('case-study-badge')).toHaveText('test (2024)');
    await expect(page.getByTestId('case-study-badge')).toHaveAttribute('title', CASE_LABEL);
    await expect(page.getByTestId('case-study-banner')).toContainText(CASE_LABEL);
    await expect(page.getByTestId('case-study-banner')).toContainText('Malana river, Tosh, Parvati valley');
    await expect(page.getByTestId('oos-badge')).toHaveCount(0);
    await expect(page.getByTestId('in-sample-badge')).toHaveCount(0);
    await expect(page.locator('path.nowcast-site-marker')).toHaveCount(2);
    await expect(page.getByTestId('map-legend')).toContainText('documented cloudburst sites');
    await expect(page.getByTestId('episode-select')).toContainText('TEST (2024) CASE STUDY');
    await page.getByTestId('watch-toggle').check();
    for (const L of [1, 2, 3, 4, 6]) {
        await page.getByTestId(`lead-${L}`).click();
        await expectCountsMatch(page, alerts, L, true);
        await expectValueLabels(page);
    }
    await page.getByTestId('lead-6').click();
    await shot(page, 'REF051_case_study_0731T1800Z_L6_with_watch');
    // the demo episodes keep their own badges
    await openIssue(page, 'REF045', '20230813T2100Z');
    await expect(page.getByTestId('case-study-banner')).toHaveCount(0);
    await expect(page.locator('path.nowcast-site-marker')).toHaveCount(1);
});

// ---------------------------------------------------------------- documented-event check (report-based)
const EVENT_LABEL = 'Checked against the documented event location, not satellite rain; IMERG may not resolve cloudbursts.';
const EVENT_DISAGREE = 'IMERG verification and documented-report check can disagree; both are shown.';

test('documented-event check REF045: 8 early-warning alerts (2 precise), rules, jump to alert', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T1500Z');
    await page.getByTestId('aside-tab-event').click();
    const panel = page.getByTestId('event-check-panel');
    await expect(page.getByTestId('event-label')).toHaveText(EVENT_LABEL);
    await expect(page.getByTestId('event-disagree')).toHaveText(EVENT_DISAGREE);
    const site = page.getByTestId('event-site-REF045');
    await expect(site.getByTestId('event-result')).toContainText('8 alert(s) issued before the event window');
    await expect(site.getByTestId('event-alert')).toHaveCount(8);
    await expect(site.locator('[data-testid="event-alert"][data-precision="precise"]')).toHaveCount(2);
    await expect(site.getByTestId('event-source-note')).toHaveText('Uses documented reports, not satellite rain');
    await expect(site).toContainText('late night of Aug 13, 2023');
    await expect(site).toContainText('IMERG: not verified (false alarm)');
    const rules = page.getByTestId('event-rules');
    await expect(rules).toContainText('± 1 h tolerance');
    await expect(rules).toContainText('≤ 25 km from the site AND area ≤ 5,000 km²');
    await expect(rules).toContainText('ISSUED before the event window starts AND VALID during the window');
    await shot(page, 'event_check_REF045');
    // first card = cloudburst Watch issued 12:00Z, L6 -> opens that issue, lead and alert
    await site.getByTestId('event-alert').first().locator('button').click();
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', 'REF045/20230813T1200Z');
    expect(await activeLead(page)).toBe(6);
    await expect(page.getByTestId('explain-panel')).toHaveAttribute('data-hazard', 'cloudburst');
    await expect(panel).toHaveCount(0);
});

test('documented-event check REF051: Malana 5 alerts + nearby cells at 13:00Z, Tosh date only', async ({ page }) => {
    await openIssue(page, 'REF051', '20240731T1800Z');
    await page.getByTestId('aside-tab-event').click();
    const malana = page.getByTestId('event-site-REF051');
    await expect(malana.getByTestId('event-result')).toContainText('5 alert(s)');
    await expect(malana.getByTestId('event-alert')).toHaveCount(5);
    await expect(malana.locator('[data-testid="event-alert"][data-precision="precise"]')).toHaveCount(0);
    await expect(malana).toContainText("state authority's preliminary range; covers several Kullu cloudbursts, not Malana alone");
    const near = malana.getByTestId('event-nearby');
    await expect(near).toContainText('nearby alert cells (≤25 km), not a site-covering alert');
    await expect(near.locator('li')).toHaveCount(2);
    await expect(near).toContainText('19.8 km');
    await expect(near).toContainText('no explanation available: input window starts 12:00Z');
    const tosh = page.getByTestId('event-site-REF052');
    await expect(tosh.getByTestId('event-result')).toContainText('Documented date only (hour not reported)');
    await expect(tosh.getByTestId('event-result')).toContainText('None of the alerts shown covers the site');
    await expect(tosh).toContainText('catalog lists 1 Aug');
    await expect(tosh.getByTestId('event-alert')).toHaveCount(0);
    await expect(page.getByTestId('event-check-panel')).toContainText('2024 test period — descriptive case study');
    await shot(page, 'event_check_REF051');
    // nearby-cells item -> forecast-only 13:00Z issue at L4
    const alertsResp = page.waitForResponse((r) => r.url().includes('/issues/REF051/20240731T1300Z/ui-alerts') && r.ok());
    await near.locator('li button').first().click();
    const alerts = (await (await alertsResp).json()).alerts;
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', 'REF051/20240731T1300Z');
    expect(await activeLead(page)).toBe(4);
    await expect(page.getByTestId('forecast-only-banner')).toContainText('no explanation available: input window starts 12:00Z');
    await page.getByTestId('watch-toggle').check();
    await expectCountsMatch(page, alerts, 4, true);
    await expectValueLabels(page);
    await page.getByTestId('alert-row').first().locator('button').click();
    await expect(page.getByTestId('explain-unavailable')).toContainText('no explanation available: input window starts 12:00Z');
    await shot(page, 'REF051_1300Z_forecast_only_L4');
});

test('no documented-event check for the in-sample REF025', async ({ page }) => {
    await openIssue(page, 'REF025', '20210718T1800Z');
    await expect(page.getByTestId('in-sample-badge')).toBeVisible();
    await expect(page.getByTestId('aside-tab-event')).toHaveCount(0);
});

// ---------------------------------------------------------------- IMD colour chips (checkpoint 01)
const IMD_NOTE = 'Indicative mapping to IMD colour codes; not an official IMD warning.';

test('IMD colour chips: orange on every Watch, red on every Warning, label present', async ({ page }) => {
    const alerts = await openIssue(page, 'REF045', '20230813T1500Z');
    await page.getByTestId('watch-toggle').check();
    const lead = await activeLead(page);
    await expectCountsMatch(page, alerts, lead, true);

    const rows = page.getByTestId('alert-row');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    let sawWatch = false, sawWarning = false;
    for (let i = 0; i < n; i++) {
        const row = rows.nth(i);
        const level = await row.getAttribute('data-level');
        const chip = row.getByTestId('imd-chip');
        await expect(chip).toHaveCount(1);
        await expect(chip).toHaveAttribute('data-imd', level === 'Warning' ? 'red' : 'orange');
        await expect(chip).toHaveAttribute('title', IMD_NOTE);
        if (level === 'Watch') sawWatch = true; else sawWarning = true;
    }
    expect(sawWatch && sawWarning).toBe(true);
    await expect(page.getByTestId('map-legend')).toContainText(IMD_NOTE);
    await shot(page, 'imd_chips_alert_list_REF045_0813T1500Z');

    // explain panel
    await rows.first().locator('button').click();
    const panel = page.getByTestId('explain-panel');
    await expect(panel.getByTestId('imd-chip')).toHaveCount(1);
    await shot(page, 'imd_chip_explain_panel');
    await panel.locator('button[title="Back to list"]').click();

    // documented-event check cards
    await page.getByTestId('aside-tab-event').click();
    const site = page.getByTestId('event-site-REF045');
    const cards = site.getByTestId('event-alert');
    const nc = await cards.count();
    expect(nc).toBeGreaterThan(0);
    for (let i = 0; i < nc; i++) {
        await expect(cards.nth(i).getByTestId('imd-chip')).toHaveCount(1);
    }
    await shot(page, 'imd_chips_event_check_REF045');
});

test('forecast-only issue legend explains peak markers instead of verification dots', async ({ page }) => {
    await openIssue(page, 'REF051', '20240731T1300Z');
    const legend = page.getByTestId('map-legend');
    await expect(legend).toContainText('alert peak (colour = hazard)');
    await expect(legend).not.toContainText('not verified (false alarm)');
    await openIssue(page, 'REF051', '20240731T1400Z');
    await expect(page.getByTestId('map-legend')).toContainText('not verified (false alarm)');
});
