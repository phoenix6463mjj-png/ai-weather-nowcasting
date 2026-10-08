// Header city search on the rule-based pages (Dashboard "/", Forecast, Alerts, Reports): the full field from
// 1600 px, a search icon that expands into the same field below that; none on the ML pages. Nominatim is
// mocked (<= 1 request/s, credit next to the result); tiles and photos are stubbed.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const PLACES = {
    manali: { lat: '32.2432', lon: '77.1892', display_name: 'Manali, Himachal Pradesh, India' },
    kolkata: { lat: '22.5726', lon: '88.3639', display_name: 'Kolkata, West Bengal, India' },
};
const SIZES = [[1920, 1080], [1366, 768], [390, 844]];
const LABEL = 'Search city (e.g. Mumbai, Jaipur)';

async function stub(page) {
    await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    await page.route('https://gibs.earthdata.nasa.gov/**', (r) => r.fulfill({ body: PNG, contentType: 'image/jpeg' }));
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
    const calls = [];
    await page.route('https://nominatim.openstreetmap.org/**', (r) => {
        const q = new URL(r.request().url()).searchParams.get('q').toLowerCase();
        calls.push({ q, t: Date.now() });
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(PLACES[q] ? [PLACES[q]] : []) });
    });
    return calls;
}

// the field, opening it first below 1600 px
async function openSearch(page, w) {
    const input = page.getByLabel(LABEL);
    if (w < 1600) {
        await expect(input).toBeHidden();
        await page.getByTestId('header-search-toggle').click();
    } else await expect(page.getByTestId('header-search-toggle')).toBeHidden();
    await expect(input).toBeVisible();
    return input;
}

// nothing in the header spills out of it or off the screen
const headerFits = (page) => page.evaluate(() => {
    const h = document.querySelector('header');
    const f = document.querySelector('[data-testid="header-search"]');
    const fr = f.getBoundingClientRect();
    return h.scrollWidth <= h.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1
        && (fr.width === 0 || (fr.left >= 0 && fr.right <= innerWidth + 0.5));
});

for (const [w, h] of SIZES) {
    test(`Dashboard search at ${w}x${h}: field or icon, Esc closes, the search updates the Dashboard with the Nominatim credit`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        const calls = await stub(page);
        await page.goto('/');
        await expect(page.getByTestId('dashboard-source-badge')).not.toHaveText('Loading weather source…');
        expect(await headerFits(page), 'header fits (closed)').toBe(true);
        await page.screenshot({ path: path.join(SHOTS, `city_search_dashboard_${w}x${h}.png`) });
        let input = await openSearch(page, w);
        expect(await headerFits(page), 'header fits (open)').toBe(true);
        if (w < 1600) {
            await expect(input).toBeFocused();
            await page.screenshot({ path: path.join(SHOTS, `city_search_open_${w}x${h}.png`) });
            await page.keyboard.press('Escape');
            await expect(input).toBeHidden();
            input = await openSearch(page, w);
        }
        await input.fill('Manali');
        await input.press('Enter');
        await expect.poll(() => calls.length).toBe(1);
        await expect(page.getByRole('heading', { name: /^Manali/ })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('nominatim-credit')).toContainText('© OpenStreetMap contributors');
        if (w < 1600) await expect(page.getByLabel(LABEL)).toBeHidden();            // a search closes the expanded field
        await page.getByTestId('nominatim-credit').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `city_search_result_${w}x${h}.png`) });
        // a second search right away: Nominatim still at most 1 request per second
        input = await openSearch(page, w);
        await input.fill('Kolkata');
        await input.press('Enter');
        await expect.poll(() => calls.length).toBe(2);
        expect(calls[1].t - calls[0].t).toBeGreaterThanOrEqual(1000);
        await expect(page.getByRole('heading', { name: /^Kolkata/ })).toBeVisible({ timeout: 30_000 });
    });
}

test('Alerts and Reports: the header search opens the Dashboard with that place; Forecast has the search too (1366 px)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await stub(page);
    for (const route of ['/alerts', '/reports']) {
        await page.goto(route);
        const input = await openSearch(page, 1366);
        await input.fill('Manali');
        await input.press('Enter');
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole('heading', { name: /^Manali/ })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('nominatim-credit')).toBeVisible();
    }
    await page.goto('/forecast');
    await openSearch(page, 1366);
    await page.screenshot({ path: path.join(SHOTS, 'city_search_forecast_open_1366x768.png') });
});

test('ML pages keep no city search (1920 and 1366 px)', async ({ page }) => {
    await stub(page);
    for (const w of [1920, 1366]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const route of ['/overview', '/nowcast', '/nowcast/results', '/analytics']) {
            await page.goto(route);
            await expect(page.getByTestId('site-nav').or(page.getByTestId('nav-compact')).first()).toBeVisible();
            await expect(page.getByTestId('header-search-toggle'), `${route} at ${w}`).toHaveCount(0);
            await expect(page.getByLabel(LABEL), `${route} at ${w}`).toHaveCount(0);
        }
    }
});
