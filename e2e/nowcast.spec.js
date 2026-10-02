// ML Nowcast page: DOM assertions + screenshots (saved to e2e/screenshots/, gitignored).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
// The newest live run (2 Oct 2026, 0 alerts) is the Live tab's default; tests of the live ALERT panel open the
// 26 Sep run (8 alerts) through the URL (?view=live&run=...; no run selector in the UI).
const OLD_LIVE = '/nowcast?view=live&run=20260926T0330Z';
// wait until the visible OSM tiles and overlay images have finished loading, then capture
async function shot(page, name) {
    await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll('.leaflet-pane img')];
        return imgs.length > 0 && imgs.every((i) => i.complete);
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// Open /nowcast on (ep, ts); returns the ui-alerts JSON the page itself received. The issue is named in the URL:
// plain /nowcast opens the judge-first view (REF051 15:00Z with its cloudburst Warning selected, e2e/judge_first.spec.js).
async function openIssue(page, ep, ts) {
    const target = page.waitForResponse((r) => r.url().includes(`/issues/${ep}/${ts}/ui-alerts`) && r.ok());
    await page.goto(`/nowcast?ep=${ep}&ts=${ts}`);
    const body = await (await target).json();
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `${ep}/${ts}`);
    return body.alerts;
}

async function activeLead(page) {
    const id = await page.locator('[data-testid^="lead-"][aria-pressed="true"]').getAttribute('data-testid');
    return Number(id.replace('lead-', ''));
}

// The alert list lives in the drawer's Alert section (collapsed by default): open it, back to the list.
async function showAlertList(page) {
    if ((await page.getByTestId('drawer').getAttribute('data-open')) !== 'alert') await page.getByTestId('drawer-tab-alert').click();
    const back = page.getByTestId('explain-panel').locator('button[title="Back to list"]');
    if (await back.count()) await back.click();
    await expect(page.getByTestId('alert-list-view')).toBeVisible();
}

// Map polygons and list rows must equal the API's alerts under the same filter.
async function expectCountsMatch(page, alerts, lead, withWatch) {
    await showAlertList(page);
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
    await showAlertList(page);
    await page.locator('[data-testid="alert-row"][data-hazard="cloudburst"]').first().locator('button').click();
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
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
    await showAlertList(page);
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
    await page.getByTestId('drawer-tab-about').click();                // notes live in the drawer's About section
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
    await page.goto(OLD_LIVE);
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
    await showAlertList(page);                                            // the replay button heads the Alert section
    const st = await (await page.request.get('http://127.0.0.1:8000/ml/replay/status')).json();
    if (st.enabled === false) {                                           // hosted mode (ML_REPLAY_ENABLED=0)
        await expect(page.getByTestId('replay-disabled-note')).toHaveText(st.note);
        await expect(page.getByTestId('replay-button')).toHaveCount(0);
        return;
    }
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
    await showAlertList(page);
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
    await page.getByTestId('drawer-tab-event').click();
    const panel = page.getByTestId('event-check-panel');
    await expect(page.getByTestId('event-label')).toHaveText(EVENT_LABEL);
    await expect(page.getByTestId('event-disagree')).toHaveText(EVENT_DISAGREE);
    const site = page.getByTestId('event-site-REF045');
    await expect(site.getByTestId('event-result')).toContainText('8 alert(s) issued before the event window');
    await expect(site.getByTestId('event-alert')).toHaveCount(8);
    await expect(site.locator('[data-testid="event-alert"][data-precision="precise"]')).toHaveCount(2);
    await expect(site.getByTestId('event-source-note')).toHaveText('Uses documented reports, not satellite rain');
    await expect(site).toContainText('late night of Aug 13, 2023');
    await expect(site).toContainText('IMERG: not confirmed by IMERG');                       // judge-first wording
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
    await page.getByTestId('drawer-tab-event').click();
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
    await expect(page.getByTestId('drawer-tab-event')).toHaveCount(0);
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
        await expect(chip).toHaveText(level === 'Warning' ? 'Red' : 'Orange');
        const box = await chip.boundingBox();
        expect(box.height, 'IMD pill height').toBeGreaterThanOrEqual(10);
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
    await page.getByTestId('drawer-tab-event').click();
    const site = page.getByTestId('event-site-REF045');
    const cards = site.getByTestId('event-alert');
    const nc = await cards.count();
    expect(nc).toBeGreaterThan(0);
    for (let i = 0; i < nc; i++) {
        await expect(cards.nth(i).getByTestId('imd-chip')).toHaveCount(1);
    }
    await shot(page, 'imd_chips_event_check_REF045');
});

test('IMD pill also on the live alert panel', async ({ page }) => {
    await page.goto(OLD_LIVE);
    await page.getByTestId('tab-live').click();
    await page.getByTestId('watch-toggle').check();
    await showAlertList(page);
    const row = page.getByTestId('alert-row').first();
    const level = await row.getAttribute('data-level');
    await row.locator('button').click();
    const chip = page.getByTestId('explain-panel').getByTestId('imd-chip');
    await expect(chip).toHaveText(level === 'Warning' ? 'Red' : 'Orange');
    await expect(chip).toHaveAttribute('title', IMD_NOTE);
});

// ---------------------------------------------------------------- terrain (DEM), checkpoint 02
const paneZ = (loc) => loc.evaluate((el) => Number(getComputedStyle(el.closest('.leaflet-pane')).zIndex));

test('terrain (DEM): on by default, same bounds as the forecast rasters, below rasters and alerts', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T2100Z');
    await page.getByTestId('lead-4').click();
    const terrain = page.locator('img.nowcast-terrain');
    await expect(terrain).toHaveCount(1);
    await expect(terrain).toHaveAttribute('src', /terrain\/REF045\.png$/);
    await expect.poll(() => terrain.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(page.getByTestId('terrain-toggle')).toBeChecked();
    // placed at the same bounds as the observed overlay (which uses the issue's grid bounds)
    const obs = page.locator('img.nowcast-raster.observed');
    const [bt, bo] = [await terrain.boundingBox(), await obs.boundingBox()];
    for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(bt[k] - bo[k]), `terrain ${k}`).toBeLessThan(1.5);
    // stacking: terrain pane < forecast/observed raster pane < alert polygons
    const zT = await paneZ(terrain), zR = await paneZ(obs), zA = await paneZ(page.locator('path.nowcast-alert-poly').first());
    expect(zT).toBeLessThan(zR);
    expect(zR).toBeLessThan(zA);
    await expect(page.locator('.leaflet-control-attribution')).toContainText('Terrain: Copernicus DEM GLO-90');
    await shot(page, 'terrain_REF045_0813T2100Z_L4_default');
    // zoomed in near the documented site: relief detail and valley alignment
    await page.locator('.leaflet-control-zoom-in').click();
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(600);
    await shot(page, 'terrain_REF045_0813T2100Z_L4_zoom8');

    await page.getByTestId('terrain-opacity').fill('0.4');
    await expect(terrain).toHaveCSS('opacity', '0.4');
    await page.getByTestId('terrain-toggle').uncheck();
    await expect(page.locator('img.nowcast-terrain')).toHaveCount(0);
    await expect(page.locator('.leaflet-control-attribution')).not.toContainText('Copernicus DEM');
    await expect(page.locator('path.nowcast-alert-poly').first()).toBeVisible();   // alerts unaffected
    await shot(page, 'terrain_REF045_0813T2100Z_L4_off');
    await page.getByTestId('terrain-toggle').check();
    await expect(page.locator('img.nowcast-terrain')).toHaveCount(1);
});

test('terrain follows the episode (REF051 forecast-only issue, REF025 in-sample)', async ({ page }) => {
    await openIssue(page, 'REF051', '20240731T1300Z');
    await expect(page.getByTestId('forecast-only-banner')).toBeVisible();
    await expect(page.locator('img.nowcast-terrain')).toHaveAttribute('src', /terrain\/REF051\.png$/);
    await shot(page, 'terrain_REF051_1300Z_forecast_only');
    await openIssue(page, 'REF025', '20210718T1800Z');
    await expect(page.getByTestId('in-sample-badge')).toBeVisible();
    await expect(page.locator('img.nowcast-terrain')).toHaveAttribute('src', /terrain\/REF025\.png$/);
});

