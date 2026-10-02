import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ArrowUpRight, ArrowDownRight, BellRing, FlaskConical, Info, Building2 } from 'lucide-react';
import { getLiveRuns, getLiveMeta, getLiveAlerts, getShelters, liveMapUrl, getLiveInsat, liveInsatUrl, getLiveRunInsat, getComputeLatency } from '../../services/nowcastApi';
import { HAZARDS, HAZARD_STYLE, LEVEL_STYLE, valueText, kindText, fmtUtc, defaultLead, FIELD_OPTIONS } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import { ABOVE_ATTRIBUTION } from '../../utils/mapLayout';
import { numberShelters } from '../../utils/shelterNumbers';
import MapControls from './MapControls';
import MapToolbar from './MapToolbar';
import MapLegend from './MapLegend';
import AlertList from './AlertList';
import IMDChip from './IMDChip';
import CapReview from './CapReview';
import useTerrain from './useTerrain';
import Drawer from './Drawer';
import LayersPanel from './LayersPanel';
import IngredientsTab from './IngredientsTab';
import CaveatsPanel from './CaveatsPanel';
import ShelterPanel, { SHELTER_LABEL } from './ShelterPanel';
import LiveInsatControl from './LiveInsatControl';
import { nowcastTarget } from '../../utils/nowcastUrl';
import { StatusLine } from './MapFrame';
import FreshnessStrip from './FreshnessStrip';

const LIVE_FIELDS = FIELD_OPTIONS.filter((o) => o.id !== 'flash_flood');
const LIVE_INGREDIENTS_NOTE = 'no per-feature SHAP is stored for live runs';

