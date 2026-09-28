import { useCallback, useEffect, useState } from 'react';
import { MapIcon, Info } from 'lucide-react';
import { getIndiaMeta, indiaMapUrl } from '../../services/nowcastApi';
import { fmtUtc, FIELD_OPTIONS } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import MapControls from './MapControls';
import MapLegend from './MapLegend';
import useTerrain from './useTerrain';
import Drawer from './Drawer';
import LayersPanel from './LayersPanel';
import CaveatsPanel from './CaveatsPanel';
import { MapBadges } from './MapFrame';

// The national sample has no flash-flood guidance (all-empty placeholder band), so it is not offered.
const INDIA_FIELDS = FIELD_OPTIONS.filter((o) => o.id && o.id !== 'flash_flood');

const NationalView = () => {
    const [meta, setMeta] = useState(null);
    const [error, setError] = useState(null);
    const [lead, setLead] = useState(1);
    const [field, setField] = useState('thunderstorm');
    const terrain = useTerrain('national');
    const [drawer, setDrawer] = useState(null);
    const closeDrawer = useCallback(() => setDrawer(null), []);

    useEffect(() => {
        getIndiaMeta().then(setMeta).catch((e) => setError(e.message));
    }, []);

    const overlays = meta && field ? [{ url: indiaMapUrl(lead, field), opacity: 1, zIndex: 1, kind: `field-${field}` }] : [];
    const tabs = [
        { id: 'about', label: 'About map', icon: MapIcon, width: 400 },
        { id: 'caveats', label: 'Caveats', icon: Info, width: 420 },
    ];

    return (
        <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
                <MapBadges testid="india-banner" tone="bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-900">
                    <MapIcon size={16} className="text-sky-700 dark:text-sky-300 shrink-0" />
                    <div className="text-[11px] text-slate-800 dark:text-slate-200 leading-snug">
                        <p className="font-black">
                            National sample: probability map only. No alerts are produced for the national grid,
                            and the flash-flood layer is a placeholder (not computed).
                        </p>
                        {meta && <p className="text-slate-600 dark:text-slate-400">Issued {fmtUtc(meta.issue_time)} · precomputed, not live · model {meta.model}</p>}
                    </div>
                </MapBadges>
                {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}
                <div className="flex-1 relative min-h-0">
                    {meta && <AlertMap bounds={meta.bounds} overlays={overlays} alerts={[]} terrain={terrain.layers} terrainNotice={terrain.fullNotice} />}
                    {meta && (
                        <div className="absolute top-3 left-3 bottom-3 z-[400] flex flex-col pointer-events-none">
                            <LayersPanel summary={`National · L${lead} h · ${INDIA_FIELDS.find((o) => o.id === field)?.label || ''}`}>
                                <MapControls leads={meta.leads_available} lead={lead} setLead={setLead}
                                    field={field} setField={setField} fieldOptions={INDIA_FIELDS} alertControls={false} terrain={terrain} />
                            </LayersPanel>
                        </div>
                    )}
                    {meta && (
                        <div className="absolute top-[84px] bottom-[26px] right-3 z-[400] flex flex-col justify-end pointer-events-none">
                            <MapLegend legends={meta.legends} field={field} terrain={terrain.layers.length > 0} />
                        </div>
                    )}
                </div>
            </div>
            <Drawer tabs={tabs} active={drawer} onOpen={setDrawer} onClose={closeDrawer}>
                {(id) => (id === 'about' ? (
                    <div className="p-4 space-y-3">
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
                    </div>
                ) : <CaveatsPanel />)}
            </Drawer>
        </div>
    );
};

export default NationalView;
