// Overview ("/" System briefing), navigation, site-wide type scale, declutter.
//  - every number on the Overview = /ml/overview (whose serve tests compare it with docs/ and models/v0)
//  - each step shows its map layer; step dots and keyboard arrows; reduced motion (no autoplay)
//  - nav + deep links survive a refresh; old Dashboard links go to /dashboard
//  - no visible text below 15 px outside the credits (footer, map attribution, inline licence credits)
//  - no horizontal scroll at 390 px; credits order (OpenWeather primary, Open-Meteo fallback)
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();
const CREDIT_SEL = '[data-testid="data-credits"], .leaflet-control-attribution, [data-testid="openweather-credit"], [data-testid="open-meteo-credit"], [data-testid="nominatim-credit"]';
const MIN_PX = 15;

async function shot(page, name) {
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-pane img, main img')].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// visible text smaller than MIN_PX (HTML: computed size; SVG: size x the SVG's on-screen scale), credits skipped
async function smallText(page) {
    return page.evaluate(([skipSel, minPx]) => {
        const out = [];
        const walk = (el) => {
            if (el.matches(skipSel)) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
            const r = el.getBoundingClientRect();
            if (own && r.width > 1 && r.height > 1) {
                let px = parseFloat(cs.fontSize);
                const svg = el.closest('svg');
                if (svg && svg.getScreenCTM()) px *= svg.getScreenCTM().a;
                if (px < minPx - 0.1) out.push(`${px.toFixed(1)}px: ${own.slice(0, 60)}`);
            }
            [...el.children].forEach(walk);
        };
        walk(document.body);
        return out;
    }, [CREDIT_SEL, MIN_PX]);
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1
    && [...document.querySelectorAll('main, [data-testid="overview-scroller"]')].every((m) => m.scrollWidth <= m.clientWidth + 1));

async function openOverview(page) {
    const resp = page.waitForResponse((r) => r.url().endsWith('/ml/overview') && r.ok());
    await page.goto('/');
    const d = await (await resp).json();
    await expect(page.getByTestId('ov-text-2')).toContainText('mm/hr');
    return d;
}

const goStep = async (page, n) => {
    await page.getByTestId(`ov-dot-${n}`).click();
    await expect(page.getByTestId('briefing-map')).toHaveAttribute('data-step', String(n));
};

test('Overview: heading, headline, skip button, disclaimer; every number = /ml/overview', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const d = await openOverview(page);
    await expect(page.getByTestId('overview-heading')).toHaveText('System briefing');
    await expect(page.getByTestId('overview-skip')).toHaveAttribute('href', '/nowcast');
    await expect(page.getByTestId('overview-skip')).toContainText('Skip the briefing');
    await expect(page.getByTestId('overview-disclaimer')).toHaveText('Not an official warning. Follow IMD and state advisories.');
    await expect(page.getByTestId('ov-text-1')).toContainText(`${d.sites.length} documented`);
    await expect(page.getByTestId('ov-median')).toHaveText(`${d.imerg.median_mmhr} mm/hr`);
    await expect(page.getByTestId('ov-ge30')).toHaveText(`${d.imerg.n_ge30} of ${d.imerg.n}`);
    expect([d.imerg.median_mmhr, d.imerg.n_ge30, d.imerg.n]).toEqual([17.6, 6, 24]);
    const [tsW, cbW] = d.malana.warnings;
    await expect(page.getByTestId('ov-text-3')).toContainText(`Warning at ${tsW.issue_time.slice(11, 16)}Z`);
    await expect(page.getByTestId('ov-text-3')).toContainText(`cloudburst Warning at ${cbW.issue_time.slice(11, 16)}Z`);
    await expect(page.getByTestId('ov-hours-before')).toHaveText(`${cbW.hours_of_warning} h`);
    await expect(page.getByTestId('ov-insat-floor')).toHaveText(d.insat.floor_label);
    await expect(page.getByTestId('ov-csi-cells')).toHaveText(`higher CSI in ${d.csi.better}/${d.csi.cells} cells`);
    await expect(page.getByTestId('ov-arith-label')).toHaveText('arithmetic, not a demonstrated result');
    await expect(page.getByTestId('ov-text-7')).toContainText(`≈ ${d.realtime.arithmetic.real_warning_imerg_h} h`);
    // step 5's small multiples
    const ev = page.getByTestId('ov-insat-event');
    await expect(ev).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
        await expect(ev.nth(i).getByTestId('ov-ev-imerg')).toHaveText(`${d.insat.events[i].imerg_peak_mmhr} mm/hr`);
        await expect(ev.nth(i).getByTestId('ov-ev-cold')).toHaveText(`${d.insat.events[i].coldest_top_k} K`);
    }
    await expect(page.getByTestId('ov-insat-caption')).toHaveText('Three case studies, not a general result. Observation only, not a model input.');
    // case studies labelled, no "safe" wording, no internal IDs
    await expect(page.getByTestId('ov-step-3')).toContainText(d.malana.case_label);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\bsafe\b/i);
    expect(text).not.toMatch(/\bREF\d{3}\b/);
});

