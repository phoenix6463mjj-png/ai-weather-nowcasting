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
