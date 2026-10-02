// Nearby shelter options (drawer section on /nowcast): OSM public buildings near a chosen point, checked
// against every alert of the issue/run. Candidates outside all alerts first; those inside one in a
// collapsed group; "none outside" said plainly with one button to widen to 50 km; Event replay's default
// point = the alert peak nearest the documented event site; relative elevation in words; one NDMA
// sentence quoted with its source. Every value shown is the API's (serve/shelters.py); never "safe".
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const WORDING = 'Candidate public buildings outside the current alert area, not verified shelters. Roads may be blocked. '
    + 'Follow evacuation instructions from district authorities and IMD. Emergency: 112.';
const NDMA = 'Be aware of streams, drainage channels, canyons, and other areas known to flood suddenly.';
const SAFE = /\bsaf(e|er|ety|ely)\b/i;
const ISSUES = { REF045: '20230813T1500Z', REF051: '20240731T1400Z', REF025: '20210717T1800Z' };

async function openIssue(page, ep) {
    await page.goto(`/nowcast?ep=${ep}&ts=${ISSUES[ep]}`);
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `${ep}/${ISSUES[ep]}`, { timeout: 30_000 });
}
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();
const leadsOf = (c) => [...new Set(c.inside_alerts.map((a) => a.lead_time_h))].sort((a, b) => a - b);

async function expectCandidate(it, c) {
    await expect(it).toContainText(c.name || `Unnamed ${c.type_label.toLowerCase()}`);
    await expect(it).toContainText(c.type_label);
    await expect(it.getByTestId('shelter-distance')).toHaveText(`${c.distance_km.toFixed(1)} km ${c.direction}`);
    await expect(it).toHaveAttribute('data-outside', String(c.outside_all_alerts));
    await expect(it.getByTestId('shelter-alert-status')).toHaveText(
        c.outside_all_alerts ? 'Outside all alert areas (at every lead time)' : `Inside an alert area at +${leadsOf(c).join(', +')} h`);
    await expect(it.getByTestId('shelter-slope')).toHaveText(c.slope_deg != null ? `${c.slope_deg}°` : 'no data');
    await expect(it.getByTestId('shelter-elev')).toHaveText(c.elevation_rel_text);
    expect(c.elevation_rel_text).toMatch(/^(\d[\d,]* m (lower|higher) than your chosen location|same elevation as your chosen location|no elevation data)$/);
}

// the panel equals the API's answer for the point (and radius) it shows: outside group first, inside group
// collapsed (opened here to compare), counts, "none outside" text and the widen button
async function expectMatchesApi(page, base, radius = 25) {
    const pt = page.getByTestId('shelter-point');
    await expect(page.getByTestId('shelter-summary').or(page.getByTestId('shelter-not-available'))).toBeVisible();
    const q = `lat=${await pt.getAttribute('data-lat')}&lon=${await pt.getAttribute('data-lon')}${radius === 25 ? '' : `&radius=${radius}`}`;
    const r = await api(page, `${base}/shelters?${q}`);
    const N = r.n_within_radius;
    if (N) {
        await expect(page.getByTestId('shelter-summary-count')).toContainText(`${N} public building${N === 1 ? '' : 's'} (`);
        await expect(page.getByTestId('shelter-summary-count')).toContainText(`within ${r.radius_km} km of this location.`);
        await expect(page.getByTestId('shelter-summary-split')).toHaveText(r.n_outside === 0
            ? (N === 1 ? 'It is inside an alert area.' : `All ${N} are inside an alert area.`)
            : r.n_inside === 0 ? (N === 1 ? 'It is outside all alert areas: listed below.' : `All ${N} are outside all alert areas: listed below.`)
                : `${r.n_outside} ${r.n_outside === 1 ? 'is' : 'are'} outside all alert areas: listed first below.`);
    }
    const out = page.getByTestId('shelter-outside-list').getByTestId('shelter-candidate');
    await expect(out).toHaveCount(r.candidates.length);
    for (const [i, c] of r.candidates.entries()) await expectCandidate(out.nth(i), c);
    expect(r.candidates.every((c) => c.outside_all_alerts)).toBe(true);
    const d = r.candidates.map((c) => c.distance_km);
    expect(d).toEqual([...d].sort((a, b) => a - b));
    if (r.none_outside_text) {
        await expect(page.getByTestId('shelter-none-outside')).toHaveText(`No public building within ${r.radius_km} km is outside the alert areas.`);
        await expect(page.getByTestId('shelter-widen')).toHaveCount(r.widen_radius_km ? 1 : 0);
    } else {
        await expect(page.getByTestId('shelter-none-outside')).toHaveCount(0);
    }
    // inside group: collapsed by default (no list, no hollow markers), then opened
    await expect(page.locator('.nowcast-shelter-marker.outside')).toHaveCount(r.candidates.length);
    if (r.n_inside) {
        const t = page.getByTestId('shelter-inside-toggle');
        await expect(t).toContainText(`Inside an alert area (${r.n_inside})`);
        await expect(t).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByTestId('shelter-inside-list')).toHaveCount(0);
        await expect(page.locator('.nowcast-shelter-marker.inside')).toHaveCount(0);
        await t.click();
        const ins = page.getByTestId('shelter-inside-list').getByTestId('shelter-candidate');
        await expect(ins).toHaveCount(r.inside_candidates.length);
        for (const [i, c] of r.inside_candidates.entries()) await expectCandidate(ins.nth(i), c);
        await expect(page.locator('.nowcast-shelter-marker.inside')).toHaveCount(r.inside_candidates.length);
        await t.click();
    }
    expect((await page.getByTestId('drawer-panel-shelter').innerText()).match(SAFE)).toBeNull();
    return r;
}

