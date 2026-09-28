import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, FlaskConical, CalendarClock, Info } from 'lucide-react';
import { getEpisodes, getEventCheck, getTimeline, getIssueMeta, getIssueAlerts, getAlertDetail, issueMapUrl, issueMissedUrl } from '../../services/nowcastApi';
import { HAZARDS, fmtUtc, fmtIssueShort, issueDefaultLead, FF_VERIFY_NOTE } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import MapControls from './MapControls';
import AlertList from './AlertList';
import ExplainPanel from './ExplainPanel';
import EpisodeBadge from './EpisodeBadge';
import MapLegend from './MapLegend';
import ReplayButton from './ReplayButton';
import EventCheckPanel from './EventCheckPanel';
import useTerrain from './useTerrain';
import Drawer from './Drawer';
import LayersPanel from './LayersPanel';
import IngredientsTab from './IngredientsTab';
import CaveatsPanel from './CaveatsPanel';
import { MapBadges } from './MapFrame';
import useEventDrawerWidth from './useEventDrawerWidth';

const tsOf = (iso) => iso.replace(/[-:]/g, '');       // '2023-08-13T12:00Z' -> '20230813T1200Z'

// Show a target (lead, level, hazard, alert) picked in the documented-event check.
function applyTarget(t, list, set) {
    if (t.lead != null) set.setLead(t.lead);
    if (t.level === 'Watch') set.setShowWatch(true);
    if (t.hazard) set.setHazards((h) => (h.includes(t.hazard) ? h : [...h, t.hazard]));
    set.setSelected((t.alertId && list.find((x) => x.alert_id === t.alertId)) || null);
}


