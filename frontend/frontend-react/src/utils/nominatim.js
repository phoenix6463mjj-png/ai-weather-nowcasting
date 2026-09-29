// Place search via the OSMF Nominatim service, within its usage policy
// (https://operations.osmfoundation.org/policies/nominatim/, checked 2026-09-29; quotes stored in
// backend/assets/nominatim_policy.json):
// - "an absolute maximum of 1 request per second": requests go out one at a time, >= MIN_INTERVAL_MS apart;
// - "Results must be cached on your side": per-query cache (memory + sessionStorage), in-flight dedupe;
// - no auto-complete: called only on an explicit search (Find / Enter / region pick), never per keystroke;
//   a queued search that a newer one overtakes before it is sent is dropped (latest wins);
// - identification: a browser cannot set User-Agent, so the Referer (the page origin) is always sent.
// Results are OpenStreetMap data: show NominatimCredit wherever they appear.
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
export const MIN_INTERVAL_MS = 1000;

export class SupersededError extends Error {
    constructor() { super('superseded by a newer search'); this.name = 'SupersededError'; }
}

const memo = new Map();
const inflight = new Map();
let queue = Promise.resolve();
let lastSent = 0;
let ticket = 0;

const keyOf = (q) => q.trim().replace(/\s+/g, ' ').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cached(key) {
    if (memo.has(key)) return memo.get(key);
    try {
        const s = sessionStorage.getItem(`nominatim:${key}`);
        if (s) { const v = JSON.parse(s); memo.set(key, v); return v; }
    } catch { /* storage unavailable */ }
    return undefined;
}

// Returns Nominatim's result array (possibly empty) for one free-text query.
export function geocode(query) {
    const key = keyOf(query);
    const hit = cached(key);
    if (hit !== undefined) return Promise.resolve(hit);
    if (inflight.has(key)) return inflight.get(key);
    const mine = ++ticket;
    const p = queue.then(async () => {
        if (mine !== ticket) throw new SupersededError();
        const wait = lastSent + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        if (mine !== ticket) throw new SupersededError();
        lastSent = Date.now();
        const url = `${NOMINATIM_SEARCH_URL}?q=${encodeURIComponent(query.trim())}&format=json&limit=1`;
        const res = await fetch(url, { referrerPolicy: 'strict-origin-when-cross-origin' });
        if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status}).`);
        const data = await res.json();
        memo.set(key, data);
        try { sessionStorage.setItem(`nominatim:${key}`, JSON.stringify(data)); } catch { /* storage unavailable */ }
        return data;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    queue = p.catch(() => {});
    return p;
}