test('REF045: default point = alert peak nearest Pipalkoti; none outside within 25 km said plainly; widen to 50 km', async ({ page }) => {
    await openIssue(page, 'REF045');
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-wording')).toHaveText(WORDING);
    const dflt = await api(page, `issues/REF045/${ISSUES.REF045}/shelters/default-point`);
    await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-source', 'site');
    await expect(page.getByTestId('shelter-default-text')).toHaveText(dflt.text);
    expect(dflt.text).toContain('(Pipalkoti area)');
    await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-lat', dflt.lat.toFixed(4));
    const r = await expectMatchesApi(page, `issues/REF045/${ISSUES.REF045}`);
    expect(r.n_outside).toBe(0);
    await expect(page.getByTestId('shelter-none-outside')).toHaveText('No public building within 25 km is outside the alert areas.');
    await expect(page.getByTestId('shelter-widen')).toHaveText('Search up to 50 km');
    await page.getByTestId('shelter-widen').click();
    const w = await expectMatchesApi(page, `issues/REF045/${ISSUES.REF045}`, 50);
    expect(w.radius_km).toBe(50);
    expect(w.n_outside).toBeGreaterThan(0);
    await expect(page.getByTestId('shelter-widen')).toHaveCount(0);
    await expect(page.locator('.nowcast-shelter-radius')).toHaveCount(1);
});

test('REF051: default point = alert peak nearest Malana; outside candidates listed first', async ({ page }) => {
    await openIssue(page, 'REF051');
    await page.getByTestId('drawer-tab-shelter').click();
    const dflt = await api(page, `issues/REF051/${ISSUES.REF051}/shelters/default-point`);
    await expect(page.getByTestId('shelter-default-text')).toHaveText(dflt.text);
    expect(dflt.text).toContain('(Malana river)');
    const r = await expectMatchesApi(page, `issues/REF051/${ISSUES.REF051}`);
    expect(r.n_outside).toBeGreaterThan(0);
    await expect(page.getByTestId('shelter-outside-heading')).toBeVisible();
});

test('NDMA guidance line: the stored sentence verbatim, with its source link', async ({ page }) => {
    await openIssue(page, 'REF051');
    await page.getByTestId('drawer-tab-shelter').click();
    const a = page.getByTestId('shelter-advice');
    await expect(a).toContainText(`“${NDMA}”`);
    await expect(a).toContainText('“If a flood is likely to hit your area, you should:”');
    await expect(a).toContainText('checked 1 Oct 2026');
    await expect(page.getByTestId('shelter-advice-source')).toHaveAttribute('href', 'https://ndma.gov.in/index.php/floods-dos-donts');
});

test('selected alert and map click still choose the point; the section stays open', async ({ page }) => {
    await openIssue(page, 'REF045');
    await page.getByTestId('drawer-tab-alert').click();
    await page.getByTestId('alert-row').first().locator('button').first().click();
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-point')).toHaveAttribute('data-source', 'site');
    await page.getByTestId('shelter-use-alert').click();
    await expect(page.getByTestId('shelter-location-why')).toHaveText('Chosen: the peak of the selected alert');
    await expectMatchesApi(page, `issues/REF045/${ISSUES.REF045}`);
    const b = await page.locator('.leaflet-container').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'shelter');
    await expect(page.getByTestId('shelter-location-why')).toHaveText('Chosen: you clicked here');
    await expectMatchesApi(page, `issues/REF045/${ISSUES.REF045}`);
    await page.getByTestId('drawer-close').click();
    await expect(page.locator('.nowcast-shelter-marker')).toHaveCount(0);
    await expect(page.locator('.nowcast-shelter-point')).toHaveCount(0);
});

test('REF025: in-sample badge in the section', async ({ page }) => {
    await openIssue(page, 'REF025');
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-badge-in-sample')).toHaveText('IN-SAMPLE: training-period event, shown for illustration only');
});

test('Live: "not validated"; a point outside the two states -> "Not available for this area yet."', async ({ page }) => {
    await page.goto('/nowcast');
    await page.getByTestId('tab-live').click();
    await expect(page.getByTestId('lead-1')).toBeAttached({ timeout: 30_000 });
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-badge-live')).toContainText('Live output: not validated');
    await expect(page.getByTestId('shelter-point')).toHaveCount(0);                // no event site on Live
    const b = await page.locator('.leaflet-container').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height * 0.6);             // central India
    await expect(page.getByTestId('shelter-not-available')).toHaveText('Not available for this area yet.');
    await expect(page.getByTestId('shelter-candidate')).toHaveCount(0);
    await expect(page.locator('.nowcast-shelter-marker')).toHaveCount(0);
});

test('shelter options screenshots at 1920x1080 and 1366x768 (REF045 default + widened, REF051 default)', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const ep of ['REF045', 'REF051']) {
            await openIssue(page, ep);
            await page.getByTestId('drawer-tab-shelter').click();
            await expect(page.getByTestId('shelter-summary')).toBeVisible();
            await page.waitForTimeout(1200);
            await page.screenshot({ path: path.join(SHOTS, `shelters_${ep}_${w}x${h}.png`) });
            if (ep === 'REF045') {
                await page.getByTestId('shelter-widen').click();
                await expect(page.getByTestId('shelter-summary')).toContainText('within 50 km of this location');
                await page.waitForTimeout(1200);
                await page.screenshot({ path: path.join(SHOTS, `shelters_REF045_50km_${w}x${h}.png`) });
            }
        }
    }
});
