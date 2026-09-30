// Friendly backend-wake state (utils/serverWake.js, audit F3): a failed / timed-out / 502-504 request is
// retried every 5 s for up to ~90 s with "Starting the server …"; after that "Server unavailable …".
// Never a raw address, port or error class name. Requests are blocked in the browser (Playwright routes).
import { test, expect } from '@playwright/test';

const STARTING = 'Starting the server — this can take up to a minute on the free host…';
const UNAVAILABLE = 'Server unavailable — please refresh in a minute.';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const RAW = [/127\.0\.0\.1/, /localhost/, /:800[01]\b/, /TypeError/, /AbortError/, /NetworkError/, /Failed to fetch/, /Cannot reach/, /Is it running/];

const backend = (pathRe) => (u) => u.port === '8000' && pathRe.test(u.pathname);

// fail the matching requests (abort, or a 503 as a sleeping host's gateway gives) for `ms`, then pass them
async function blockFor(page, match, ms, how = 'abort') {
    const hits = { blocked: 0, passed: 0, until: 0 };
    await page.route(match, (r) => {
        if (!hits.until) hits.until = Date.now() + ms;
        if (Date.now() < hits.until) {
            hits.blocked += 1;
            return how === 'abort' ? r.abort() : r.fulfill({ status: 503, body: 'Service Unavailable' });
        }
        hits.passed += 1;
        return r.continue();
    });
    return hits;
}

async function noRawErrors(page) {
    const text = await page.locator('body').innerText();
    for (const re of RAW) expect(text, `shows ${re}`).not.toMatch(re);
}

test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
});

test('team backend down for ~7 s (real 5 s retry): "Starting the server" notice, then the Alerts load', async ({ page }) => {
    const hits = await blockFor(page, backend(/^\/alerts$/), 7000);
    await page.goto('/alerts');
    const notice = page.getByTestId('server-wake');
    await expect(notice).toHaveAttribute('data-state', 'starting');
    await expect(page.getByTestId('server-wake-text')).toHaveText(STARTING);
    await noRawErrors(page);
    // alert cards, or the safety net when the backend serves sample data
    await expect(page.getByTestId('alert-card-source').first().or(page.getByTestId('sample-safety-net'))).toBeVisible({ timeout: 30_000 });
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId('alerts-error')).toHaveCount(0);
    expect(hits.blocked).toBeGreaterThanOrEqual(2);          // first try + one retry 5 s later, both blocked
    expect(hits.passed).toBeGreaterThanOrEqual(1);
    await noRawErrors(page);
});

test('Forecast: backend blocked for ~6 s, then the page loads', async ({ page }) => {
    const hits = await blockFor(page, backend(/^\/batch_predict$/), 6000);
    await page.goto('/forecast');
    await expect(page.getByTestId('server-wake-text')).toHaveText(STARTING);
    await expect(page.getByTestId('forecast-backend-sync')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('server-wake')).toHaveCount(0);
    expect(hits.passed).toBeGreaterThanOrEqual(1);
});

test('ML API answering 503 for ~6 s (sleeping host): notice, then ML Nowcast Results load', async ({ page }) => {
    const hits = await blockFor(page, backend(/^\/ml\//), 6000, '503');
    await page.goto('/nowcast/results');
    await expect(page.getByTestId('server-wake-text')).toHaveText(STARTING);
    await noRawErrors(page);
    await expect(page.getByTestId('reliability-min-n')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('server-wake')).toHaveCount(0);
    expect(hits.blocked).toBeGreaterThanOrEqual(1);
    await noRawErrors(page);
});

test('an ordinary HTTP error (404 "not available") is passed through, not retried', async ({ page }) => {
    let calls = 0;
    await page.route(backend(/^\/ml\/approach$/), (r) => { calls += 1; return r.fulfill({ status: 404, json: { detail: 'not available' } }); });
    await page.goto('/nowcast/approach');
    await expect(page.getByText('not available', { exact: true })).toBeVisible();
    const n = calls;                                           // 1 per effect run (React StrictMode runs it twice in dev)
    expect(n).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(5_600);                          // longer than the 5 s retry interval
    expect(calls).toBe(n);                                     // no retry
    await expect(page.getByTestId('server-wake')).toHaveCount(0);
});

test('backend never comes back (short timings): every page ends on "Server unavailable", no addresses or error names', async ({ page }) => {
    await page.addInitScript(() => { window.__SERVER_WAKE__ = { retryMs: 200, budgetMs: 1500, attemptMs: 1000 }; });
    await page.route((u) => u.port === '8000', (r) => r.abort());
    for (const route of ['/', '/forecast', '/analytics', '/alerts', '/reports', '/nowcast', '/nowcast/results', '/nowcast/approach']) {
        await page.goto(route);
        const notice = page.getByTestId('server-wake');
        await expect(notice, route).toHaveAttribute('data-state', 'unavailable', { timeout: 10_000 });
        await expect(page.getByTestId('server-wake-text'), route).toHaveText(UNAVAILABLE);
        await page.waitForTimeout(300);
        await noRawErrors(page);
    }
});

test('backend never comes back: the page error slots use the same wording', async ({ page }) => {
    await page.addInitScript(() => { window.__SERVER_WAKE__ = { retryMs: 200, budgetMs: 1500, attemptMs: 1000 }; });
    await page.route((u) => u.port === '8000', (r) => r.abort());
    await page.goto('/alerts');
    await expect(page.getByTestId('alerts-error')).toHaveText(UNAVAILABLE);
    await page.goto('/forecast');
    await expect(page.getByTestId('forecast-status')).toHaveText(UNAVAILABLE);
    await page.goto('/nowcast/results');
    await expect(page.locator('main').getByText(UNAVAILABLE)).toBeVisible();
});

test('wake notice screenshots ("starting" and "unavailable") at 1920x1080 and 1366x768', async ({ page }) => {
    const shots = new URL('./screenshots/', import.meta.url);
    await page.addInitScript(() => { window.__SERVER_WAKE__ = { retryMs: 1500, budgetMs: 4000, attemptMs: 1000 }; });
    await page.route((u) => u.port === '8000', (r) => r.abort());
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/alerts');
        await expect(page.getByTestId('server-wake')).toHaveAttribute('data-state', 'starting');
        await page.screenshot({ path: new URL(`wake_starting_${w}x${h}.png`, shots).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
        await expect(page.getByTestId('server-wake')).toHaveAttribute('data-state', 'unavailable', { timeout: 10_000 });
        await page.screenshot({ path: new URL(`wake_unavailable_${w}x${h}.png`, shots).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    }
});
