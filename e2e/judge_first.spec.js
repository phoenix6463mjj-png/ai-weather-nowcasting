// Judge-first pass: /nowcast explains itself without hiding any result.
//  1 opening view = REF051 (2024 test), the cloudburst Warning issued 15:00Z that IMERG confirmed, selected;
//    Pipalkoti one click away
//  2 IMERG wording (popups, Alert drawer, legend, Event check) + documented-site note
//  3 "Start here" (first visit, dismissible, reopens; storage failures tolerated)
//  4 Live "Data freshness" strip, thunderstorm layer on by default, link to the 26 Sep run
//  5 "All-India example" tab
//  6 typography (16 px body, nothing below 14 px in the drawer / Results / Approach), wider drawer >= 1600 px
// Every number on screen is compared with the ML API, whose own tests compare it with docs/ and models/v0.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();
const FIRST_VISIT = { storageState: { cookies: [], origins: [] } };
const CONFIRMED = 'Confirmed by IMERG satellite rain (≥30 mm/hr within r)';
const NOT_CONFIRMED = 'Not confirmed by IMERG satellite rain – counted as a false alarm in our scores.';
const SIZES = [[1920, 1080], [1366, 768]];

async function shot(page, name) {
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-pane img')].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const loaded = (page, key) => expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', key, { timeout: 60_000 });

// smallest computed font size (px) of the visible text in a container, ignoring elements matched by `skip`
async function minFont(locator, skip = '') {
    return locator.evaluate((root, skipSel) => {
        let min = Infinity;
        const walk = (el) => {
            if (skipSel && el.matches(skipSel)) return;
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            const r = el.getBoundingClientRect();
            if (own && r.width > 0 && r.height > 0 && !el.closest('svg')) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
            [...el.children].forEach(walk);
        };
        walk(root);
        return min;
    }, skip);
}

