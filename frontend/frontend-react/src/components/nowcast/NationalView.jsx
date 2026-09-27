import { useEffect, useState } from 'react';
import { MapIcon } from 'lucide-react';
import { getIndiaMeta, indiaMapUrl } from '../../services/nowcastApi';
import { fmtUtc, FIELD_OPTIONS } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import MapControls from './MapControls';
import MapLegend from './MapLegend';

// The national sample has no flash-flood guidance (all-empty placeholder band), so it is not offered.
const INDIA_FIELDS = FIELD_OPTIONS.filter((o) => o.id && o.id !== 'flash_flood');

const NationalView = () => {
    const [meta, setMeta] = useState(null);
    const [error, setError] = useState(null);
    const [lead, setLead] = useState(1);
    const [field, setField] = useState('thunderstorm');

    useEffect(() => {
        getIndiaMeta().then(setMeta).catch((e) => setError(e.message));
    }, []);

    const overlays = meta && field ? [{ url: indiaMapUrl(lead, field), opacity: 1, zIndex: 1, kind: `field-${field}` }] : [];

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div data-testid="india-banner" className="px-6 py-2.5 bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-900 flex items-start gap-3 shrink-0">
                <MapIcon size={18} className="text-sky-700 dark:text-sky-300 mt-0.5 shrink-0" />
                <div className="text-xs text-slate-800 dark:text-slate-200">
                    <p className="font-black">
                        National sample: probability map only. No alerts are produced for the national grid,
                        and the flash-flood layer is a placeholder (not computed).
                    </p>
                    {meta && <p className="text-slate-600 dark:text-slate-400">Issued {fmtUtc(meta.issue_time)} · precomputed, not live · model {meta.model}</p>}
                </div>
            </div>
            {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}
            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 relative">
                    {meta && <AlertMap bounds={meta.bounds} overlays={overlays} alerts={[]} />}
                    {meta && (
                        <div className="absolute top-3 right-3 z-[400]">
                            <MapControls leads={meta.leads_available} lead={lead} setLead={setLead}
                                field={field} setField={setField} fieldOptions={INDIA_FIELDS} alertControls={false} />
                        </div>
                    )}
                    {meta && (
                        <div className="absolute bottom-3 left-3 z-[400]">
                            <MapLegend legends={meta.legends} field={field} alerts={false} observed={false} missed={false} />
                        </div>
                    )}
                </div>
                <aside className="w-[400px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] overflow-y-auto p-4 space-y-3">
                    <h3 className="text-sm font-black">About this map</h3>
                    <ul data-testid="india-notes" className="space-y-2">
                        {(meta?.notes || []).map((n) => (
                            <li key={n} className="text-xs text-slate-700 dark:text-slate-300 leading-snug">• {n}</li>
                        ))}
                    </ul>
                    {meta && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                            <p>Flash flood: {meta.hazards.flash_flood}</p>
                            <p>Cloudburst: {meta.hazards.cloudburst}</p>
                            <p>Grid: {meta.grid.nrows} × {meta.grid.ncols} cells at {meta.grid.cell_size_deg}°</p>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default NationalView;
