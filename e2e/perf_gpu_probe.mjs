// One-off performance probe (not part of the test suite): open the 3D view on REF045 (50 km) and REF051 with
// Chromium using the laptop GPU, and report the WebGL renderer, the open time and the rotation frame rate.
//   node e2e/perf_gpu_probe.mjs [headed]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const headed = process.argv[2] === 'headed';
const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const out = [];
for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const gpu = await page.evaluate(() => {
        const g = document.createElement('canvas').getContext('webgl');
        const d = g && g.getExtension('WEBGL_debug_renderer_info');
        return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no WebGL';
    });
    for (const [ep, ts, widen] of [['REF045', '20230813T1500Z', true], ['REF051', '20240731T1400Z', false]]) {
        await page.goto(`http://localhost:5173/nowcast?ep=${ep}&ts=${ts}`);
        await page.getByTestId('replay-view').and(page.locator(`[data-loaded="${ep}/${ts}"]`)).waitFor({ timeout: 60_000 });
        await page.getByTestId('drawer-tab-shelter').click();
        await page.getByTestId('shelter-summary').waitFor();
        if (widen) {
            await page.getByTestId('shelter-widen').click();
            await page.getByText('Within 50 km').first().waitFor();
        }
        const t0 = Date.now();
        await page.getByTestId('shelter-3d').click();
        await page.locator('[data-testid="terrain3d"][data-status="data"]:not([data-open-ms=""])').waitFor({ timeout: 60_000 });
        const ready = Date.now() - t0;
        const openMs = Number(await page.getByTestId('terrain3d').getAttribute('data-open-ms'));
        const spin = await page.evaluate(() => window.__terrain3d.spin(4000));
        out.push({ ep, viewport: `${w}x${h}`, headed, gpu, click_to_ready_ms: ready, component_open_ms: openMs,
            rotate_fps: Math.round(spin.fps * 10) / 10, frames: spin.frames });
        await page.keyboard.press('Escape');
    }
    await page.close();
}
await browser.close();
fs.writeFileSync(`e2e/screenshots/terrain3d_perf_gpu${headed ? '_headed' : ''}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