test('terrain on National and Live: national hillshade at the grid bounds, under the risk layer', async ({ page }) => {
    await page.goto('/nowcast');
    await page.getByTestId('tab-india').click();
    const terrain = page.locator('img.nowcast-terrain');
    await expect(terrain).toHaveAttribute('src', /terrain\/national\.png$/);
    const field = page.locator('img.nowcast-raster.field-thunderstorm');
    await expect.poll(async () => (await overlayImgs(page)).every((i) => i.ok)).toBe(true);
    const [bt, bf] = [await terrain.boundingBox(), await field.boundingBox()];
    for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(bt[k] - bf[k]), `national terrain ${k}`).toBeLessThan(1.5);
    expect(await paneZ(terrain)).toBeLessThan(await paneZ(field));
    await shot(page, 'terrain_national_thunderstorm_L1');

    await page.getByTestId('tab-live').click();
    await expect(page.getByTestId('live-not-validated')).toBeVisible();
    await expect(page.locator('img.nowcast-terrain')).toHaveAttribute('src', /terrain\/national\.png$/);
    await page.getByTestId('terrain-toggle').uncheck();
    await expect(page.locator('img.nowcast-terrain')).toHaveCount(0);
});

test('forecast-only issue legend explains peak markers instead of verification dots', async ({ page }) => {
    await openIssue(page, 'REF051', '20240731T1300Z');
    const legend = page.getByTestId('map-legend');
    await expect(legend).toContainText('alert peak (colour = hazard)');
    await expect(legend).not.toContainText('Not confirmed by IMERG satellite rain');
    await openIssue(page, 'REF051', '20240731T1400Z');
    await expect(page.getByTestId('map-legend')).toContainText('Not confirmed by IMERG satellite rain – counted as a false alarm in our scores.');
});

// ---------------------------------------------------------------- data credits footer (checkpoint 02 follow-up)
const COPERNICUS_NOTICE = 'produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH '
    + '2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

test('data credits: one line naming Copernicus DEM on every tab, the full notice one click away; terrain copyright on the map', async ({ page }) => {
    const cr = page.waitForResponse((r) => r.url().endsWith('/credits') && r.ok());
    await page.goto('/nowcast');
    const api = (await (await cr).json()).credits;
    expect(api.find((c) => c.id === 'copernicus_dem').text).toBe(COPERNICUS_NOTICE);
    await page.mouse.move(0, 0);                                    // nothing hovered
    const holders = /© DLR e\.V\. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018/;
    for (const tab of ['replay', 'india', 'live']) {
        await page.getByTestId(`tab-${tab}`).click();
        await expect(page.getByTestId('credits-names')).toContainText('Copernicus DEM');
        await expect(page.getByTestId('credits-toggle')).toBeInViewport({ ratio: 1 });
        // the terrain layer (on by default) carries its copyright holders in the map attribution, no hover needed
        await expect(page.locator('.leaflet-control-attribution')).toContainText(holders);
    }
    await page.getByTestId('tab-replay').click();
    await page.getByTestId('credits-toggle').click();
    const credit = page.getByTestId('credit-copernicus_dem');
    await expect(credit).toContainText(COPERNICUS_NOTICE);
    await expect(credit.locator('a', { hasText: 'licence' })).toHaveAttribute('href', /dataspace\.copernicus\.eu/);
    await credit.scrollIntoViewIfNeeded();
    await expect(credit).toBeInViewport();
    await page.getByTestId('drawer-tab-caveats').click();               // open caveats must not push the footer off-screen
    await expect(page.getByTestId('caveat').first()).toBeVisible();
    await expect(page.getByTestId('credits-toggle')).toBeInViewport({ ratio: 1 });
    await shot(page, 'data_credits_footer_replay_caveats_open');
    await page.keyboard.press('Escape');
    await shot(page, 'data_credits_footer_replay');
});

// ---------------------------------------------------------------- ingredients panel (checkpoint 03)
async function openAlert(page, hazard, level = 'Warning') {
    await page.getByTestId('watch-toggle').check();
    await showAlertList(page);
    const detail = page.waitForResponse((r) => /\/alerts\/[^/]+$/.test(r.url()) && r.ok());
    await page.locator(`[data-testid="alert-row"][data-hazard="${hazard}"][data-level="${level}"]`).first().locator('button').click();
    const ing = (await (await detail).json()).ingredients;
    await page.getByTestId('explain-open-ingredients').click();          // Alert section -> Ingredients section
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'ingredients');
    await expect(page.getByTestId('ingredients-tab')).toBeVisible();
    return ing;
}

async function expectBarsMatch(page, ing) {
    const rows = page.getByTestId('ingredient-row');
    await expect(rows).toHaveCount(6);
    let sum = 0;
    for (let i = 0; i < 6; i++) {
        const g = ing.groups[i];
        await expect(rows.nth(i)).toHaveAttribute('data-group', g.group);
        await expect(rows.nth(i)).toContainText(g.label);
        expect(Number(await rows.nth(i).getAttribute('data-value'))).toBe(g.shap_logodds);
        sum += g.shap_logodds;
    }
    const lead = page.getByTestId('ingredient-lead');
    await expect(lead).toContainText('lead time (not weather)');
    expect(Number(await lead.getAttribute('data-value'))).toBe(ing.lead.shap_logodds);
    expect(Math.abs(sum + ing.lead.shap_logodds + ing.base_logodds - ing.raw_logodds)).toBeLessThan(1e-5);
}

test('ingredients: cloudburst bars = API, sums = raw log-odds, boost line from the trace, demo aggregate', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T2100Z');
    await page.getByTestId('lead-4').click();
    const ing = await openAlert(page, 'cloudburst');
    expect(ing.model).toBe('theta30');
    await expect(page.getByTestId('ingredients-tab')).toContainText('Ingredients: contribution to this alert (log-odds, ranking not magnitude)');
    await expect(page.getByTestId('ingredients-label')).toHaveText('explains the ≥30 mm/hr rain probability behind this alert (log-odds, before calibration)');
    await expectBarsMatch(page, ing);
    await expect(page.getByTestId('ingredients-boost')).toHaveText(ing.boost);
    await expect(page.getByTestId('ingredients-boost')).toContainText('+ orographic boost applied after the model (not in SHAP): cloudburst index = P30 x (1 + min(lift/0.05, 1))');
    await expect(page.getByTestId('ingredients-agg-lead')).toHaveText(ing.aggregate.lead_trend);
    await expect(page.getByTestId('ingredients-agg-moisture')).toHaveText(ing.aggregate.moisture);
    await expect(page.getByTestId('ingredients-agg-scope')).toHaveText(ing.aggregate.scope);
    await expect(page.getByTestId('ingredients-agg-scope')).toContainText('1,034 alerts; ≥30 mm/hr model');
    await page.getByTestId('ingredients-panel').scrollIntoViewIfNeeded();
    await shot(page, 'ingredients_cloudburst_REF045_0813T2100Z_L4');
});

test('ingredients: flash flood uses the ≥10 model with its own label and no boost line', async ({ page }) => {
    await openIssue(page, 'REF045', '20230812T2100Z');
    const ing = await openAlert(page, 'flash_flood');
    expect(ing.model).toBe('theta10');
    await expect(page.getByTestId('ingredients-label')).toHaveText("explains the ≥10 mm/hr rain probability at the basin's strongest-inflow cell (log-odds, before calibration); the basin ratio itself is computed from the rain forecast and is not explained by SHAP.");
    await expectBarsMatch(page, ing);
    await expect(page.getByTestId('ingredients-boost')).toHaveCount(0);
    await expect(page.getByTestId('ingredients-agg-scope')).toContainText('273 alerts; flash flood: ≥10 mm/hr model');
    await page.getByTestId('ingredients-panel').scrollIntoViewIfNeeded();
    await shot(page, 'ingredients_flashflood_REF045_0812T2100Z');
});

test('ingredients: thunderstorm (no boost) and REF025 in-sample alert keep their badges', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T1500Z');
    await page.getByTestId('lead-2').click();
    const ing = await openAlert(page, 'thunderstorm', 'Watch');
    await expectBarsMatch(page, ing);
    await expect(page.getByTestId('ingredients-boost')).toHaveCount(0);
    await openIssue(page, 'REF025', '20210718T1800Z');
    await expect(page.getByTestId('in-sample-badge')).toBeVisible();
    const ing25 = await openAlert(page, 'cloudburst');
    await expectBarsMatch(page, ing25);
    await expect(page.getByTestId('ingredients-tab')).toContainText('IN-SAMPLE');
    await page.getByTestId('drawer-tab-alert').click();
    await expect(page.getByTestId('explain-panel')).toContainText('IN-SAMPLE');
});

