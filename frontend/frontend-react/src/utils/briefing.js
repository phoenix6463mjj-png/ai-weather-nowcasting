// Overview ("System briefing") helpers: the map view per step, the layers each step shows, the Malana
// scrubber times. Everything is derived from the /api/overview payload.

const pad = (b, d) => [[b[0][0] - d, b[0][1] - d], [b[1][0] + d, b[1][1] + d]];
const boundsOf = (pts) => [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
    [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]];
const polyPoints = (g) => (g?.type === 'MultiPolygon' ? g.coordinates.flat(2) : g?.coordinates?.flat(1) || []).map(([lon, lat]) => [lat, lon]);

export function stepViews(d) {
    if (!d) return null;
    const domain = pad(boundsOf(d.sites.map((s) => [s.lat, s.lon])), 0.6);
    const m = d.malana;
    const cb = m.warnings[1];
    const malana = pad(boundsOf([...polyPoints(cb.polygon), [m.lat, m.lon]]), 0.25);
    const blind = pad(boundsOf([[m.lat, m.lon], ...d.insat.events.map((e) => {
        const s = d.sites.find((x) => x.episode === e.episode);
        return s ? [s.lat, s.lon] : [m.lat, m.lon];
    })]), 0.45);
    const india = d.terrain.bounds;
    return [domain, domain, malana, malana, blind, domain, india, india];
}

export function layerNames(step, data, scrub) {
    if (!data) return [];
    const m = data.malana;
    const at = (iso) => scrub != null && iso.slice(11, 16) <= scrub;
    return [
        ['terrain', 'sites'],
        ['terrain', 'sites-sized-by-imerg'],
        ['terrain-malana', 'site-malana', ...(at(m.warnings[0].issue_time) ? ['thunderstorm-warning'] : []),
            ...(at(m.warnings[1].issue_time) ? ['cloudburst-warning'] : []), ...(at(m.imerg_first_ge30.t) ? ['imerg-ge30'] : [])],
        ['terrain-malana', 'site-malana', 'cloudburst-warning', 'reasons'],
        ['terrain-malana', 'site-malana', 'insat-3dr', 'imerg-blind-sites'],
        ['terrain', 'sites-sized-by-imerg', 'csi'],
        ['live-insat', 'freshness'],
        ['terrain', 'explore'],
    ][step];
}


const hhmm = (iso) => iso.slice(11, 16);
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Step 3: the scrubber's issue times (every 30 min from the first Warning to IMERG's first >=30 mm/hr) and
// the captions that appear at their times.
export function malanaEvents(m) {
    const [tsW, cbW] = m.warnings;
    return [
        { t: hhmm(tsW.issue_time), id: 'ts-warning', text: `${hhmm(tsW.issue_time)}Z · ${tsW.hazard_name} Warning issued` },
        { t: hhmm(cbW.issue_time), id: 'cb-warning', text: `${hhmm(cbW.issue_time)}Z · ${cbW.hazard_name} Warning issued` },
        { t: hhmm(m.window_start), id: 'window', text: `${hhmm(m.window_start)}Z · reported window starts` },
        { t: hhmm(m.imerg_first_ge30.t), id: 'imerg', text: `${hhmm(m.imerg_first_ge30.t)}Z · satellite rain first ≥30 mm/hr` },
    ];
}

export function scrubTimes(m) {
    const ev = malanaEvents(m).map((e) => toMin(e.t));
    const out = [];
    for (let t = Math.min(...ev); t <= Math.max(...ev); t += 30) out.push(fromMin(t));
    return out;
}
