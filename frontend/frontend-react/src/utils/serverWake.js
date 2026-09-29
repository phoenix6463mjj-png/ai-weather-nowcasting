// Friendly wake-up for the free host (it sleeps when idle). A request that fails, times out or gets a
// gateway error (502/503/504) is retried every 5 s for up to ~90 s while <ServerWakeNotice> says the
// server is starting; after that it fails with WAKE_UNAVAILABLE. Other HTTP answers (404 "not available",
// 403 replay disabled, ...) are returned unchanged. Never shows addresses, ports or error class names.
export const WAKE_STARTING = 'Starting the server — this can take up to a minute on the free host…';
export const WAKE_UNAVAILABLE = 'Server unavailable — please refresh in a minute.';

const DEFAULTS = { retryMs: 5000, budgetMs: 90000, attemptMs: 30000 };
// window.__SERVER_WAKE__ = { retryMs, budgetMs, attemptMs } shortens the timings (e2e tests only)
const config = () => ({ ...DEFAULTS, ...(typeof window !== 'undefined' && window.__SERVER_WAKE__) });
const RETRY_STATUS = new Set([502, 503, 504]);

let waiting = 0;            // requests currently being retried
let failed = false;         // the last request gave up (cleared by the next success)
const listeners = new Set();

export const wakeState = () => ({ starting: waiting > 0, unavailable: failed && waiting === 0 });
const emit = () => { const s = wakeState(); listeners.forEach((fn) => fn(s)); };
export function subscribeWake(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export class ServerUnavailableError extends Error {
    constructor() {
        super(WAKE_UNAVAILABLE);
        this.unavailable = true;
    }
}
export const isServerUnavailable = (e) => Boolean(e?.unavailable);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithWake(url, options = {}) {
    const { retryMs, budgetMs, attemptMs } = config();
    const start = Date.now();
    let retrying = false;
    try {
        for (;;) {
            const left = budgetMs - (Date.now() - start);
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(attemptMs, left)));
            try {
                const res = await fetch(url, { ...options, signal: ctrl.signal });
                if (!RETRY_STATUS.has(res.status)) {
                    if (failed) { failed = false; emit(); }
                    return res;
                }
            } catch {
                // network error or timeout: retried below
            } finally {
                clearTimeout(timer);
            }
            if (!retrying) { retrying = true; waiting += 1; emit(); }
            if (Date.now() - start + retryMs >= budgetMs) break;
            await sleep(retryMs);
        }
        failed = true;
        throw new ServerUnavailableError();
    } finally {
        if (retrying) { waiting -= 1; emit(); }
    }
}
