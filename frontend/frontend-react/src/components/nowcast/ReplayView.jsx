import { useEffect, useMemo, useState } from 'react';
import { getEpisodes, getIssueMeta, getIssueAlerts, issueMapUrl, issueMissedUrl } from '../../services/nowcastApi';
import { HAZARDS, fmtUtc, fmtIssueShort, defaultLead } from '../../utils/hazardLabels';
import AlertMap from './AlertMap';
import MapControls from './MapControls';
import AlertList from './AlertList';
import ExplainPanel from './ExplainPanel';
import EpisodeBadge from './EpisodeBadge';
import MapLegend from './MapLegend';


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

    useEffect(() => {
        getEpisodes().then((r) => {
            setEpisodes(r.episodes);
            setEp(r.default.episode);
            setTs(r.default.ts);
        }).catch((e) => setError(e.message));
    }, []);

    useEffect(() => {
        if (!ep || !ts) return;
        let live = true;
        Promise.all([getIssueMeta(ep, ts), getIssueAlerts(ep, ts)]).then(([m, a]) => {
            if (!live) return;
            setData({ key: `${ep}/${ts}`, meta: m, alerts: a.alerts });
            setLead(defaultLead(a.alerts, m.leads_available));
            setError(null);
        }).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, [ep, ts]);

    const { meta, alerts } = data;
    const loading = !!ep && !!ts && data.key !== `${ep}/${ts}` && !error;

    const episode = episodes.find((e) => e.episode === ep);

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

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* issue selector */}
            <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] flex flex-wrap items-center gap-3 shrink-0">
                <select data-testid="episode-select" value={ep || ''} onChange={(e) => changeEpisode(e.target.value)}
                    className="text-sm font-bold bg-slate-100 dark:bg-slate-800 dark:text-white rounded-lg px-3 py-1.5 border border-slate-200 dark:border-slate-700">
                    {episodes.map((e) => (
                        <option key={e.episode} value={e.episode}>
                            {e.episode} · {e.site?.name || e.location} ({e.site?.date}){e.in_sample ? ' · IN-SAMPLE' : ''}
                        </option>
                    ))}
                </select>
                <select data-testid="issue-select" value={ts || ''} onChange={(e) => changeIssue(e.target.value)}
                    className="text-sm font-bold bg-slate-100 dark:bg-slate-800 dark:text-white rounded-lg px-3 py-1.5 border border-slate-200 dark:border-slate-700">
                    {episode?.issues.map((i) => (
                        <option key={i.ts} value={i.ts}>
                            issued {fmtIssueShort(i.issue_time)} · {i.n_alerts} alerts ({i.n_verified} verified)
                        </option>
                    ))}
                </select>
                <EpisodeBadge episode={episode} />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                    Replay of archived inputs (IMERG Final + ERA5) · model lgbm_v0 (frozen), {meta?.cutset} cut-offs
                </span>
            </div>

            {error && <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold">{error}</div>}

            <div className="flex-1 flex overflow-hidden" data-testid="replay-view" data-loaded={data.key || ''}>
                <div className="flex-1 relative">
                    {meta && (
                        <AlertMap bounds={meta.bounds} alerts={shown} selectedId={selected?.alert_id}
                            onSelect={setSelected} site={meta.site} overlays={overlays} dimFill={!!field} />
                    )}
                    {meta && lead && (
                        <div className="absolute top-3 right-3 z-[400]">
                            <MapControls leads={meta.leads_available} lead={lead} setLead={setLead} leadInfo={leadInfo}
                                hazards={hazards} setHazards={setHazards} showWatch={showWatch} setShowWatch={setShowWatch}
                                counts={counts} field={field} setField={setField} />
                        </div>
                    )}
                    {meta && (
                        <div className="absolute bottom-3 left-3 z-[400]">
                            <MapLegend legends={meta.legends} field={field} site={!!meta.site}
                                note={obsAvailable ? null : 'Observed frame unavailable for this lead: no verification overlay.'} />
                        </div>
                    )}
                    {loading && (
                        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/40 dark:bg-black/30">
                            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>

                <aside className="w-[400px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] overflow-y-auto">
                    {selected ? (
                        <ExplainPanel key={selected.alert_id} episode={ep} ts={ts} alertId={selected.alert_id} onClose={() => setSelected(null)} />
                    ) : (
                        <>
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
                                        {hiddenWatch} Watch alert{hiddenWatch === 1 ? '' : 's'} hidden at this lead. Tick "Also show Watch".
                                    </p>
                                )}
                                {meta && (
                                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">{meta.verification_definition}</p>
                                )}
                            </div>
                            <AlertList alerts={shown} selectedId={selected?.alert_id} onSelect={setSelected}
                                emptyText={showWatch ? 'No alerts at this lead for the selected hazards.'
                                    : 'No Warnings at this lead for the selected hazards. Tick "Also show Watch" to see Watch alerts.'} />
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default ReplayView;