test('Overview: each step shows its layer (dots), arrows move steps, scrubber reaches the IMERG layer', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const d = await openOverview(page);
    const layers = page.getByTestId('briefing-layers');
    await goStep(page, 1);
    await expect(layers).toHaveText('terrain, sites');
    await expect(page.locator('.leaflet-overlay-pane path.leaflet-interactive')).toHaveCount(d.sites.length);
    await goStep(page, 2);
    await expect(layers).toHaveText('terrain, sites-sized-by-imerg');
    // step 3 auto-plays to IMERG's first >= 30 mm/hr
    await goStep(page, 3);
    await expect(page.getByTestId('ov-cap-imerg')).toHaveAttribute('data-shown', 'true', { timeout: 20_000 });
    await expect(layers).toHaveText('terrain-malana, site-malana, thunderstorm-warning, cloudburst-warning, imerg-ge30');
    await expect(page.locator(`.leaflet-overlay-pane img[src*="${d.malana.imerg_layer.path}"]`)).toHaveCount(1);
    await expect(page.getByTestId('ov-cap-window')).toHaveText(`${d.malana.window_start.slice(11, 16)}Z · reported window starts`);
    await expect(page.getByTestId('ov-cap-imerg')).toHaveText(`${d.malana.imerg_first_ge30.t.slice(11, 16)}Z · satellite rain first ≥30 mm/hr`);
    await shot(page, 'overview_step3_end_1920x1080');
    // keyboard: arrows move one step
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('briefing-map')).toHaveAttribute('data-step', '4');
    await expect(page.getByTestId('ov-reason')).toHaveCount(d.explain.reasons.length);
    for (let i = 0; i < d.explain.reasons.length; i += 1) await expect(page.getByTestId('ov-reason').nth(i)).toContainText(d.explain.reasons[i].text);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('briefing-map')).toHaveAttribute('data-step', '5');
    await expect(page.locator(`.leaflet-overlay-pane img[src*="${d.insat.path}"]`)).toHaveCount(1);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('briefing-map')).toHaveAttribute('data-step', '4');
    await goStep(page, 6);
    await expect(page.getByTestId('ov-csi-plot').locator('[data-series="model"] circle')).toHaveCount(d.csi.leads.length);
    await expect(page.getByTestId('ov-known-limits')).toHaveAttribute('href', '/nowcast/results#limitations');
    await goStep(page, 7);
    await expect(page.getByTestId('ov-fresh-imerg')).toContainText(`${d.realtime.bars[0].minutes} min`);
    await expect(page.getByTestId('ov-fresh-insat')).toContainText(`${d.realtime.bars[1].minutes} min`);
    await expect(page.getByTestId('ov-fresh-compute')).toContainText(`${Math.round(d.realtime.bars[2].seconds)} s`);
    if (d.realtime.snapshots.length) await expect(page.locator(`.leaflet-overlay-pane img[src*="${d.realtime.snapshots[0].path}"]`)).toHaveCount(1);
    await goStep(page, 8);
    for (const c of d.explore) await expect(page.getByTestId(`ov-card-${c.id}`)).toHaveAttribute('href', c.to);
});

