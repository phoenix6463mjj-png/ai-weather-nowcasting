import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, FlaskConical, CalendarClock, Info, Building2 } from 'lucide-react';
import { getEpisodes, getEventCheck, getTimeline, getIssueMeta, getIssueAlerts, getAlertDetail, getShelters, getShelterDefault, issueMapUrl, issueMissedUrl } from '../../services/nowcastApi';
import { HAZARDS, fmtUtc, fmtIssueShort, issueDefaultLead, FF_VERIFY_NOTE } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import { ABOVE_ATTRIBUTION } from '../../utils/mapLayout';
import { numberShelters } from '../../utils/shelterNumbers';
import MapToolbar from './MapToolbar';
import MapControls from './MapControls';
import AlertList from './AlertList';
import ExplainPanel from './ExplainPanel';
import EpisodeBadge from './EpisodeBadge';
import MapLegend from './MapLegend';
import ReplayButton from './ReplayButton';
import EventCheckPanel from './EventCheckPanel';
import useTerrain from './useTerrain';
import useInsat from './useInsat';
import InsatControl from './InsatControl';
import Drawer from './Drawer';
import LayersPanel from './LayersPanel';
import IngredientsTab from './IngredientsTab';
import CaveatsPanel from './CaveatsPanel';
import ShelterPanel, { SHELTER_LABEL } from './ShelterPanel';
import { nowcastTarget } from '../../utils/nowcastUrl';
import { StatusLine } from './MapFrame';

const tsOf = (iso) => iso.replace(/[-:]/g, '');       // '2023-08-13T12:00Z' -> '20230813T1200Z'

// Show a target (lead, level, hazard, alert) picked in the documented-event check.
function applyTarget(t, list, set) {
    if (t.lead != null) set.setLead(t.lead);
    if (t.level === 'Watch') set.setShowWatch(true);
    if (t.hazard) set.setHazards((h) => (h.includes(t.hazard) ? h : [...h, t.hazard]));
    set.setSelected((t.alertId && list.find((x) => x.alert_id === t.alertId)) || null);
}


