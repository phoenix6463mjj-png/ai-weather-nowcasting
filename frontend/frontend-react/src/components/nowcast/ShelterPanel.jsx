import { MapPin, Crosshair } from 'lucide-react';

// "Nearby shelter options" drawer section. Everything shown comes from /shelters (serve/shelters.py):
// OpenStreetMap public buildings within the stated radius, nearest first, with values only (no
// thresholds, no pass/fail). The alert check covers every alert of the issue or run, at every lead.
export const SHELTER_LABEL = 'Nearby shelter options';

const HZ = { thunderstorm: 'thunderstorm', cloudburst: 'cloudburst', flash_flood: 'flash flood' };
const fmtM = (m) => (m == null ? 'no data' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const signed = (m) => (m == null ? 'no data' : `${m > 0 ? '+' : m < 0 ? '−' : '±'}${Math.abs(m).toLocaleString()} m`);

// leads of the alerts a candidate lies in ("+1, +2, +4 h"), and those at the lead shown on the map,
// per level: "Warning (flash flood, thunderstorm); Watch (cloudburst)"
const insideLeads = (list) => [...new Set(list.map((a) => a.lead_time_h))].sort((a, b) => a - b);
function atLead(list, lead) {
    const by = {};
    for (const a of list.filter((x) => x.lead_time_h === lead)) (by[a.level] = by[a.level] || new Set()).add(HZ[a.hazard] || a.hazard);
    return ['Warning', 'Watch'].filter((l) => by[l]).map((l) => `${l} (${[...by[l]].join(', ')})`).join('; ');
}

const ShelterPanel = ({ point, data, error, loading, selected, onUseAlert, lead, live = false }) => (
    <div data-testid="shelter-panel" className="text-xs">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 space-y-2">
            <p data-testid="shelter-wording" className="text-[11px] font-bold leading-snug text-amber-950 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-800 rounded px-2 py-1.5">
                Candidate public buildings outside the current alert area, not verified shelters. Roads may be blocked. Follow evacuation instructions from district authorities and IMD. Emergency: 112.
            </p>
            {live && (
                <p data-testid="shelter-badge-live" className="text-[11px] font-black text-amber-900 bg-amber-200 rounded px-2 py-1">
                    Live output: not validated. The alert check uses this live run&apos;s alerts.
                </p>
            )}
            {data?.source?.in_sample && (
                <p data-testid="shelter-badge-in-sample" className="text-[11px] font-black text-violet-950 dark:text-violet-100 bg-violet-200 dark:bg-violet-900/60 rounded px-2 py-1">
                    {data.source.sample_label}
                </p>
            )}
            <p className="text-slate-600 dark:text-slate-300">
                <Crosshair size={12} className="inline -mt-0.5 mr-1" />
                Click the map to choose a point{selected ? ', or use the selected alert' : ''}.
            </p>
            {selected?.peak_cell && (
                <button type="button" data-testid="shelter-use-alert" onClick={onUseAlert}
                    className="flex items-center gap-1 font-bold text-blue-700 dark:text-blue-400 hover:underline">
                    <MapPin size={12} /> Use the selected alert&apos;s peak cell ({selected.peak_cell[0].toFixed(2)}N {selected.peak_cell[1].toFixed(2)}E)
                </button>
            )}
        </div>

        {!point && <p className="px-4 py-3 text-slate-500">No point chosen yet.</p>}
        {point && (
            <div data-testid="shelter-point" data-lat={point.lat.toFixed(4)} data-lon={point.lon.toFixed(4)}
                className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                Chosen point: <b>{point.lat.toFixed(3)}N {point.lon.toFixed(3)}E</b>
                {point.source === 'alert' ? ' (selected alert’s peak cell)' : ' (map click)'}
                {data?.available && <> · elevation {data.point.elevation_m != null ? `${data.point.elevation_m.toLocaleString()} m` : 'no data'}</>}
            </div>
        )}
        {point && loading && <p className="px-4 py-3 text-slate-500">Loading…</p>}
        {point && error && <p className="px-4 py-3 text-red-600">{error}</p>}

        {point && !loading && data && !data.available && (
            <div className="px-4 py-3 space-y-1">
                <p data-testid="shelter-not-available" className="font-bold text-slate-800 dark:text-slate-100">{data.message}</p>
                <p className="text-slate-500">Covered: {data.coverage}.</p>
            </div>
        )}

        {point && !loading && data?.available && (
            <div>
                <p data-testid="shelter-summary" className="px-4 pt-3 pb-1 text-slate-600 dark:text-slate-300">
                    {data.n_within_radius} mapped public building{data.n_within_radius === 1 ? '' : 's'} within {data.radius_km} km
                    {data.n_within_radius > data.candidates.length ? `; the nearest ${data.candidates.length} shown` : ''}.
                    Straight-line distance and direction, no route. Alert check: {data.n_alerts_checked} alerts of this {live ? 'run' : 'issue'} ({data.alert_scope}), not only those on the map.
                </p>
                {data.candidates.length === 0 && <p className="px-4 py-2 font-bold">No mapped public building within {data.radius_km} km.</p>}
                <ol className="px-3 py-1 space-y-2">
                    {data.candidates.map((c) => (
                        <li key={c.osm_id} data-testid="shelter-candidate" data-outside={String(c.outside_all_alerts)}
                            data-distance={c.distance_km} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
                            <div className="flex items-start gap-2">
                                <span className={`shrink-0 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center border-2 border-violet-700 ${c.outside_all_alerts ? 'bg-violet-700 text-white' : 'bg-white text-violet-800'}`}>{c.rank}</span>
                                <div className="min-w-0">
                                    <p className="font-black text-slate-900 dark:text-white leading-tight">{c.name || `Unnamed ${c.type_label.toLowerCase()}`}</p>
                                    <p className="text-[11px] text-slate-500">{c.type_label} · OSM {c.osm_id}</p>
                                </div>
                                <span data-testid="shelter-distance" className="ml-auto shrink-0 font-black tabular-nums">{c.distance_km.toFixed(1)} km {c.direction}</span>
                            </div>
                            <p data-testid="shelter-alert-status" className={`mt-1.5 font-bold ${c.outside_all_alerts ? 'text-slate-800 dark:text-slate-100' : 'text-red-700 dark:text-red-400'}`}>
                                {c.outside_all_alerts ? 'Outside all current alerts at every lead'
                                    : `Inside a current alert at +${insideLeads(c.inside_alerts).join(', +')} h`}
                            </p>
                            {!c.outside_all_alerts && atLead(c.inside_alerts, lead) && (
                                <p data-testid="shelter-at-lead" className="text-[11px] text-red-700 dark:text-red-400">
                                    At +{lead} h (shown on the map): {atLead(c.inside_alerts, lead)}
                                </p>
                            )}
                            <dl className="mt-1.5 grid grid-cols-3 gap-1 text-[11px]">
                                <div><dt className="text-slate-500">Slope</dt><dd data-testid="shelter-slope" className="font-bold">{c.slope_deg != null ? `${c.slope_deg}°` : 'no data'}</dd></div>
                                <div><dt className="text-slate-500">Nearest mapped stream</dt><dd data-testid="shelter-stream" className="font-bold">{fmtM(c.stream_distance_m)}</dd></div>
                                <div><dt className="text-slate-500">Elevation vs point</dt><dd data-testid="shelter-elev" className="font-bold">{signed(c.elevation_rel_m)}</dd></div>
                            </dl>
                        </li>
                    ))}
                </ol>
                <div className="px-4 py-3 text-[10px] text-slate-500 dark:text-slate-400 space-y-1 leading-snug">
                    <p>Values only: no thresholds are applied (none cited).</p>
                    <p>Map: ◉ chosen point, dashed circle {data.radius_km} km, numbered dots = these candidates (filled: outside all alerts; hollow: inside an alert).</p>
                    <p>Slope: native 90 m DEM cell. Elevation: 270 m mean DEM cell, same grid for the point. Stream distance: to the nearest OpenStreetMap river/stream line.</p>
                    <p>Covered: {data.coverage}; buildings and streams as mapped in OpenStreetMap (may be incomplete). © OpenStreetMap contributors (ODbL); terrain: Copernicus DEM GLO-90.</p>
                </div>
            </div>
        )}
    </div>
);

export default ShelterPanel;