test('ingredients: "not available" on the forecast-only issue and on live alerts', async ({ page }) => {
    await openIssue(page, 'REF051', '20240731T1300Z');
    await page.getByTestId('watch-toggle').check();
    await showAlertList(page);
    await page.getByTestId('alert-row').first().locator('button').click();
    await page.getByTestId('drawer-tab-ingredients').click();
    await expect(page.getByTestId('ingredients-unavailable')).toHaveText('Not available: no explanation available: input window starts 12:00Z.');
    await expect(page.getByTestId('ingredient-row')).toHaveCount(0);
    await shot(page, 'ingredients_forecast_only_REF051_1300Z');
    await page.goto(OLD_LIVE);
    await expect(page.getByTestId('lead-1')).toBeAttached({ timeout: 30_000 });
    await page.getByTestId('watch-toggle').check();
    await showAlertList(page);
    await page.getByTestId('alert-row').first().locator('button').click();
    await expect(page.getByTestId('explain-panel')).toContainText('NOT validated');
    await page.getByTestId('explain-open-ingredients').click();
    await expect(page.getByTestId('ingredients-unavailable')).toHaveText('Not available: no per-feature SHAP is stored for live runs.');
    await expect(page.getByTestId('ingredients-tab')).toContainText('NOT validated');
    // no alert selected -> the Ingredients section says how to get one
    await page.getByTestId('drawer-tab-alert').click();
    await page.getByTestId('explain-panel').locator('button[title="Back to list"]').click();
    await page.getByTestId('drawer-tab-ingredients').click();
    await expect(page.getByTestId('ingredients-empty')).toContainText('Select an alert');
});

// ---------------------------------------------------------------- footer at small viewports
for (const [w, h] of [[1280, 720], [1366, 768]]) {
    test(`data credits footer: one line, in view and not covered at ${w}x${h}; opens to every credit`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast');
        const footer = page.getByTestId('data-credits');
        await expect(page.getByTestId('credits-names')).toContainText('ERA5, IMERG, GFS');
        await page.mouse.move(0, 0);
        for (const tab of ['replay', 'india', 'live']) {
            await page.getByTestId(`tab-${tab}`).click();
            await expect(page.getByTestId('credits-toggle')).toBeInViewport({ ratio: 1 });
            const r = await footer.evaluate((el) => {
                const b = el.getBoundingClientRect();
                const t = el.querySelector('[data-testid="credits-toggle"]').getBoundingClientRect();
                const e = document.elementFromPoint(t.left + 20, t.top + t.height / 2);
                return { bottom: b.bottom, vh: innerHeight, h: b.height, hit: e && el.contains(e), font: parseFloat(getComputedStyle(el).fontSize) };
            });
            expect(r.bottom).toBeLessThanOrEqual(r.vh + 0.5);
            expect(r.h).toBeLessThan(40);
            expect(r.hit).toBe(true);
            expect(r.font).toBeGreaterThanOrEqual(13);
        }
        await page.getByTestId('credits-toggle').click();
        await expect(page.getByTestId('credit-copernicus_dem')).toContainText(COPERNICUS_NOTICE);
        await expect(footer).toHaveAttribute('data-open', 'true');
        await shot(page, `data_credits_open_${w}x${h}`);
    });
}

// ---------------------------------------------------------------- validation aggregate lines (checkpoint 03 continuation)
test('ingredients: validation 2022-23 lines shown next to the demo statement, per model', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T2100Z');
    await page.getByTestId('lead-4').click();
    const ing = await openAlert(page, 'cloudburst');
    const v = ing.aggregate_val;
    expect(v.model).toBe('theta30');
    await expect(page.getByTestId('ingredients-agg-lead')).toHaveText(ing.aggregate.lead_trend);   // demo kept
    await expect(page.getByTestId('ingredients-val-lead')).toHaveText(v.lead_trend);
    await expect(page.getByTestId('ingredients-val-moisture')).toHaveText(v.moisture);
    await expect(page.getByTestId('ingredients-val-scope')).toHaveText(v.scope);
    await expect(page.getByTestId('ingredients-val-scope')).toContainText('Validation 2022–23, alert-selected rows; ≥30 model: all ');
    await expect(page.getByTestId('ingredients-val-scope')).toContainText('≥10 model: estimated from a 25% deterministic sample (373,636 of 1,498,609 selected rows). Descriptive.');
    if (!v.moisture_order_both_years) await expect(page.getByTestId('ingredients-val-moisture')).toContainText('mixed across years');
    await page.getByTestId('ingredients-val').scrollIntoViewIfNeeded();
    await shot(page, 'ingredients_validation_cloudburst_REF045_0813T2100Z_L4');

    await openIssue(page, 'REF045', '20230812T2100Z');
    const ff = await openAlert(page, 'flash_flood');
    expect(ff.aggregate_val.model).toBe('theta10');
    await expect(page.getByTestId('ingredients-val-moisture')).toHaveText(ff.aggregate_val.moisture);
});

