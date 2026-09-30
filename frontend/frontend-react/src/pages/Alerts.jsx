import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../config';
import { fetchWithWake, WAKE_UNAVAILABLE } from '../utils/serverWake';
import { fetchedLabel, isLiveSource, isSampleSource, isUnratedZone, mixedCounts, parseUtcIso, primaryThreat, sourceBadge, unratedNote } from '../utils/dashboardRisk';
import SampleSafetyNotice from '../components/SampleSafetyNotice';
import OpenMeteoCredit from '../components/OpenMeteoCredit';
import OpenWeatherCredit from '../components/OpenWeatherCredit';
import {
    ArrowLeft,
    RefreshCw,
    Search,
    ShieldCheck,
    AlertTriangle,
    Flame,
    AlertCircle,
    SlidersHorizontal,
    MapPin,
    Radio
} from 'lucide-react';
import TopHeader from '../components/TopHeader';

// Standard state mapping for Indian cities for cleaner display
const CITY_STATE_MAP = {
    "Amalapuram": "Andhra Pradesh",
    "Bapatla": "Andhra Pradesh",
    "Bhimavaram": "Andhra Pradesh",
    "Dharmavaram": "Andhra Pradesh",
    "Eluru": "Andhra Pradesh",
    "Gudivada": "Andhra Pradesh",
    "Kakinada": "Andhra Pradesh",
    "Visakhapatnam": "Andhra Pradesh",
    "Mumbai": "Maharashtra",
    "Pune": "Maharashtra",
    "Nagpur": "Maharashtra",
    "Delhi": "NCR",
    "New Delhi": "NCR",
    "Kolkata": "West Bengal",
    "Digha": "West Bengal",
    "Chennai": "Tamil Nadu",
    "Bengaluru": "Karnataka",
    "Hyderabad": "Telangana",
    "Bhubaneswar": "Odisha",
    "Puri": "Odisha",
    "Ahmedabad": "Gujarat",
    "Surat": "Gujarat",
    "Jaipur": "Rajasthan",
    "Lucknow": "Uttar Pradesh",
    "Patna": "Bihar",
    "Guwahati": "Assam",
    "Kochi": "Kerala",
    "Thiruvananthapuram": "Kerala",
    "Dehradun": "Uttarakhand",
    "Shimla": "Himachal Pradesh",
    "Srinagar": "Jammu & Kashmir",
    "Amritsar": "Punjab",
    "Indore": "Madhya Pradesh",
    "Bhopal": "Madhya Pradesh",
    "Ranchi": "Jharkhand",
    "Raipur": "Chhattisgarh"
};

// "N min ago" from the backend's UTC timestamp ("...Z"); a naive or missing one falls back to the fetch time
const getTimeAgo = (ts, fallbackDate) => {
    const d = parseUtcIso(ts) || fallbackDate || new Date();

    const diffMs = Math.max(0, Date.now() - d.getTime());
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffMin < 1) return "Just now";
    if (diffMin === 1) return "1 min ago";
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHr === 1) return "1 hr ago";
    return `${diffHr} hrs ago`;
};

// Normalize severity to standard categories: HIGH, MODERATE, LOW
const normalizeSeverity = (sev) => {
    const s = String(sev || '').toUpperCase().trim();
    if (s === 'HIGH' || s === 'CRITICAL' || s === 'SEVERE') return 'HIGH';
    if (s === 'MEDIUM' || s === 'MODERATE' || s === 'WARNING') return 'MODERATE';
    if (s === 'LOW' || s === 'ADVISORY' || s === 'INFO') return 'LOW';
    return 'LOW';
};

// Severity priority sorting weight: HIGH (3) -> MODERATE (2) -> LOW (1)
const getSeverityWeight = (sev) => {
    const norm = normalizeSeverity(sev);
    if (norm === 'HIGH') return 3;
    if (norm === 'MODERATE') return 2;
    if (norm === 'LOW') return 1;
    return 0;
};

// Card sentence: the rule(s) that put the zone at its level, as reported by the backend (rules_fired).
// A HIGH card names a hazard only when the fired rule points to it (the HIGH rain rule -> Flash Flood);
// otherwise "Rule-based HIGH: <rule>" with no hazard named.
const resolveShortMessage = (alert) => {
    const sev = normalizeSeverity(alert.severity);
    if (sev === 'LOW') return "No rule-based hazard flagged for this zone.";
    const rules = Array.isArray(alert.rules_fired) ? alert.rules_fired.filter(Boolean) : [];
    if (!rules.length) return "Rule-based level; the rule that fired was not reported.";
    if (sev === 'HIGH') return primaryThreat(alert) === 'flood' ? `Flash Flood: ${rules.join('; ')} (rule-based).`
        : `Rule-based HIGH: ${rules.join('; ')}.`;
    return `${rules.join('; ')} (rule-based).`;
};