test.describe('first visit', () => {
    test.use(FIRST_VISIT);

    test('opens on REF051 with the IMERG-confirmed cloudburst Warning issued 15:00Z selected, Start here open', async ({ page }) => {
        const eps = await api(page, 'episodes');
        const st = eps.start;
        expect([st.episode, st.ts, st.hazard, st.level, st.imerg]).toEqual(['REF051', '20240731T1500Z', 'cloudburst', 'Warning', 'verified']);
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/nowcast');
        await loaded(page, `${st.episode}/${st.ts}`);
        await expect(page.getByTestId('start-here')).toBeVisible();
        await expect(page.getByTestId('case-study-badge')).toContainText(/2024/);
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
        const panel = page.getByTestId('explain-panel');
        await expect(panel).toHaveAttribute('data-hazard', 'cloudburst');
        await expect(panel).toContainText(st.alert_id);
        await expect(page.getByTestId('explain-verification')).toContainText(CONFIRMED);
        await expect(page.getByTestId(`lead-${st.lead}`)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('tab-replay')).toHaveClass(/border-blue-600/);
        // each size is a fresh first visit (the Layers panel and legend pick their default from the window size)
        for (const [w, h] of SIZES) {
            await page.evaluate(() => window.localStorage.clear());
            await page.setViewportSize({ width: w, height: h });
            await page.goto('/nowcast');
            await loaded(page, `${st.episode}/${st.ts}`);
            await expect(page.getByTestId('start-here')).toBeVisible();
            // below 1600 px the drawer waits (collapsed) while Start here is open (overview pass)
            if (w < 1600) await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', '');
            else await expect(page.getByTestId('explain-panel')).toContainText(st.alert_id);
            await shot(page, `judge_default_starthere_open_${w}x${h}`);
            await page.getByTestId('start-here-close').click();
            await expect(page.getByTestId('explain-panel')).toContainText(st.alert_id);
            await shot(page, `judge_default_starthere_closed_${w}x${h}`);
        }
    });

    test('Start here: 5 findings read from the API, case-study labels, jumps, dismiss + reopen, Esc', async ({ page }) => {
        const sh = await api(page, 'start-here');
        await page.goto('/nowcast');
        const box = page.getByTestId('start-here');
        await expect(box).toBeVisible();
        const ids = sh.findings.map((f) => f.id);
        expect(ids).toEqual(['malana', 'pipalkoti', 'csi', 'compute', 'insat']);
        for (const f of sh.findings) {
            const li = page.getByTestId(`finding-${f.id}`);
            await expect(li).toContainText(f.text);
            await expect(li.getByTestId('finding-case-study')).toHaveCount(f.case_study ? 1 : 0);
            expect(f.text).not.toMatch(/%/);
        }
        await expect(page.getByTestId('finding-malana')).toContainText('3 h before the reported event window');
        await expect(page.getByTestId('finding-pipalkoti')).toContainText('Watch 2.8 km from the site, 4.5 h before the reported time');
        await expect(page.getByTestId('finding-csi')).toContainText('15/15 lead × threshold cells on validation (2022–23) and 15/15 on the 2024 test');
        await expect(page.getByTestId('finding-compute')).toContainText('takes 14 s on a laptop CPU');
        // Pipalkoti jump: issue, lead and the Watch selected (Alert section)
        const p = sh.pipalkoti;
        await page.getByTestId('finding-go-pipalkoti').click();
        await expect(box).toHaveCount(0);
        await loaded(page, `${p.episode}/${p.ts}`);
        await expect(page.getByTestId('explain-panel')).toContainText(p.alert_id);
        await expect(page.getByTestId('explain-verification')).toHaveText(NOT_CONFIRMED);
        // dismissed: stays closed after reload, the header button reopens it
        await page.reload();
        await loaded(page, `${sh.start.episode}/${sh.start.ts}`);
        await expect(page.getByTestId('start-here')).toHaveCount(0);
        await page.getByTestId('start-here-open').click();
        await expect(page.getByTestId('start-here')).toBeVisible();
        // Esc closes Start here only (the Alert drawer stays open)
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('start-here')).toHaveCount(0);
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
        // page jumps: Results CSI section, Approach compute + INSAT lines
        for (const [id, url, target] of [['csi', /\/nowcast\/results#csi-section$/, 'csi-section'],
            ['compute', /\/nowcast\/approach#approach-compute-latency$/, 'approach-compute-latency'],
            ['insat', /\/nowcast\/approach#approach-insat-latency$/, 'approach-insat-latency']]) {
            await page.goto('/nowcast');
            await page.getByTestId('start-here-open').click();
            await page.getByTestId(`finding-go-${id}`).click();
            await expect(page).toHaveURL(url);
            await expect(page.getByTestId(target)).toBeInViewport();
            await expect(page.getByTestId(target)).toHaveAttribute('data-target', 'true');
        }
        await expect(page.getByTestId('approach-insat-latency')).toContainText(`median ${sh.findings[4].numbers.median_min} min`);
    });

    test('Start here works when browser storage throws (shown, closable, page intact)', async ({ page }) => {
        await page.addInitScript(() => {
            const boom = () => { throw new Error('storage blocked'); };
            Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
        });
        await page.goto('/nowcast');
        await expect(page.getByTestId('start-here')).toBeVisible();
        await page.getByTestId('start-here-close').click();
        await expect(page.getByTestId('start-here')).toHaveCount(0);
        await expect(page.getByTestId('explain-panel')).toBeVisible();
    });
});

test('Pipalkoti one click away; Alert drawer: wording + documented-site note (screenshots)', async ({ page }) => {
    const sh = await api(page, 'start-here');
    const p = sh.pipalkoti;
    const d = await api(page, `issues/${p.episode}/${p.ts}/alerts/${p.alert_id}`);
    await page.goto('/nowcast');
    await loaded(page, `${sh.start.episode}/${sh.start.ts}`);
    await expect(page.getByTestId('case-link')).toHaveText('Pipalkoti case (2023 validation) →');
    await page.getByTestId('case-link').click();
    await loaded(page, `${p.episode}/${p.ts}`);
    await expect(page.getByTestId('case-link')).toHaveText('Malana case (2024 test) →');
    await expect(page.getByTestId('explain-panel')).toContainText(p.alert_id);
    await expect(page.getByTestId('explain-verification')).toHaveText(NOT_CONFIRMED);
    await expect(page.getByTestId('explain-site-note')).toHaveText(d.site_note.text);
    await expect(page.getByTestId('explain-site-note')).toContainText('occurred inside this alert area, 2.8 km from its peak');
    await expect(page.getByTestId('explain-site-note')).toContainText(sh.under_report);
    await expect(page.locator('body')).not.toContainText('not verified (false alarm)');
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/nowcast?ep=${p.episode}&ts=${p.ts}`);
        await loaded(page, `${p.episode}/${p.ts}`);
        // open the Watch from the alert list (Watch alerts are shown with "Also show Watch")
        if ((await page.getByTestId('layers-panel').getAttribute('data-open')) === 'false') await page.getByTestId('layers-toggle').click();
        await page.getByTestId(`lead-${p.lead}`).click();
        await page.getByTestId('watch-toggle').check();
        if (w < 1600) await page.getByTestId('layers-toggle').click();
        if ((await page.getByTestId('drawer').getAttribute('data-open')) !== 'alert') await page.getByTestId('drawer-tab-alert').click();
        await page.locator(`[data-alert-id="${p.alert_id}"]`).click();
        await expect(page.getByTestId('explain-site-note')).toHaveText(d.site_note.text);
        await shot(page, `judge_alert_pipalkoti_watch_${w}x${h}`);
    }
});

test('map popup, legend and Event check use the IMERG wording; site note only near a documented site', async ({ page }) => {
    const sh = await api(page, 'start-here');
    const st = sh.start;
    const al = (await api(page, `issues/${st.episode}/${st.ts}/ui-alerts?level=all`)).alerts;
    expect(al.filter((a) => a.verification.status === 'verified').every((a) => a.verification.text === CONFIRMED)).toBe(true);
    expect(al.filter((a) => a.verification.status === 'false_alarm').every((a) => a.verification.text === NOT_CONFIRMED)).toBe(true);
    for (const a of al.filter((x) => x.site_note)) expect(a.site_note.inside || a.site_note.km <= 25).toBe(true);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/nowcast');
    await loaded(page, `${st.episode}/${st.ts}`);
    const legend = page.getByTestId('map-legend');
    await expect(legend.getByTestId('legend-verified')).toHaveText(CONFIRMED);
    await expect(legend.getByTestId('legend-false-alarm')).toHaveText(NOT_CONFIRMED);
    await expect(legend.getByTestId('legend-under-report')).toHaveText(sh.under_report);
    // popup of the selected (default) alert: hover its outline
    const sel = al.find((a) => a.alert_id === st.alert_id);
    expect(sel.site_note).toBeTruthy();
    const poly = page.locator(`path.nowcast-alert-poly.hazard-cloudburst.level-Warning`).first();
    await poly.hover({ force: true });
    const tip = page.getByTestId('alert-tooltip').first();
    await expect(tip).toBeVisible();
    // UX review: the map tooltip is 2 short lines (hazard, level, value; lead); the IMERG wording is in the drawer
    await expect(tip).toContainText(/(Thunderstorm|Cloudburst|Flash flood) (Warning|Watch) · .*lead/);
    await expect(tip).not.toContainText('IMERG');
    await expect(page.getByTestId('explain-verification')).toContainText(/Confirmed by IMERG|Not confirmed by IMERG/);
    await shot(page, 'judge_popup_1920x1080');
    // Event check: short chips + the under-reporting line
    await page.getByTestId('drawer-tab-event').click();
    const ev = page.getByTestId('event-check-panel');
    await expect(page.getByTestId('event-under-report')).toHaveText(sh.under_report);
    await expect(ev.getByTestId('event-imerg').first()).toContainText(/IMERG: (confirmed|not confirmed) by IMERG/);
    await expect(ev).not.toContainText('false alarm)');
    await expect(page.getByTestId('event-rules')).toContainText('counts as a false alarm in our scores');
});

test('Live: Data freshness strip (values from the API), thunderstorm layer on, link to the 26 Sep run', async ({ page }) => {
    const runs = (await api(page, 'live')).runs;
    const [newest, older] = runs;
    const meta = await api(page, `live/${newest.run}/meta`);
    const ins = await api(page, 'live-insat');
    const comp = (await api(page, 'compute-latency')).compute;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/nowcast?view=live');
    const strip = page.getByTestId('freshness-strip');
    // the freshness strip sits in the Live status line's details (one compact line per view, overview pass)
    await page.getByTestId('live-not-validated').getByTestId('status-info').click();
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('fresh-imerg')).toContainText(`${(meta.latency_min.imerg / 60).toFixed(1)} h old`);
    await expect(page.getByTestId('fresh-gfs')).toContainText(`${(meta.latency_min.gfs / 60).toFixed(1)} h old`);
    for (const s of ins.by_satellite) {
        await expect(page.getByTestId(`fresh-insat-${s.satellite}`)).toContainText(s.newest ? s.text.split(', ').pop() : s.text.split(': ').pop());
    }
    await expect(page.getByTestId('fresh-compute')).toContainText(`${Math.round(comp.pipeline_seconds.median)} s per all-India run`);
    await expect(strip).not.toContainText('%');
    await expect(page.locator('img.nowcast-raster.field-thunderstorm')).toHaveCount(1);
    await expect(page.getByTestId('live-not-validated')).toContainText('NOT validated');
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast?view=live');
        await page.getByTestId('live-not-validated').getByTestId('status-info').click();
        await expect(page.getByTestId('fresh-compute')).toBeVisible({ timeout: 30_000 });
        await shot(page, `judge_live_freshness_${w}x${h}`);
    }
    const link = page.getByTestId('live-other-run');
    await expect(link).toHaveText(`See the 26 Sep run (${older.n_alerts} alerts)`);
    expect(older.n_alerts).toBe(8);
    await link.click();
    await expect(page.getByTestId('layers-summary')).toContainText(`Live ${older.run}`);
    await expect(page.getByTestId('live-other-run')).toHaveText(`Back to the newest run: ${new Date(newest.issue_time).getUTCDate()} Oct run (0 alerts)`);
    await page.getByTestId('live-other-run').click();
    await expect(page.getByTestId('layers-summary')).toContainText(`Live ${newest.run}`);
});

test('All-India example tab: renamed, subtitle with time and source read from the data', async ({ page }) => {
    const m = await api(page, 'india/meta');
    await page.goto('/nowcast');
    await expect(page.getByTestId('tab-india')).toHaveText('All-India example');
    await page.getByTestId('tab-india').click();
    const sub = page.getByTestId('india-subtitle');
    const d = new Date(m.issue_time);
    // plain words, no internal IDs (overview pass); the period is read from the input note
    await expect(sub).toContainText(new RegExp(`^All of India at one past time: ${d.getUTCDate()} Sept? ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`));
    const note = m.notes.find((n) => n.startsWith('Input frames come from'));
    expect(note).toContain('(a 2024 test-period episode)');
    await expect(sub).toContainText('(2024 test period). Probability map only, not live.');
    await expect(sub).not.toContainText('REF0');
    await expect(page.locator('body')).not.toContainText('National sample');
});

test('typography: drawer sections and Results/Approach >= 14 px, body 16 px; wider drawer >= 1600 px; fits 1366x768', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/nowcast');
    const sh = await api(page, 'start-here');
    await loaded(page, `${sh.start.episode}/${sh.start.ts}`);
    await expect(page.locator('[data-testid="drawer-panel-alert"]')).toHaveAttribute('data-width', '525');
    const sections = ['alert', 'ingredients', 'event', 'shelter', 'caveats'];
    for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast');
        await loaded(page, `${sh.start.episode}/${sh.start.ts}`);
        for (const s of sections) {
            if ((await page.getByTestId('drawer').getAttribute('data-open')) !== s) await page.getByTestId(`drawer-tab-${s}`).click();
            const panel = page.getByTestId(`drawer-panel-${s}`);
            await expect(panel).toBeVisible();
            await page.waitForTimeout(s === 'shelter' ? 1500 : 400);
            // the inline licence credits (Nominatim next to the place search) are credit-sized (13 px)
            expect(await minFont(panel, '[data-testid="nominatim-credit"]'), `${s} at ${w}`).toBeGreaterThanOrEqual(15);
            // the map keeps the main share of the width
            const mapBox = await page.locator('.leaflet-container').boundingBox();
            const pBox = await panel.boundingBox();
            expect(mapBox.width, `${s} map width at ${w}`).toBeGreaterThan(pBox.width * (s === 'event' ? 0.6 : 1));
            expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(pBox.x + 1);                      // no overlap
            await shot(page, `judge_drawer_${s}_${w}x${h}`);
        }
        if (w === 1366) await expect(page.locator('[data-testid="drawer-panel-caveats"]')).toHaveAttribute('data-width', '420');
    }
    // CAP review sits in the Alert section: open it on the default alert
    await page.setViewportSize({ width: 1920, height: 1080 });
    if ((await page.getByTestId('drawer').getAttribute('data-open')) !== 'alert') await page.getByTestId('drawer-tab-alert').click();
    const body = await page.getByTestId('explain-panel').locator('p').filter({ hasText: 'Confirmed = at least one IMERG cell' }).evaluate((e) => getComputedStyle(e).fontSize);
    expect(body).toBe('17px');                                    // site-wide type scale (overview pass)
    for (const [route, testid] of [['/nowcast/results', 'results-page'], ['/nowcast/approach', 'approach-page']]) {
        for (const [w, h] of SIZES) {
            await page.setViewportSize({ width: w, height: h });
            await page.goto(route);
            await expect(page.getByTestId(testid).locator('main')).toBeVisible();
            await page.waitForTimeout(1200);
            expect(await minFont(page.getByTestId(testid).locator('main')), `${route} at ${w}`).toBeGreaterThanOrEqual(15);
            await page.screenshot({ path: path.join(SHOTS, `judge_${route.split('/').pop()}_${w}x${h}.png`) });
        }
    }
});

test('Start here at 1366x768 does not cover the Layers panel or the drawer', async ({ browser }) => {
    const ctx = await browser.newContext({ ...FIRST_VISIT, viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto('/nowcast');
    const sh = await api(page, 'start-here');
    await loaded(page, `${sh.start.episode}/${sh.start.ts}`);
    const a = await page.getByTestId('start-here').boundingBox();
    const d = await page.getByTestId('drawer').boundingBox();
    const l = await page.getByTestId('layers-panel').boundingBox();
    expect(a.x + a.width).toBeLessThanOrEqual(d.x);
    expect(a.y + a.height).toBeLessThanOrEqual(768);
    const overlapX = a.x < l.x + l.width && l.x < a.x + a.width;
    const overlapY = a.y < l.y + l.height && l.y < a.y + a.height;
    expect(overlapX && overlapY).toBe(false);
    await ctx.close();
});