test('Overview: later steps load their images only when reached', async ({ page }) => {
    const seen = [];
    page.on('request', (r) => seen.push(r.url()));
    await page.setViewportSize({ width: 1920, height: 1080 });
    const d = await openOverview(page);
    expect(seen.some((u) => u.includes(d.insat.path))).toBe(false);
    expect(seen.some((u) => u.includes(d.malana.imerg_layer.path))).toBe(false);
    await goStep(page, 5);
    await expect.poll(() => seen.some((u) => u.includes(d.insat.path))).toBe(true);
});

test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('no autoplay: step 3 shows its final state at once, steps switch without animation', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        const d = await openOverview(page);
        await expect(page.getByTestId('overview-page')).toHaveAttribute('data-reduced-motion', 'true');
        await goStep(page, 3);
        await expect(page.getByTestId('ov-play')).toHaveAttribute('aria-label', 'Play');
        await expect(page.getByTestId('ov-scrub-time')).toHaveText(`${d.malana.imerg_first_ge30.t.slice(11, 16)}Z`);
        await expect(page.getByTestId('ov-step-3')).not.toHaveClass(/transition/);
    });
});

test('Overview screenshots: every step at 1920x1080 and 390 px; no horizontal scroll at 390', async ({ page }) => {
    test.setTimeout(300_000);
    for (const [w, h] of [[1920, 1080], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h });
        await openOverview(page);
        for (let n = 1; n <= 8; n += 1) {
            await goStep(page, n);
            if (n === 3) await expect(page.getByTestId('ov-cap-imerg')).toHaveAttribute('data-shown', 'true', { timeout: 20_000 });
            await page.waitForTimeout(1300);                       // the map's fly animation
            expect(await noHScroll(page), `step ${n} at ${w}`).toBe(true);
            await shot(page, `overview_step${n}_${w}x${h}`);
        }
    }
});

const PAGES = [
    ['/', 'overview-page'],
    ['/nowcast', 'replay-view'],
    ['/nowcast/results', 'results-page'],
    ['/nowcast/approach', 'approach-page'],
    ['/analytics', 'analytics-page'],
];

test('no horizontal scroll at 390 px on the ML pages', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [url, id] of PAGES) {
        await page.goto(url);
        await expect(page.getByTestId(id).first()).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(500);
        await shot(page, `overview_390_${url.replace(/\//g, '_') || 'root'}`);
        expect(await noHScroll(page), url).toBe(true);
    }
});

test('type scale: no visible text below 15 px outside the credits (/, /nowcast + drawer, Results, Approach, Analytics)', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const [url, id] of PAGES) {
            await page.goto(url);
            await expect(page.getByTestId(id).first()).toBeVisible({ timeout: 60_000 });
            await page.waitForTimeout(800);
            expect(await smallText(page), `${url} at ${w}`).toEqual([]);
        }
        // /nowcast drawer sections, one at a time
        await page.goto('/nowcast');
        await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', /REF051/, { timeout: 60_000 });
        for (const s of ['alert', 'ingredients', 'event', 'shelter', 'caveats']) {
            if ((await page.getByTestId('drawer').getAttribute('data-open')) !== s) await page.getByTestId(`drawer-tab-${s}`).click();
            await page.waitForTimeout(s === 'shelter' ? 2500 : 600);
            expect(await smallText(page), `/nowcast drawer ${s} at ${w}`).toEqual([]);
        }
        // the layers panel and legend open
        if ((await page.getByTestId('layers-panel').getAttribute('data-open')) === 'false') await page.getByTestId('layers-toggle').click();
        expect(await smallText(page), `/nowcast layers at ${w}`).toEqual([]);
    }
});