// ---------------------------------------------------------------- map legend + controls at small viewports
for (const [w, h] of [[1280, 720], [1366, 768]]) {
    test(`map legend + Layers panel collapsed and controls not clipped at ${w}x${h}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await openIssue(page, 'REF045', '20230813T1500Z');
        const legend = page.getByTestId('map-legend');
        await expect(legend).toHaveAttribute('data-open', 'false');
        await expect(page.getByTestId('legend-toggle')).toHaveAttribute('aria-expanded', 'false');
        await expect(legend).not.toContainText('Warning (solid outline)');
        // Layers panel: collapsed on small screens, one-line summary of the current selection
        const layers = page.getByTestId('layers-panel');
        await expect(layers).toHaveAttribute('data-open', 'false');
        await expect(page.getByTestId('layers-summary')).toContainText(`L${await activeLead(page)} h`);
        await shot(page, `layers_collapsed_${w}x${h}`);
        await page.getByTestId('layers-toggle').click();
        await expect(layers).toHaveAttribute('data-open', 'true');
        const map = page.locator('.leaflet-container');
        const controls = page.getByTestId('layers-panel');
        const [mb, cb] = [await map.boundingBox(), await controls.boundingBox()];
        expect(cb.y + cb.height, 'controls bottom inside the map').toBeLessThanOrEqual(mb.y + mb.height + 0.5);
        // every control is reachable (the panel scrolls inside the map instead of being cut off)
        for (const id of ['episode-select', 'issue-select', 'lead-6', 'field-select', 'terrain-toggle', 'watch-toggle']) {
            await page.getByTestId(id).scrollIntoViewIfNeeded();
            await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
            const b = await page.getByTestId(id).boundingBox();
            expect(b.y + b.height).toBeLessThanOrEqual(mb.y + mb.height + 0.5);
        }
        await page.getByTestId('watch-toggle').check();                       // usable, not just visible
        await expect(page.getByTestId('watch-toggle')).toBeChecked();
        await controls.locator('.overflow-y-auto').evaluate((el) => { el.scrollTop = 0; });
        await shot(page, `map_legend_collapsed_${w}x${h}`);
        await page.getByTestId('legend-toggle').click();
        await expect(legend).toHaveAttribute('data-open', 'true');
        await expect(legend).toContainText('Warning (solid outline)');
        const lb = await legend.boundingBox();
        expect(lb.y).toBeGreaterThanOrEqual(mb.y);                              // expanded legend stays inside the map
        expect(lb.y + lb.height).toBeLessThanOrEqual(mb.y + mb.height + 0.5);
        await shot(page, `map_legend_expanded_${w}x${h}`);
    });
}

test('map legend open by default at 1600 px', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T1500Z');
    await expect(page.getByTestId('map-legend')).toHaveAttribute('data-open', 'true');
    await page.getByTestId('legend-toggle').click();
    await expect(page.getByTestId('map-legend')).toHaveAttribute('data-open', 'false');
});

// ---------------------------------------------------------------- warning timeline (checkpoint 04)
async function openTimeline(page, ep, ts) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const chk = page.waitForResponse((r) => r.url().endsWith(`/episodes/${ep}/event-check`) && r.ok());
    const tlr = page.waitForResponse((r) => r.url().endsWith(`/episodes/${ep}/timeline`) && r.ok());
    await openIssue(page, ep, ts);
    const [check, tl] = [await (await chk).json(), await (await tlr).json()];
    await page.getByTestId('drawer-tab-event').click();
    await expect(page.getByTestId('warning-timeline')).toBeVisible();
    return { site: check.sites.find((s) => s.site_episode === ep), tl };
}

async function expectTimelineMatchesApi(page, site, tl) {
    const tlBox = page.getByTestId('warning-timeline');
    const w0 = new Date(site.source.window_utc[0]).getTime();
    // qualifying alerts: exactly the API's, with its hours of warning (= window start - issue time)
    const markers = tlBox.getByTestId('tl-alert');
    await expect(markers).toHaveCount(site.qualifying.length);
    const got = await markers.evaluateAll((els) => els.map((e) => [e.dataset.alertId, Number(e.dataset.hours), e.dataset.issue]));
    expect(got.map((g) => g[0]).sort()).toEqual(site.qualifying.map((a) => a.alert_id).sort());
    for (const [id, hrs, issue] of got) {
        const a = site.qualifying.find((x) => x.alert_id === id);
        expect(hrs).toBe(a.hours_of_warning);
        expect(hrs).toBeCloseTo((w0 - new Date(issue).getTime()) / 3600e3, 5);
        await expect(tlBox.locator(`[data-testid="tl-alert"][data-alert-id="${id}"]`)).toContainText(`${a.hours_of_warning} h`);
        const row = tlBox.locator(`[data-testid="tl-alert"][data-alert-id="${id}"]`).locator('xpath=../..');
        await expect(row).toContainText(a.precision);                       // right-hand column of the same row
        await expect(row.getByTestId('tl-source')).toHaveAttribute('data-source', 'model');
        await expect(row.getByTestId('imd-chip')).toHaveCount(1);
    }
    await expect(tlBox.getByTestId('tl-nearby')).toHaveCount(site.nearby_cells.items.length);
    // every alert / nearby-cells lane starts and reaches the window inside the visible range
    const xs = await tlBox.locator('[data-testid="tl-alert"], [data-testid="tl-nearby"]')
        .evaluateAll((els) => els.map((el) => [Number(el.dataset.x), Number(el.dataset.xWindow)]));
    expect(xs.length).toBe(site.qualifying.length + site.nearby_cells.items.length);
    for (const [xi, xw] of xs) { expect(xi).toBeGreaterThan(0); expect(xw).toBeLessThan(100); expect(xi).toBeLessThan(xw); }
    await expect(tlBox.getByTestId('tl-row-tcwv_anom_mean').getByTestId('tl-row-label')).toContainText('area mean (patch), not at the site');
    await expect(tlBox.getByTestId('tl-row-cape_anom_mean').getByTestId('tl-row-label')).toContainText('area mean (patch), not at the site');
    await expect(tlBox.getByTestId('tl-row-tcwv_anom_change').getByTestId('tl-row-label')).toContainText('derived, not a model feature');
    await expect(tlBox.getByTestId('tl-row-tcwv_anom_change').locator('[data-testid="tl-source"]')).toHaveAttribute('data-source', 'derived');
    for (const n of site.nearby_cells.items) {
        await expect(tlBox.locator(`[data-testid="tl-nearby"][data-issue="${n.issue_time}"]`).first()).toContainText(`${n.hours_of_warning} h`);
    }
    // every row carries its source
    const sources = await tlBox.getByTestId('tl-source').evaluateAll((els) => [...new Set(els.map((e) => e.dataset.source))]);
    for (const s of ['model', 'model inputs', 'reports', 'satellite']) expect(sources, s).toContain(s);
    await expect(tlBox.getByTestId('tl-imerg-peak')).toContainText(String(tl.imerg.peak.max_mmhr));
    // ingredient cells: every issue in range, forecast-only shown as a gap
    for (const i of tl.issues) {
        const c = tlBox.locator(`[data-testid="tl-ingredient"][data-field="tcwv_anom_mean"][data-ts="${i.ts}"]`);
        if (await c.count()) {
            if (i.forecast_only) await expect(c).toHaveText('n/a');
            else await expect(c).toHaveText(`${i.tcwv_anom_mean > 0 ? '+' : ''}${i.tcwv_anom_mean.toFixed(2)}`);
        }
    }
}

test('warning timeline REF045 Pipalkoti: markers = event-check API, sources, IMERG never reached 30', async ({ page }) => {
    const { site, tl } = await openTimeline(page, 'REF045', '20230813T1500Z');
    await expectTimelineMatchesApi(page, site, tl);
    expect(site.qualifying.length).toBe(8);
    await expect(page.getByTestId('tl-window')).toContainText('(approximate)');
    await expect(page.getByTestId('tl-imerg-note')).toHaveText(
        `IMERG never reached 30 mm/hr within 25 km of the site (peak ${tl.imerg.peak.max_mmhr} mm/hr at 13 Aug 17:00Z).`);
    await expect(page.getByTestId('tl-imerg-onset')).toHaveCount(0);
    await expect(page.getByTestId('tl-row-tcwv_anom_change')).toContainText('since previous issue (3 h)');
    await expect(page.getByTestId('warning-timeline')).toHaveAttribute('data-t0', '2023-08-13T09:00:00.000Z');
    await expect(page.getByTestId('warning-timeline')).toHaveAttribute('data-t1', '2023-08-13T22:00:00.000Z');
    await shot(page, 'timeline_REF045_1920x1080');
    // click the 12:00Z cloudburst Watch lane -> that issue, lead and alert on the map
    const a = site.qualifying.find((x) => x.issue_time.startsWith('2023-08-13T12:00'));
    await page.locator(`[data-testid="tl-alert"][data-alert-id="${a.alert_id}"]`).click();
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', 'REF045/20230813T1200Z');
    expect(await activeLead(page)).toBe(a.lead_time_h);
    await expect(page.getByTestId('explain-panel')).toHaveAttribute('data-hazard', a.hazard);
});

test('warning timeline REF051 Malana: markers = event-check API, window label, onset + peak, forecast-only gap', async ({ page }) => {
    const { site, tl } = await openTimeline(page, 'REF051', '20240731T1800Z');
    await expectTimelineMatchesApi(page, site, tl);
    expect(site.qualifying.length).toBe(5);
    await expect(page.getByTestId('tl-window-label')).toContainText("state authority's preliminary range; covers several Kullu cloudbursts");
    await expect(page.getByTestId('tl-imerg-onset')).toContainText(String(tl.imerg.onset_ge30.max_mmhr));
    await expect(page.getByTestId('tl-imerg-note')).toContainText('IMERG first reached 30 mm/hr at 31 Jul 18:30Z');
    await expect(page.getByTestId('tl-row-tcwv_anom_change')).toContainText('since previous issue (1 h)');
    await expect(page.getByTestId('warning-timeline')).toHaveAttribute('data-t0', '2024-07-31T11:00:00.000Z');
    await expect(page.getByTestId('warning-timeline')).toHaveAttribute('data-t1', '2024-08-01T00:00:00.000Z');
    await expect(page.locator('[data-testid="tl-ingredient"][data-ts="20240731T1300Z"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="tl-ingredient"][data-ts="20240731T1300Z"]').first()).toHaveAttribute('data-forecast-only', 'true');
    await expect(page.getByTestId('warning-timeline')).toContainText('nearby alert cells (≤25 km), not a site-covering alert');
    await shot(page, 'timeline_REF051_1920x1080');
    // nearby-cells marker -> forecast-only 13:00Z issue at its lead
    const n = site.nearby_cells.items[0];
    await page.getByTestId('tl-nearby').first().click();
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', 'REF051/20240731T1300Z');
    expect(await activeLead(page)).toBe(n.lead_time_h);
});

// ---------------------------------------------------------------- Results + Approach pages (checkpoint 06)
test('Results page: CSI points = API, caveat markers, case studies from event-check, timeline links', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/nowcast');
    const resp = page.waitForResponse((r) => r.url().endsWith('/results') && r.ok());
    const chk = page.waitForResponse((r) => r.url().endsWith('/episodes/REF045/event-check') && r.ok());
    await page.getByTestId('nav-results').click();
    await expect(page).toHaveURL(/\/nowcast\/results$/);
    const res = await (await resp).json();
    const check = await (await chk).json();
    for (const split of ['val', 'test']) {
        for (const th of [1, 10, 30]) {
            const want = res.csi.filter((r) => r.split === split && r.threshold === th).sort((a, b) => a.lead - b.lead);
            const chart = page.getByTestId(`csi-chart-${split}-${th}`);
            const v0 = await chart.locator('[data-series="v0"] circle').evaluateAll((els) => els.map((e) => Number(e.dataset.y)));
            expect(v0, `${split} ${th}`).toEqual(want.map((r) => r.csi_v0));
            await expect(chart.getByTestId('csi-far-flag')).toHaveCount(want.filter((r) => r.far_above_advection).length);
        }
    }
    await expect(page.getByTestId('csi-persistence-flag')).toHaveCount(res.csi.filter((r) => r.persistence_ge_v0).length);
    await expect(page.getByTestId('far-caveat-legend')).toContainText('FAR caveat');
    await expect(page.getByTestId('reliability-val')).toBeVisible();
    await expect(page.getByTestId('reliability-min-n')).toContainText('fewer than 100 cells');
    // case studies (numbers from the event-check API)
    const site = check.sites.find((s) => s.site_episode === 'REF045');
    const pa = site.qualifying.filter((a) => a.precision === 'precise' && a.hazard === 'cloudburst')
        .sort((a, b) => b.hours_of_warning - a.hours_of_warning)[0];
    const p = page.getByTestId('case-study-REF045');
    await expect(p).toContainText(`${pa.hours_of_warning} h before the earliest reported time`);
    await expect(p).toContainText(`${pa.peak_to_site_km} km from the site`);
    await expect(p).toContainText(`${Math.round(pa.area_km2)} km²`);
    await expect(p).toContainText('Not confirmed by IMERG satellite rain – counted as a false alarm in our scores.');
    await expect(p).toContainText('17.52 mm/hr');
    await expect(p).toContainText('never reached 30 mm/hr');
    await expect(p).toContainText('approximate');
    const m = page.getByTestId('case-study-REF051');
    await expect(m).toContainText('Cloudburst Warning 3 h');
    await expect(m).toContainText('thunderstorm Warning 4 h');
    await expect(m).toContainText('broad area');
    await expect(m).toContainText("state authority's preliminary range; covers several Kullu cloudbursts");
    await expect(page.getByTestId('case-study-note')).toContainText('This is a case study, not a skill score');
    await expect(page.getByTestId('negative-results')).toContainText('no measurable skill gain');
    await expect(page.getByTestId('negative-results')).toContainText('behind v0 in every combination');
    await expect(page.getByTestId('limitations').locator('li')).toHaveCount(10);
    await shot(page, 'results_1920x1080');
    // case-study link opens that timeline
    await page.getByTestId('case-link-REF045').click();
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `REF045/${pa.issue_time.replace(/[-:]/g, '')}`);
    await expect(page.getByTestId('warning-timeline')).toBeVisible();
});

test('Approach page: status table, IWV attribution from AGGREGATE_VAL, IMERG evidence, live latency arithmetic', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const resp = page.waitForResponse((r) => r.url().endsWith('/approach') && r.request().resourceType() === 'fetch' && r.ok());
    await page.goto('/nowcast/approach');
    const a = await (await resp).json();
    const rows = page.getByTestId('approach-row');
    await expect(rows).toHaveCount(9);
    const st = Object.fromEntries(a.rows.map((r) => [r.item, r.status]));
    for (const [item, status] of Object.entries(st)) {
        await expect(page.locator(`[data-testid="approach-row"][data-item="${item}"]`)).toHaveAttribute('data-status', status);
    }
    expect(st['Wind shear']).toBe('Tested, no gain');
    expect(st['Alert API / CAP']).toBe('Export + Atom feed built');
    await expect(page.locator('[data-testid="approach-row"][data-item="Alert API / CAP"]')).toContainText('CAP 1.2 file export and Atom feed built (Exercise status, not connected to any official system)');
    const capNote = a.rows.find((r) => r.item === 'Alert API / CAP').status_note;
    const nApproved = (await (await page.request.get(`${ML_API}/ml/cap/approvals`)).json()).n_approved;
    expect(capNote).toMatch(new RegExp(`^${nApproved} forecaster-approved message`));                // the real state
    await expect(page.locator('[data-testid="approach-row"][data-item="Alert API / CAP"]').getByTestId('approach-status-note')).toHaveText(capNote);
    await expect(page.getByTestId('iwv-attribution')).toHaveText(a.rows[0].attribution);
    await expect(page.getByTestId('iwv-attribution')).toContainText('Validation 2022–23, alert-selected rows');
    await expect(page.getByTestId('approach-page')).not.toContainText('core driver');
    await expect(page.getByTestId('imerg-evidence')).toContainText('| all | 24 | 17.6 |');
    await expect(page.getByTestId('imerg-evidence')).toContainText('Pipalkoti area | 17.5');
    const lat = a.live.latency;
    await expect(page.getByTestId('latency-arithmetic')).toContainText(`≈ ${lat.real_warning_imerg_h} h of real warning`);
    await expect(page.getByTestId('latency-arithmetic')).toContainText(`≈ ${lat.real_warning_insat_h} h`);
    // both IMERG Early cases: 5.3 h at our first live poll and the ~4 h typical value (from LIVE_PIPELINE.md)
    await expect(page.getByTestId('latency-arithmetic')).toContainText(`${lat.imerg_early_age_h} h old (our first live poll)`);
    await expect(page.getByTestId('latency-arithmetic')).toContainText(`at the ~${lat.imerg_early_typical_h} h typical latency LIVE_PIPELINE.md also notes ≈ ${lat.real_warning_imerg_typical_h} h`);
    await expect(page.getByTestId('lat-imerg')).toContainText('5.3 h at our first live poll (LIVE_PIPELINE.md also notes ~4 h typical)');
    await expect(page.getByTestId('lat-imerg')).toContainText(`~${lat.numbers.imerg_early_min[0]} min`);
    await expect(page.getByTestId('lat-3ds')).toContainText(`${lat.numbers.insat_3ds_min[0]} min`);
    await shot(page, 'approach_1920x1080');
    await page.getByTestId('page-link-nowcast').click();
    await expect(page.getByTestId('replay-view')).toBeVisible();
});

// ---------------------------------------------------------------- layout consolidation (checkpoint U1)
const DRAWER_TABS = ['alert', 'ingredients', 'event', 'caveats'];
const boxesOverlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// map controls (Layers panel, zoom) are inside the map and not covered by the drawer
async function expectControlsClear(page) {
    const map = await page.locator('.leaflet-container').boundingBox();
    const drawer = await page.getByTestId('drawer').boundingBox();
    for (const loc of [page.getByTestId('layers-panel'), page.locator('.leaflet-control-zoom'), page.getByTestId('map-legend')]) {
        const b = await loc.boundingBox();
        expect(b.x).toBeGreaterThanOrEqual(map.x - 0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(map.x + map.width + 0.5);
        expect(boxesOverlap(b, drawer), 'control covered by the drawer').toBe(false);
    }
    expect(map.x + map.width).toBeLessThanOrEqual(drawer.x + 0.5);          // the drawer pushes the map
}

for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    test(`layout ${w}x${h}: map first, one drawer (collapsed, one section at a time, Esc/× close), badges on the map`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        const cav = page.waitForResponse((r) => r.url().endsWith('/caveats') && r.ok());
        const alerts = await openIssue(page, 'REF045', '20230813T1500Z');
        const drawer = page.getByTestId('drawer');
        // default: drawer collapsed (only the icon rail), badges visible above the map, credits visible
        await expect(drawer).toHaveAttribute('data-open', '');
        await expect(page.locator('[data-testid^="drawer-panel-"]')).toHaveCount(0);
        for (const t of DRAWER_TABS) await expect(page.getByTestId(`drawer-tab-${t}`)).toBeVisible();
        await expect(page.getByTestId('oos-badge')).toBeInViewport({ ratio: 1 });
        await expect(page.getByTestId('layers-panel')).toHaveAttribute('data-open', String(w >= 1600 && h >= 900));
        await expect(page.getByTestId('credits-toggle')).toBeInViewport({ ratio: 1 });
        await expect(page.locator('path.nowcast-alert-poly')).toHaveCount(
            alerts.filter((a) => a.lead_time_h === 2 && a.level === 'Warning').length);
        await expectControlsClear(page);
        await shot(page, `layout_default_${w}x${h}`);

        // clicking an alert on the map opens the drawer on the Alert section
        const detail = page.waitForResponse((r) => /\/alerts\/[^/]+$/.test(r.url()) && r.ok());
        await page.locator('path.nowcast-alert-poly').first().dispatchEvent('click');
        const d = await (await detail).json();
        await expect(drawer).toHaveAttribute('data-open', 'alert');
        await expect(page.getByTestId('explain-panel')).toHaveAttribute('data-hazard', d.hazard);
        await expect(page.locator('[data-testid^="drawer-panel-"]')).toHaveCount(1);
        await expect(page.getByTestId('oos-badge')).toBeInViewport({ ratio: 1 });
        await expectControlsClear(page);
        await shot(page, `layout_drawer_alert_${w}x${h}`);

        // one section at a time
        await page.getByTestId('drawer-tab-ingredients').click();
        await expect(drawer).toHaveAttribute('data-open', 'ingredients');
        await expect(page.getByTestId('explain-panel')).toHaveCount(0);
        await expect(page.getByTestId('ingredients-tab')).toBeVisible();
        await expect(page.getByTestId('ingredient-row')).toHaveCount(6);
        await expect(page.locator('[data-testid^="drawer-panel-"]')).toHaveCount(1);
        await shot(page, `layout_drawer_ingredients_${w}x${h}`);

        await page.getByTestId('drawer-tab-event').click();
        await expect(drawer).toHaveAttribute('data-open', 'event');
        await expect(page.getByTestId('warning-timeline')).toBeVisible();
        await expect(page.getByTestId('ingredients-tab')).toHaveCount(0);
        await expectControlsClear(page);
        await expect(page.getByTestId('oos-badge')).toBeInViewport({ ratio: 1 });
        await shot(page, `layout_drawer_event_${w}x${h}`);

        await page.getByTestId('drawer-tab-caveats').click();
        const caveats = (await (await cav).json()).caveats;
        await expect(page.getByTestId('caveat')).toHaveCount(caveats.length);
        await expect(page.getByTestId('caveats-panel')).toContainText(caveats[0].short);
        await expect(page.getByTestId('caveats-panel')).toContainText(caveats[0].source);
        await expect(page.getByTestId('warning-timeline')).toHaveCount(0);
        await expect(page.getByTestId('credits-toggle')).toBeInViewport({ ratio: 1 });
        await shot(page, `layout_drawer_caveats_${w}x${h}`);

        // Esc closes; × closes; clicking the open section's icon closes
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveAttribute('data-open', '');
        await page.getByTestId('drawer-tab-caveats').click();
        await page.getByTestId('drawer-close').click();
        await expect(drawer).toHaveAttribute('data-open', '');
        await page.getByTestId('drawer-tab-alert').click();
        await page.getByTestId('drawer-tab-alert').click();
        await expect(drawer).toHaveAttribute('data-open', '');
    });
}

test('legend lists only visible layers (hazards, forecast layer, terrain, observed)', async ({ page }) => {
    await openIssue(page, 'REF045', '20230813T2100Z');
    await page.getByTestId('lead-4').click();
    const legend = page.getByTestId('map-legend');
    await expect(legend).toHaveAttribute('data-open', 'true');
    await expect(page.getByTestId('raster-legend-label')).toHaveCount(0);            // no forecast layer selected
    await expect(page.getByTestId('legend-observed')).toHaveCount(1);
    await expect(page.getByTestId('legend-terrain')).toHaveCount(1);
    await expect(page.getByTestId('legend-hazards').locator('[data-hazard]')).toHaveCount(3);
    await page.locator('label', { hasText: 'Cloudburst' }).locator('input').uncheck();
    await expect(page.getByTestId('legend-hazards').locator('[data-hazard="cloudburst"]')).toHaveCount(0);
    await page.getByTestId('terrain-toggle').uncheck();
    await expect(page.getByTestId('legend-terrain')).toHaveCount(0);
    await page.getByTestId('field-select').selectOption('thunderstorm');
    await expect(page.getByTestId('raster-legend-label')).toContainText('probability');
    for (const h of ['Thunderstorm', 'Flash flood']) await page.locator('label', { hasText: h }).locator('input').uncheck();
    await expect(legend).not.toContainText('Warning (solid outline)');               // no alert layer on -> no alert legend
    await expect(page.getByTestId('raster-legend-label')).toHaveCount(1);
});

test('National and Live use the same frame: Layers panel, legend, drawer (About/Alert/Ingredients/Caveats)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/nowcast');
    await page.getByTestId('tab-india').click();
    await expect(page.getByTestId('india-banner')).toBeInViewport();
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', '');
    await page.getByTestId('drawer-tab-about').click();
    await expect(page.getByTestId('india-notes')).toContainText('Absence of alerts does not mean');
    await expectControlsClear(page);
    await shot(page, 'layout_national_about_1366x768');
    await page.goto(OLD_LIVE);
    await expect(page.getByTestId('lead-1')).toBeAttached({ timeout: 30_000 });
    await expect(page.getByTestId('live-not-validated')).toBeInViewport();
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', '');
    await page.getByTestId('layers-toggle').click();
    await page.getByTestId('watch-toggle').check();
    await page.locator('path.nowcast-peak-marker').first().dispatchEvent('click');
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
    await expect(page.getByTestId('explain-panel')).toContainText('NOT validated');
    await expect(page.getByTestId('live-not-validated')).toBeInViewport();
    await expectControlsClear(page);
    await shot(page, 'layout_live_alert_1366x768');
});

for (const [path, id, name] of [['/nowcast/results', 'results-page', 'results'], ['/nowcast/approach', 'approach-page', 'approach']]) {
    test(`${name} page reads cleanly at 1366x768 (no horizontal overflow, nothing clipped)`, async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto(path);
        await expect(page.getByTestId(id)).toBeVisible();
        await page.waitForTimeout(800);
        const r = await page.evaluate(() => {
            const bad = [];
            for (const el of document.querySelectorAll('main *, [data-testid$="-page"] *')) {
                if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
                const cs = getComputedStyle(el);
                if ((cs.overflowX === 'visible' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0
                    && !['inline'].includes(cs.display)) bad.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
            }
            return { docW: document.documentElement.scrollWidth, vw: innerWidth, bad: bad.slice(0, 10) };
        });
        expect(r.docW, 'page wider than the viewport').toBeLessThanOrEqual(r.vw);
        expect(r.bad, 'elements with clipped / overflowing content').toEqual([]);
        await shot(page, `${name}_1366x768`);
    });
}

// ---------------------------------------------------------------- CAP 1.2 + forecaster review (checkpoint 05)
const CAP_LABEL = "CAP 1.2 compatible (format used by India's Sachet alerting platform)";
const ML_API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';

// Forecaster decisions are server state now (they feed /ml/cap/feed.atom): put every stored decision back to
// "pending" so each run starts from an unreviewed alert.
async function resetCapReviews(page) {
    const { items } = await (await page.request.get(`${ML_API}/ml/cap/approvals`)).json();
    for (const it of items) {
        if (it.status === 'pending' && !it.edited) continue;
        const r = await page.request.post(`${ML_API}/ml/cap/review`, { data: { ...it.src, alert_id: it.alert_id, status: 'pending' } });
        expect(r.ok()).toBe(true);
    }
}

for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    test(`CAP review ${w}x${h}: download blocked until approved, edits kept, Exercise status, nothing sent`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await resetCapReviews(page);
        const offsite = [];
        page.on('request', (r) => {
            const u = new URL(r.url());
            if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('tile.openstreetmap.org')) offsite.push(r.url());
        });
        await openIssue(page, 'REF045', '20230813T2100Z');
        // the Layers panel starts collapsed below 1600 px (declutter pass)
        if ((await page.getByTestId('layers-panel').getAttribute('data-open')) === 'false') await page.getByTestId('layers-toggle').click();
        await page.getByTestId('lead-4').click();
        await showAlertList(page);
        const row = page.locator('[data-testid="alert-row"][data-level="Warning"]').first();
        const level = await row.getAttribute('data-level');
        await row.locator('button').click();
        const review = page.getByTestId('cap-review');
        await expect(review).toHaveAttribute('data-status', 'pending');
        await expect(page.getByTestId('cap-status')).toHaveText('Exercise');
        await expect(review).toContainText(level === 'Warning' ? 'severity Severe · certainty Likely' : 'severity Moderate · certainty Possible');
        await expect(page.getByTestId('cap-format')).toContainText(CAP_LABEL);
        await expect(page.getByTestId('cap-format')).toContainText('nothing is ever sent anywhere');
        await expect(page.getByTestId('cap-headline')).toContainText('EXERCISE:');
        await expect(page.getByTestId('cap-download')).toBeDisabled();                  // not reviewed yet
        await shot(page, `cap_review_pending_${w}x${h}`);

        await page.getByTestId('cap-reject').click();
        await expect(review).toHaveAttribute('data-status', 'rejected');
        await expect(page.getByTestId('cap-download')).toBeDisabled();
        await page.getByTestId('cap-approve').click();
        await expect(page.getByTestId('cap-review-status')).toHaveText('approved for issue (demo)');
        await expect(page.getByTestId('cap-download')).toBeEnabled();

        // edit (headline + description only) sends it back to review
        await page.getByTestId('cap-edit').click();
        await page.getByTestId('cap-edit-headline').fill('EXERCISE: forecaster-edited headline');
        await page.getByTestId('cap-edit-description').fill('Forecaster-edited description for the demo.');
        await page.getByTestId('cap-save').click();
        await expect(review).toHaveAttribute('data-status', 'pending');
        await expect(page.getByTestId('cap-download')).toBeDisabled();
        await expect(page.getByTestId('cap-headline')).toHaveText('EXERCISE: forecaster-edited headline');
        await page.getByTestId('cap-approve').click();
        await shot(page, `cap_review_approved_${w}x${h}`);

        const dl = page.waitForEvent('download');
        await page.getByTestId('cap-download').click();
        const file = await dl;
        expect(file.suggestedFilename()).toMatch(/\.cap\.xml$/);
        const xml = await (await import('node:fs/promises')).readFile(await file.path(), 'utf-8');
        expect(xml).toContain('<status>Exercise</status>');
        expect(xml).not.toContain('<status>Actual</status>');
        expect(xml).toContain('<headline>EXERCISE: forecaster-edited headline</headline>');
        expect(xml).toContain('<description>Forecaster-edited description for the demo.</description>');
        expect(xml).toContain('approved for issue (demo); headline/description edited by the forecaster');
        expect(xml).toContain('<language>en-IN</language>');
        await expect(page.getByTestId('cap-download-result')).toContainText('not sent anywhere');

        // the review belongs to that alert only: another alert starts unreviewed
        await page.getByTestId('explain-panel').locator('button[title="Back to list"]').click();
        await page.locator('[data-testid="alert-row"]').nth(1).locator('button').click();
        await expect(page.getByTestId('cap-review')).toHaveAttribute('data-status', 'pending');
        await expect(page.getByTestId('cap-download')).toBeDisabled();
        expect(offsite, 'requests leaving this machine (other than map tiles)').toEqual([]);
    });
}

test('CAP review on a live alert: status Test (not validated), download blocked until approved', async ({ page }) => {
    await page.goto(OLD_LIVE);
    await page.getByTestId('tab-live').click();
    await page.getByTestId('watch-toggle').check();
    await showAlertList(page);
    await page.getByTestId('alert-row').first().locator('button').click();
    await expect(page.getByTestId('cap-status')).toHaveText('Test');
    await expect(page.getByTestId('cap-headline')).toContainText('TEST:');
    await expect(page.getByTestId('cap-download')).toBeDisabled();
    await page.getByTestId('cap-approve').click();
    await expect(page.getByTestId('cap-download')).toBeEnabled();
    await expect(page.getByTestId('explain-panel')).toContainText('NOT validated');
});

// ---------------------------------------------------------------- INSAT-3DR case-study observation layer (checkpoint I2b)
const INSAT_LINES = ['INSAT position uncertainty ≈ 5–10 km (navigation + parallax); site values use a 25 km patch.',
    'Observation only — not used by the model.'];
const INSAT_FLOOR = "≤180 K = at or below the coldest value in the product's lookup table (179.9 K); cooling rate not computable.";

async function openLayers(page) {
    if ((await page.getByTestId('layers-panel').getAttribute('data-open')) === 'false') await page.getByTestId('layers-toggle').click();
}

test('INSAT layer: off by default; on = the image usable at issue time (API rule), legend + both lines; off again', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        const at = page.waitForResponse((r) => r.url().endsWith('/issues/REF045/20230813T1500Z/insat') && r.ok());
        await openIssue(page, 'REF045', '20230813T1500Z');
        const api = await (await at).json();
        expect(api.available).toBe(true);
        expect(api.slot).toBe('2023-08-13T13:45Z');                  // 14:15Z scan ends 14:42Z, usable only at 15:27Z
        await openLayers(page);
        const toggle = page.getByTestId('insat-toggle');
        await expect(toggle).not.toBeChecked();
        await expect(page.locator('img.nowcast-raster.insat')).toHaveCount(0);
        await expect(page.getByTestId('legend-insat')).toHaveCount(0);
        await toggle.check();
        const img = page.locator('img.nowcast-raster.insat');
        await expect(img).toHaveAttribute('src', new RegExp(`/insat/REF045/${api.id}\\.png$`));
        await expect(page.getByTestId('insat-availability')).toHaveText(api.label);
        await expect(page.getByTestId('insat-availability')).toContainText('acquired 13:45Z, ~45 min latency');
        if ((await page.getByTestId('map-legend').getAttribute('data-open')) === 'false') await page.getByTestId('legend-toggle').click();
        await expect(page.getByTestId('legend-insat')).toContainText('Satellite observation (INSAT via MOSDAC)');
        await expect(page.getByTestId('legend-insat').getByTestId('insat-line')).toHaveText(INSAT_LINES);
        await expect(page.getByTestId('legend-insat')).not.toContainText('%');
        await expect(page.getByTestId('legend-insat-floor')).toHaveText(INSAT_FLOOR);
        await expect(page.getByTestId('legend-insat-coldest')).toHaveText('≤180 K');
        // same bounds as the forecast rasters (the overlay is drawn at meta.bounds)
        const meta = await (await page.request.get('http://127.0.0.1:8000/ml/issues/REF045/20230813T1500Z/meta')).json();
        const info = await (await page.request.get('http://127.0.0.1:8000/ml/insat/REF045')).json();
        expect(info.bounds).toEqual(meta.bounds);
        await page.getByTestId('insat-opacity').fill('0.4');
        await expect.poll(async () => Number(await img.evaluate((e) => getComputedStyle(e).opacity))).toBeCloseTo(0.4, 2);
        await shot(page, `insat_overlay_REF045_${w}x${h}`);
        await toggle.uncheck();
        await expect(img).toHaveCount(0);
        await expect(page.getByTestId('legend-insat')).toHaveCount(0);
    }
});

test('INSAT availability rule in the UI: no image acquired after issue − latency; early issue says not available', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const index = await (await page.request.get('http://127.0.0.1:8000/ml/insat/REF051')).json();
    const lat = index.latency.minutes;
    for (const ts of ['20240731T1300Z', '20240731T1800Z', '20240731T2200Z']) {
        await openIssue(page, 'REF051', ts);
        await openLayers(page);
        await page.getByTestId('insat-toggle').check();
        const av = page.getByTestId('insat-availability');
        await expect(av).toHaveAttribute('data-available', 'true');
        const slot = await av.getAttribute('data-slot');
        const s = index.slots.find((x) => x.slot === slot);
        const T = new Date(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:00Z`).getTime();
        expect(new Date(s.acq_end).getTime() + lat * 60e3).toBeLessThanOrEqual(T);
        // no later scan was usable yet
        for (const o of index.slots.filter((x) => new Date(x.acq_end) > new Date(s.acq_end))) {
            expect(new Date(o.acq_end).getTime() + lat * 60e3).toBeGreaterThan(T);
        }
        await expect(page.locator('img.nowcast-raster.insat')).toHaveAttribute('src', new RegExp(`${s.id}\\.png$`));
    }
    // REF045 12 Aug issue: before the first downloaded scan -> no image, stated
    await openIssue(page, 'REF045', '20230812T2100Z');
    await openLayers(page);
    await page.getByTestId('insat-toggle').check();
    await expect(page.getByTestId('insat-availability')).toHaveAttribute('data-available', 'false');
    await expect(page.getByTestId('insat-availability')).toContainText('No INSAT-3DR image available at issue time');
    await expect(page.locator('img.nowcast-raster.insat')).toHaveCount(0);
});

