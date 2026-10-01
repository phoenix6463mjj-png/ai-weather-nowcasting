import { ML_API_BASE } from '../config';
import { fetchWithWake, ServerUnavailableError } from '../utils/serverWake';

export const mlUrl = (path) => `${ML_API_BASE}/${path.replace(/^\/+/, '')}`;

async function request(path, options, as = 'json') {
    let res;
    try {
        res = await fetchWithWake(mlUrl(path), options);     // retried while the free host wakes up
    } catch {
        throw new ServerUnavailableError();                   // never the address or the error class
    }
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        } catch { /* non-JSON error body */ }
        const err = new Error(detail);
        err.status = res.status;
        throw err;
    }
    return as === 'text' ? res.text() : res.json();
}

const q = (params) => {
    const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return s.toString() ? `?${s}` : '';
};

export const getEpisodes = () => request('episodes');
export const getEventCheck = (ep) => request(`episodes/${ep}/event-check`);
export const getCaveats = () => request('caveats');
export const getIssueMeta = (ep, ts) => request(`issues/${ep}/${ts}/meta`);
export const getIssueAlerts = (ep, ts) => request(`issues/${ep}/${ts}/ui-alerts?level=all`);
export const getAlertDetail = (ep, ts, id) => request(`issues/${ep}/${ts}/alerts/${encodeURIComponent(id)}`);
export const issueFileUrl = (ep, ts, name) => mlUrl(`issues/${ep}/${ts}/files/${name}`);
export const issueMapUrl = (ep, ts, lead, field) => mlUrl(`issues/${ep}/${ts}/map/${lead}/${field}.png`);
export const issueMissedUrl = (ep, ts, lead, level, hazards) =>
    mlUrl(`issues/${ep}/${ts}/map/${lead}/missed_ge30.png${q({ level, hazard: hazards.join(',') })}`);

export const getIndiaMeta = () => request('india/meta');
export const indiaMapUrl = (lead, field) => mlUrl(`india/map/${lead}/${field}.png`);

export const getLiveRuns = () => request('live');
export const getLiveMeta = (run) => request(`live/${run}/meta`);
export const getLiveAlerts = (run) => request(`live/${run}/ui-alerts?level=all`);
export const liveMapUrl = (run, lead, field) => mlUrl(`live/${run}/map/${lead}/${field}.png`);

export const getReplayStatus = () => request('replay/status');

// Nearby shelter options: OSM public buildings near a point, checked against every alert of the issue/run
const fix = (v) => Number(v).toFixed(4);
export const getShelters = (src, lat, lon, radius = 25) =>
    request(`${src.kind === 'live' ? `live/${src.run}` : `issues/${src.ep}/${src.ts}`}/shelters${q({ lat: fix(lat), lon: fix(lon), radius: radius === 25 ? null : radius })}`);
// Event replay default point: the issue's alert peak nearest the documented event site
export const getShelterDefault = (ep, ts) => request(`issues/${ep}/${ts}/shelters/default-point`);
export const runReplay = (body) => request('replay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export const getTerrain = () => request('terrain');
export const terrainUrl = (layer) => mlUrl(`terrain/${layer}.png`);
export const getCredits = () => request('credits');
export const getTimeline = (ep) => request(`episodes/${ep}/timeline`);
// INSAT-3DR case-study observation layer (satellite observation, INSAT via MOSDAC; not a model input)
export const getInsatIndex = () => request('insat');
export const getInsat = (ep) => request(`insat/${ep}`);
export const getIssueInsat = (ep, ts) => request(`issues/${ep}/${ts}/insat`);
export const insatUrl = (ep, slotId) => mlUrl(`insat/${ep}/${slotId}.png`);
// Live tab INSAT cloud-top layer (observation) and the per-alert coldest cloud top near the valid time
export const getLiveInsat = () => request('live-insat');
export const liveInsatUrl = (id) => mlUrl(`live-insat/frames/${id}.png`);
export const getLiveRunInsat = (run) => request(`live/${run}/insat`);
export const getResults = () => request('results');
export const getApproach = () => request('approach');

// CAP 1.2 (checkpoint 05). `src` = { kind: 'replay', ep, ts } or { kind: 'live', run }.
// Nothing is sent anywhere: the XML only comes back to this browser.
const capBase = (src) => (src.kind === 'live' ? `live/${src.run}` : `issues/${src.ep}/${src.ts}`);
export const getAlertCap = (src, alertId) => request(`${capBase(src)}/alerts.cap.xml${q({ alert_id: alertId })}`, undefined, 'text');
export const getApprovedCap = (src, alertId, edits) => request(`${capBase(src)}/alerts/${encodeURIComponent(alertId)}/cap.xml`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ review: 'approved', headline: edits?.headline || null, description: edits?.description || null }),
}, 'text');
