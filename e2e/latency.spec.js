// Approach page: the measured compute time of one all-India nowcast (docs/latency_benchmark.json via
// /ml/approach). The line is the API's text, whose numbers come from that file (serve/tests/test_latency.py);
// here: it is shown verbatim, next to the data-latency facts, with no NWP or "real-time" claim.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000';
const BENCH = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'nowcast_data', 'docs', 'latency_benchmark.json'), 'utf-8'));

test('Approach: compute-time line from the benchmark file, next to the data latency', async ({ page }) => {
    const compute = (await (await page.request.get(`${API}/ml/approach`)).json()).compute;
    await page.goto('/nowcast/approach');
    const line = page.getByTestId('approach-compute-latency');
    await expect(line).toHaveText(`Our compute time (measured): ${compute.text} Source: docs/latency_benchmark.md.`);
    const p = BENCH.pipeline_seconds;
    const f = (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
    await expect(line).toContainText(`${f(p.median)} s median (${f(p.min)}–${f(p.max)} s, ${BENCH.n_runs} runs)`);
    await expect(line).toContainText(`${BENCH.machine.ram_gb} GB RAM`);
    await expect(line).toContainText('Data latency dominates: IMERG Early is 5.3 h old at our first live poll (~4 h typical).');
    await expect(line).not.toContainText(/real[- ]time|NWP|faster/i);
    // inside the Live readiness card, after the data-latency arithmetic
    const card = page.getByTestId('live-readiness');
    await expect(card.getByTestId('approach-compute-latency')).toHaveCount(1);
    const [a, b] = await Promise.all([card.getByTestId('latency-arithmetic').boundingBox(), line.boundingBox()]);
    expect(b.y).toBeGreaterThan(a.y);
});

test('Approach screenshots at 1920x1080 and 1366x768 (compute-time line)', async ({ page }) => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/nowcast/approach');
        const line = page.getByTestId('approach-compute-latency');
        await expect(line).toBeVisible();
        await line.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SHOTS, `approach_latency_${w}x${h}.png`) });
    }
});