test('INSAT not available for REF025 (in-sample event, no case files)', async ({ page }) => {
    await openIssue(page, 'REF025', '20210718T1800Z');
    await openLayers(page);
    await expect(page.getByTestId('insat-unavailable')).toContainText('not available for this event');
    await expect(page.getByTestId('insat-toggle')).toHaveCount(0);
});

test('INSAT timeline rows: cells = API series by scan time, gaps hatched, no change across gaps, lines + reference', async ({ page }) => {
    for (const [ep, ts, nGaps] of [['REF045', '20230813T1500Z', 3], ['REF051', '20240731T1800Z', 0]]) {
        const { tl } = await openTimeline(page, ep, ts);
        const site = tl.insat.sites.find((s) => s.site_episode === ep);
        const box = page.getByTestId('warning-timeline');
        const t0 = new Date(await box.getAttribute('data-t0')).getTime();
        const t1 = new Date(await box.getAttribute('data-t1')).getTime();
        const inRange = site.series.filter((s) => new Date(s.slot).getTime() >= t0 && new Date(s.slot).getTime() + 30 * 60e3 <= t1);
        await expect(page.getByTestId('insat-cell-p10')).toHaveCount(inRange.length);
        await expect(page.getByTestId('insat-cell-d30')).toHaveCount(inRange.length);
        for (const s of inRange) {
            await expect(page.locator(`[data-testid="insat-cell-p10"][data-slot="${s.slot}"]`)).toHaveAttribute('data-value', String(s.p10_bt_k));
            await expect(page.locator(`[data-testid="insat-cell-d30"][data-slot="${s.slot}"]`))
                .toHaveAttribute('data-value', s.d30_p10_k == null ? '' : String(s.d30_p10_k));
        }
        await expect(page.getByTestId('tl-insat-p10').getByTestId('insat-gap')).toHaveCount(nGaps);
        if (nGaps) {
            // the scan after the gap has no 30-min change
            await expect(page.locator('[data-testid="insat-cell-d30"][data-slot="2023-08-13T19:45Z"]')).toHaveAttribute('data-value', '');
        }
        await expect(page.getByTestId('tl-insat-p10').getByTestId('tl-source')).toHaveAttribute('data-source', 'satellite');
        await expect(page.getByTestId('tl-insat-p10')).toContainText('INSAT-3DR via MOSDAC');
        await expect(page.getByTestId('insat-notes').getByTestId('insat-line')).toHaveText(INSAT_LINES);
        // I2c: no threshold line; the 0 °C reference is removed from the UI
        await expect(page.getByTestId('insat-threshold')).toHaveCount(0);
        await expect(page.getByTestId('insat-threshold-note')).toHaveText('No verified severe-storm threshold shown.');
        await expect(page.getByTestId('insat-rows')).not.toContainText('273.15');
        await expect(page.getByTestId('insat-floor-line')).toHaveText(INSAT_FLOOR);
        await page.getByTestId('insat-table-toggle').click();
        await expect(page.getByTestId('insat-table-row')).toHaveCount(site.series.length);
        await expect(page.getByTestId('insat-method')).toContainText('look-up table');
        await expect(page.getByTestId('insat-table-floor-line')).toHaveText(INSAT_FLOOR);
        const floorRow = site.series.find((x) => x.p10_at_lut_floor);
        await expect(page.locator(`[data-testid="insat-table-row"][data-slot="${floorRow.slot}"]`)).toContainText('≤180 K');
        for (const bad of ['early signal', 'validat', 'precursor', '%']) {
            await expect(page.getByTestId('insat-rows')).not.toContainText(bad);
        }
        await page.getByTestId('insat-table-toggle').click();
        await shot(page, `insat_timeline_${ep}_1920x1080`);
    }
    // 1366: the rows still fit (colour cells; values in the table)
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.getByTestId('insat-rows')).toBeVisible();
    const rowBox = await page.getByTestId('tl-insat-p10').boundingBox();
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(1366);
    await shot(page, 'insat_timeline_REF051_1366x768');
});

