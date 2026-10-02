import { useCallback, useEffect, useState } from 'react';
import { MapIcon, Info } from 'lucide-react';
import { getIndiaMeta, indiaMapUrl } from '../../services/nowcastApi';
import { nowcastTarget } from '../../utils/nowcastUrl';
import { fmtUtc, FIELD_OPTIONS } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import { ABOVE_ATTRIBUTION } from '../../utils/mapLayout';
import MapControls from './MapControls';
import MapLegend from './MapLegend';
import useTerrain from './useTerrain';
import Drawer from './Drawer';
import LayersPanel from './LayersPanel';
import CaveatsPanel from './CaveatsPanel';
import { StatusLine } from './MapFrame';
import { periodOf, withoutIds } from '../../utils/plainText';

// The all-India example has no flash-flood guidance (all-empty placeholder band), so it is not offered.
const INDIA_FIELDS = FIELD_OPTIONS.filter((o) => o.id && o.id !== 'flash_flood');

const NationalView = ({ mapOverlay = null }) => {
    const [meta, setMeta] = useState(null);
    const [error, setError] = useState(null);
    const [lead, setLead] = useState(() => nowcastTarget().lead || 1);
    const [field, setField] = useState(() => (['thunderstorm', 'cloudburst_index', 'rain_p10', 'rain_p1', 'rain_p30'].includes(nowcastTarget().field)
        ? nowcastTarget().field : 'thunderstorm'));
    const terrain = useTerrain('national');
    const [drawer, setDrawer] = useState(null);
    const closeDrawer = useCallback(() => setDrawer(null), []);

    useEffect(() => {
        getIndiaMeta().then(setMeta).catch((e) => setError(e.message));
    }, []);

    const inputNote = meta?.notes?.find((n) => n.startsWith('Input frames come from'));     // its time/source, from the data
    const overlays = meta && field ? [{ url: indiaMapUrl(lead, field), opacity: 1, zIndex: 1, kind: `field-${field}` }] : [];
    const tabs = [
        { id: 'about', label: 'About map', icon: MapIcon, width: 400 },
        { id: 'caveats', label: 'Caveats', icon: Info, width: 420 },
    ];

    return (
        <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
                <StatusLine testid="india-banner" tone="bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-900" details={
                    <p className="text-slate-700 dark:text-slate-300">
                        One precomputed nowcast for the whole country{inputNote ? ` (${withoutIds(inputNote).replace(/^Input frames come from /, 'inputs from ').replace(/\.$/, '')})` : ''}.
                        It is a probability map only. No alerts are produced for the national grid,
                        and the flash-flood layer is a placeholder (not computed) · model {meta?.model}
                    </p>}>
                    <MapIcon size={16} className="text-sky-700 dark:text-sky-300 shrink-0" />
                    {meta && (
                        <p data-testid="india-subtitle" className="text-base font-black text-slate-800 dark:text-slate-100 min-w-0">
                            All of India at one past time: {fmtUtc(meta.issue_time, false)}{periodOf(inputNote) ? ` (${periodOf(inputNote)})` : ''}. Probability map only, not live.
                        </p>
                    )}
                </StatusLine>
                {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}
                <div className="flex-1 relative min-h-0">
                    {meta && <AlertMap bounds={meta.bounds} overlays={overlays} alerts={[]} terrain={terrain.layers} terrainNotice={terrain.fullNotice} />}
                    {meta && (
                        <div className="absolute top-3 left-3 z-[400] flex flex-col pointer-events-none" style={ABOVE_ATTRIBUTION}>
                            <LayersPanel summary={`All-India · L${lead} h · ${INDIA_FIELDS.find((o) => o.id === field)?.label || ''}`}>
                                <MapControls leads={meta.leads_available} lead={lead} setLead={setLead}
                                    field={field} setField={setField} fieldOptions={INDIA_FIELDS} alertControls={false} terrain={terrain} />
                            </LayersPanel>
                        </div>
                    )}
                    {mapOverlay}
                    {meta && (
                        <div className="absolute top-[84px] right-3 z-[400] flex flex-col justify-end pointer-events-none" style={ABOVE_ATTRIBUTION}>
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
                                <li key={n} className="text-base text-slate-700 dark:text-slate-300 leading-normal">• {withoutIds(n)}</li>
                            ))}
                        </ul>
                        {meta && (
                            <div className="text-sm text-slate-500 dark:text-slate-400 space-y-0.5">
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
