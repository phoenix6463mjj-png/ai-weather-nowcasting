import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, storageState: { cookies: [], origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: 'nowcast.startHere.dismissed', value: '1' }] }] } });
const p = await ctx.newPage();
await p.goto('http://localhost:5173/nowcast?ep=REF051&ts=20240731T1500Z');
await p.waitForTimeout(9000);
await p.getByTestId('drawer-tab-event').click();
await p.waitForTimeout(3000);
const r = await p.getByTestId('warning-timeline').evaluate((el) => {
  const R = el.getBoundingClientRect();
  const out = [];
  el.querySelectorAll('*').forEach((c) => { const b = c.getBoundingClientRect(); if (b.width && (b.right > R.right + 1 || b.left < R.left - 1)) out.push(`${c.tagName}.${String(c.className).slice(0, 70)} [${c.textContent.slice(0, 30)}] l=${Math.round(b.left - R.left)} r=${Math.round(b.right - R.right)}`); });
  return { sw: el.scrollWidth, cw: el.clientWidth, out: out.slice(0, 12) };
});
console.log(JSON.stringify(r, null, 1));
await p.screenshot({ path: 'e2e/screenshots/_dbg_event.png' });
await b.close();