test('data credits: MOSDAC credit line and the 3DR L1C DOI', async ({ page }) => {
    await page.goto('/nowcast');
    await page.getByTestId('credits-toggle').click();
    const c = page.getByTestId('credit-insat_mosdac');
    await expect(c).toContainText('Data Source MOSDAC/SAC/ISRO. https://mosdac.gov.in');
    await expect(c.getByRole('link', { name: 'DOI' })).toHaveAttribute('href', 'https://doi.org/10.19038/SAC/10/3RIMG_L1C_ASIA_MER');
});

test('Approach page: cloud-top temperature row (INSAT observation layer, not a model input)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/nowcast/approach');
    const row = page.locator('[data-testid="approach-row"][data-item="Cloud-top temperature drop rate"]');
    await expect(row).toHaveAttribute('data-status', 'Observation layer delivered');
    await expect(row).toContainText('INSAT-3DR cloud-top observation layer delivered (MOSDAC access granted 28 Sep 2026); not a model input.');
    await expect(row).not.toContainText('needs INSAT imagery');
    await expect(row.getByTestId('approach-status-note')).toHaveText(
        '10.8 µm cloud-top temperature on the two case studies. Using it in the model needs INSAT history + retraining (roadmap).');
    await expect(page.getByTestId('approach-table')).not.toContainText('Blocked by data access');
    // status notes: this row and the Alert API / CAP row (approved count in the feed, from the real state)
    await expect(page.getByTestId('approach-status-note')).toHaveCount(2);
    await shot(page, 'approach_ctt_row_1920x1080');
});