// No action advice from this demo (its alerts are rule-based, usually on sample data): point to the
// official sources instead. The backend's action text is not shown.
const OFFICIAL_ADVICE = "Follow official IMD and state advisories.";
const resolveCleanAction = () => OFFICIAL_ADVICE;
const Alerts = () => {
    const [alerts, setAlerts] = useState([]);
    // weather source of the zone list ("sample" | "openweather" | "mixed"); "Live" only for OpenWeather
    const [weatherSource, setWeatherSource] = useState(null);
    const [dataTime, setDataTime] = useState(null);
    const live = isLiveSource(weatherSource);
    const [summary, setSummary] = useState({ total: 0, high: 0, moderate: 0, low: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // sample data: no counts, filters or alert cards (no rule-based alarms on sample values)
    const sampleOnly = isSampleSource(weatherSource) && !error;
    const [filter, setFilter] = useState('ALL'); // 'ALL' | 'HIGH' | 'MODERATE' | 'LOW'
    const [sortBy, setSortBy] = useState('severity'); // 'severity' | 'latest'
    const [searchQuery, setSearchQuery] = useState('');
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [expandedIds, setExpandedIds] = useState(new Set());

    const isFetchingRef = useRef(false);

    // Fetch alerts from backend /alerts — SINGLE SOURCE OF TRUTH
    const fetchAlerts = useCallback(async (isSilent = false) => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        if (!isSilent) setLoading(true);
        setError(null);
        try {
            const res = await fetchWithWake(`${API_BASE}/alerts?limit=380`);
            if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch alerts`);
            const data = await res.json();
            const fetchedAlerts = data.alerts || [];
            const fetchedSummary = data.summary || {
                total: fetchedAlerts.length,
                high: 0,
                moderate: 0,
                low: 0
            };
            setAlerts(fetchedAlerts);
            setSummary(fetchedSummary);
            setWeatherSource(fetchedSummary.source || 'sample');
            setDataTime(fetchedSummary.data_time || fetchedSummary.latest_observed_at || null);
            setLastSyncTime(parseUtcIso(data.last_updated) || new Date());   // backend UTC time of the zone data
        } catch (err) {
            console.error("Alerts fetch error:", err);
            setError(WAKE_UNAVAILABLE);
            setAlerts([]);
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
    }, []);

    useEffect(() => {
        let isMounted = true;
        const initFetch = async () => {
            if (isMounted) await fetchAlerts();
        };
        initFetch();

        // 5-minute auto-sync
        const interval = setInterval(() => {
            if (isMounted) fetchAlerts(true);
        }, 300000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [fetchAlerts]);

    // Toggle collapsible details
    const toggleExpanded = (key) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // Metrics for the 4 summary cards — SINGLE SOURCE OF TRUTH FROM BACKEND
    // DO NOT recalculate with alerts.filter on client side
    const totalCount = summary.total ?? alerts.length;
    // mixed list: sample-data zones get no card and are not in the counts
    const mixed = weatherSource === 'mixed';
    const nUnrated = mixed ? mixedCounts(summary, alerts).sample : 0;
    const ratedCount = summary.n_rated ?? (totalCount - nUnrated);
    const ratedAlerts = useMemo(() => alerts.filter((a) => !isUnratedZone(a)), [alerts]);
    const highCount = summary.high ?? 0;
    const modCount = summary.moderate ?? 0;
    const lowCount = summary.low ?? 0;

    // Filter and Sort Alerts
    const filteredAndSortedAlerts = useMemo(() => {
        let result = ratedAlerts.filter(alert => {
            const norm = normalizeSeverity(alert.severity);
            if (filter === 'HIGH' && norm !== 'HIGH') return false;
            if (filter === 'MODERATE' && norm !== 'MODERATE') return false;
            if (filter === 'LOW' && norm !== 'LOW') return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const cityMatch = (alert.city || '').toLowerCase().includes(q);
                const stateMatch = (alert.state || CITY_STATE_MAP[alert.city] || '').toLowerCase().includes(q);
                const typeMatch = (alert.type || '').toLowerCase().includes(q);
                const actionMatch = (alert.action || alert.message || '').toLowerCase().includes(q);
                if (!cityMatch && !stateMatch && !typeMatch && !actionMatch) return false;
            }
            return true;
        });

        if (sortBy === 'severity') {
            result.sort((a, b) => {
                const weightA = getSeverityWeight(a.severity);
                const weightB = getSeverityWeight(b.severity);
                if (weightB !== weightA) return weightB - weightA;
                return (a.city || '').localeCompare(b.city || '');
            });
        } else if (sortBy === 'latest') {
            result.sort((a, b) => {
                const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return dateB - dateA;
            });
        }

        return result;
    }, [ratedAlerts, filter, sortBy, searchQuery]);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-gray-900 dark:text-gray-100 flex flex-col font-sans transition-colors duration-200">
            {/* Top Navigation Header (matches existing Dashboard/Forecast) */}
            <TopHeader showCredits onSearch={() => {}} searchLoading={false} selectedCity="All India" alertCount={sampleOnly ? null : highCount} />

            <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full space-y-6">

                {/* 1. HEADER (CLEAN & MINIMAL, NO OVERDESIGN) */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 rounded-lg bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-100 dark:border-red-900/40">
                            <Radio size={22} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                                Weather Alerts
                            </h1>
                            <p data-testid="alerts-subtitle" className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                Rule-based indicators from current weather (not the ML model). ML forecasts:{' '}
                                <Link to="/nowcast" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">ML Nowcast →</Link>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 self-start sm:self-center">
                        <div className="flex items-center gap-2">
                            {live ? (
                                <span className="inline-flex flex-col items-end">
                                    <span data-testid="alerts-source-badge" data-source={weatherSource} className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                        {`Live Feed · ${sourceBadge(weatherSource, null, dataTime)}`}
                                    </span>
                                    {weatherSource === 'open-meteo' && <OpenMeteoCredit className="mt-0.5" />}
                                    {weatherSource === 'openweather' && <OpenWeatherCredit className="mt-0.5" />}
                                </span>
                            ) : (
                                <span className="inline-flex flex-col items-end">
                                <span data-testid="alerts-source-badge" data-source={weatherSource || ''} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                    {error ? 'Server unavailable' : weatherSource ? sourceBadge(weatherSource, null, dataTime, summary, alerts) : 'Loading…'}
                                </span>
                                {mixed && !error && mixedCounts(summary, alerts).openMeteo > 0 && <OpenMeteoCredit className="mt-0.5" />}
                                {mixed && !error && mixedCounts(summary, alerts).openWeather > 0 && <OpenWeatherCredit className="mt-0.5" />}
                                </span>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline whitespace-nowrap">
                                {fetchedLabel(lastSyncTime)}
                            </span>
                        </div>

                        <button
                            onClick={() => fetchAlerts(false)}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-200 font-medium text-xs rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95 transition-all duration-150"
                            title="Refresh alerts"
                        >
                            <RefreshCw size={13} className={loading ? "animate-spin text-blue-600" : "text-gray-500"} />
                            <span>Refresh</span>
                        </button>

                        <Link
                            to="/"
                            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm hover:scale-105 active:scale-95 transition-all duration-150"
                        >
                            <ArrowLeft size={13} />
                            <span>Dashboard</span>
                        </Link>
                    </div>
                </div>

                {sampleOnly && (
                    <div className="space-y-2">
                        <SampleSafetyNotice />
                        <p data-testid="alerts-sample-zones" className="text-xs text-gray-500 dark:text-gray-400 px-1">{totalCount} zones loaded (sample data).</p>
                    </div>
                )}

                {/* 2. TOP SUMMARY CARDS (FLAT WHITE CARDS, NO GRADIENTS) */}
                {!sampleOnly && <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Zones monitored */}
                    <div data-testid="alerts-card-total" className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm flex items-center justify-between transition-all duration-200 hover:shadow-md">
                        <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Zones monitored
                            </span>
                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                                {totalCount}
                            </div>
                            <span data-testid="alerts-total-caption" className={`text-xs ${mixed ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                {mixed ? unratedNote(nUnrated) : 'rule-based indicators from current weather'}
                            </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                            <AlertCircle size={20} />
                        </div>
                    </div>

                    {/* High Risk */}
                    <div className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm flex items-center justify-between transition-all duration-200 hover:shadow-md">
                        <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                High Risk
                            </span>
                            <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-0.5">
                                {highCount}
                            </div>
                            <span className="text-xs text-red-600 dark:text-red-400">
                                Rule-based HIGH zones
                            </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
                            <Flame size={20} />
                        </div>
                    </div>

                    {/* Moderate */}
                    <div data-testid="alerts-card-moderate" className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm flex items-center justify-between transition-all duration-200 hover:shadow-md">
                        <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Moderate
                            </span>
                            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                                {modCount}
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                Moderate on rule-based indicators
                            </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                            <AlertTriangle size={20} />
                        </div>
                    </div>

                    {/* Low */}
                    <div data-testid="alerts-card-low" className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm flex items-center justify-between transition-all duration-200 hover:shadow-md">
                        <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Low
                            </span>
                            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                {lowCount}
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                No rule fired
                            </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck size={20} />
                        </div>
                    </div>
                </div>

                {/* 3. FILTER BAR (CLEAN, ONE-ROW ALIGNMENT WITH HOVER & ACTIVE FEEDBACK) */}
                <div className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 rounded-lg p-3 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                    {/* Tabs: All / High / Moderate / Low */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                        <button
                            onClick={() => setFilter('ALL')}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap hover:scale-105 active:scale-95 transition-all duration-150 ${
                                filter === 'ALL'
                                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400'
                            }`}
                        >
                            All ({ratedCount})
                        </button>
                        <button
                            onClick={() => setFilter('HIGH')}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap hover:scale-105 active:scale-95 transition-all duration-150 ${
                                filter === 'HIGH'
                                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400'
                            }`}
                        >
                            High ({highCount})
                        </button>
                        <button
                            onClick={() => setFilter('MODERATE')}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap hover:scale-105 active:scale-95 transition-all duration-150 ${
                                filter === 'MODERATE'
                                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400'
                            }`}
                        >
                            Moderate ({modCount})
                        </button>
                        <button
                            onClick={() => setFilter('LOW')}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap hover:scale-105 active:scale-95 transition-all duration-150 ${
                                filter === 'LOW'
                                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400'
                            }`}
                        >
                            Low ({lowCount})
                        </button>
                    </div>

                    {/* Right side: Search bar & Sort dropdown */}
                    <div className="flex items-center gap-2 flex-1 md:flex-initial justify-end">
                        {/* Search bar */}
                        <div className="relative flex-1 sm:w-56">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search city..."
                                className="w-full pl-8 pr-6 py-1.5 text-xs bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg outline-none text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-blue-500 focus:bg-white transition-colors duration-150"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {/* Sort dropdown */}
                        <div className="relative">
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="appearance-none bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 text-xs font-medium px-3 py-1.5 pr-7 rounded-lg border border-gray-200 dark:border-slate-700 outline-none cursor-pointer focus:border-blue-500 hover:border-gray-300 transition-colors duration-150"
                            >
                                <option value="severity">Sort by: Severity</option>
                                <option value="latest">Sort by: Latest</option>
                            </select>
                            <SlidersHorizontal size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
                        </div>
                    </div>
                </div>

                </>}

                {/* Error Banner */}
                {error && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-xs flex items-center justify-between">
                        <span data-testid="alerts-error">{error}</span>
                        <button
                            onClick={() => fetchAlerts(false)}
                            className="px-2 py-0.5 bg-red-600 text-white rounded text-xs font-medium cursor-pointer hover:bg-red-700 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Empty State */}
                {!loading && !error && !sampleOnly && filteredAndSortedAlerts.length === 0 && (
                    <div className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 rounded-lg p-10 text-center my-6 shadow-sm flex flex-col items-center justify-center">
                        <ShieldCheck size={28} className="text-emerald-500 mb-2" />
                        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                            No active alerts found
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-sm">
                            {filter !== 'ALL' || searchQuery
                                ? "No alerts match your current filter and search query."
                                : "No alerts in this data."}
                        </p>
                        {(filter !== 'ALL' || searchQuery) && (
                            <button
                                onClick={() => { setFilter('ALL'); setSearchQuery(''); }}
                                className="mt-3 px-3 py-1 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 rounded-md text-xs font-medium cursor-pointer transition-colors"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                )}

                {/* 4. ALERT CARDS GRID (3 COLS DESKTOP, 1 COL MOBILE, GAP-5) */}
                {!sampleOnly && filteredAndSortedAlerts.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {filteredAndSortedAlerts.map((alert, idx) => {
                            const norm = normalizeSeverity(alert.severity);
                            const shortMessage = resolveShortMessage(alert);
                            const cleanAction = resolveCleanAction(alert);
                            const timeAgo = getTimeAgo(alert.timestamp, lastSyncTime);
                            const stateName = alert.state || CITY_STATE_MAP[alert.city] || "Andhra Pradesh";
                            const cardKey = `${alert.city}-${alert.type || 'alert'}-${idx}`;
                            const isExpanded = expandedIds.has(cardKey);

                            return (
                                /* 1. CARD HOVER EFFECT: hover:shadow-md, hover:-translate-y-1, hover:border-blue-300 */
                                <div
                                    key={cardKey}
                                    className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 rounded-lg p-4 sm:p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 flex flex-col justify-between"
                                >
                                    <div>
                                        {/* Top Row: City Name + Location below (left) & Severity badge (right) */}
                                        <div className="flex items-start justify-between gap-2 mb-2.5">
                                            <div>
                                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white leading-snug">
                                                    {alert.city}
                                                </h3>
                                                <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                                                    <MapPin size={11} className="text-blue-500 shrink-0" />
                                                    <span>{stateName}</span>
                                                </span>
                                            </div>

                                            {/* Severity badge on right (HIGH / MODERATE / LOW) */}
                                            <span className={`px-2.5 py-0.5 text-xs font-bold rounded uppercase shrink-0 ${
                                                norm === 'HIGH' ? 'bg-red-600 text-white' :
                                                norm === 'MODERATE' ? 'bg-amber-500 text-white' :
                                                'bg-emerald-600 text-white'
                                            }`}>
                                                {norm}
                                            </span>
                                        </div>

                                        {/* Middle: Short message (max 1–2 lines) */}
                                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3">
                                            {shortMessage}
                                        </p>

                                        {/* 6. Action Section: Light red background with subtle hover glow on HIGH alerts */}
                                        {norm === 'HIGH' ? (
                                            <div className="bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900/50 rounded-md px-3 py-2 text-xs font-medium mb-3 transition-colors duration-200">
                                                <span className="font-bold mr-1">Action:</span>
                                                <span>{cleanAction}</span>
                                            </div>
                                        ) : (
                                            <div className="bg-gray-50 hover:bg-gray-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-slate-700/60 rounded-md px-3 py-2 text-xs font-medium mb-3 transition-colors duration-200">
                                                <span className="font-bold mr-1">Action:</span>
                                                <span>{cleanAction}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Bottom Row */}
                                    <div>
                                        <div className="flex items-center justify-between pt-2.5 border-t border-gray-100 dark:border-slate-800 text-xs">
                                            {/* 5. Left: "Live • Just now" with pulsing green dot */}
                                            <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium">
                                                <div className={`w-2 h-2 rounded-full shrink-0 ${isLiveSource(alert.source) ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></div>
                                                <span data-testid="alert-card-source">{isLiveSource(alert.source) ? `Live • ${timeAgo}` : sourceBadge('sample')}</span>
                                            </span>

                                            {/* 2. Right: "View Details →" (blue link style with hover underline + color shift) */}
                                            <button
                                                type="button"
                                                onClick={() => toggleExpanded(cardKey)}
                                                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline cursor-pointer flex items-center gap-1 transition-colors duration-150"
                                            >
                                                <span>{isExpanded ? 'Hide Details' : 'View Details →'}</span>
                                            </button>
                                        </div>

                                        {/* Collapsible Details */}
                                        {isExpanded && (
                                            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800 text-xs text-gray-600 dark:text-gray-400 space-y-1.5 animate-fadeIn">
                                                <div className="flex justify-between">
                                                    <span className="font-medium text-gray-700 dark:text-gray-300">Hazard:</span>
                                                    <span data-testid="alert-card-hazard">{primaryThreat(alert) === 'flood' ? 'Flash Flood (rain rule)' : 'None named (rule-based level)'}</span>
                                                </div>
                                                {alert.message && alert.message !== shortMessage && (
                                                    <div>
                                                        <span className="font-medium text-gray-700 dark:text-gray-300 block">Notice:</span>
                                                        <p className="text-[11px] text-gray-500 mt-0.5">{alert.message}</p>
                                                    </div>
                                                )}

                                                {alert.timestamp && (
                                                    <div className="text-[10px] text-gray-400 pt-1">
                                                        {fetchedLabel(lastSyncTime)}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
};

export default Alerts;
