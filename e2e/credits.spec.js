// Batch 3: data credits (ML footer + team pages) and the Nominatim usage policy (mocked Nominatim).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const ML_FOOTER = ['era5', 'imerg', 'gfs', 'imd', 'copernicus_dem', 'insat_mosdac', 'nasa_gibs', 'osm', 'open_meteo'];
const TEAM = ['imd', 'nasa_gibs', 'osm', 'open_meteo', 'unsplash', 'nominatim'];
const PLACES = {
    shimla: { lat: '31.1048', lon: '77.1734', display_name: 'Shimla, Himachal Pradesh, India' },
    delhi: { lat: '28.6139', lon: '77.2090', display_name: 'Delhi, India' },
    mumbai: { lat: '19.0760', lon: '72.8777', display_name: 'Mumbai, Maharashtra, India' },
    kolkata: { lat: '22.5726', lon: '88.3639', display_name: 'Kolkata, West Bengal, India' },
    manali: { lat: '32.2432', lon: '77.1892', display_name: 'Manali, Himachal Pradesh, India' },
};

async function stubExternal(page) {
    await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route('https://gibs.earthdata.nasa.gov/**', (r) => r.fulfill({ body: PNG, contentType: 'image/jpeg' }));
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
}

async function mockNominatim(page) {
    const calls = [];
    await page.route('https://nominatim.openstreetmap.org/**', (r) => {
        const u = new URL(r.request().url());
        const q = u.searchParams.get('q').toLowerCase();
        calls.push({ q, t: Date.now(), referer: r.request().headers().referer || null });
        const hit = PLACES[q];
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(hit ? [hit] : []) });
    });
    return calls;
}

test('ML footer lists every data source in order, with its provider wording', async ({ page }) => {
    const cr = page.waitForResponse((r) => r.url().endsWith('/credits') && r.ok());
    await page.goto('/nowcast');
    const api = (await (await cr).json()).credits;
    const footer = page.getByTestId('data-credits');
    const ids = await footer.locator('[data-testid^="credit-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.slice(7)));
    expect(ids).toEqual(ML_FOOTER);
    for (const id of ML_FOOTER) {
        const c = api.find((x) => x.id === id);
        const el = page.getByTestId(`credit-${id}`);
        await expect(el).toContainText(c.label);
        await expect(el).toContainText(c.text);
        for (const l of c.links) await expect(el.locator(`a[href="${l.url}"]`)).toHaveCount(1);
    }
    await expect(page.getByTestId('credit-era5')).toContainText('Contains modified Copernicus Climate Change Service information 2026');
    await expect(page.getByTestId('credit-osm')).toContainText('© OpenStreetMap contributors');
    await expect(page.getByTestId('credit-unsplash')).toHaveCount(0);           // team-page source only
    await expect(page.getByTestId('credit-nominatim')).toHaveCount(0);
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await expect(page.getByTestId('credit-open_meteo')).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: path.join(SHOTS, `credits_ml_footer_${w}x${h}.png`) });
    }
});

test('team pages: a Credits button opens the team credits (Esc and × close it); photo credit shown', async ({ page }) => {
    await stubExternal(page);
    for (const route of ['/', '/forecast', '/alerts', '/analytics', '/reports']) {
        await page.goto(route);
        const btn = page.getByTestId('team-credits-button').first();
        await expect(btn).toBeVisible();
        await expect(page.getByTestId('team-credits')).toHaveCount(0);           // collapsed by default
        await btn.click();
        const box = page.getByTestId('team-credits');
        for (const id of TEAM) await expect(box.getByTestId(`team-credit-${id}`)).toBeVisible();
        const ids = await box.locator('[data-testid^="team-credit-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.slice(12)));
        expect(ids).toEqual(TEAM);
        await expect(box.getByTestId('team-credit-unsplash')).toContainText('Photos: Unsplash.');
        await expect(box.getByTestId('team-credit-nominatim')).toContainText('© OpenStreetMap contributors');
        if (route === '/') {
            await expect(page.getByTestId('photo-credit').first()).toHaveText('Photo: Unsplash');
            for (const [w, h] of [[1920, 1080], [1366, 768]]) {
                await page.setViewportSize({ width: w, height: h });
                await expect(box).toBeInViewport({ ratio: 1 });
                await page.screenshot({ path: path.join(SHOTS, `credits_team_dashboard_${w}x${h}.png`) });
            }
            await page.setViewportSize({ width: 1600, height: 1000 });
        }
        await page.keyboard.press(route === '/' ? 'Escape' : 'Tab');
        if (route !== '/') await box.getByTestId('team-credits-close').click();
        await expect(page.getByTestId('team-credits')).toHaveCount(0);
    }
    await page.goto('/nowcast');                                                     // ML pages use their footer instead
    await expect(page.getByTestId('team-credits-button')).toHaveCount(0);
});

test('Nominatim: no request per keystroke, cached repeats, >= 1 s apart, latest search wins, Referer sent, OSM credit shown', async ({ page }) => {
    await stubExternal(page);
    const calls = await mockNominatim(page);
    await page.goto('/');
    await expect(page.getByTestId('dashboard-source-badge')).not.toHaveText('Loading weather source…');
    const input = page.getByPlaceholder('Search city (e.g. Mumbai, Jaipur)...');
    await input.pressSequentially('Shimla', { delay: 60 });
    await page.waitForTimeout(1200);
    expect(calls.length, 'typing alone sends nothing (no auto-complete)').toBe(0);
    await expect(page.getByTestId('nominatim-credit')).toHaveCount(0);
    await input.press('Enter');
    await expect.poll(() => calls.length).toBe(1);
    await expect(page.getByTestId('nominatim-credit')).toContainText('© OpenStreetMap contributors');
    await expect(page.getByTestId('nominatim-credit')).toContainText('ODbL');
    await expect(input).toBeEnabled();
    expect(calls[0].referer, 'the page origin identifies the app').toMatch(/^http:\/\/(localhost|127\.0\.0\.1):5173/);

    await input.fill('  SHIMLA ');                                                  // same query: served from the cache
    await input.press('Enter');
    await expect(input).toBeEnabled();
    await page.waitForTimeout(300);
    expect(calls.length).toBe(1);

    await input.fill('Manali');                                                     // right after: waits out the 1 s gap
    await input.press('Enter');
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1].t - calls[0].t).toBeGreaterThanOrEqual(950);

    // three region picks in quick succession: the first goes out (after the gap), the middle one is
    // overtaken before it is sent and dropped, the last goes out >= 1 s after the first
    const region = page.locator('aside select');
    await expect(input).toBeEnabled();
    await page.waitForTimeout(1100);                                                // gap after 'manali' elapsed: Delhi is sent at once
    for (const r of ['Delhi', 'Mumbai', 'Kolkata']) await region.selectOption(r);
    await expect.poll(() => calls.length, { timeout: 8000 }).toBe(4);
    await page.waitForTimeout(1500);
    expect(calls.map((c) => c.q)).toEqual(['shimla', 'manali', 'delhi', 'kolkata']);
    for (let i = 1; i < calls.length; i++) expect(calls[i].t - calls[i - 1].t).toBeGreaterThanOrEqual(950);
    await expect(page.getByTestId('nominatim-credit')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'credits_nominatim_dashboard.png') });
});