test('Event check: "Observed (case study)" paragraph on both events = the API text (every value built from data)', async ({ page }) => {
    for (const [ep, ts] of [['REF045', '20230813T1500Z'], ['REF051', '20240731T1800Z']]) {
        const { tl } = await openTimeline(page, ep, ts);
        const cs = tl.insat.case_study;
        const box = page.getByTestId('insat-case-study');
        await expect(page.getByTestId('insat-case-study-title')).toHaveText('Observed (case study)');
        await expect(page.getByTestId('insat-case-study-text')).toHaveText(cs.text);
        await expect(page.getByTestId('insat-case-study-footer')).toHaveText('Two case studies, not a general lead-time result.');
        await expect(box).toContainText(`from the ${cs.facts.run_first.slice(11, 16)}Z to the ${cs.facts.run_last.slice(11, 16)}Z scan`);
        await expect(box).toContainText(`first qualifying alert was issued at ${cs.facts.first_alert.slice(11, 16)}Z`);
        for (const bad of ['early signal', 'validat', 'precursor', '%']) await expect(box).not.toContainText(bad);
        await page.screenshot({ path: `e2e/screenshots/case_study_${ep}_1920x1080.png` });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByTestId('insat-case-study').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'e2e/screenshots/case_study_REF051_1366x768.png' });
});

test('replay disabled on the host: the note replaces the button; precomputed replay still loads', async ({ page }) => {
    const note = 'On-demand replay is disabled in the hosted demo; precomputed case studies are shown.';
    await page.route((u) => u.port === '8000' && u.pathname === '/ml/replay/status', (r) => r.fulfill({
        json: { enabled: false, note, loaded: false, busy: false, cached: 0 } }));
    const alerts = await openIssue(page, 'REF045', '20230813T1500Z');
    expect(alerts.length).toBeGreaterThan(0);
    await showAlertList(page);
    await expect(page.getByTestId('replay-disabled-note')).toHaveText(note);
    await expect(page.getByTestId('replay-button')).toHaveCount(0);
    await expect(page.locator('path.nowcast-alert-poly').first()).toBeVisible();
});
