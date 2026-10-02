// Shelter section: elevation profile per candidate and the lazy three.js 3D view (REF045 at 50 km, REF051).
// Every value is the API's (serve/shelters.py). three.js must not load until "3D view" is clicked.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const ISSUES = { REF045: '20230813T1500Z', REF051: '20240731T1400Z' };
const WORDING = 'Candidate public buildings outside the current alert area, not verified shelters. Roads may be blocked. '
    + 'Follow evacuation instructions from district authorities and IMD. Emergency: 112.';
const api = async (page, p) => (await page.request.get(`${API}/ml/${p}`)).json();
const isThree = (u) => /Terrain3D|\/three(\.js|\/|\?|_)|deps\/three/.test(u);

async function openShelter(page, ep) {
    await page.goto(`/nowcast?ep=${ep}&ts=${ISSUES[ep]}`);
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `${ep}/${ISSUES[ep]}`, { timeout: 30_000 });
    await page.getByTestId('drawer-tab-shelter').click();
    await expect(page.getByTestId('shelter-summary')).toBeVisible();
}

async function shelterApi(page, ep) {
    const pt = page.getByTestId('shelter-point');
    const s = await page.getByTestId('shelter-summary').innerText();
    const radius = /within 50 km of this location/.test(s) ? '&radius=50' : '';
    return api(page, `issues/${ep}/${ISSUES[ep]}/shelters?lat=${await pt.getAttribute('data-lat')}&lon=${await pt.getAttribute('data-lon')}${radius}`);
}

async function expectProfiles(cards, list) {
    await expect(cards).toHaveCount(list.length);
    for (const [i, c] of list.entries()) {
        const f = cards.nth(i).getByTestId('shelter-profile');
        const p = c.profile;
        await expect(f).toHaveAttribute('data-n', String(p.n));
        await expect(f).toHaveAttribute('data-crossings', String(p.crossings.length));
        await expect(f).toHaveAttribute('data-stretches', String(p.alert_stretches.length));
        await expect(f.getByTestId('profile-crossing')).toHaveCount(p.crossings.length);
        await expect(f.getByTestId('profile-alert-stretch')).toHaveCount(p.alert_stretches.length);
        await expect(f.getByTestId('profile-start')).toHaveText(`${p.elev_m[0].toLocaleString('en-US')} m`);
        await expect(f.getByTestId('profile-end')).toHaveText(`${p.elev_m[p.elev_m.length - 1].toLocaleString('en-US')} m`);
        await expect(f.getByTestId('profile-note')).toHaveText('Straight line, not a route. Roads may differ.');
        await expect(f).toContainText(`Terrain every ${p.spacing_m} m`);
        expect(p.spacing_m).toBeLessThanOrEqual(250);
    }
}

async function open3d(page, name, info) {
    const before = [];
    page.on('request', (r) => before.push(r.url()));
    expect(before.filter(isThree), 'three.js loaded before the 3D view was opened').toEqual([]);
    const t0 = Date.now();
    await page.getByTestId('shelter-3d').click();
    const box = page.getByTestId('terrain3d');
    await expect(box).toBeAttached({ timeout: 30_000 });
    const gl = await page.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); });
    if (!gl) {
        await expect(page.getByTestId('terrain3d-fallback')).toContainText('needs WebGL');
        info.annotations.push({ type: 'webgl', description: 'unavailable: fallback message tested' });
        return null;
    }
    await expect(box).toHaveAttribute('data-status', 'data', { timeout: 30_000 });
    await expect(box).not.toHaveAttribute('data-open-ms', '', { timeout: 30_000 });
    const clickToReady = Date.now() - t0;
    expect(before.some(isThree), 'three.js chunk requested on open').toBe(true);
    await expect(page.getByTestId('terrain3d-exaggeration')).toHaveText('Height ×2');
    await expect(page.getByTestId('terrain3d-wording')).toHaveText(WORDING);
    await expect(page.getByTestId('terrain3d-legend')).toContainText('rivers / streams (OpenStreetMap)');
    await expect(box.locator('canvas')).toHaveCount(1);
    const spin = await page.evaluate(() => window.__terrain3d.spin(3000));
    await page.getByTestId('terrain3d-reset').click();
    const perf = { name, viewport: page.viewportSize(), click_to_ready_ms: clickToReady,
        component_open_ms: Number(await box.getAttribute('data-open-ms')), rotate_fps: Math.round(spin.fps * 10) / 10, frames: spin.frames };
    info.annotations.push({ type: 'perf', description: JSON.stringify(perf) });
    return perf;
}