// Live alerts carry only the model's top-5 reasons (no explain.json, no verification).
const LiveAlertPanel = ({ a, run, onBack, onIngredients, review, onReview, insatNear }) => (
    <div data-testid="explain-panel" data-hazard={a.hazard}>
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: HAZARD_STYLE[a.hazard].color }} />
                <h3 className="text-lg font-black">{HAZARD_STYLE[a.hazard].name}</h3>
                <span className={`text-sm font-black px-1.5 py-0.5 rounded ${LEVEL_STYLE[a.level]?.badge}`}>{a.level}</span>
                <IMDChip level={a.level} large />
                <button onClick={onBack} title="Back to list"
                    className="ml-auto flex items-center gap-0.5 px-1.5 py-1 rounded text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <ChevronLeft size={14} /> List
                </button>
            </div>
            <p data-testid="explain-value" className="text-2xl font-black mt-1 tabular-nums">{valueText(a)}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{kindText(a)}</p>
            <p className="mt-1.5 text-sm font-black text-amber-900 bg-amber-200 rounded px-2 py-1">
                Live output: system running operationally, NOT validated
            </p>
        </div>
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <h4 className="text-sm font-black uppercase text-slate-500 mb-1.5">Forecaster review (CAP 1.2, demo)</h4>
            <CapReview src={{ kind: 'live', run }} alertId={a.alert_id} review={review} onChange={onReview} />
        </div>
        <div className="px-4 py-3 text-base space-y-0.5 border-b border-slate-100 dark:border-slate-800">
            <p>Issued {fmtUtc(a.issue_time)}</p>
            <p>Valid {fmtUtc(a.valid_time)} (lead {a.lead_time_h} h{a.radius_km ? `, within ${a.radius_km} km` : ''})</p>
            <p>peak {a.peak_cell[0].toFixed(2)}N {a.peak_cell[1].toFixed(2)}E · {Math.round(a.area_km2).toLocaleString()} km²</p>
            <p className="text-slate-500">No observed verification exists for live runs.</p>
        </div>
        <div data-testid="live-alert-insat" className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <h4 className="text-sm font-black uppercase text-slate-500 mb-1">INSAT cloud tops (satellite observation, INSAT via MOSDAC)</h4>
            <p data-testid="live-alert-insat-text" data-available={insatNear ? String(insatNear.available) : ''} className="text-base">
                {insatNear ? insatNear.text : 'Loading…'}
            </p>
            {insatNear?.available && (insatNear.lines || []).map((l) => <p key={l} data-testid="live-alert-insat-line" className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">{l}</p>)}
        </div>
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <h4 className="text-sm font-black uppercase text-slate-500 mb-1">Ingredients</h4>
            <button type="button" data-testid="explain-open-ingredients" onClick={onIngredients}
                className="flex items-center gap-1.5 text-base font-bold text-blue-700 dark:text-blue-400 hover:underline">
                <FlaskConical size={13} /> Ingredients section (not available for live runs)
            </button>
        </div>
        <div className="px-4 py-3">
            <h4 className="text-sm font-black uppercase text-slate-500 mb-1.5">Why: top reasons</h4>
            <ul className="space-y-1.5">
                {(a.explanations || []).map((e) => (
                    <li key={e.concept} className="flex items-start gap-1.5 text-base">
                        {e.effect === 'raises risk' ? <ArrowUpRight size={14} className="text-red-600 shrink-0 mt-0.5" />
                            : <ArrowDownRight size={14} className="text-emerald-600 shrink-0 mt-0.5" />}
                        <span>{e.text}</span>
                    </li>
                ))}
            </ul>
        </div>
    </div>
);

// "26 Sep run (8 alerts)": day and alert count read from /api/live
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const runLinkText = (r) => {
    const d = new Date(r.issue_time);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} run`
        + (r.n_alerts != null ? ` (${r.n_alerts} alert${r.n_alerts === 1 ? '' : 's'})` : '');
};

const LiveView = ({ mapOverlay = null }) => {
    const [runs, setRuns] = useState(null);
    const [meta, setMeta] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const [lead, setLead] = useState(null);
    const [hazards, setHazards] = useState(HAZARDS);
    const [showWatch, setShowWatch] = useState(false);
    const [field, setField] = useState('thunderstorm');       // probability layer on by default: the map is never empty
    const [runId, setRunId] = useState(null);
    const [compute, setCompute] = useState(null);
    const terrain = useTerrain('national');
    const [selected, setSelected] = useState(null);
    const [error, setError] = useState(null);
    const [drawer, setDrawer] = useState(null);
    const [reviews, setReviews] = useState({});            // forecaster review per alert (this page only; never sent)
    // INSAT cloud-top layer (observation; off by default) and the per-alert coldest cloud top near the valid time
    const [insatLayer, setInsatLayer] = useState(null);
    const [insatOn, setInsatOn] = useState(false);
    const [insatFrame, setInsatFrame] = useState(null);
    const [insatOpacity, setInsatOpacity] = useState(0.75);
    const [insatNear, setInsatNear] = useState(null);
    useEffect(() => {
        let live = true;
        getLiveInsat().then((r) => live && setInsatLayer(r)).catch(() => {});
        getComputeLatency().then((r) => live && setCompute(r.compute)).catch(() => {});
        return () => { live = false; };
    }, []);
    useEffect(() => {
        if (!meta?.run) return undefined;
        let live = true;
        getLiveRunInsat(meta.run).then((r) => live && setInsatNear(r)).catch(() => {});
        return () => { live = false; };
    }, [meta?.run]);
    const insatShown = insatOn && insatLayer?.available ? (insatLayer.frames.find((f) => f.id === insatFrame) || insatLayer.latest) : null;
    const closeDrawer = useCallback(() => setDrawer(null), []);
    const select = (a) => { setSelected(a); if (a) setDrawer('alert'); };
    const [shelterPt, setShelterPtRaw] = useState(null);    // { lat, lon, source: 'click' | 'alert' }
    const [radius, setRadius] = useState(25);               // 25 km, or 50 km after "Widen the search"
    const [insideOpen, setInsideOpen] = useState(false);    // "Inside a current alert (N)" group, collapsed by default
    const setShelterPt = (p) => { setShelterPtRaw(p); setRadius(25); setInsideOpen(false); };
    const [shelter, setShelter] = useState({ key: null, data: null, error: null });
    const pointFromAlert = () => selected?.peak_cell && setShelterPt({ lat: selected.peak_cell[0], lon: selected.peak_cell[1], source: 'alert' });
    const openDrawer = (id) => {
        if (id === 'shelter' && !shelterPt) pointFromAlert();
        setDrawer(id);
    };
    const shelterOpen = drawer === 'shelter';
    const run = meta?.run;
    const shelterKey = shelterPt && run ? `${run}/${shelterPt.lat.toFixed(4)}/${shelterPt.lon.toFixed(4)}/${radius}` : null;
    useEffect(() => {
        if (!shelterKey) return undefined;
        let live = true;
        getShelters({ kind: 'live', run }, shelterPt.lat, shelterPt.lon, radius)
            .then((r) => live && setShelter({ key: shelterKey, data: r, error: null }))
            .catch((e) => live && setShelter({ key: shelterKey, data: null, error: e.message }));
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shelterKey]);
    const sh = shelter.key === shelterKey ? shelter : { data: null, error: null };

    useEffect(() => {
        let live = true;
        getLiveRuns().then((r) => {
            if (!live) return;
            setRuns(r);
            if (!r.runs.length) return;
            const tg = nowcastTarget();                       // link from Analytics: run / lead / hazard / watch
            // the newest run by default; an older run via ?view=live&run=<id> or the "See the ... run" link
            setRunId((tg.view === 'live' && r.runs.find((x) => x.run === tg.run)?.run) || r.runs[0].run);
        }).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, []);
    const urlTargetUsed = useRef(false);
    useEffect(() => {
        if (!runId) return undefined;
        let live = true;
        Promise.all([getLiveMeta(runId), getLiveAlerts(runId)]).then(([m, a]) => {
            if (!live) return;
            const tg = urlTargetUsed.current ? {} : nowcastTarget();        // the URL target applies to the first run shown
            urlTargetUsed.current = true;
            const fromUrl = tg.view === 'live';
            setSelected(null); setShelterPtRaw(null);
            setMeta(m);
            setAlerts(a.alerts);
            setLead(fromUrl && tg.lead && m.leads_available.includes(tg.lead) ? tg.lead : defaultLead(a.alerts, m.leads_available));
            if (fromUrl && tg.hazard) setHazards([tg.hazard]);
            if (fromUrl && tg.watch) setShowWatch(true);
        }).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, [runId]);
    // link between the newest run and the older one, with its alert count (from /api/live)
    const otherRun = runs && runId ? (runId === runs.runs[0]?.run ? runs.runs[1] : runs.runs[0]) : null;

    const shown = useMemo(() => alerts.filter((a) =>
        a.lead_time_h === lead && hazards.includes(a.hazard) && (showWatch || a.level === 'Warning')), [alerts, lead, hazards, showWatch]);
    const counts = useMemo(() => {
        const c = {};
        for (const a of alerts) if (a.lead_time_h === lead && (showWatch || a.level === 'Warning')) c[a.hazard] = (c[a.hazard] || 0) + 1;
        return c;
    }, [alerts, lead, showWatch]);
    const hiddenWatch = alerts.filter((a) => a.lead_time_h === lead && hazards.includes(a.hazard) && a.level === 'Watch').length;
    const overlays = [
        // INSAT observation below the forecast raster (frame bounds = the live run's grid bounds)
        ...(insatShown ? [{ url: liveInsatUrl(insatShown.id), opacity: insatOpacity, zIndex: 0, kind: 'insat live-insat' }] : []),
        ...(meta && lead && field ? [{ url: liveMapUrl(meta.run, lead, field), opacity: 1, zIndex: 1, kind: `field-${field}` }] : []),
    ];

    const tabs = [
        { id: 'alert', label: 'Alert', icon: BellRing, width: 420 },
        { id: 'ingredients', label: 'Ingredients', icon: FlaskConical, width: 420 },
        { id: 'shelter', label: SHELTER_LABEL, short: 'Shelter options', icon: Building2, width: 440 },
        { id: 'caveats', label: 'Caveats', icon: Info, width: 420 },
    ];

    return (
        <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
                <StatusLine testid="live-not-validated" tone="bg-amber-100 dark:bg-amber-950/50 border-b-2 border-amber-400 text-amber-950 dark:text-amber-100" details={<>
                    <p>These are not validated warnings. {runs?.label}
                        {meta && <> · Issued {fmtUtc(meta.issue_time)} (one frozen run, not refreshing) · flash flood not computed on the national live grid</>}</p>
                    <FreshnessStrip meta={meta} insat={insatLayer} compute={compute} />
                </>}>
                    <AlertTriangle size={18} className="text-amber-700 dark:text-amber-400 shrink-0" />
                    <span className="text-base font-black">System running operationally — NOT validated</span>
                    {meta && <span className="text-sm">Issued {fmtUtc(meta.issue_time, false)}</span>}
                    {meta?.no_alert_text && <span data-testid="live-no-alerts" className="text-sm font-black">{meta.no_alert_text}</span>}
                    {otherRun && (
                        <button type="button" data-testid="live-other-run" data-run={otherRun.run} onClick={() => setRunId(otherRun.run)}
                            className="text-sm font-bold underline text-blue-800 dark:text-blue-300">
                            {otherRun.run === runs.runs[0].run ? 'Back to the newest run: ' : 'See the '}{runLinkText(otherRun)}
                        </button>
                    )}
                </StatusLine>
                {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}
                {meta && lead && <MapToolbar leads={meta.leads_available} lead={lead} setLead={setLead} showWatch={showWatch} setShowWatch={setShowWatch} />}
                {runs && !runs.runs.length && <p className="p-6 text-sm">No live runs available.</p>}
                <div className="flex-1 relative min-h-0">
                    {meta && <AlertMap bounds={meta.bounds} alerts={shown} selectedId={selected?.alert_id} onSelect={select} overlays={overlays} dimFill={!!field}
                        terrain={terrain.layers} terrainNotice={terrain.fullNotice}
                        onPick={shelterOpen ? (p) => setShelterPt({ ...p, source: 'click' }) : null}
                        shelter={shelterOpen && shelterPt ? { point: shelterPt, radiusKm: sh.data?.radius_km, candidates: [
                                ...numberShelters(sh.data).outside,
                                ...(insideOpen ? numberShelters(sh.data).inside : [])] } : null} />}
                    {meta && lead && (
                        <div className="absolute top-3 left-3 z-[400] flex flex-col pointer-events-none" style={ABOVE_ATTRIBUTION}>
                            <LayersPanel summary={`Live ${meta.run} · L${lead} h · ${showWatch ? 'Watch + Warning' : 'Warnings'}`}>
                                <MapControls hazards={hazards} setHazards={setHazards}
                                    counts={counts} field={field} setField={setField} fieldOptions={LIVE_FIELDS} terrain={terrain} />
                                <LiveInsatControl layer={insatLayer} on={insatOn} setOn={setInsatOn} frameId={insatShown?.id}
                                    setFrameId={setInsatFrame} opacity={insatOpacity} setOpacity={setInsatOpacity} />
                            </LayersPanel>
                        </div>
                    )}
                    {mapOverlay}
                    {meta && (
                        <div className="absolute top-[84px] right-3 z-[400] flex flex-col justify-end pointer-events-none" style={ABOVE_ATTRIBUTION}>
                            <MapLegend legends={meta.legends} field={field} hazards={hazards} verification={false} showWatch={showWatch}
                                terrain={terrain.layers.length > 0} noteTitle="Verification" note="Live: no observed verification layer."
                                insat={insatShown ? { classes: insatLayer.colour_scale.classes, lines: insatLayer.lines, floorLine: insatShown.floor_line, satellite: insatShown.satellite } : null} />
                        </div>
                    )}
                </div>
            </div>
            <Drawer tabs={tabs} active={drawer} onOpen={openDrawer} onClose={closeDrawer}>
                {(id) => (id === 'alert' ? (
                    selected ? <LiveAlertPanel key={selected.alert_id} a={selected} run={meta?.run} onBack={() => setSelected(null)} onIngredients={() => setDrawer('ingredients')}
                        insatNear={insatNear ? { ...(insatNear.alerts[selected.alert_id] || { available: false, text: 'No INSAT frame near this alert\'s valid time' }), lines: insatNear.lines } : null}
                        review={reviews[selected.alert_id]} onReview={(r) => setReviews((m) => ({ ...m, [selected.alert_id]: r }))} /> : (
                        <div data-testid="alert-list-view">
                            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                                <h3 className="text-base font-black">Live run {meta?.run}</h3>
                                {lead && alerts.length > 0 && <p className="text-base text-slate-600 dark:text-slate-300 mt-1">Lead {lead} h: {shown.length} alert{shown.length === 1 ? '' : 's'} shown (not validated)</p>}
                                {lead && alerts.length === 0 && meta && (
                                    <div data-testid="live-empty-run" className="text-base text-slate-700 dark:text-slate-200 mt-1 space-y-1.5">
                                        <p className="font-bold">{meta.no_alert_text || 'No Watch or Warning in this run.'}</p>
                                        {meta.thunderstorm_max?.per_lead_text?.[lead] && (
                                            <p data-testid="live-empty-lead">At +{lead} h the highest thunderstorm probability is {meta.thunderstorm_max.per_lead_text[lead]} (not validated).</p>
                                        )}
                                        <p data-testid="live-empty-cap">CAP review: no alerts in this run, so there is no CAP message to review.</p>
                                        {insatNear?.summary && <p data-testid="live-empty-insat" className="text-slate-500 dark:text-slate-400">{insatNear.summary.text}</p>}
                                    </div>
                                )}
                                {!showWatch && hiddenWatch > 0 && (
                                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">{hiddenWatch} Watch alert{hiddenWatch === 1 ? '' : 's'} hidden at this lead. Tick "Also show Watch" above the map.</p>
                                )}
                            </div>
                            {alerts.length > 0 && (
                                <AlertList alerts={shown} selectedId={selected?.alert_id} onSelect={select}
                                    emptyText={showWatch ? 'No live alerts at this lead.' : 'No live Warnings at this lead. Tick "Also show Watch" above the map.'} />
                            )}
                        </div>
                    )
                ) : id === 'ingredients' ? <IngredientsTab selected={selected} d={selected} liveNote={LIVE_INGREDIENTS_NOTE} />
                    : id === 'shelter' ? <ShelterPanel point={shelterPt} data={sh.data} error={sh.error} live
                        loading={!!shelterKey && shelter.key !== shelterKey} selected={selected} onUseAlert={pointFromAlert} lead={lead}
                        onWiden={setRadius} onChoose={setShelterPt} mapAlerts={shown} insideOpen={insideOpen} onInsideToggle={() => setInsideOpen((o) => !o)} />
                        : <CaveatsPanel />)}
            </Drawer>
        </div>
    );
};

export default LiveView;