const ReplayView = () => {
    const [episodes, setEpisodes] = useState([]);
    const [ep, setEp] = useState(null);
    const [ts, setTs] = useState(null);
    // data for the issue currently loaded; `loading` is derived from its key
    const [data, setData] = useState({ key: null, meta: null, alerts: [] });
    const [lead, setLead] = useState(null);
    const [hazards, setHazards] = useState(HAZARDS);
    const [showWatch, setShowWatch] = useState(false);
    const [field, setField] = useState('');
    const [selected, setSelected] = useState(null);
    const [error, setError] = useState(null);
    const [drawer, setDrawer] = useState(null);             // open drawer section, null = collapsed
    const [check, setCheck] = useState({ ep: null, data: null, timeline: null });
    const [detail, setDetail] = useState({ id: null, d: null, error: null });
    const [reviews, setReviews] = useState({});            // forecaster review per alert (this page only; never sent)
    const eventWidth = useEventDrawerWidth();
    const terrain = useTerrain(ep);
    const pendingRef = useRef(null);            // jump target waiting for its issue to load
    const setters = { setLead, setShowWatch, setHazards, setSelected };

    useEffect(() => {
        getEpisodes().then((r) => {
            setEpisodes(r.episodes);
            const q = new URLSearchParams(window.location.search);
            const e = r.episodes.find((x) => x.episode === q.get('ep'));
            const i = e?.issues.find((x) => x.ts === q.get('ts'));
            setEp(e ? e.episode : r.default.episode);
            setTs(e ? (i ? i.ts : e.issues[0].ts) : r.default.ts);
            if (e && q.get('tab') === 'event') setDrawer('event');
        }).catch((e) => setError(e.message));
    }, []);

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
                setLead(issueDefaultLead(m, a.alerts, ep, ts));
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

    const { meta, alerts } = data;
    const loading = !!ep && !!ts && data.key !== `${ep}/${ts}` && !error;

    const episode = episodes.find((e) => e.episode === ep);
    const eventCheck = check.ep === ep ? check.data : null;
    const checkApplies = !!eventCheck?.applies;
    const active = drawer === 'event' && !checkApplies ? null : drawer;
    const closeDrawer = useCallback(() => setDrawer(null), []);
    const select = (a) => { setSelected(a); if (a) setDrawer('alert'); };
    const issueInfo = episode?.issues.find((i) => i.ts === ts);

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

    // map overlays: optional forecast field, then observed >=30 (always on), then the derived
    // "heavy rain outside displayed alerts" cells for exactly the alerts on screen (always on)
    const obsAvailable = !!(meta && lead && meta.per_lead[String(lead)]?.observed_available);
    const overlays = [];
    if (meta && lead && data.key === `${ep}/${ts}`) {
        if (field) overlays.push({ url: issueMapUrl(ep, ts, lead, field), opacity: 1, zIndex: 1, kind: `field-${field}` });
        if (obsAvailable) {
            overlays.push({ url: issueMapUrl(ep, ts, lead, 'observed_ge30'), opacity: 0.85, zIndex: 2, kind: 'observed' });
            overlays.push({ url: issueMissedUrl(ep, ts, lead, showWatch ? 'all' : 'warning', hazards), opacity: 1, zIndex: 3, kind: 'missed' });
        }
    }

    const nVer = shown.filter((a) => a.verification?.status === 'verified').length;
    const nFa = shown.filter((a) => a.verification?.status === 'false_alarm').length;

    const changeEpisode = (id) => {
        const e = episodes.find((x) => x.episode === id);
        setSelected(null); setError(null);
        setEp(id);
        setTs(e.issues[Math.floor(e.issues.length / 2)].ts);
    };
    const changeIssue = (newTs) => { setSelected(null); setError(null); setTs(newTs); };

    const tabs = [
        { id: 'alert', label: 'Alert', icon: BellRing, width: 420 },
        { id: 'ingredients', label: 'Ingredients', icon: FlaskConical, width: 440 },
        ...(checkApplies ? [{ id: 'event', label: 'Event check', icon: CalendarClock, width: eventWidth }] : []),
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
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {meta ? `Issued ${fmtUtc(meta.issue_time)}` : 'Loading…'}
                </h3>
                {meta && lead && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                        Lead {lead} h: {shown.length} alert{shown.length === 1 ? '' : 's'} shown ·{' '}
                        <span className="text-emerald-700 dark:text-emerald-400 font-bold">{nVer} verified</span> ·{' '}
                        <span className="font-bold">{nFa} not verified (false alarm)</span>
                    </p>
                )}
                {!showWatch && hiddenWatch > 0 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                        {hiddenWatch} Watch alert{hiddenWatch === 1 ? '' : 's'} hidden at this lead. Tick "Also show Watch" in Layers.
                    </p>
                )}
                {meta && (
                    <>
                        <p className="text-[10px] text-slate-400 mt-1 leading-snug">{meta.verification_definition}</p>
                        <p data-testid="ff-verify-note-summary" className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 leading-snug">{FF_VERIFY_NOTE}</p>
                    </>
                )}
            </div>
            <AlertList alerts={shown} selectedId={selected?.alert_id} onSelect={select}
                emptyText={showWatch ? 'No alerts at this lead for the selected hazards.'
                    : 'No Warnings at this lead for the selected hazards. Tick "Also show Watch" in Layers to see Watch alerts.'} />
        </div>
    );

    return (
        <div className="flex-1 flex overflow-hidden min-h-0" data-testid="replay-view" data-loaded={data.key || ''}>
            <div className="flex-1 flex flex-col min-w-0">
                {/* badges stay visible at the top of the map (never inside the drawer) */}
                <MapBadges>
                    <EpisodeBadge episode={episode} />
                    {episode?.case_study && (
                        <span data-testid="case-study-banner" className="text-[11px] text-violet-950 dark:text-violet-100">
                            <span className="font-black">{episode.sample_label}</span>
                            {' '}The official 2024 test result is unchanged; sites shown: {episode.sites.map((s) => s.name).join(', ')}.
                        </span>
                    )}
                    {issueInfo?.explain_available === false && (
                        <span data-testid="forecast-only-banner" className="text-[11px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100">
                            <span className="font-black">Forecast-only issue: {issueInfo.note}.</span>{' '}
                            Alerts and maps come from the same frozen model; there is no explanation panel and no per-alert IMERG verification for this issue.
                        </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
                        Replay of archived inputs (IMERG Final + ERA5) · model lgbm_v0 (frozen), {meta?.cutset} cut-offs
                    </span>
                </MapBadges>
                {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}

                <div className="flex-1 relative min-h-0">
                    {meta && (
                        <AlertMap bounds={meta.bounds} alerts={shown} selectedId={selected?.alert_id}
                            onSelect={select} sites={meta.sites || []} overlays={overlays} dimFill={!!field}
                            terrain={terrain.layers} terrainNotice={terrain.fullNotice} />
                    )}
                    <div className="absolute top-3 left-3 bottom-3 z-[400] flex flex-col pointer-events-none">
                        <LayersPanel summary={meta && lead ? `${ep} · ${fmtIssueShort(meta.issue_time)} · L${lead} h · ${showWatch ? 'Watch + Warning' : 'Warnings'}` : ''}>
                            <div className="space-y-1.5">
                                <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">Event and issue</p>
                                <select data-testid="episode-select" value={ep || ''} onChange={(e) => changeEpisode(e.target.value)}
                                    className="w-full text-xs font-bold bg-slate-100 dark:bg-slate-700 dark:text-white rounded-md px-2 py-1 border border-slate-200 dark:border-slate-600">
                                    {episodes.map((e) => (
                                        <option key={e.episode} value={e.episode}>
                                            {e.episode} · {e.sites?.length ? e.sites.map((s) => s.name).join(' + ') : e.location} ({e.site?.date}){e.in_sample ? ' · IN-SAMPLE' : ''}{e.case_study ? ` · ${e.badge.toUpperCase()} CASE STUDY` : ''}
                                        </option>
                                    ))}
                                </select>
                                <select data-testid="issue-select" value={ts || ''} onChange={(e) => changeIssue(e.target.value)}
                                    className="w-full text-xs font-bold bg-slate-100 dark:bg-slate-700 dark:text-white rounded-md px-2 py-1 border border-slate-200 dark:border-slate-600">
                                    {episode?.issues.map((i) => (
                                        <option key={i.ts} value={i.ts}>
                                            issued {fmtIssueShort(i.issue_time)} · {i.n_alerts} alerts{i.explain_available === false ? ' · forecast-only' : ` (${i.n_verified} verified)`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {meta && lead && (
                                <MapControls leads={meta.leads_available} lead={lead} setLead={setLead} leadInfo={leadInfo}
                                    hazards={hazards} setHazards={setHazards} showWatch={showWatch} setShowWatch={setShowWatch}
                                    counts={counts} field={field} setField={setField} terrain={terrain} />
                            )}
                        </LayersPanel>
                    </div>
                    {meta && (
                        <div className="absolute top-[84px] bottom-[26px] right-3 z-[400] flex flex-col justify-end pointer-events-none">
                            <MapLegend legends={meta.legends} field={field} hazards={hazards} site={(meta.sites || []).length} ffNote={FF_VERIFY_NOTE}
                                verification={meta.explain_available !== false} observed={obsAvailable} missed={obsAvailable}
                                terrain={terrain.layers.length > 0}
                                noteTitle="Observed (replay)"
                                note={obsAvailable ? null : 'Observed frame unavailable for this lead: no verification overlay.'} />
                        </div>
                    )}
                    {loading && (
                        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/40 dark:bg-black/30">
                            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
            </div>

            <Drawer tabs={tabs} active={active} onOpen={setDrawer} onClose={closeDrawer}>
                {(id) => (
                    id === 'alert' ? alertSection
                        : id === 'ingredients' ? <IngredientsTab selected={selected} d={det.d} error={det.error} />
                            : id === 'event' ? <EventCheckPanel check={eventCheck} timeline={check.ep === ep ? check.timeline : null} onJump={jumpTo} />
                                : <CaveatsPanel />
                )}
            </Drawer>
        </div>
    );
};

export default ReplayView;
