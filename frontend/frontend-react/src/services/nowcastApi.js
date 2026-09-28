import { ML_API_BASE } from '../config';

export const mlUrl = (path) => `${ML_API_BASE}/${path.replace(/^\/+/, '')}`;

async function request(path, options, as = 'json') {
    let res;
    try {
        res = await fetch(mlUrl(path), options);
    } catch {
        throw new Error(`Cannot reach the nowcast API at ${ML_API_BASE}. Is it running?`);
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