test('REF045: profile in every candidate card (values = API); widen to 50 km; 3D view lazy-loaded; Esc closes', async ({ page }, info) => {
    await openShelter(page, 'REF045');
    await page.getByTestId('shelter-widen').click();
    await expect(page.getByTestId('shelter-summary')).toContainText('within 50 km of this location');
    const r = await shelterApi(page, 'REF045');
    expect(r.radius_km).toBe(50);
    await expectProfiles(page.getByTestId('shelter-outside-list').getByTestId('shelter-candidate'), r.candidates);
    await page.getByTestId('shelter-inside-toggle').click();
    await expectProfiles(page.getByTestId('shelter-inside-list').getByTestId('shelter-candidate'), r.inside_candidates);
    expect(r.candidates.some((c) => c.profile.crossings.length > 0)).toBe(true);
    expect(r.candidates.some((c) => c.profile.alert_stretches.length > 0)).toBe(true);
    const perf = await open3d(page, 'REF045 50 km', info);
    if (perf) {
        const t = await api(page, `shelters/terrain?lat=${r.point.lat.toFixed(4)}&lon=${r.point.lon.toFixed(4)}&half_km=50`);
        await expect(page.getByTestId('terrain3d-legend')).toContainText(`${t.min_m.toLocaleString('en-US')}–${t.max_m.toLocaleString('en-US')} m`);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('terrain3d-overlay')).toHaveCount(0);
});

test('REF051: 3D view opens; x closes', async ({ page }, info) => {
    await openShelter(page, 'REF051');
    await open3d(page, 'REF051 25 km', info);
    await page.getByTestId('terrain3d-close').click();
    await expect(page.getByTestId('terrain3d-overlay')).toHaveCount(0);
});

test('outside the two states the 3D button is hidden', async ({ page }) => {
    await page.goto('/nowcast');
    await page.getByTestId('tab-live').click();
    await expect(page.getByTestId('lead-1')).toBeAttached({ timeout: 30_000 });
    await page.getByTestId('drawer-tab-shelter').click();
    const b = await page.locator('.leaflet-container').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height * 0.6);
    await expect(page.getByTestId('shelter-not-available')).toHaveText('Not available for this area yet.');
    await expect(page.getByTestId('shelter-3d')).toHaveCount(0);
});

test('profile + 3D screenshots at 1920x1080 and 1366x768 (REF045 at 50 km, REF051); open time and rotation', async ({ page }, info) => {
    test.setTimeout(240_000);
    const perfs = [];
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const ep of ['REF045', 'REF051']) {
            await openShelter(page, ep);
            if (ep === 'REF045') {
                await page.getByTestId('shelter-widen').click();
                await expect(page.getByTestId('shelter-summary')).toContainText('within 50 km of this location');
            }
            await page.getByTestId('shelter-profile').first().scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(SHOTS, `profile_${ep}${ep === 'REF045' ? '_50km' : ''}_${w}x${h}.png`) });
            const perf = await open3d(page, `${ep} ${w}x${h}`, info);
            if (perf) perfs.push(perf);
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(SHOTS, `terrain3d_${ep}${ep === 'REF045' ? '_50km' : ''}_${w}x${h}.png`) });
            await page.keyboard.press('Escape');
        }
    }
    fs.writeFileSync(path.join(SHOTS, `terrain3d_perf_${process.env.PERF_TAG || 'headless'}.json`), JSON.stringify(perfs, null, 1));
});
