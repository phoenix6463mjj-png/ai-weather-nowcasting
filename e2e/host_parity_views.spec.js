// Host parity through the real frontend: the same ML Nowcast clicks against the full local app (/ml via
// the team backend on :8000) and against the space-folder app (hosting/space, host env, no rasterio) on
// :10000. Every /ml request is recorded (status, bytes, ms); the statuses must match. Skipped when the
// space-folder app is not running (start it as in HOSTING.md, "Host parity").
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const HOST = process.env.E2E_HOST_APP_URL || 'http://127.0.0.1:10000';

async function hostUp(request) {
    try {
        return (await request.get(`${HOST}/ml/health`, { timeout: 5000 })).ok();
    } catch {
        return false;
    }
}

async function record(page, target) {
    const log = [];
    await page.route((u) => u.port === '8000' && u.pathname.startsWith('/ml/'), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const t = Date.now();
        let res;
        try {
            res = target === 'host'
                ? await route.fetch({ url: `${HOST}${u.pathname}${u.search}` })
                : await route.fetch();
        } catch {
            return;
        }
        const body = await res.body();
        log.push({ method: req.method(), path: `${u.pathname}${u.search}`, status: res.status(), bytes: body.length, ms: Date.now() - t });
        await route.fulfill({ response: res, body }).catch(() => {});
    });
    return log;
}

async function openLayers(page) {
    const lp = page.getByTestId('layers-panel');
    if (await lp.count() && (await lp.getAttribute('data-open')) === 'false') await page.getByTestId('layers-toggle').click();
}

async function cycleLeadsAndFields(page) {
    for (const L of [1, 2, 3, 4, 6]) {
        const b = page.getByTestId(`lead-${L}`);
        if (await b.count() && await b.isEnabled()) {
            await b.click();
            await page.waitForTimeout(250);
        }
    }
    await openLayers(page);
    const sel = page.getByTestId('field-select');
    if (await sel.count()) {
        for (const v of await sel.locator('option').evaluateAll((os) => os.map((o) => o.value))) {
            await sel.selectOption(v);
            await page.waitForTimeout(250);
        }
    }
}

async function drawerSections(page) {
    for (const s of ['alert', 'ingredients', 'event', 'caveats', 'about']) {
        const tab = page.getByTestId(`drawer-tab-${s}`);
        if (await tab.count()) {
            await tab.click();
            await page.waitForTimeout(400);
        }
    }
    const tab = page.getByTestId('drawer-tab-alert');
    if (await tab.count()) {
        await tab.click();
        const row = page.getByTestId('alert-row').first();
        if (await row.count()) {
            await row.click();
            await page.waitForTimeout(600);
            const cap = page.getByRole('button', { name: /CAP/ }).first();
            if (await cap.count()) {
                await cap.click().catch(() => {});
                await page.waitForTimeout(500);
            }
        }
    }
}

async function clickThrough(page) {
    await page.goto('/nowcast');
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', /REF045\//, { timeout: 60_000 });
    await cycleLeadsAndFields(page);
    await drawerSections(page);
    for (const ep of ['REF051', 'REF025']) {
        await openLayers(page);
        await page.getByTestId('episode-select').selectOption(ep);
        await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', new RegExp(`${ep}/`), { timeout: 60_000 });
        await cycleLeadsAndFields(page);
        await drawerSections(page);
    }
    await page.getByTestId('tab-india').click();
    await page.waitForTimeout(800);
    await cycleLeadsAndFields(page);
    await page.getByTestId('tab-live').click();
    await expect(page.getByTestId('live-not-validated')).toBeVisible({ timeout: 60_000 });
    await cycleLeadsAndFields(page);
    await drawerSections(page);
    for (const r of ['/nowcast/results', '/nowcast/approach']) {
        await page.goto(r);
        await page.waitForTimeout(1500);
    }
}

test('ML Nowcast views: every /ml request has the same status on the host package as on the full app', async ({ page, browser, request }) => {
    test.setTimeout(600_000);
    test.skip(!(await hostUp(request)), 'space-folder app not running on :10000');
    const logs = {};
    for (const target of ['full', 'host']) {
        const p = target === 'full' ? page : await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
        p.setDefaultTimeout(15_000);
        const log = await record(p, target);
        await clickThrough(p);
        logs[target] = log;
    }
    fs.writeFileSync(path.join(OUT, 'host_parity_views.json'), JSON.stringify(logs, null, 1));
    const by = (log) => Object.fromEntries(log.map((r) => [`${r.method} ${r.path}`, r.status]));
    const f = by(logs.full);
    const h = by(logs.host);
    expect(Object.keys(f).length).toBeGreaterThan(50);
    const diff = Object.keys({ ...f, ...h }).filter((k) => f[k] !== h[k]).map((k) => `${k}: full ${f[k]} host ${h[k]}`);
    expect(diff, diff.join('\n')).toEqual([]);
});
