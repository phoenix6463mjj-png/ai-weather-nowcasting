// Analytics = "Nowcast analytics (ML model)": numbers equal the ML API's (Live, National, REF045); the lead
// slider and every chip update all four sections; tiles and thumbnail open ML Nowcast at that view; sentences
// come from the data (same pure functions, utils/nowcastAnalytics.js); no % for cloudburst / flash flood;
// no horizontal scroll at 390 px; tooltips reachable by keyboard.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tileStats, areaByLead, sentenceWarning, sentenceLeads, sentenceNoAlertsRun, fmtAreaText, LEADS, HAZARD_IDS, LEVELS } from '../frontend/frontend-react/src/utils/nowcastAnalytics.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();

async function setLead(page, L) {
    await page.getByTestId('analytics-lead-slider').fill(String(LEADS.indexOf(L)));
    await expect(page.getByTestId('analytics-lead')).toHaveText(`+${L} h`);
}

async function source(page, label) {
    const sel = page.getByTestId('analytics-source');
    await expect(sel.locator('option', { hasText: label })).toHaveCount(1, { timeout: 30_000 });      // options loaded
    const opts = await sel.locator('option').allInnerTexts();
    const v = await sel.locator('option').nth(opts.findIndex((o) => o.includes(label))).getAttribute('value');
    await sel.selectOption(v);
}

async function expectSection1(page, alerts, L, hazards = HAZARD_IDS, levels = LEVELS) {
    const st = tileStats(alerts, L, hazards, levels);
    for (const h of HAZARD_IDS) {
        const t = page.locator(`[data-testid="hazard-tile"][data-hazard="${h}"]`);
        // independent count from the raw API alerts
        const raw = alerts.filter((a) => a.lead_time_h === L && a.hazard === h && levels.includes(a.level));
        expect(st[h].n).toBe(raw.length);
        await expect(t).toHaveAttribute('data-n', String(raw.length));
        await expect(t).toHaveAttribute('data-area', String(Math.round(raw.reduce((s, a) => s + a.area_km2, 0))));
    }
    await expect(page.getByTestId('analytics-s1-sentence')).toHaveText(sentenceWarning(st, L, hazards, levels));
    await expect(page.getByTestId('analytics-s2-sentence')).toHaveText(sentenceLeads(areaByLead(alerts, hazards, levels)));
    return st;
}

test('REF045: tiles, sentences and the area chart equal the API; sections 3 and 4 from /analytics', async ({ page }) => {
    const eps = await api(page, 'episodes');
    const ts = eps.default.ts;
    const alerts = (await api(page, `issues/REF045/${ts}/ui-alerts?level=all`)).alerts;
    const doc = await api(page, 'analytics');
    await page.goto('/analytics');
    await expect(page.locator('main h1')).toHaveText('Nowcast analytics (ML model)');
    await source(page, 'REF045');
    await setLead(page, 4);
    await expectSection1(page, alerts, 4);
    for (const L of LEADS) {
        for (const h of HAZARD_IDS) {
            const a = alerts.filter((x) => x.lead_time_h === L && x.hazard === h).reduce((s, x) => s + x.area_km2, 0);
            await expect(page.locator(`[data-testid="area-bar"][data-lead="${L}"][data-hazard="${h}"]`)).toHaveCount(a > 0 ? 1 : 0);
        }
    }
    await expect(page.getByTestId('analytics-s3-sentence')).toHaveText(doc.attribution.sentence);
    await expect(page.getByTestId('analytics-s4-sentence')).toHaveText(doc.skill.sentence);
    for (const r of doc.skill.rows) {
        await expect(page.locator(`[data-testid="skill-point"][data-line="model"][data-lead="${r.lead}"]`)).toHaveAttribute('data-csi', String(r.model));
    }
    const seg = page.locator('[data-testid="attr-seg"][data-lead="6"][data-group="moisture"]');
    await expect(seg).toHaveAttribute('data-share', String(doc.attribution.per_lead['6'].shares.moisture));
    // Known weaknesses: collapsed by default, quoted
    const w = page.getByTestId('analytics-weaknesses');
    await expect(w).not.toHaveAttribute('open', '');
    await w.locator('summary').click();
    await expect(page.getByTestId('weakness')).toHaveCount(doc.weaknesses.length);
    await expect(w).toContainText('in 7 of 15 cells');
});

test('Live and National: numbers from the API; the national sample says it has no alerts', async ({ page }) => {
    const run = (await api(page, 'live')).runs[0].run;
    const alerts = (await api(page, `live/${run}/ui-alerts?level=all`)).alerts;
    await page.goto('/analytics');
    const meta = await api(page, `live/${run}/meta`);
    await source(page, 'Live run');
    await expect(page.getByTestId('analytics-badge')).toContainText('Not validated');
    for (const L of [1, 6]) {
        await setLead(page, L);
        if (alerts.length) {
            await expectSection1(page, alerts, L);
            continue;
        }
        // a run with no alerts at any lead: the run-level line (number from the run's rasters), no empty chart
        const s1 = sentenceNoAlertsRun(meta, L);
        expect(s1).toBe(meta.thunderstorm_max.lead === L ? meta.no_alert_text
            : `${meta.no_alert_text} At +${L} h the highest thunderstorm probability is ${meta.thunderstorm_max.per_lead_text[L]}.`);
        await expect(page.getByTestId('analytics-s1-sentence')).toHaveText(s1);
        await expect(page.getByTestId('analytics-s2-sentence')).toHaveText('No alerts at any lead in this run, so there is no alert area to compare.');
        await expect(page.locator('[data-testid="area-bar"]')).toHaveCount(0);
        await expect(page.getByTestId('analytics-s2').locator('svg')).toHaveCount(0);
        for (const h of HAZARD_IDS) await expect(page.locator(`[data-testid="hazard-tile"][data-hazard="${h}"]`)).toHaveAttribute('data-n', '0');
        await expect(page.getByTestId('analytics-thumbnail')).toBeVisible();
        expect(await page.locator('main').innerText()).not.toMatch(/\bsafe\b/i);
    }
    await source(page, 'National sample');
    await expect(page.getByTestId('analytics-s1-sentence')).toHaveText(
        'The national sample has probability maps only: no alerts are produced (absence of alerts does not mean no risk).');
    await expect(page.locator('[data-testid="hazard-tile"]').first()).toContainText('—');
    await expect(page.getByTestId('analytics-thumbnail').locator('image')).toHaveAttribute('href', /\/india\/map\/6\/thunderstorm\.png$/);
});

