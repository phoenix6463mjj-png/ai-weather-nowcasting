import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../config';
import { fetchWithWake, WAKE_UNAVAILABLE } from '../utils/serverWake';
import { askShownFirst, useFillPoll } from '../utils/weatherFill';
import { fetchedLabel, firedRules, isSampleSource, mixedBadge, sourceBadge, unratedNote } from '../utils/dashboardRisk';
import HonestyBanner from '../components/HonestyBanner';
import SampleSafetyNotice from '../components/SampleSafetyNotice';
import {
    FileText,
    ArrowLeft,
    Download,
    AlertTriangle,
    Activity,
    Calendar,
    MapPin,
    FileSpreadsheet,
    RefreshCw
} from 'lucide-react';
import TopHeader from '../components/TopHeader';

// One report, computed from the team backend's current zone list (/alerts): rule-based levels from current
// weather, not the ML model. No fixed figures, places or synoptic text: every number here is counted from
// the zone list, and the exports contain the same rows.
const FOOTER = 'Rule-based indicators from current weather (fixed rules, not the ML model). Not an alert bulletin.';
const TOP_N = 10;

const level = (z) => String(z.severity || z.risk_level || '').toUpperCase();
const sourceText = (s, zones) => (s.source === 'mixed' ? mixedBadge(s, zones) : sourceBadge(s.source, s.latest_observed_at, s.data_time));
const hhmm = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—');

const Card = ({ testid, label, icon, value, sub, tone = 'text-slate-900 dark:text-white' }) => (
    <div data-testid={testid} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</span>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-300 rounded-lg">{icon}</div>
        </div>
        <div data-testid={`${testid}-value`} className={`text-2xl font-black mt-2 ${tone}`}>{value}</div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{sub}</p>
    </div>
);