test('/nowcast at 1920 and 1366: drawer open, map keeps >= 70 % uncovered; layers + legend collapsed at 1366', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast');
        await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', /REF051/, { timeout: 60_000 });
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
        await expect(page.getByTestId('layers-panel')).toHaveAttribute('data-open', String(w >= 1600));
        // one status line (no stacked banners)
        await expect(page.getByTestId('map-badges')).toHaveCount(1);
        const map = await page.locator('.leaflet-container').boundingBox();
        const covered = await page.evaluate(() => {
            const m = document.querySelector('.leaflet-container').getBoundingClientRect();
            const sel = '[data-testid="layers-panel"], [data-testid="map-legend"], [data-testid="start-here"]';
            return [...document.querySelectorAll(sel)].reduce((a, el) => {
                const r = el.getBoundingClientRect();
                const x = Math.max(0, Math.min(r.right, m.right) - Math.max(r.left, m.left));
                const y = Math.max(0, Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top));
                return a + x * y;
            }, 0);
        });
        await shot(page, `overview_nowcast_drawer_${w}x${h}`);
        expect(covered / (map.width * map.height), `covered share at ${w}`).toBeLessThanOrEqual(0.31);      // ~70 % of the map uncovered
    }
});

test.describe('first visit at 1366: drawer waits while Start here is open', () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test('collapsed with Start here open; the default alert opens when it closes; Start here links to the overview', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto('/nowcast');
        await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', /REF051/, { timeout: 60_000 });
        await expect(page.getByTestId('start-here')).toBeVisible();
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', '');
        await expect(page.getByTestId('start-here-overview')).toHaveAttribute('href', '/');
        await page.getByTestId('start-here-close').click();
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert');
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.evaluate(() => window.localStorage.clear());
        await page.goto('/nowcast');
        await expect(page.getByTestId('start-here')).toBeVisible();
        await expect(page.getByTestId('drawer')).toHaveAttribute('data-open', 'alert', { timeout: 60_000 });
    });
});

