// /nowcast URL parameters (links from the Analytics page): view=replay|india|live, ep, ts, run (an older live run;
// default = the newest), lead, hazard, watch=1.
// Read once when a view loads; invalid values are ignored.
const HAZARD_IDS = ['thunderstorm', 'cloudburst', 'flash_flood'];

export function nowcastTarget() {
    const q = new URLSearchParams(window.location.search);
    const lead = Number(q.get('lead'));
    const hz = q.get('hazard');
    return {
        view: ['replay', 'india', 'live'].includes(q.get('view')) ? q.get('view') : null,
        ep: q.get('ep'), ts: q.get('ts'), run: q.get('run'),
        lead: Number.isFinite(lead) && lead > 0 ? lead : null,
        hazard: HAZARD_IDS.includes(hz) ? hz : null,
        watch: q.get('watch') === '1',
        field: q.get('field'),
    };
}

export function nowcastLink({ view, ep, ts, run, lead, hazard, watch, field }) {
    const q = new URLSearchParams();
    if (view && view !== 'replay') q.set('view', view);
    if (ep) q.set('ep', ep);
    if (ts) q.set('ts', ts);
    if (run) q.set('run', run);
    if (lead) q.set('lead', String(lead));
    if (hazard) q.set('hazard', hazard);
    if (watch) q.set('watch', '1');
    if (field) q.set('field', field);
    return `/nowcast?${q.toString()}`;
}