// jump: a replay target from Start here / the case links ({ episode, ts, lead, hazard, level, alert_id }); the
// parent remounts this view for each jump, so it is the opening view, like /api/episodes `start`;
// startHere: the /api/start-here payload (Pipalkoti / Malana links, IMERG under-reporting line)
// holdDrawer: Start here is open on a window narrower than 1600 px; the opening view's drawer section then
// waits (collapsed) and opens when Start here closes.
// URL: ?ep=&ts=&alert=<id>&lead=&level=&hazard=&tab=<section> opens that alert with that drawer section.
const DEEP_TABS = ['alert', 'ingredients', 'event', 'shelter', 'caveats'];
const ReplayView = ({ jump = null, onJump = null, startHere = null, mapOverlay = null, holdDrawer = false }) => {
    const [episodes, setEpisodes] = useState([]);
    const [ep, setEp] = useState(null);
    const [ts, setTs] = useState(null);
    // data for the issue currently loaded; `loading` is derived from its key
    const [data, setData] = useState({ key: null, meta: null, alerts: [] });
    const [lead, setLead] = useState(null);
    const [hazards, setHazards] = useState(HAZARDS);
    const [showWatch, setShowWatch] = useState(false);
    // observed >= 30 mm/hr and "heavy rain outside displayed alerts": off by default (Layers panel toggles)
    const [showObserved, setShowObserved] = useState(false);
    const [showMissed, setShowMissed] = useState(false);
    const [field, setField] = useState('');
    const [selected, setSelected] = useState(null);
    const [error, setError] = useState(null);
    const [drawer, setDrawer] = useState(null);             // open drawer section, null = collapsed
    const [deferred, setDeferred] = useState(null);         // opening section held while Start here is open
    const [prevHold, setPrevHold] = useState(holdDrawer);
    if (prevHold !== holdDrawer) {
        setPrevHold(holdDrawer);
        if (!holdDrawer && deferred) { setDrawer(deferred); setDeferred(null); }
    }
    const holdRef = useRef(holdDrawer);
    useEffect(() => { holdRef.current = holdDrawer; }, [holdDrawer]);
    const [check, setCheck] = useState({ ep: null, data: null, timeline: null });
    const [detail, setDetail] = useState({ id: null, d: null, error: null });
    const [reviews, setReviews] = useState({});            // forecaster review per alert (this page only; never sent)
    const [shelterPt, setShelterPtRaw] = useState(null);    // { lat, lon, source: 'click' | 'alert' | 'site', text? }
    const [radius, setRadius] = useState(25);               // 25 km, or 50 km after "Widen the search"
    const [insideOpen, setInsideOpen] = useState(false);    // "Inside a current alert (N)" group, collapsed by default
    const setShelterPt = (p) => { setShelterPtRaw(p); setRadius(25); setInsideOpen(false); };
    const [shelter, setShelter] = useState({ key: null, data: null, error: null });
    const terrain = useTerrain(ep);
    const insat = useInsat(ep, ts);
    const pendingRef = useRef(null);            // jump target waiting for its issue to load
    const urlTargetRef = useRef(nowcastTarget());
    const setters = { setLead, setShowWatch, setHazards, setSelected };

    useEffect(() => {
        getEpisodes().then((r) => {
            setEpisodes(r.episodes);
            const q = new URLSearchParams(window.location.search);
            const e = r.episodes.find((x) => x.episode === q.get('ep'));
            const i = e?.issues.find((x) => x.ts === q.get('ts'));
            // an alert named in the URL (Overview "Explore it yourself" cards)
            const urlAlert = e && i && q.get('alert') ? { episode: e.episode, ts: i.ts, lead: Number(q.get('lead')) || null,
                level: q.get('level'), hazard: q.get('hazard'), alert_id: q.get('alert') } : null;
            // judge-first opening view: the Malana cloudburst Warning issued 15:00Z, selected (or a Start-here jump)
            const want = jump || urlAlert || (!e ? r.start : null);
            const st = want && r.episodes.some((x) => x.episode === want.episode && x.issues.some((y) => y.ts === want.ts)) ? want : null;
            if (st) {
                pendingRef.current = { key: `${st.episode}/${st.ts}`, lead: st.lead, level: st.level, hazard: st.hazard, alertId: st.alert_id };
                const sec = !jump && urlAlert && DEEP_TABS.includes(q.get('tab')) ? q.get('tab') : 'alert';
                if (holdRef.current) setDeferred(sec);
                else setDrawer(sec);
            }
            setEp(st ? st.episode : e ? e.episode : r.default.episode);
            setTs(st ? st.ts : e ? (i ? i.ts : e.issues[0].ts) : r.default.ts);
            if (!st && e && q.get('tab') === 'event') setDrawer('event');
            if (!st && e && q.get('tab') === 'shelter') setDrawer('shelter');
        }).catch((e) => setError(e.message));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);                                     // `jump` is fixed for this mount (the parent remounts per jump)

    useEffect(() => {
        if (!ep || !ts) return;
        let live = true;
        Promise.all([getIssueMeta(ep, ts), getIssueAlerts(ep, ts)]).then(([m, a]) => {
            if (!live) return;
            setData({ key: `${ep}/${ts}`, meta: m, alerts: a.alerts });
            const p = pendingRef.current;
            if (p && p.key === `${ep}/${ts}`) {
                pendingRef.current = null;
                if (p.lead == null) setLead(issueDefaultLead(m, a.alerts, ep, ts));
                applyTarget(p, a.alerts, { setLead, setShowWatch, setHazards, setSelected });
            } else {
                const tg = urlTargetRef.current;              // link from Analytics: lead / hazard / watch, once
                if (tg && tg.ep === ep && tg.ts === ts) {
                    urlTargetRef.current = null;
                    setLead(tg.lead && m.leads_available.includes(tg.lead) ? tg.lead : issueDefaultLead(m, a.alerts, ep, ts));
                    if (tg.hazard) setHazards([tg.hazard]);
                    if (tg.watch) setShowWatch(true);
                } else {
                    setLead(issueDefaultLead(m, a.alerts, ep, ts));
                }
            }
            setError(null);
        }).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, [ep, ts]);

    useEffect(() => {
        if (!ep) return;
        let live = true;
        Promise.all([getEventCheck(ep).catch(() => null), getTimeline(ep).catch(() => null)])
            .then(([r, tl]) => live && setCheck({ ep, data: r, timeline: tl }));
        return () => { live = false; };
    }, [ep]);

    // alert detail for the selected alert: shared by the Alert and Ingredients sections
    const selId = selected?.alert_id;
    useEffect(() => {
        if (!selId || !ep || !ts) return undefined;
        let live = true;
        getAlertDetail(ep, ts, selId).then((r) => live && setDetail({ id: selId, d: r, error: null }))
            .catch((e) => live && setDetail({ id: selId, d: null, error: e.message }));
        return () => { live = false; };
    }, [selId, ep, ts]);
    const det = selId && detail.id === selId ? detail : { d: null, error: null };

    // nearby shelter options for the chosen point, checked against every alert of this issue
    const shelterKey = shelterPt && ep && ts ? `${ep}/${ts}/${shelterPt.lat.toFixed(4)}/${shelterPt.lon.toFixed(4)}/${radius}` : null;
    useEffect(() => {
        if (!shelterKey) return undefined;
        let live = true;
        getShelters({ kind: 'issue', ep, ts }, shelterPt.lat, shelterPt.lon, radius)
            .then((r) => live && setShelter({ key: shelterKey, data: r, error: null }))
            .catch((e) => live && setShelter({ key: shelterKey, data: null, error: e.message }));
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shelterKey]);
    const sh = shelter.key === shelterKey ? shelter : { data: null, error: null };

    const { meta, alerts } = data;
    const loading = !!ep && !!ts && data.key !== `${ep}/${ts}` && !error;

    const episode = episodes.find((e) => e.episode === ep);
    const eventCheck = check.ep === ep ? check.data : null;
    const checkApplies = !!eventCheck?.applies;
    const active = drawer === 'event' && !checkApplies ? null : drawer;
    const closeDrawer = useCallback(() => setDrawer(null), []);
    // opening "Nearby shelter options" with an alert selected (and no point yet) starts from its peak cell
    const pointFromAlert = () => selected?.peak_cell && setShelterPt({ lat: selected.peak_cell[0], lon: selected.peak_cell[1], source: 'alert' });
    // default point: the issue's alert peak nearest the documented event site (stated in the panel)
    const pointFromSite = () => getShelterDefault(ep, ts).then((d) => d.available
        && setShelterPt({ lat: d.lat, lon: d.lon, source: 'site', text: d.text, site: d.site?.name })).catch(() => {});
    const openDrawer = (id) => {
        if (id === 'shelter' && !shelterPt) pointFromSite();
        setDrawer(id);
        setDeferred(null);
    };
    // another issue or event with the section open: the default point follows it (a clicked or
    // alert-chosen point is kept)
    useEffect(() => {
        if (drawer === 'shelter' && ep && ts && (!shelterPt || shelterPt.source === 'site')) pointFromSite();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ep, ts]);
    const shelterOpen = active === 'shelter';
    const select = (a) => { setSelected(a); if (a) setDrawer('alert'); };
    // a map click selects the alert and shows its compact popup; the popup's "Details" opens the Alert section
    const details = (a) => { setSelected(a); setDrawer('alert'); setDeferred(null); };
    const issueInfo = episode?.issues.find((i) => i.ts === ts);

    // the other case study, one click away (from /api/start-here)
    const caseLink = startHere && onJump ? (ep === startHere.pipalkoti.episode
        ? { t: startHere.start, label: `Malana case (2024 test) →` }
        : { t: startHere.pipalkoti, label: `Pipalkoti case (2023 validation) →` }) : null;

    // documented-event check -> open that issue, lead (and alert) on the map
    const jumpTo = (item) => {
        const key = `${ep}/${tsOf(item.issue_time)}`;
        const target = { key, lead: item.lead_time_h, level: item.level, hazard: item.hazard, alertId: item.alert_id };
        setDrawer('alert');
        if (key === data.key) {
            applyTarget(target, alerts, setters);
        } else {
            pendingRef.current = target;
            setSelected(null); setError(null);
            setTs(tsOf(item.issue_time));
        }
    };

    const shown = useMemo(() => alerts.filter((a) =>
        a.lead_time_h === lead && hazards.includes(a.hazard) && (showWatch || a.level === 'Warning')), [alerts, lead, hazards, showWatch]);

    const counts = useMemo(() => {
        const c = {};
        for (const a of alerts) {
            if (a.lead_time_h === lead && (showWatch || a.level === 'Warning')) c[a.hazard] = (c[a.hazard] || 0) + 1;
        }
        return c;
    }, [alerts, lead, showWatch]);

    const hiddenWatch = alerts.filter((a) => a.lead_time_h === lead && hazards.includes(a.hazard) && a.level === 'Watch').length;

    const leadInfo = useMemo(() => {
        const o = {};
        if (meta) for (const [L, v] of Object.entries(meta.per_lead)) o[L] = { valid: fmtUtc(v.valid_time, false), radius: v.radius_km };
        return o;
    }, [meta]);

    // map overlays: optional forecast field, then observed >=30, then the derived "heavy rain outside
    // displayed alerts" cells for exactly the alerts on screen (both off by default)
    const obsAvailable = !!(meta && lead && meta.per_lead[String(lead)]?.observed_available);
    const overlays = [];
    if (meta && lead && data.key === `${ep}/${ts}`) {
        // INSAT-3DR observation (issue time, availability rule applied by the API): below the forecast rasters
        if (insat.overlay) overlays.push(insat.overlay);
        if (field) overlays.push({ url: issueMapUrl(ep, ts, lead, field), opacity: 1, zIndex: 1, kind: `field-${field}` });
        if (obsAvailable && showObserved) overlays.push({ url: issueMapUrl(ep, ts, lead, 'observed_ge30'), opacity: 0.85, zIndex: 2, kind: 'observed' });
        if (obsAvailable && showMissed) overlays.push({ url: issueMissedUrl(ep, ts, lead, showWatch ? 'all' : 'warning', hazards), opacity: 1, zIndex: 3, kind: 'missed' });
    }

    const nVer = shown.filter((a) => a.verification?.status === 'verified').length;
    const nFa = shown.filter((a) => a.verification?.status === 'false_alarm').length;

    const changeEpisode = (id) => {
        const e = episodes.find((x) => x.episode === id);
        setSelected(null); setError(null); setShelterPtRaw(null);
        setEp(id);
        setTs(e.issues[Math.floor(e.issues.length / 2)].ts);
    };
    const changeIssue = (newTs) => { setSelected(null); setError(null); setTs(newTs); };

    const tabs = [
        { id: 'alert', label: 'Alert', icon: BellRing, width: 420 },
        { id: 'ingredients', label: 'Ingredients', icon: FlaskConical, width: 440 },
        ...(checkApplies ? [{ id: 'event', label: 'Event check', icon: CalendarClock, width: 420, expandable: true }] : []),
        { id: 'shelter', label: SHELTER_LABEL, short: 'Shelter options', icon: Building2, width: 440 },
        { id: 'caveats', label: 'Caveats', icon: Info, width: 420 },
    ];

    const alertSection = selected ? (
        <ExplainPanel episode={ep} ts={ts} d={det.d} error={det.error} onBack={() => setSelected(null)}
            onIngredients={() => setDrawer('ingredients')} review={reviews[`${ep}/${ts}/${selId}`]}
            onReview={(r) => setReviews((m) => ({ ...m, [`${ep}/${ts}/${selId}`]: r }))} />
    ) : (
        <div data-testid="alert-list-view">
            {meta && data.key === `${ep}/${ts}` && <ReplayButton key={data.key} episode={ep} issueTime={meta.issue_time} />}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                    {meta ? `Issued ${fmtUtc(meta.issue_time)}` : 'Loading…'}
                </h3>
                {meta && lead && (
                    <p className="text-base text-slate-600 dark:text-slate-300 mt-1">
                        Lead {lead} h: {shown.length} alert{shown.length === 1 ? '' : 's'} shown ·{' '}
                        <span data-testid="summary-confirmed" className="text-emerald-700 dark:text-emerald-400 font-bold">{nVer} confirmed by IMERG satellite rain</span> ·{' '}
                        <span data-testid="summary-not-confirmed" className="font-bold">{nFa} not confirmed (counted as false alarms in our scores)</span>
                    </p>
                )}
                {!showWatch && hiddenWatch > 0 && (
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                        {hiddenWatch} Watch alert{hiddenWatch === 1 ? '' : 's'} hidden at this lead. Tick "Also show Watch" above the map.
                    </p>
                )}
                {meta && (
                    <>
                        <p className="text-sm text-slate-400 mt-1 leading-normal">{meta.verification_definition}</p>
                        <p data-testid="ff-verify-note-summary" className="text-sm text-amber-700 dark:text-amber-400 mt-0.5 leading-normal">{FF_VERIFY_NOTE}</p>
                    </>
                )}
            </div>
            <AlertList alerts={shown} selectedId={selected?.alert_id} onSelect={select}
                emptyText={showWatch ? 'No alerts at this lead for the selected hazards.'
                    : 'No Warnings at this lead for the selected hazards. Tick "Also show Watch" above the map to see Watch alerts.'} />
        </div>
    );

    return (
        <div className="flex-1 flex overflow-hidden min-h-0" data-testid="replay-view" data-loaded={data.key || ''}>
            <div className="flex-1 flex flex-col min-w-0">
                {/* badges stay visible at the top of the map (never inside the drawer) */}
                <StatusLine details={<>
                    {episode?.case_study && (
                        <p data-testid="case-study-banner" className="text-violet-950 dark:text-violet-100">
                            <span className="font-black">{episode.sample_label}</span>
                            {' '}The official 2024 test result is unchanged; sites shown: {episode.sites.map((s) => s.name).join(', ')}.
                        </p>
                    )}
                    {issueInfo?.explain_available === false && (
                        <p data-testid="forecast-only-detail">
                            Alerts and maps come from the same frozen model; there is no explanation panel and no per-alert IMERG verification for this issue.
                        </p>
                    )}
                    <p className="text-slate-600 dark:text-slate-300">
                        Replay of archived inputs (IMERG Final + ERA5) · model lgbm_v0 (frozen), {meta?.cutset} cut-offs
                    </p>
                </>}>
                    <EpisodeBadge episode={episode} />
                    {issueInfo?.explain_available === false && (
                        <span data-testid="forecast-only-banner" className="text-sm px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100">
                            <span className="font-black">Forecast-only issue: {issueInfo.note}.</span>
                        </span>
                    )}
                    {caseLink && (
                        <button type="button" data-testid="case-link" onClick={() => onJump(caseLink.t)}
                            className="text-sm font-bold px-2 py-0.5 rounded border border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-800">
                            {caseLink.label}
                        </button>
                    )}
                </StatusLine>
                {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}
                <MapToolbar leads={meta && lead ? meta.leads_available : []} lead={lead} setLead={setLead} leadInfo={leadInfo}
                    showWatch={showWatch} setShowWatch={setShowWatch}>
                                <select id="episode-select" data-testid="episode-select" aria-label="Event" value={ep || ''} onChange={(e) => changeEpisode(e.target.value)}
                                    className="w-[12.5rem] max-w-full text-sm font-bold bg-slate-100 dark:bg-slate-700 dark:text-white rounded-md px-2 py-1 border border-slate-200 dark:border-slate-600">
                                    {episodes.map((e) => (
                                        <option key={e.episode} value={e.episode}>
                                            {e.sites?.length ? e.sites.map((s) => s.name).join(' + ') : e.location} ({e.site?.date}){e.in_sample ? ' · IN-SAMPLE' : ''}{e.case_study ? ` · ${e.badge.toUpperCase()} CASE STUDY` : ''}
                                        </option>
                                    ))}
                                </select>
                                <select data-testid="issue-select" aria-label="Issue time" value={ts || ''} onChange={(e) => changeIssue(e.target.value)}
                                    className="w-[12.5rem] max-w-full text-sm font-bold bg-slate-100 dark:bg-slate-700 dark:text-white rounded-md px-2 py-1 border border-slate-200 dark:border-slate-600">
                                    {episode?.issues.map((i) => (
                                        <option key={i.ts} value={i.ts}>
                                            issued {fmtIssueShort(i.issue_time)} · {i.n_alerts} alerts{i.explain_available === false ? ' · forecast-only' : ` (${i.n_verified} confirmed by IMERG)`}
                                        </option>
                                    ))}
                                </select>
                </MapToolbar>

                <div className="flex-1 relative min-h-0">
                    {meta && (
                        <AlertMap bounds={meta.bounds} alerts={shown} selectedId={selected?.alert_id}
                            onSelect={setSelected} onDetails={details} sites={meta.sites || []} overlays={overlays} dimFill={!!field}
                            terrain={terrain.layers} terrainNotice={terrain.fullNotice}
                            onPick={shelterOpen ? (p) => setShelterPt({ ...p, source: 'click' }) : null}
                            shelter={shelterOpen && shelterPt ? { point: shelterPt, radiusKm: sh.data?.radius_km, candidates: [
                                ...numberShelters(sh.data).outside,
                                ...(insideOpen ? numberShelters(sh.data).inside : [])] } : null} />
                    )}
                    <div className="absolute top-3 left-3 z-[400] flex flex-col pointer-events-none" style={ABOVE_ATTRIBUTION}>
                        <LayersPanel summary={meta && lead ? `${episode?.sites?.length ? episode.sites[0].name : episode?.location || ''} · ${fmtIssueShort(meta.issue_time)} · L${lead} h · ${showWatch ? 'Watch + Warning' : 'Warnings'}${insat.on && insat.available ? ' · INSAT-3DR' : ''}` : ''}>
                            {meta && lead && (
                                <MapControls hazards={hazards} setHazards={setHazards}
                                    counts={counts} field={field} setField={setField} terrain={terrain}
                                    observed={obsAvailable ? { label: meta.legends.observed_ge30?.label || 'Observed ≥30 mm/hr', on: showObserved, setOn: setShowObserved } : null}
                                    missed={obsAvailable ? { label: meta.legends.missed_ge30?.label || 'Heavy rain outside displayed alerts', on: showMissed, setOn: setShowMissed } : null} />
                            )}
                            <InsatControl insat={insat} />
                        </LayersPanel>
                    </div>
                    {meta && (
                        <div className="absolute top-[84px] right-3 z-[400] flex flex-col justify-end pointer-events-none" style={ABOVE_ATTRIBUTION}>
                            <MapLegend legends={meta.legends} field={field} hazards={hazards} site={(meta.sites || []).length} ffNote={FF_VERIFY_NOTE}
                                verification={meta.explain_available !== false} observed={obsAvailable && showObserved} missed={obsAvailable && showMissed} showWatch={showWatch}
                                underReport={(meta.sites || []).length ? startHere?.under_report : null}
                                terrain={terrain.layers.length > 0}
                                insat={insat.on && insat.info ? {
                                    classes: insat.info.colour_scale.classes, lines: insat.info.lines, floorLine: insat.info.floor_line,
                                    availability: insat.atIssue?.label,
                                } : null}
                                noteTitle="Observed (replay)"
                                note={obsAvailable ? null : 'Observed frame unavailable for this lead: no verification overlay.'} />
                        </div>
                    )}
                    {mapOverlay}
                    {loading && (
                        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/40 dark:bg-black/30">
                            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
            </div>

            <Drawer tabs={tabs} active={active} onOpen={openDrawer} onClose={closeDrawer}>
                {(id) => (
                    id === 'alert' ? alertSection
                        : id === 'ingredients' ? <IngredientsTab selected={selected} d={det.d} error={det.error} />
                            : id === 'event' ? <EventCheckPanel check={eventCheck} timeline={check.ep === ep ? check.timeline : null} onJump={jumpTo} underReport={startHere?.under_report} />
                                : id === 'shelter' ? <ShelterPanel point={shelterPt} data={sh.data} error={sh.error}
                                    loading={!!shelterKey && shelter.key !== shelterKey} selected={selected} onUseAlert={pointFromAlert} lead={lead}
                                    onWiden={setRadius} onChoose={setShelterPt} mapAlerts={shown} insideOpen={insideOpen} onInsideToggle={() => setInsideOpen((o) => !o)} />
                                    : <CaveatsPanel />
                )}
            </Drawer>
        </div>
    );
};

export default ReplayView;
