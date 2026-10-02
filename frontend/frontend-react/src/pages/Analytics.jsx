// Nowcast analytics (ML model): what the lgbm_v0 nowcast is warning about, how that changes with lead time,
// why the model thinks so, and how good it is. Built only from the ML API (alerts, maps) and its documented
// files (/analytics: validation attribution, CSI, quoted limits, INSAT status). Rule-based current-weather
// indicators live on the Dashboard, not here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Pause, CloudRain, Droplets, Zap, Wind, Mountain, Waves, Clock, ChevronDown, Satellite, ArrowRight } from 'lucide-react';
import TopHeader from '../components/TopHeader';
import {
    getAnalytics, getEpisodes, getIssueAlerts, getIssueMeta, getIndiaMeta, getLiveAlerts, getLiveMeta, getLiveRuns,
    issueMapUrl, indiaMapUrl, liveMapUrl,
} from '../services/nowcastApi';
import { HAZARD_STYLE } from '../utils/hazardLabels';
import { HAZARD_IDS, LEADS, LEVELS, areaByLead, fmtAreaText, sentenceLeads, sentenceNoAlertsRun, sentenceWarning, tileStats } from '../utils/nowcastAnalytics';
import { nowcastLink } from '../utils/nowcastUrl';

const TERMS = {
    lead: 'Lead time: how far ahead the forecast is valid. +2 h means two hours after the forecast was issued.',
    Watch: 'Watch: the lower alert level (moderate severity; for flash flood a risk ratio from 0.5 to 1).',
    Warning: 'Warning: the higher alert level (severe or extreme; for flash flood a risk ratio of 1 or more).',
    CSI: 'CSI (critical success index): hits ÷ (hits + misses + false alarms) for rain of at least 10 mm/hr. 1 is perfect, 0 means no useful forecast.',
    advection: 'Moving the current rain forward: the satellite rain now, shifted along its own motion. A simple standard to beat.',
    persistence: 'Keeping the current rain where it is: “it will keep raining where it rains now”.',
    attribution: 'Attribution: how much each group of inputs moved the model’s scores (SHAP values), as a share of the total.',
    area: 'Area: the total area of the alert shapes at this lead, in square kilometres.',
};
const ICONS = { rain: CloudRain, moisture: Droplets, instability: Zap, wind: Wind, terrain: Mountain, ground: Waves, clock: Clock };
const GROUP_COLOURS = { observed_rain_motion: '#2563eb', moisture: '#0d9488', instability: '#d97706', lift_wind: '#7c3aed',
    terrain: '#78716c', ground_wetness: '#0369a1', lead_time: '#cbd5e1' };
const stripMd = (s) => s.replace(/\*\*/g, '');

const Term = ({ k, children }) => (
    <span className="relative inline-block group">
        <button type="button" aria-describedby={`term-${k}`} data-testid={`term-${k}`}
            className="underline decoration-dotted decoration-slate-400 underline-offset-2 cursor-help focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-sm">
            {children}
        </button>
        <span role="tooltip" id={`term-${k}`}
            className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity duration-150 absolute z-30 left-0 top-full mt-1 w-64 max-w-[80vw] rounded-lg bg-slate-900 text-white text-sm font-normal leading-snug p-2.5 shadow-lg">
            {TERMS[k]}
        </span>
    </span>
);

