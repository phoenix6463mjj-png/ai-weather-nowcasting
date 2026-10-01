// CAP Atom feed: approve an alert in the CAP review drawer -> the feed lists it -> its link opens a valid CAP
// 1.2 message with the export's status (Exercise for replays). The drawer shows the feed link, the count and
// where approvals are stored. The decision is reset at the end (approvals are server state).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const ATOM = 'http://www.w3.org/2005/Atom';

test('approve -> feed shows it -> link opens a valid CAP message (Exercise)', async ({ page }) => {
    const eps = await (await page.request.get(`${API}/ml/episodes`)).json();
    const ts = eps.default.ts;
    await page.goto(`/nowcast?ep=REF045&ts=${ts}`);
    await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `REF045/${ts}`, { timeout: 30_000 });
    await page.getByTestId('drawer-tab-alert').click();
    await page.getByTestId('alert-row').first().locator('button').first().click();
    const feed = page.getByTestId('cap-feed');
    await expect(feed.getByTestId('cap-feed-link')).toHaveText('Feed (Atom)');
    await expect(feed.getByTestId('cap-feed-count')).toContainText('approved message');
    await expect(feed.getByTestId('cap-feed-storage')).toContainText(/Approvals are stored|approvals reset when the server restarts/);
    await expect(feed).toContainText('Exercise feed — not an official warning; not connected to IMD, NDMA or Sachet.');
    if ((await page.getByTestId('cap-review').getAttribute('data-status')) === 'approved') await page.getByTestId('cap-reject').click();
    await page.getByTestId('cap-approve').click();
    await expect(page.getByTestId('cap-review')).toHaveAttribute('data-status', 'approved');
    await expect.poll(async () => (await (await page.request.get(`${API}/ml/cap/approvals`)).json()).n_approved).toBeGreaterThan(0);
    const n = (await (await page.request.get(`${API}/ml/cap/approvals`)).json()).n_approved;
    await expect(feed.getByTestId('cap-feed-count')).toHaveText(`${n} approved message${n === 1 ? '' : 's'} in the feed`);
    await page.screenshot({ path: path.join(SHOTS, 'cap_feed_drawer_1600x1000.png') });
    // the feed (Atom) lists it; its link is a CAP 1.2 alert with status Exercise
    const xml = await (await page.request.get(`${API}/ml/cap/feed.atom`)).text();
    const doc = await page.evaluate((x) => {
        const d = new DOMParser().parseFromString(x, 'application/xml');
        const ns = 'http://www.w3.org/2005/Atom';
        return { root: d.documentElement.localName, rootNs: d.documentElement.namespaceURI,
            title: d.getElementsByTagNameNS(ns, 'title')[0].textContent,
            links: [...d.getElementsByTagNameNS(ns, 'entry')].map((e) => e.getElementsByTagNameNS(ns, 'link')[0].getAttribute('href')) };
    }, xml);
    expect(doc.root).toBe('feed');
    expect(doc.rootNs).toBe(ATOM);
    expect(doc.title).toBe('Exercise feed — not an official warning; not connected to IMD, NDMA or Sachet');
    expect(doc.links.length).toBeGreaterThan(0);
    const cap = await (await page.request.get(`${API}/ml/cap/${doc.links[0]}`)).text();
    expect(cap).toContain('<status>Exercise</status>');
    expect(cap).toContain('urn:oasis:names:tc:emergency:cap:1.2');
    // reset this decision (server state)
    await page.getByTestId('cap-reject').click();
    await expect(page.getByTestId('cap-review')).toHaveAttribute('data-status', 'rejected');
});

test('CAP drawer screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    const eps = await (await page.request.get(`${API}/ml/episodes`)).json();
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/nowcast?ep=REF045&ts=${eps.default.ts}`);
        await expect(page.getByTestId('replay-view')).toHaveAttribute('data-loaded', `REF045/${eps.default.ts}`, { timeout: 30_000 });
        await page.getByTestId('drawer-tab-alert').click();
        await page.getByTestId('alert-row').first().locator('button').first().click();
        await page.getByTestId('cap-feed').scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS, `cap_drawer_${w}x${h}.png`) });
    }
});