const Reports = () => {
    const [data, setData] = useState(null);           // { summary, alerts } from /alerts
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [fetchedAt, setFetchedAt] = useState(null);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const res = await fetchWithWake(`${API_BASE}/alerts?limit=380`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setData({ summary: json.summary || {}, alerts: json.alerts || [] });
            // OpenWeather still filling the list: the flagged zones in the table first
            askShownFirst(json.summary, (json.alerts || []).filter((z) => ['HIGH', 'MODERATE'].includes(level(z))).map((z) => z.city));
            setFetchedAt(new Date());
        } catch {
            setError(WAKE_UNAVAILABLE);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        let alive = true;
        const init = async () => { if (alive) await load(); };
        init();
        return () => { alive = false; };
    }, [load]);

    useFillPoll(data?.summary, load);

    const s = data?.summary || {};
    const zones = data?.alerts || [];
    const sampleOnly = data && isSampleSource(s.source);
    const rated = zones.filter((z) => ['HIGH', 'MODERATE', 'LOW'].includes(level(z)));
    const nRated = s.n_rated ?? rated.length;
    const nUnrated = (s.total ?? zones.length) - nRated;
    const flagged = rated.filter((z) => level(z) !== 'LOW');          // the backend sorts HIGH, MODERATE, then rain
    const counts = { HIGH: s.high ?? 0, MODERATE: s.moderate ?? 0, LOW: s.low ?? 0 };

    const download = (name, text, type) => {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_${(s.data_time || new Date().toISOString()).slice(0, 10)}.${type === 'text/csv' ? 'csv' : 'txt'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
    const exportCsv = () => {
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const head = 'city,state,lat,lon,rule_based_level,rules_fired,rain_mm,wind_m_s,humidity_pct,weather_source,data_time_utc';
        const rows = rated.map((z) => [z.city, z.state, z.lat, z.lon, level(z), (firedRules(z) || []).join('; '),
            z.weather?.rainfall ?? z.rainfall, z.weather?.wind_speed ?? z.wind_speed, z.weather?.humidity ?? z.humidity,
            z.weather?.source || z.source, z.weather?.data_time].map(q).join(','));
        download('zone_list_report', [`# ${FOOTER}`, `# Source: ${sourceText(s, zones)}`, head, ...rows].join('\n') + '\n', 'text/csv');
    };
    const exportTxt = () => {
        const lines = [
            'CURRENT ZONE-LIST REPORT (rule-based)',
            `Weather data: ${sourceText(s, zones)}`,
            `Data time (latest): ${hhmm(s.data_time)}`,
            `Zones in the list: ${s.total ?? zones.length}; rated: ${nRated}${nUnrated > 0 ? `; ${unratedNote(nUnrated)}` : ''}`,
            `Rule-based HIGH: ${counts.HIGH}, MODERATE: ${counts.MODERATE}, LOW: ${counts.LOW}`,
            '',
            `Zones at HIGH or MODERATE (${flagged.length}):`,
            ...flagged.map((z, i) => `${i + 1}. ${z.city} (${z.state}) - ${level(z)} - ${(firedRules(z) || []).join('; ') || 'rule not reported'} | rain ${z.weather?.rainfall ?? z.rainfall} mm, wind ${z.weather?.wind_speed ?? z.wind_speed} m/s`),
            '',
            FOOTER,
        ];
        download('zone_list_report', lines.join('\n') + '\n', 'text/plain');
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
            <TopHeader showCredits selectedCity="All India" />

            <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
                <HonestyBanner kind="rule-figures" />
                {/* Header */}
                <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
                            <FileText size={26} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white">Reports</h1>
                            <p data-testid="reports-subtitle" className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                A report of the current zone list, computed from the team backend (/alerts)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2.5 self-start sm:self-center">
                        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{fetchedLabel(fetchedAt)}</span>
                        <button type="button" onClick={load} disabled={loading}
                            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? 'animate-spin text-blue-500' : ''} />
                            <span>{loading ? 'Updating...' : 'Refresh'}</span>
                        </button>
                        <Link to="/dashboard" className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-colors shadow-xs">
                            <ArrowLeft size={14} />
                            <span>Back to Dashboard</span>
                        </Link>
                    </div>
                </div>

                {error && <p data-testid="reports-unavailable" className="text-sm text-slate-600 dark:text-slate-300">{error}</p>}
                {!error && !data && <p className="text-sm text-slate-500 dark:text-slate-400">Loading the zone list…</p>}

                {data && (<>
                    {sampleOnly && <SampleSafetyNotice className="mb-6" />}
                    <div className={`grid grid-cols-1 sm:grid-cols-2 ${sampleOnly ? 'lg:grid-cols-2' : 'lg:grid-cols-4'} gap-4 mb-6`}>
                        <Card testid="reports-zones" label="Zones in the list" icon={<MapPin size={18} />} value={s.total ?? zones.length}
                            sub={sourceText(s, zones)} />
                        {!sampleOnly && <>
                            <Card testid="reports-high" label="Rule-based HIGH" icon={<AlertTriangle size={18} />} value={counts.HIGH}
                                sub={`of ${nRated} rated zones`} tone="text-red-600 dark:text-red-400" />
                            <Card testid="reports-moderate" label="Rule-based MODERATE" icon={<Activity size={18} />} value={counts.MODERATE}
                                sub={`of ${nRated} rated zones`} tone="text-amber-600 dark:text-amber-400" />
                        </>}
                        <Card testid="reports-data-time" label="Weather data time" icon={<Calendar size={18} />}
                            value={s.data_time ? `${s.data_time.slice(11, 16)} UTC` : '—'} sub={s.data_time ? `Latest zone, ${s.data_time.slice(0, 10)}` : 'No weather data time in the list'} />
                    </div>

                    {!sampleOnly && (
                        <div data-testid="report-current" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                            <div className="flex items-start justify-between gap-3 mb-2">
                                <div>
                                    <h2 className="font-bold text-base text-slate-900 dark:text-white">Current zone-list report (rule-based)</h2>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                                        {nRated} rated zone{nRated === 1 ? '' : 's'}{nUnrated > 0 ? `; ${unratedNote(nUnrated)}` : ''}. {FOOTER}
                                    </p>
                                </div>
                            </div>

                            {/* level counts: one bar, widths from the counts (no percentages) */}
                            <div className="my-4">
                                <div data-testid="report-counts" className="flex items-center gap-4 text-xs font-bold mb-1.5">
                                    <span className="text-red-600 dark:text-red-400">HIGH {counts.HIGH}</span>
                                    <span className="text-amber-600 dark:text-amber-400">MODERATE {counts.MODERATE}</span>
                                    <span className="text-emerald-600 dark:text-emerald-400">LOW {counts.LOW}</span>
                                </div>
                                {nRated > 0 && (
                                    <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
                                        <div className="h-full bg-red-500" style={{ flexGrow: counts.HIGH }} />
                                        <div className="h-full bg-amber-400" style={{ flexGrow: counts.MODERATE }} />
                                        <div className="h-full bg-emerald-500" style={{ flexGrow: counts.LOW }} />
                                    </div>
                                )}
                            </div>

                            <span className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-2">
                                {flagged.length ? `Zones at HIGH or MODERATE (${Math.min(TOP_N, flagged.length)} of ${flagged.length})` : 'No zone at rule-based HIGH or MODERATE'}
                            </span>
                            <div data-testid="report-zones" className="space-y-1.5 mb-4">
                                {flagged.slice(0, TOP_N).map((z) => (
                                    <div key={`${z.city}-${z.lat}`} data-testid="report-zone" className="flex items-center justify-between gap-3 p-2 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${level(z) === 'HIGH' ? 'bg-red-500' : 'bg-amber-400'}`} />
                                            <span className="font-bold text-slate-900 dark:text-slate-100">{z.city}</span>
                                            <span className="text-xs text-slate-400 hidden sm:inline">({z.state})</span>
                                            <span className="text-xs font-bold text-slate-500">{level(z)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">{(firedRules(z) || []).join('; ') || 'rule not reported'}</span>
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 whitespace-nowrap">
                                                {z.weather?.rainfall ?? z.rainfall} mm · {z.weather?.wind_speed ?? z.wind_speed} m/s
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" onClick={exportTxt}
                                    className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer">
                                    <Download size={13} /><span>Export summary (TXT)</span>
                                </button>
                                <button type="button" onClick={exportCsv}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg cursor-pointer shadow-xs">
                                    <FileSpreadsheet size={13} /><span>Export rated zones (CSV)</span>
                                </button>
                            </div>
                        </div>
                    )}
                </>)}
            </main>
        </div>
    );
};

export default Reports;
