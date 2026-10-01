import { lazy, Suspense, useState } from 'react';
import { MapPin, Crosshair, Search, Box } from 'lucide-react';
import ProfileChart from './ProfileChart';

// three.js is only downloaded when the 3D view is opened (separate chunk)
const Terrain3D = lazy(() => import('./Terrain3D'));

// "Nearby shelter options" drawer section. Everything shown comes from /shelters (serve/shelters.py):
// OpenStreetMap public buildings within the stated radius, values only (no thresholds, no pass/fail).
// Candidates outside every current alert (all leads, levels, hazards) are listed first, nearest first;
// those inside an alert are in a separate group, collapsed by default.
export const SHELTER_LABEL = 'Nearby shelter options';

const HZ = { thunderstorm: 'thunderstorm', cloudburst: 'cloudburst', flash_flood: 'flash flood' };
const fmtM = (m) => (m == null ? 'no data' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// leads of the alerts a candidate lies in ("+1, +2, +4 h"), and those at the lead shown on the map,
// per level: "Warning (flash flood, thunderstorm); Watch (cloudburst)"
const insideLeads = (list) => [...new Set(list.map((a) => a.lead_time_h))].sort((a, b) => a - b);
function atLead(list, lead) {
    const by = {};
    for (const a of list.filter((x) => x.lead_time_h === lead)) (by[a.level] = by[a.level] || new Set()).add(HZ[a.hazard] || a.hazard);
    return ['Warning', 'Watch'].filter((l) => by[l]).map((l) => `${l} (${[...by[l]].join(', ')})`).join('; ');
}

const POINT_SOURCE = { alert: ' (selected alert’s peak cell)', click: ' (map click)', site: ' (default: alert peak nearest the documented event site)' };

const Candidate = ({ c, lead, prefix = '' }) => (
    <li data-testid="shelter-candidate" data-outside={String(c.outside_all_alerts)} data-distance={c.distance_km}
        className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
        <div className="flex items-start gap-2">
            <span className={`shrink-0 min-w-5 h-5 px-0.5 rounded-full text-[10px] font-black flex items-center justify-center border-2 border-violet-700 ${c.outside_all_alerts ? 'bg-violet-700 text-white' : 'bg-white text-violet-800'}`}>{prefix}{c.rank}</span>
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
        <dl className="mt-1.5 grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-slate-500">Slope</dt><dt className="text-slate-500">Nearest mapped stream</dt><dt className="text-slate-500">Elevation</dt>
            <dd data-testid="shelter-slope" className="font-bold">{c.slope_deg != null ? `${c.slope_deg}°` : 'no data'}</dd>
            <dd data-testid="shelter-stream" className="font-bold">{fmtM(c.stream_distance_m)}</dd>
            <dd data-testid="shelter-elev" className="font-bold">{c.elevation_rel_text}</dd>
        </dl>
        {c.profile && <ProfileChart p={c.profile} lead={lead} />}
    </li>
);

const ShelterPanel = ({ point, data, error, loading, selected, onUseAlert, onWiden, insideOpen, onInsideToggle, lead, live = false, mapAlerts = [] }) => {
    const [open3d, setOpen3d] = useState(false);
    const pins = data?.available ? [...data.candidates, ...data.inside_candidates.map((c) => ({ ...c, prefix: 'i' }))] : [];
    return (
    <div data-testid="shelter-panel" className="text-xs">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 space-y-2">
            <p data-testid="shelter-wording" className="text-[11px] font-bold leading-snug text-amber-950 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-800 rounded px-2 py-1.5">
                Candidate public buildings outside the current alert area, not verified shelters. Roads may be blocked. Follow evacuation instructions from district authorities and IMD. Emergency: 112.
            </p>
            {data?.advice && (
                <p data-testid="shelter-advice" className="text-[11px] leading-snug text-slate-700 dark:text-slate-200">
                    <span className="font-bold">NDMA flood guidance</span> (&ldquo;{data.advice.section}&rdquo;): &ldquo;{data.advice.quote}&rdquo;{' '}
                    <a data-testid="shelter-advice-source" href={data.advice.url} target="_blank" rel="noreferrer" className="text-blue-700 dark:text-blue-400 underline">
                        {data.advice.source}, {data.advice.page_title}
                    </a>, checked {fmtDate(data.advice.checked)}.
                </p>
            )}
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
            <div data-testid="shelter-point" data-lat={point.lat.toFixed(4)} data-lon={point.lon.toFixed(4)} data-source={point.source}
                className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                Chosen point: <b>{point.lat.toFixed(3)}N {point.lon.toFixed(3)}E</b>{POINT_SOURCE[point.source]}
                {data?.available && <> · elevation {data.point.elevation_m != null ? `${data.point.elevation_m.toLocaleString()} m` : 'no data'}</>}
                {point.source === 'site' && point.text && <p data-testid="shelter-default-text" className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">{point.text}</p>}
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
                    Within {data.radius_km} km: {data.n_within_radius} mapped public building{data.n_within_radius === 1 ? '' : 's'},{' '}
                    {data.n_outside} outside all current alerts, {data.n_inside} inside one.
                    Straight-line distance and direction, no route. Alert check: {data.n_alerts_checked} alerts of this {live ? 'run' : 'issue'} ({data.alert_scope}), not only those on the map.
                </p>
                <div className="px-4 pb-1">
                    <button type="button" data-testid="shelter-3d" onClick={() => setOpen3d(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-600 font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <Box size={13} /> 3D view
                    </button>
                </div>
                {open3d && (
                    <Suspense fallback={<div data-testid="terrain3d-loading" className="fixed inset-0 z-[2000] bg-black/40 flex items-center justify-center text-white text-sm">Loading 3D view…</div>}>
                        <Terrain3D point={point} radiusKm={data.radius_km} pins={pins} alerts={mapAlerts} lead={lead}
                            wording={data.wording} onClose={() => setOpen3d(false)} />
                    </Suspense>
                )}

                {data.none_outside_text ? (
                    <div className="mx-3 my-2 rounded-lg border-2 border-slate-300 dark:border-slate-600 p-2.5 space-y-2">
                        <p data-testid="shelter-none-outside" className="font-black text-slate-900 dark:text-white">{data.none_outside_text}</p>
                        {data.widen_radius_km && (
                            <button type="button" data-testid="shelter-widen" onClick={() => onWiden(data.widen_radius_km)}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-bold">
                                <Search size={12} /> Widen the search to {data.widen_radius_km} km
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <h4 data-testid="shelter-outside-heading" className="px-4 pt-2 text-[10px] font-black uppercase text-slate-500">
                            Outside all current alerts{data.n_outside > data.candidates.length ? ` (nearest ${data.candidates.length} of ${data.n_outside})` : ` (${data.n_outside})`}
                        </h4>
                        <ol data-testid="shelter-outside-list" className="px-3 py-1 space-y-2">
                            {data.candidates.map((c) => <Candidate key={c.osm_id} c={c} lead={lead} />)}
                        </ol>
                    </>
                )}

                {data.n_inside > 0 && (
                    <div className="px-3 py-1">
                        <button type="button" data-testid="shelter-inside-toggle" aria-expanded={insideOpen} onClick={onInsideToggle}
                            className="w-full text-left px-1 py-1.5 font-black text-red-800 dark:text-red-300 hover:underline">
                            {insideOpen ? '▾' : '▸'} Inside a current alert ({data.n_inside})
                            {data.n_inside > data.inside_candidates.length ? <span className="font-normal text-slate-500"> · nearest {data.inside_candidates.length} listed</span> : null}
                        </button>
                        {insideOpen && (
                            <ol data-testid="shelter-inside-list" className="py-1 space-y-2">
                                {data.inside_candidates.map((c) => <Candidate key={c.osm_id} c={c} lead={lead} prefix="i" />)}
                            </ol>
                        )}
                    </div>
                )}

                <div className="px-4 py-3 text-[10px] text-slate-500 dark:text-slate-400 space-y-1 leading-snug">
                    <p>Values only: no thresholds are applied (none cited).</p>
                    <p>Map: ◉ chosen point, dashed circle {data.radius_km} km, filled numbered dots = candidates outside all alerts; hollow &ldquo;i&rdquo; dots = the inside group, while it is open.</p>
                    <p>Slope: native 90 m DEM cell. Elevation: 270 m mean DEM cell, compared with the same grid at the chosen point. Stream distance: to the nearest OpenStreetMap river/stream line.</p>
                    <p>Covered: {data.coverage}; buildings and streams as mapped in OpenStreetMap (may be incomplete). © OpenStreetMap contributors (ODbL); terrain: Copernicus DEM GLO-90.</p>
                </div>
            </div>
        )}
    </div>
    );
};

export default ShelterPanel;