test('the lead slider, play and every chip update all four sections', async ({ page }) => {
    const eps = await api(page, 'episodes');
    const alerts = (await api(page, `issues/REF045/${eps.default.ts}/ui-alerts?level=all`)).alerts;
    await page.goto('/analytics');
    await source(page, 'REF045');
    await setLead(page, 2);
    const snap = async () => Promise.all(['analytics-s1-sentence', 'area-chart-info', 'attribution-info', 'skill-info',
        'attribution-applies', 'attribution-levels', 'skill-caption'].map((id) => page.getByTestId(id).innerText()));
    const a = await snap();
    await setLead(page, 6);
    const b = await snap();
    for (const i of [0, 1, 2, 3]) expect(b[i], `section ${i + 1} follows the lead`).not.toBe(a[i]);
    expect(b[2]).toContain('+6 h');
    expect(b[3]).toContain('+6 h');
    await expectSection1(page, alerts, 6);
    // hazard chip: sections 1-2 (counts, bars) and 3-4 (captions)
    await page.getByTestId('chip-thunderstorm').click();
    const hz = ['cloudburst', 'flash_flood'];
    await expectSection1(page, alerts, 6, hz);
    await expect(page.locator('[data-testid="area-bar"][data-hazard="thunderstorm"]')).toHaveCount(0);
    const c = await snap();
    expect(c[4]).not.toBe(b[4]);
    expect(c[6]).not.toBe(b[6]);
    // level chip
    await page.getByTestId('chip-Watch').click();
    await expectSection1(page, alerts, 6, hz, ['Warning']);
    const d = await snap();
    expect(d[5]).not.toBe(c[5]);
    expect(d[6]).not.toBe(c[6]);
    // play steps through the leads
    await setLead(page, 1);
    await page.getByTestId('analytics-play').click();
    await expect(page.getByTestId('analytics-lead')).toHaveText('+2 h', { timeout: 5000 });
    await page.getByTestId('analytics-play').click();
});

test('a tile and the thumbnail open ML Nowcast at that source, lead and hazard', async ({ page }) => {
    const eps = await api(page, 'episodes');
    await page.goto('/analytics');
    await source(page, 'REF045');
    await setLead(page, 4);
    await page.locator('[data-testid="hazard-tile"][data-hazard="cloudburst"]').click();
    await expect(page).toHaveURL(new RegExp(`/nowcast\\?ep=REF045&ts=${eps.default.ts}&lead=4&hazard=cloudburst&watch=1`));
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `REF045/${eps.default.ts}`, { timeout: 30_000 });
    await expect(page.getByTestId('lead-4')).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/analytics');
    await source(page, 'Live run');
    await setLead(page, 2);
    await page.getByTestId('analytics-thumbnail').click();
    const liveRun = (await api(page, 'live')).runs[0].run;
    await expect(page).toHaveURL(new RegExp(`/nowcast\\?view=live&run=${liveRun}&lead=2&hazard=thunderstorm&watch=1`));
    await expect(page.getByTestId('live-not-validated')).toBeVisible();
    await expect(page.getByTestId('lead-2')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
});

test('no % for cloudburst / flash flood; keyboard tooltip; no horizontal scroll at 390 px', async ({ page }) => {
    await page.goto('/analytics');
    await source(page, 'REF045');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/(cloudburst|flash[ -]flood)[^.\n]{0,30}\d+\s*%/i);
    await page.getByTestId('term-CSI').first().focus();
    await expect(page.locator('#term-CSI').first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
});

test('Analytics screenshots: Live and REF051 at 1920x1080, 1366x768 and 390 px', async ({ page }) => {
    test.setTimeout(180_000);
    for (const [w, h] of [[1920, 1080], [1366, 768], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const [label, name] of [['Live run', 'live'], ['REF051', 'REF051']]) {
            await page.goto('/analytics');
            await source(page, label);
            await setLead(page, 4);
            await page.waitForTimeout(900);
            await page.screenshot({ path: path.join(SHOTS, `analytics_${name}_${w}x${h}.png`), fullPage: w === 390 });
            if (w !== 390) {
                await page.getByTestId('analytics-s3').scrollIntoViewIfNeeded();
                await page.waitForTimeout(400);
                await page.screenshot({ path: path.join(SHOTS, `analytics_${name}_s3s4_${w}x${h}.png`) });
            }
        }
    }
});