function useWidth(ref) {
    const [w, setW] = useState(600);
    useEffect(() => {
        if (!ref.current) return undefined;
        const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [ref]);
    return w;
}

const Section = ({ n, q, sentence, testid, children }) => (
    <section data-testid={testid} className="py-10 border-b border-slate-200 dark:border-slate-800 last:border-0">
        <p className="text-sm font-black uppercase tracking-wider text-blue-700 dark:text-blue-400">{n}</p>
        <h2 className="text-2xl font-black text-slate-900 dark:text-white mt-1">{q}</h2>
        {sentence && <p data-testid={`${testid}-sentence`} className="text-lg text-slate-700 dark:text-slate-200 mt-2 leading-snug transition-opacity duration-200">{sentence}</p>}
        <div className="mt-6">{children}</div>
    </section>
);

const Chip = ({ on, onClick, children, colour, testid }) => (
    <button type="button" aria-pressed={on} onClick={onClick} data-testid={testid}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border transition-colors ${on
            ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
            : 'bg-white text-slate-500 border-slate-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-600'}`}>
        {colour && <span className="w-2.5 h-2.5 rounded-full" style={{ background: colour, opacity: on ? 1 : 0.4 }} />}
        {children}
    </button>
);

// ---------------------------------------------------------------- section 1: thumbnail
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const Thumbnail = ({ meta, alerts, bg, onOpen, label }) => {
    if (!meta) return null;
    const [[s, w], [n, e]] = meta.bounds;
    const W = 1000;
    const H = Math.round((W * (mercY(n) - mercY(s))) / (((e - w) * Math.PI) / 180));
    const px = (lon) => ((lon - w) / (e - w)) * W;
    const py = (lat) => ((mercY(n) - mercY(lat)) / (mercY(n) - mercY(s))) * H;
    const path = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
        .map((poly) => poly.map((ring) => ring.map(([lo, la], i) => `${i ? 'L' : 'M'}${px(lo).toFixed(1)},${py(la).toFixed(1)}`).join(' ') + 'Z').join(' '))
        .join(' ');
    return (
        <button type="button" data-testid="analytics-thumbnail" onClick={onOpen} aria-label={label}
            className="block w-full max-w-md rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-hidden="true">
                {bg && <image href={bg} x="0" y="0" width={W} height={H} preserveAspectRatio="none" opacity="0.9" />}
                {alerts.map((a) => (
                    <path key={a.alert_id} d={path(a.geometry)} fill={HAZARD_STYLE[a.hazard].color}
                        fillOpacity={a.level === 'Warning' ? 0.55 : 0.25} stroke={HAZARD_STYLE[a.hazard].color}
                        strokeWidth="3" strokeDasharray={a.level === 'Warning' ? null : '10 8'} />
                ))}
            </svg>
            <span className="flex items-center justify-between px-3 py-2 text-sm font-bold text-blue-700 dark:text-blue-400">
                {label} <ArrowRight size={16} />
            </span>
        </button>
    );
};

// ---------------------------------------------------------------- section 2: area by lead
const AreaChart = ({ rows, hazards, lead, onLead }) => {
    const box = useRef(null);
    const W = useWidth(box);
    const [hover, setHover] = useState(null);
    const H = 240;
    const pad = { l: 8, r: 8, t: 14, b: 34 };
    const max = Math.max(1, ...rows.map((r) => r.total));
    const bw = (W - pad.l - pad.r) / rows.length;
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const info = hover ?? { lead, text: null };
    const row = rows.find((r) => r.lead === info.lead);
    return (
        <div ref={box} data-testid="analytics-area-chart">
            <svg width={W} height={H} role="img" aria-label="Alert area by lead time, stacked by hazard">
                {rows.map((r, i) => {
                    let acc = 0;
                    const x = pad.l + i * bw + bw * 0.18;
                    const w = bw * 0.64;
                    const sel = r.lead === lead;
                    return (
                        <g key={r.lead}>
                            {hazards.map((h) => {
                                const v = r.byHazard[h]?.area || 0;
                                if (!v) return null;
                                const y0 = y(acc + v);
                                const hgt = y(acc) - y0;
                                acc += v;
                                return (
                                    <rect key={h} data-testid="area-bar" data-lead={r.lead} data-hazard={h} data-area={Math.round(v)}
                                        x={x} y={y0} width={w} height={Math.max(1, hgt)} rx="3" fill={HAZARD_STYLE[h].color}
                                        opacity={sel ? 1 : 0.45} tabIndex={0} className="cursor-pointer transition-opacity duration-200 focus:outline-none"
                                        onMouseEnter={() => setHover({ lead: r.lead, h })} onMouseLeave={() => setHover(null)}
                                        onFocus={() => setHover({ lead: r.lead, h })} onBlur={() => setHover(null)}
                                        onClick={() => onLead(r.lead)} aria-label={`+${r.lead} h, ${HAZARD_STYLE[h].name}: ${fmtAreaText(v)} km²`} />
                                );
                            })}
                            {sel && <rect x={x - 4} y={pad.t - 6} width={w + 8} height={H - pad.t - pad.b + 6} fill="none" stroke="#0f172a" strokeWidth="2" rx="6" />}
                            <text x={x + w / 2} y={H - 12} textAnchor="middle" fontSize="14" fontWeight={sel ? 800 : 500} fill="currentColor">+{r.lead} h</text>
                        </g>
                    );
                })}
            </svg>
            <p data-testid="area-chart-info" aria-live="polite" className="text-base text-slate-700 dark:text-slate-200 min-h-[1.5rem]">
                {row && `+${row.lead} h: ${hazards.map((h) => `${HAZARD_STYLE[h].name} ${fmtAreaText(row.byHazard[h]?.area || 0)} km²`).join(' · ')}`}
            </p>
        </div>
    );
};

// ---------------------------------------------------------------- section 3: attribution
const AttributionChart = ({ a, lead, dim }) => {
    const box = useRef(null);
    const W = useWidth(box);
    const [hover, setHover] = useState(null);
    const leads = Object.keys(a.per_lead);
    const rowH = 30;
    const labelW = 52;
    const H = leads.length * (rowH + 12) + 4;
    const cur = hover ?? { lead: String(lead), key: null };
    const g = a.groups.find((x) => x.key === cur.key);
    const sh = a.per_lead[cur.lead]?.shares;
    return (
        <div ref={box} data-testid="analytics-attribution-chart" className={`transition-opacity duration-200 ${dim ? 'opacity-30' : ''}`}>
            <svg width={W} height={H} role="img" aria-label="Share of the model's attribution by input group, per lead time">
                {leads.map((L, i) => {
                    let x = labelW;
                    const sel = L === String(lead);
                    const y = i * (rowH + 12) + 2;
                    return (
                        <g key={L}>
                            <text x={0} y={y + rowH / 2 + 5} fontSize="14" fontWeight={sel ? 800 : 500} fill="currentColor">+{L} h</text>
                            {a.groups.map((gr) => {
                                const v = a.per_lead[L].shares[gr.key] || 0;
                                const w = (v / 100) * (W - labelW - 4);
                                const r = (
                                    <rect key={gr.key} data-testid="attr-seg" data-lead={L} data-group={gr.key} data-share={v}
                                        x={x} y={y} width={Math.max(0.5, w)} height={rowH} fill={GROUP_COLOURS[gr.key]}
                                        opacity={sel ? 1 : 0.5} tabIndex={0} className="transition-opacity duration-200 focus:outline-none"
                                        onMouseEnter={() => setHover({ lead: L, key: gr.key })} onMouseLeave={() => setHover(null)}
                                        onFocus={() => setHover({ lead: L, key: gr.key })} onBlur={() => setHover(null)}
                                        aria-label={`+${L} h, ${gr.name}: ${v}% of the attribution`} />
                                );
                                x += w;
                                return r;
                            })}
                            {sel && <rect x={labelW - 3} y={y - 3} width={W - labelW - 1} height={rowH + 6} fill="none" stroke="#0f172a" strokeWidth="2" rx="4" />}
                        </g>
                    );
                })}
            </svg>
            <p data-testid="attribution-info" aria-live="polite" className="text-base text-slate-700 dark:text-slate-200 min-h-[3rem] mt-1">
                {g ? <><b>{g.name}</b>: {sh[g.key]}% of the attribution at +{cur.lead} h. {g.explain}.</>
                    : sh && <>At +{cur.lead} h: rain now {sh.observed_rain_motion}%, everything else {a.per_lead[cur.lead].not_rain_now}%.</>}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
                {a.groups.map((gr) => {
                    const I = ICONS[gr.icon];
                    return (
                        <li key={gr.key} className="flex items-center gap-1.5 text-sm" title={gr.explain}>
                            <span className="w-3 h-3 rounded-sm" style={{ background: GROUP_COLOURS[gr.key] }} />
                            {I && <I size={16} className="text-slate-500" />} {gr.name}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

// ---------------------------------------------------------------- section 4: CSI by lead
const SKILL_LINES = [['model', 'The model', '#2563eb', null], ['advection', 'Moving the current rain forward', '#94a3b8', '6 4'],
    ['persistence', 'Keeping the current rain where it is', '#f59e0b', '2 4']];

const SkillChart = ({ s, lead }) => {
    const box = useRef(null);
    const W = useWidth(box);
    const [hover, setHover] = useState(null);
    const H = 260;
    const pad = { l: 44, r: 16, t: 14, b: 34 };
    const rows = s.rows;
    const max = Math.ceil(Math.max(...rows.flatMap((r) => [r.model, r.advection, r.persistence])) * 10) / 10;
    const x = (i) => pad.l + (i / (rows.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const li = rows.findIndex((r) => r.lead === lead);
    const show = hover ?? (li >= 0 ? { i: li } : null);
    const r = show ? rows[show.i] : null;
    return (
        <div ref={box} data-testid="analytics-skill-chart">
            <svg width={W} height={H} role="img" aria-label="CSI at 10 mm/hr by lead time: model, moving the current rain forward, keeping it where it is">
                {[0, max / 2, max].map((v) => (
                    <g key={v}>
                        <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
                        <text x={pad.l - 6} y={y(v) + 5} textAnchor="end" fontSize="14" fill="#64748b">{v.toFixed(1)}</text>
                    </g>
                ))}
                {li >= 0 && <line x1={x(li)} x2={x(li)} y1={pad.t} y2={H - pad.b} stroke="#0f172a" strokeWidth="2" strokeDasharray="3 3" />}
                {SKILL_LINES.map(([k, , col, dash]) => (
                    <g key={k}>
                        <polyline points={rows.map((rr, i) => `${x(i)},${y(rr[k])}`).join(' ')} fill="none" stroke={col} strokeWidth={k === 'model' ? 3.5 : 2.5} strokeDasharray={dash} />
                        {rows.map((rr, i) => (
                            <circle key={rr.lead} data-testid="skill-point" data-line={k} data-lead={rr.lead} data-csi={rr[k]}
                                cx={x(i)} cy={y(rr[k])} r={k === 'model' ? 6 : 5} fill={col} tabIndex={0} className="focus:outline-none"
                                onMouseEnter={() => setHover({ i })} onMouseLeave={() => setHover(null)}
                                onFocus={() => setHover({ i })} onBlur={() => setHover(null)} aria-label={`+${rr.lead} h: CSI ${rr[k]}`} />
                        ))}
                    </g>
                ))}
                {rows.map((rr, i) => <text key={rr.lead} x={x(i)} y={H - 12} textAnchor="middle" fontSize="14" fontWeight={rr.lead === lead ? 800 : 500} fill="currentColor">+{rr.lead} h</text>)}
            </svg>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm mt-1">
                {SKILL_LINES.map(([k, name, col, dash]) => (
                    <li key={k} className="flex items-center gap-2">
                        <svg width="26" height="8"><line x1="0" x2="26" y1="4" y2="4" stroke={col} strokeWidth="3" strokeDasharray={dash} /></svg>
                        {k === 'model' ? name : <Term k={k}>{name}</Term>}
                    </li>
                ))}
            </ul>
            <p data-testid="skill-info" aria-live="polite" className="text-base text-slate-700 dark:text-slate-200 min-h-[1.5rem] mt-2">
                {r && <>At +{r.lead} h: model <b>{r.model.toFixed(3)}</b> · moving forward {r.advection.toFixed(3)} · keeping in place {r.persistence.toFixed(3)} (<Term k="CSI">CSI</Term>)</>}
            </p>
        </div>
    );
};

const More = ({ title, children, testid }) => (
    <details data-testid={testid} className="group mt-5 rounded-xl border border-slate-200 dark:border-slate-700">
        <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 text-base font-bold text-slate-800 dark:text-slate-100">
            {title} <ChevronDown size={18} className="transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 text-sm text-slate-700 dark:text-slate-300 space-y-3 leading-relaxed">{children}</div>
    </details>
);

// ---------------------------------------------------------------- page
const Analytics = () => {
    const navigate = useNavigate();
    const [sources, setSources] = useState(null);           // [{ id, kind, label, badge, ep, ts, run, issue }]
    const [srcId, setSrcId] = useState(null);
    const [data, setData] = useState({ id: null, meta: null, alerts: [] });
    const [doc, setDoc] = useState(null);                   // /analytics
    const [leadIdx, setLeadIdx] = useState(3);
    const [playing, setPlaying] = useState(false);
    const [hazards, setHazards] = useState(HAZARD_IDS);
    const [levels, setLevels] = useState(LEVELS);
    const [error, setError] = useState(null);

    useEffect(() => {
        let live = true;
        Promise.all([getLiveRuns().catch(() => ({ runs: [] })), getEpisodes()]).then(([lr, eps]) => {
            if (!live) return;
            const list = [];
            if (lr.runs.length) list.push({ id: 'live', kind: 'live', run: lr.runs[0].run, issue: lr.runs[0].issue_time,
                label: `Live run (not validated) · issued ${lr.runs[0].issue_time.slice(5, 16).replace('T', ' ')}Z`, badge: 'Not validated' });
            list.push({ id: 'india', kind: 'india', label: 'All-India example (probability maps only)', badge: 'Sample' });
            for (const e of eps.episodes) {
                const it = e.episode === eps.default.episode ? e.issues.find((i) => i.ts === eps.default.ts) : e.issues[Math.floor(e.issues.length / 2)];
                list.push({ id: e.episode, kind: 'replay', ep: e.episode, ts: it.ts, issue: it.issue_time, forecastOnly: it.explain_available === false,
                    label: `Event replay ${e.episode} · ${e.sites?.length ? e.sites.map((x) => x.name).join(' + ') : e.location}${e.in_sample ? ' · IN-SAMPLE' : ''}`,
                    badge: e.in_sample ? e.sample_label : e.badge });
            }
            setSources(list);
            setSrcId(list[0].id);
        }).catch((e) => live && setError(e.message));
        getAnalytics().then((d) => live && setDoc(d)).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, []);

    const src = sources?.find((s) => s.id === srcId) || null;
    useEffect(() => {
        if (!src) return undefined;
        let live = true;
        const p = src.kind === 'live' ? Promise.all([getLiveMeta(src.run), getLiveAlerts(src.run)])
            : src.kind === 'india' ? Promise.all([getIndiaMeta(), Promise.resolve({ alerts: [] })])
                : Promise.all([getIssueMeta(src.ep, src.ts), getIssueAlerts(src.ep, src.ts)]);
        p.then(([m, a]) => live && setData({ id: src.id, meta: m, alerts: a.alerts || [] })).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, [src]);

    useEffect(() => {
        if (!playing) return undefined;
        const t = setInterval(() => setLeadIdx((i) => {
            if (i >= LEADS.length - 1) { setPlaying(false); return i; }
            return i + 1;
        }), 1300);
        return () => clearInterval(t);
    }, [playing]);

    const lead = LEADS[leadIdx];
    const ready = data.id === srcId && data.meta;
    const alerts = useMemo(() => (ready ? data.alerts : []), [ready, data.alerts]);
    const stats = useMemo(() => tileStats(alerts, lead, hazards, levels), [alerts, lead, hazards, levels]);
    const byLead = useMemo(() => areaByLead(alerts, hazards, levels), [alerts, hazards, levels]);
    const shown = alerts.filter((a) => a.lead_time_h === lead && hazards.includes(a.hazard) && levels.includes(a.level));
    const toggle = (list, set, v) => set(list.includes(v) ? (list.length > 1 ? list.filter((x) => x !== v) : list) : [...list, v]);
    const noAlerts = src?.kind === 'india';
    const emptyRun = !!ready && !noAlerts && alerts.length === 0;   // a run/issue with no alerts at any lead
    const open = (hz) => navigate(nowcastLink({
        view: src.kind, ep: src.ep, ts: src.ts, run: src.kind === 'live' ? src.run : undefined, lead, hazard: hz,
        watch: levels.includes('Watch'),
        field: src.kind === 'india' ? (hz === 'cloudburst' ? 'cloudburst_index' : 'thunderstorm') : undefined,
    }));
    const bg = !src || !ready ? null : src.kind === 'live' ? liveMapUrl(src.run, lead, 'rain_p10')
        : src.kind === 'india' ? indiaMapUrl(lead, hazards.includes('cloudburst') && !hazards.includes('thunderstorm') ? 'cloudburst_index' : 'thunderstorm')
            : issueMapUrl(src.ep, src.ts, lead, 'rain_p10');
    const attrApplies = doc?.attribution?.applies_to?.filter((h) => hazards.includes(h)) || [];

    return (
        <div className="min-h-screen bg-white dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-x-hidden">
            <TopHeader showCredits selectedCity="All India" />
            <div data-testid="analytics-topbar" className="sticky top-0 z-40 bg-white/95 dark:bg-[#0b0f19]/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
                <div className="max-w-3xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <label className="flex flex-col gap-1 min-w-0 flex-1 basis-60">
                        <span className="text-sm font-bold text-slate-500">Source</span>
                        <select data-testid="analytics-source" value={srcId || ''} onChange={(e) => setSrcId(e.target.value)}
                            className="text-base font-bold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 min-w-0 w-full">
                            {(sources || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                    </label>
                    <div className="flex flex-col gap-1 basis-56 flex-1">
                        <span className="text-sm font-bold text-slate-500"><Term k="lead">Lead time</Term>: <b data-testid="analytics-lead" className="text-slate-900 dark:text-white">+{lead} h</b></span>
                        <div className="flex items-center gap-2">
                            <button type="button" data-testid="analytics-play" onClick={() => { if (!playing && leadIdx === LEADS.length - 1) setLeadIdx(0); setPlaying(!playing); }}
                                aria-label={playing ? 'Pause' : 'Play through the lead times'}
                                className="p-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700">{playing ? <Pause size={16} /> : <Play size={16} />}</button>
                            <input type="range" min="0" max={LEADS.length - 1} step="1" value={leadIdx} data-testid="analytics-lead-slider"
                                onChange={(e) => { setPlaying(false); setLeadIdx(Number(e.target.value)); }} aria-label="Lead time"
                                aria-valuetext={`+${lead} h`} className="flex-1 accent-blue-600" />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 basis-full">
                        {HAZARD_IDS.map((h) => <Chip key={h} testid={`chip-${h}`} on={hazards.includes(h)} colour={HAZARD_STYLE[h].color}
                            onClick={() => toggle(hazards, setHazards, h)}>{HAZARD_STYLE[h].name}</Chip>)}
                        <span className="w-px bg-slate-200 dark:bg-slate-700 mx-1" />
                        {LEVELS.map((l) => <Chip key={l} testid={`chip-${l}`} on={levels.includes(l)} onClick={() => toggle(levels, setLevels, l)}>{l}</Chip>)}
                    </div>
                </div>
            </div>

            <main className="max-w-3xl mx-auto px-4">
                <header className="pt-8">
                    <h1 className="text-3xl font-black">Nowcast analytics (ML model)</h1>
                    <p className="text-base text-slate-600 dark:text-slate-300 mt-1">What the frozen lgbm_v0 model is warning about, how that changes with lead time, why, and how far to trust it.</p>
                    {src && <p data-testid="analytics-badge" className="inline-block mt-3 text-sm font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{src.badge}{src.forecastOnly ? ' · forecast-only issue' : ''}</p>}
                    {error && <p className="text-base text-red-600 mt-2">{error}</p>}
                </header>

                <Section n="1" q="What is the model warning about?" testid="analytics-s1"
                    sentence={!ready ? 'Loading…' : noAlerts ? `The all-India example has probability maps only: no alerts are produced (absence of alerts does not mean no risk).`
                        : emptyRun ? (src.kind === 'live' ? sentenceNoAlertsRun(data.meta, lead) : 'No Watch or Warning in this issue at any lead.')
                            : sentenceWarning(stats, lead, hazards, levels)}>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {HAZARD_IDS.map((h) => {
                            const s = stats[h];
                            return (
                                <button key={h} type="button" data-testid="hazard-tile" data-hazard={h} data-n={s.n} data-area={Math.round(s.area)}
                                    onClick={() => open(h)} disabled={!ready}
                                    className={`text-left rounded-2xl border-2 p-4 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${s.selected ? '' : 'opacity-40'}`}
                                    style={{ borderColor: HAZARD_STYLE[h].color }}>
                                    <p className="text-base font-bold flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: HAZARD_STYLE[h].color }} />{HAZARD_STYLE[h].name}</p>
                                    <p className="text-4xl font-black mt-2 tabular-nums">{noAlerts ? '—' : s.n}</p>
                                    <p className="text-sm text-slate-600 dark:text-slate-300">{noAlerts ? 'no alerts in this source' : `alert${s.n === 1 ? '' : 's'} at +${lead} h`}</p>
                                    {!noAlerts && (
                                        <p className="text-sm text-slate-700 dark:text-slate-200 mt-2">
                                            <Term k="Warning">Warning</Term> {s.warning} · <Term k="Watch">Watch</Term> {s.watch}<br />
                                            <Term k="area">{fmtAreaText(s.area)} km²</Term>
                                        </p>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-6">
                        <Thumbnail meta={ready ? data.meta : null} alerts={shown} bg={bg} onOpen={() => open(hazards[0])}
                            label={`Open in ML Nowcast at +${lead} h`} />
                    </div>
                </Section>

                <Section n="2" q="How does it change with lead time?" testid="analytics-s2"
                    sentence={!ready ? null : noAlerts ? 'No alerts in the all-India example, so there is no alert area to compare.'
                        : emptyRun ? `No alerts at any lead in this ${src.kind === 'live' ? 'run' : 'issue'}, so there is no alert area to compare.`
                            : sentenceLeads(byLead)}>
                    {ready && !noAlerts && !emptyRun && <AreaChart rows={byLead} hazards={hazards} lead={lead} onLead={(L) => { setPlaying(false); setLeadIdx(LEADS.indexOf(L)); }} />}
                </Section>

                <Section n="3" q="Why does the model think so?" testid="analytics-s3" sentence={doc?.attribution?.sentence}>
                    {doc?.attribution?.available && (
                        <>
                            <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                                <Term k="attribution">Attribution</Term> of the {doc.attribution.model}, {doc.attribution.label}.{' '}
                                <span data-testid="attribution-applies">{attrApplies.length
                                    ? `Describes ${attrApplies.map((h) => HAZARD_STYLE[h].name.toLowerCase()).join(' and ')}.`
                                    : 'Not shown for flash flood alone: it is a basin rain-accumulation ratio, not this model’s output.'}</span>{' '}
                                <span data-testid="attribution-levels">Model-wide: the same for {levels.join(' and ')} alerts.</span>
                            </p>
                            <AttributionChart a={doc.attribution} lead={lead} dim={!attrApplies.length} />
                            <More title="More about this chart" testid="attribution-more">
                                <p>{doc.attribution.applies_note}</p>
                                <p>Rows: {doc.attribution.rows?.toLocaleString('en-US')} validation rows (2022–23) at or above the alert cut-off. {doc.attribution.definition}.</p>
                                <p>Source: {doc.attribution.source}.</p>
                            </More>
                        </>
                    )}
                </Section>

                <Section n="4" q="How good is it?" testid="analytics-s4" sentence={doc?.skill?.sentence}>
                    {doc?.skill && (
                        <>
                            <p data-testid="skill-caption" className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                                <Term k="CSI">CSI</Term> for rain of at least 10 mm/hr, validation 2022–23. The same scores apply to every hazard shown
                                ({hazards.map((h) => HAZARD_STYLE[h].name.toLowerCase()).join(', ')}) and to {levels.join(' and ')} alerts: the hazards are built from these rain forecasts.
                            </p>
                            <SkillChart s={doc.skill} lead={lead} />
                            <More title="Known weaknesses" testid="analytics-weaknesses">
                                <ul className="space-y-3">
                                    {doc.weaknesses.map((w) => (
                                        <li key={w.id} data-testid="weakness">
                                            <p className="font-bold text-slate-800 dark:text-slate-100">{w.plain}</p>
                                            {w.count && <p>{w.count}</p>}
                                            <p className="text-slate-500">“{stripMd(w.quote)}” ({w.source})</p>
                                        </li>
                                    ))}
                                </ul>
                            </More>
                            <Link to="/nowcast/results" data-testid="analytics-results-link" className="inline-flex items-center gap-1 mt-4 text-base font-bold text-blue-700 dark:text-blue-400 hover:underline">
                                All results <ArrowRight size={16} />
                            </Link>
                        </>
                    )}
                </Section>

                <footer className="py-10 space-y-4">
                    {doc?.insat && (
                        <div data-testid="analytics-insat" className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                            <p className="text-base font-bold flex items-center gap-2"><Satellite size={18} /> INSAT satellite (observation, INSAT via MOSDAC)</p>
                            <ul className="mt-2 space-y-1 text-base">
                                {doc.insat.by_satellite.map((s) => <li key={s.satellite} data-testid="analytics-insat-sat">{s.text}</li>)}
                            </ul>
                            {doc.insat.listing_delay && <p data-testid="analytics-insat-delay" className="text-sm text-slate-600 dark:text-slate-300 mt-2">{doc.insat.listing_delay}</p>}
                            <p className="text-sm text-slate-500 mt-1">Observation only: not used by the model.</p>
                        </div>
                    )}
                    <p data-testid="analytics-rule-link" className="text-base">Current-weather rule-based indicators: see <Link to="/" className="font-bold text-blue-700 dark:text-blue-400 hover:underline">Dashboard</Link>.</p>
                </footer>
            </main>
        </div>
    );
};

export default Analytics;
