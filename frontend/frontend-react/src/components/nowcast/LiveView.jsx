import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getLiveRuns, getLiveMeta, getLiveAlerts, liveMapUrl } from '../../services/nowcastApi';
import { HAZARDS, HAZARD_STYLE, LEVEL_STYLE, valueText, kindText, fmtUtc, defaultLead, FIELD_OPTIONS } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import MapControls from './MapControls';
import MapLegend from './MapLegend';
import AlertList from './AlertList';
import IMDChip from './IMDChip';
import useTerrain from './useTerrain';

const LIVE_FIELDS = FIELD_OPTIONS.filter((o) => o.id !== 'flash_flood');

// Live alerts carry only the model's top-5 reasons (no explain.json, no verification).
const LiveAlertPanel = ({ a, onClose }) => (
    <div data-testid="explain-panel" data-hazard={a.hazard}>
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: HAZARD_STYLE[a.hazard].color }} />
                <h3 className="text-base font-black">{HAZARD_STYLE[a.hazard].name}</h3>
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${LEVEL_STYLE[a.level]?.badge}`}>{a.level}</span>
                <IMDChip level={a.level} />
                <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><X size={16} /></button>
            </div>
            <p data-testid="explain-value" className="text-2xl font-black mt-1 tabular-nums">{valueText(a)}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{kindText(a)}</p>
            <p className="mt-1.5 text-[11px] font-black text-amber-900 bg-amber-200 rounded px-2 py-1">
                Live output: system running operationally, NOT validated
            </p>
        </div>
        <div className="px-4 py-3 text-xs space-y-0.5 border-b border-slate-100 dark:border-slate-800">
            <p>Issued {fmtUtc(a.issue_time)}</p>
            <p>Valid {fmtUtc(a.valid_time)} (lead {a.lead_time_h} h{a.radius_km ? `, within ${a.radius_km} km` : ''})</p>
            <p>peak {a.peak_cell[0].toFixed(2)}N {a.peak_cell[1].toFixed(2)}E · {Math.round(a.area_km2).toLocaleString()} km²</p>
            <p className="text-slate-500">No observed verification exists for live runs.</p>
        </div>
        <div className="px-4 py-3">
            <h4 className="text-[10px] font-black uppercase text-slate-500 mb-1.5">Why: top reasons</h4>
            <ul className="space-y-1.5">
                {(a.explanations || []).map((e) => (
                    <li key={e.concept} className="flex items-start gap-1.5 text-xs">
                        {e.effect === 'raises risk' ? <ArrowUpRight size={14} className="text-red-600 shrink-0 mt-0.5" />
                            : <ArrowDownRight size={14} className="text-emerald-600 shrink-0 mt-0.5" />}
                        <span>{e.text}</span>
                    </li>
                ))}
            </ul>
        </div>
    </div>
);

const LiveView = () => {
    const [runs, setRuns] = useState(null);
    const [meta, setMeta] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const [lead, setLead] = useState(null);
    const [hazards, setHazards] = useState(HAZARDS);
    const [showWatch, setShowWatch] = useState(false);
    const [field, setField] = useState('');
    const terrain = useTerrain('national');
    const [selected, setSelected] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let live = true;
        getLiveRuns().then(async (r) => {
            if (!live) return;
            setRuns(r);
            if (!r.runs.length) return;
            const run = r.runs[0].run;
            const [m, a] = await Promise.all([getLiveMeta(run), getLiveAlerts(run)]);
            if (!live) return;
            setMeta(m);
            setAlerts(a.alerts);
            setLead(defaultLead(a.alerts, m.leads_available));
        }).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, []);

    const shown = useMemo(() => alerts.filter((a) =>
        a.lead_time_h === lead && hazards.includes(a.hazard) && (showWatch || a.level === 'Warning')), [alerts, lead, hazards, showWatch]);
    const counts = useMemo(() => {
        const c = {};
        for (const a of alerts) if (a.lead_time_h === lead && (showWatch || a.level === 'Warning')) c[a.hazard] = (c[a.hazard] || 0) + 1;
        return c;
    }, [alerts, lead, showWatch]);
    const hiddenWatch = alerts.filter((a) => a.lead_time_h === lead && hazards.includes(a.hazard) && a.level === 'Watch').length;
    const overlays = meta && lead && field ? [{ url: liveMapUrl(meta.run, lead, field), opacity: 1, zIndex: 1, kind: `field-${field}` }] : [];

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div data-testid="live-not-validated" className="px-6 py-2.5 bg-amber-100 dark:bg-amber-950/50 border-b-2 border-amber-400 flex items-start gap-3 shrink-0">
                <AlertTriangle size={20} className="text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-950 dark:text-amber-100">
                    <p className="text-sm font-black">System running operationally — NOT validated. These are not validated warnings.</p>
                    <p>{runs?.label}</p>
                    {meta && (
                        <p className="mt-0.5">
                            Issued {fmtUtc(meta.issue_time)} (one frozen run, not refreshing) ·
                            rain input ~{(meta.latency_min.imerg / 60).toFixed(1)} h old (IMERG Early), environment ~{(meta.latency_min.gfs / 60).toFixed(1)} h old (GFS) ·
                            flash flood not computed on the national live grid
                        </p>
                    )}
                </div>
            </div>
            {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}
            {runs && !runs.runs.length && <p className="p-6 text-sm">No live runs available.</p>}
            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 relative">
                    {meta && <AlertMap bounds={meta.bounds} alerts={shown} selectedId={selected?.alert_id} onSelect={setSelected} overlays={overlays} dimFill={!!field}
                        terrain={terrain.layers} terrainNotice={terrain.fullNotice} />}
                    {meta && lead && (
                        <div className="absolute top-3 right-3 z-[400]">
                            <MapControls leads={meta.leads_available} lead={lead} setLead={setLead}
                                hazards={hazards} setHazards={setHazards} showWatch={showWatch} setShowWatch={setShowWatch}
                                counts={counts} field={field} setField={setField} fieldOptions={LIVE_FIELDS} terrain={terrain} />
                        </div>
                    )}
                    {meta && (
                        <div className="absolute bottom-3 left-3 z-[400]">
                            <MapLegend legends={meta.legends} field={field} observed={false} missed={false} verification={false}
                                note="Live: no observed verification layer." />
                        </div>
                    )}
                </div>
                <aside className="w-[400px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] overflow-y-auto">
                    {selected ? <LiveAlertPanel key={selected.alert_id} a={selected} onClose={() => setSelected(null)} /> : (
                        <>
                            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                                <h3 className="text-sm font-black">Live run {meta?.run}</h3>
                                {lead && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Lead {lead} h: {shown.length} alert{shown.length === 1 ? '' : 's'} shown (not validated)</p>}
                                {!showWatch && hiddenWatch > 0 && (
                                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">{hiddenWatch} Watch alert{hiddenWatch === 1 ? '' : 's'} hidden at this lead. Tick "Also show Watch".</p>
                                )}
                            </div>
                            <AlertList alerts={shown} selectedId={selected?.alert_id} onSelect={setSelected}
                                emptyText={showWatch ? 'No live alerts at this lead.' : 'No live Warnings at this lead. Tick "Also show Watch".'} />
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default LiveView;