test('nav: Overview · Explore map · Results · Analytics · Current weather (rule-based) menu; deep links survive a refresh', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    const nav = page.getByTestId('site-nav');
    await expect(nav.locator('a, button')).toHaveText(['Overview', 'Explore map', 'Results', 'Analytics', 'Current weather (rule-based)']);
    await page.getByTestId('nav-rule-menu').click();
    await expect(page.getByTestId('nav-rule-items')).toContainText('not the ML model');
    await expect(page.getByTestId('nav-rule-items').getByRole('menuitem')).toHaveText(['Dashboard', 'Forecast', 'Alerts', 'Reports']);
    await shot(page, 'overview_nav_menu_1366x768');
    await page.getByTestId('nav-dashboard').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    for (const [url, check] of [
        ['/', () => expect(page.getByTestId('overview-heading')).toHaveText('System briefing')],
        ['/dashboard', () => expect(page.getByTestId('sidebar-live-map')).toBeVisible()],
        ['/forecast', () => expect(page.getByTestId('header-title')).toBeVisible()],
        ['/alerts', () => expect(page.getByTestId('header-title')).toBeVisible()],
        ['/reports', () => expect(page.getByTestId('header-title')).toBeVisible()],
        ['/analytics', () => expect(page.getByTestId('analytics-page')).toBeVisible()],
        ['/nowcast?view=live', () => expect(page.getByTestId('live-not-validated')).toBeVisible({ timeout: 60_000 })],
        ['/nowcast/results#limitations', () => expect(page.getByTestId('limitations')).toBeVisible({ timeout: 30_000 })],
        ['/nowcast/approach', () => expect(page.getByTestId('approach-page')).toBeVisible()],
    ]) {
        await page.goto(url);
        await check();
        await page.reload();
        await check();
        expect(new URL(page.url()).pathname, url).toBe(url.split(/[?#]/)[0]);
    }
    // old Dashboard links now go to /dashboard; rule-based pages keep their label
    await page.goto('/reports');
    await expect(page.getByRole('link', { name: /Dashboard/ }).first()).toHaveAttribute('href', '/dashboard');
    // the SPA fallback that makes these refreshes work on Vercel
    const vercel = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../frontend/frontend-react/vercel.json', import.meta.url), 'utf8'));
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
});

test('390 px: one Menu button holds every page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('site-nav')).toBeHidden();
    await page.getByTestId('nav-compact').click();
    await expect(page.getByTestId('nav-compact-items').locator('a')).toHaveText(['Overview', 'Explore map', 'Results', 'Analytics', 'Dashboard', 'Forecast', 'Alerts', 'Reports']);
    await expect(page.getByTestId('nav-compact-items')).toContainText('Current weather (rule-based)');
    await shot(page, 'overview_nav_compact_390x844');
});

test('credits: one line that expands; OpenWeather (primary) before Open-Meteo (fallback); same order in the team credits', async ({ page }) => {
    const cr = (await api(page, 'credits')).credits;
    const ml = cr.filter((c) => c.shown_on.includes('ml')).map((c) => c.id);
    expect(ml.indexOf('openweather')).toBeLessThan(ml.indexOf('open_meteo'));
    expect(cr.find((c) => c.id === 'openweather').label).toBe('OpenWeather (primary current-weather source)');
    expect(cr.find((c) => c.id === 'open_meteo').label).toBe('Open-Meteo (fallback, used only when OpenWeather is unavailable)');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/nowcast/results');
    const foot = page.getByTestId('data-credits');
    await expect(page.getByTestId('credits-names')).toHaveText('ERA5, IMERG, GFS, IMD, Copernicus DEM, INSAT/MOSDAC, NASA GIBS, OpenStreetMap, OpenWeather, Open-Meteo');
    await expect(foot).toHaveAttribute('data-open', 'false');
    const lineBox = await foot.boundingBox();
    expect(lineBox.height).toBeLessThan(40);
    await page.getByTestId('credits-toggle').click();
    await expect(page.getByTestId('credit-openweather')).toContainText('Weather data © OpenWeather');
    await expect(page.getByTestId('credit-open_meteo')).toContainText('Weather data by Open-Meteo.com');
    await shot(page, 'overview_credits_open_1366x768');
    // team pages' credits popover: the same order
    await page.goto('/alerts');
    await page.getByTestId('team-credits-button').click();
    await expect(page.getByTestId('team-credit-openweather')).toBeVisible();
    const ids = await page.getByTestId('team-credits').locator('li').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('team-credit-', '')));
    expect(ids.indexOf('openweather')).toBeLessThan(ids.indexOf('open_meteo'));
});

test('All-India subtitle in plain words, read from the data; no internal IDs', async ({ page }) => {
    const m = await api(page, 'india/meta');
    const note = m.notes.find((n) => n.startsWith('Input frames come from'));
    const period = /(\d{4}) (test|validation)-period/.exec(note);
    await page.goto('/nowcast?view=india');
    const sub = page.getByTestId('india-subtitle');
    const d = new Date(m.issue_time);
    await expect(sub).toContainText(new RegExp(`^All of India at one past time: ${d.getUTCDate()} Sept? ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC \\(${period[1]} ${period[2]} period\\)`));
    expect(await page.locator('body').innerText()).not.toMatch(/\bREF\d{3}\b/);
    await page.getByTestId('drawer-tab-about').click();
    await expect(page.getByTestId('india-notes')).not.toContainText('REF0');
    await expect(page.getByTestId('india-notes')).toContainText(`a ${period[1]} test-period episode`);
});
