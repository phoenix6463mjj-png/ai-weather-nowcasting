import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { API_BASE } from '../config';
import { fetchWithWake, WAKE_UNAVAILABLE } from '../utils/serverWake';
import { isLiveSource, sourceBadge, sourceShort } from '../utils/dashboardRisk';
import OpenMeteoCredit from '../components/OpenMeteoCredit';
import HonestyBanner from '../components/HonestyBanner';
import {
    CloudRain,
    ArrowLeft,
    Sparkles,
    AlertTriangle,
    ShieldCheck,
    Thermometer,
    Droplets,
    Wind,
    Activity,
    MapPin,
    ShieldAlert,
    Info,
    Search,
    Loader2
} from 'lucide-react';
import TopHeader from '../components/TopHeader';

// Safe fallback state in case backend network is down
const DEFAULT_WEATHER = {
    city: "Mumbai",
    location: "Mumbai",
    state: "Maharashtra",
    risk_level: "MODERATE",
    temperature: 28.5,
    humidity: 78,
    rainfall: 12.4,
    wind_speed: 6.2,
    lat: 19.0760,
    lon: 72.8777,
    reason: "Moderate rainfall expected due to coastal moisture build-up"
};

const LEVEL_WORD = { LOW: "Low", MODERATE: "Moderate", HIGH: "High" };

const Forecast = () => {
    const [searchParams] = useSearchParams();
    const cityParam = searchParams.get('city');

    // Weather Data & Cities State
    const [currentData, setCurrentData] = useState(DEFAULT_WEATHER);
    const [citiesList, setCitiesList] = useState([]);
    const [loading, setLoading] = useState(false);
    const [backendStatus, setBackendStatus] = useState('pending');

    // STEP 1: ADD NEW STATE (Real-time nowcasting from /nowcast API)
    const [isRealtime, setIsRealtime] = useState(false);
    const [realtimeData, setRealtimeData] = useState(null);
    const [isSearching, setIsSearching] = useState(false);

    // STEP 3: DATA SOURCE SWITCH
    const activeData = isRealtime && realtimeData ? realtimeData : currentData;
    // weather source of what is shown: /nowcast says "realtime_api" | "fallback_mock", the zone list
    // "openweather" | "sample". "Real-Time" wording only when it really is OpenWeather.
    const rawSource = isRealtime && realtimeData ? realtimeData.source : (currentData?.source || currentData?.weather?.source);
    const weatherSource = rawSource === 'openweather' || rawSource === 'realtime_api' ? 'openweather'
        : rawSource === 'open-meteo' ? 'open-meteo' : 'sample';
    const liveWeather = isLiveSource(weatherSource);
    const sourceText = sourceBadge(weatherSource, isRealtime ? null : currentData?.weather?.observed_at,
        isRealtime ? realtimeData?.data_time : currentData?.weather?.data_time);

    // 1. Search input state, dropdown suggestions & smart fallback message
    const [search, setSearch] = useState("");
    const [filteredNodes, setFilteredNodes] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [fallbackMessage, setFallbackMessage] = useState("");
    const searchContainerRef = useRef(null);

    // 5. On select node handler
    const handleSelectNode = useCallback((nodeName) => {
        if (!nodeName || !citiesList.length) return;
        setIsRealtime(false);
        setRealtimeData(null);
        const matchingNode = citiesList.find(c =>
            (c.location && c.location.toLowerCase() === nodeName.toLowerCase()) ||
            (c.city && c.city.toLowerCase() === nodeName.toLowerCase()) ||
            (c.name && c.name.toLowerCase() === nodeName.toLowerCase())
        );

        if (matchingNode) {
            const locName = matchingNode.location || matchingNode.city || matchingNode.name;
            setCurrentData(matchingNode);
            setFallbackMessage("");
            try {
                localStorage.setItem("selectedCity", locName);
                localStorage.setItem("selected_city", locName);
            } catch (e) {
                // Ignore storage errors
            }
            setSearch(locName);
            setShowDropdown(false);
        }
    }, [citiesList]);

    // Backward-compatible select handler
    const handleCitySelect = useCallback((cityItem) => {
        if (!cityItem) return;
        setIsRealtime(false);
        setRealtimeData(null);
        const locName = cityItem.location || cityItem.city || cityItem.name;
        setCurrentData(cityItem);
        setFallbackMessage("");
        setSearch(locName);
        try {
            localStorage.setItem('selectedCity', locName);
            localStorage.setItem('selected_city', locName);
        } catch (e) {
            // Ignore storage errors
        }
    }, []);

    // 2. Fetch from backend: {API_BASE}/batch_predict?limit=100
    useEffect(() => {
        let isMounted = true;
        const fetchBackendData = async () => {
            try {
                setLoading(true);
                const res = await fetchWithWake(`${API_BASE}/batch_predict?limit=100`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!Array.isArray(data) || data.length === 0) throw new Error('no data');

                if (isMounted && Array.isArray(data) && data.length > 0) {
                    const enrichedCities = data.map((item) => ({
                        ...item,
                        location: item.location || item.city || item.name
                    }));

                    setCitiesList(enrichedCities);
                    setBackendStatus('ok');

                    // Active City Logic: Use same selected city as Dashboard or URL
                    const savedCity = cityParam || localStorage.getItem('selectedCity') || localStorage.getItem('selected_city');
                    if (savedCity) {
                        const match = enrichedCities.find(c =>
                            c.city?.toLowerCase() === savedCity.toLowerCase() ||
                            c.location?.toLowerCase() === savedCity.toLowerCase() ||
                            c.fullName?.toLowerCase() === savedCity.toLowerCase()
                        );
                        if (match) {
                            setCurrentData(match);
                            setSearch(match.location || match.city);
                            return;
                        }
                    }

                    // Default to first city if no city selected
                    const defaultCity = enrichedCities[0];
                    setCurrentData(defaultCity);
                    setSearch(defaultCity.location || defaultCity.city);
                }
            } catch (err) {
                console.warn("Forecast backend not reachable:", err);
                if (isMounted) setBackendStatus('down');
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchBackendData();
        return () => { isMounted = false; };
    }, [cityParam]);

    // 2. Nodes list: nodes = data.map(n => n.location || n.city || n.name)
    const nodes = useMemo(() => {
        return citiesList.map(n => n.location || n.city || n.name || "").filter(Boolean);
    }, [citiesList]);

    // 3. Filtering logic (case-insensitive substring filter, max 5)
    useEffect(() => {
        if (!search || !search.trim()) {
            setFilteredNodes([]);
            return;
        }

        const results = nodes.filter(n =>
            n.toLowerCase().includes(search.toLowerCase())
        );

        setFilteredNodes(results.slice(0, 5));
    }, [search, nodes]);

    // Close search dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 2. MODIFY SEARCH HANDLER (Real-Time /nowcast -> Exact match -> Smart fallback -> UI Message)
    const handleSearchSubmit = useCallback(async (query) => {
        const text = (typeof query === 'string' ? query : search)?.trim();
        if (!text) return;

        setIsSearching(true);
        setFallbackMessage("");

        // STEP 2: Call real-time /nowcast API
        try {
            const res = await fetchWithWake(`${API_BASE}/nowcast?city=${encodeURIComponent(text)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && !data.error && data.city) {
                    setRealtimeData(data);
                    setIsRealtime(true);
                    setFallbackMessage("");
                    setShowDropdown(false);
                    setSearch(data.city);
                    setIsSearching(false);
                    return;
                }
            }
        } catch (err) {
            console.warn("Real-time /nowcast fetch failed, falling back to node search:", err);
        }

        // STEP 2.3: If error or not found on /nowcast, fallback to existing node search (DO NOT REMOVE OLD LOGIC)
        setIsRealtime(false);
        setRealtimeData(null);

        // STEP 1: Try exact match
        const exactNode = citiesList.find(n =>
            (n.location || n.city || n.name || "")
            .toLowerCase() === text.toLowerCase()
        );

        if (exactNode) {
            const locName = exactNode.location || exactNode.city || exactNode.name;
            setCurrentData(exactNode);
            setFallbackMessage("");
            setSearch(locName);
            setShowDropdown(false);
            setIsSearching(false);
            try {
                localStorage.setItem("selectedCity", locName);
                localStorage.setItem("selected_city", locName);
            } catch (e) {}
            return;
        }

        // STEP 2: If NOT found → use SMART fallback
        const searchSub = text.toLowerCase().slice(0, 4);
        let fallbackNode = citiesList.find(n =>
            (n.location || n.city || n.name || "")
            .toLowerCase().includes(searchSub)
        );

        // Smart regional heuristics for coastal / satellite areas (e.g. Digha in West Bengal -> Kolkata)
        if (!fallbackNode) {
            const lowerSearch = text.toLowerCase();
            if (lowerSearch.includes("digha") || lowerSearch.includes("bengal") || lowerSearch.includes("howrah") || lowerSearch.includes("haldia")) {
                fallbackNode = citiesList.find(n => (n.state || "").toLowerCase().includes("bengal") || (n.city || "").toLowerCase() === "kolkata");
            } else if (lowerSearch.includes("noida") || lowerSearch.includes("gurgaon") || lowerSearch.includes("delhi") || lowerSearch.includes("faridabad")) {
                fallbackNode = citiesList.find(n => (n.city || "").toLowerCase().includes("delhi"));
            } else if (lowerSearch.includes("thane") || lowerSearch.includes("kalyan") || lowerSearch.includes("navi mumbai") || lowerSearch.includes("pune")) {
                fallbackNode = citiesList.find(n => (n.city || "").toLowerCase().includes("mumbai") || (n.city || "").toLowerCase() === "pune");
            }
        }

        // State name matching
        if (!fallbackNode) {
            fallbackNode = citiesList.find(n =>
                n.state && (text.toLowerCase().includes(n.state.toLowerCase()) || n.state.toLowerCase().includes(text.toLowerCase()))
            );
        }

        // Safe fallback node if still not matched
        if (!fallbackNode && citiesList.length > 0) {
            fallbackNode = citiesList[0];
        }

        if (fallbackNode) {
            const locName = fallbackNode.location || fallbackNode.city || fallbackNode.name;
            setCurrentData(fallbackNode);
            setFallbackMessage(
                "⚠ Exact location not found. Showing nearest available node: " + locName
            );
            setShowDropdown(false);
            setIsSearching(false);
            try {
                localStorage.setItem("selectedCity", locName);
                localStorage.setItem("selected_city", locName);
            } catch (e) {}
            return;
        }

        // STEP 3: If nothing matches:
        setFallbackMessage("No data available for this location.");
        setShowDropdown(false);
        setIsSearching(false);
    }, [search, citiesList]);

    // Current values only (the page has no hourly forecast)
    const activeNowcast = useMemo(() => {
        const src = isRealtime && realtimeData ? realtimeData : activeData;
        return {
            rainfall: Number(Number(src?.rainfall ?? src?.weather?.rainfall ?? 0).toFixed(1)),
            humidity: Math.round(Number(src?.humidity ?? src?.weather?.humidity ?? 70)),
            wind_speed: Number(Number(src?.wind_speed ?? src?.weather?.wind_speed ?? 2).toFixed(1)),
            temperature: Number(Number(src?.temperature ?? src?.weather?.temperature ?? 28).toFixed(1)),
            risk: (src?.risk_level || src?.risk || "LOW").toUpperCase()
        };
    }, [isRealtime, realtimeData, activeData]);

    // Risk styling helper
    const getRiskBadge = (risk) => {
        const r = (risk || "LOW").toUpperCase();
        if (r === "HIGH") {
            return {
                label: "HIGH RISK",
                color: "red",
                badgeClass: "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800",
                bgClass: "bg-red-500",
                textClass: "text-red-600 dark:text-red-400",
                borderClass: "border-red-500"
            };
        }
        if (r === "MODERATE") {
            return {
                label: "MODERATE RISK",
                color: "yellow",
                badgeClass: "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800",
                bgClass: "bg-amber-400",
                textClass: "text-amber-600 dark:text-amber-400",
                borderClass: "border-amber-400"
            };
        }
        return {
            label: "LOW RISK",
            color: "green",
            badgeClass: "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800",
            bgClass: "bg-emerald-500",
            textClass: "text-emerald-600 dark:text-emerald-400",
            borderClass: "border-emerald-500"
        };
    };

    const currentRiskInfo = getRiskBadge(activeNowcast.risk);

    // Rule-based summary of the current values; the subtext names the weather source (backend `source`)
    const aiInsightData = useMemo(() => {
        const evaluated = `Evaluated for ${activeData?.city || "active node"} with fixed rules (${sourceShort(weatherSource)}).`;
        const rain = activeNowcast.rainfall;
        const hum = activeNowcast.humidity;
        const wind = activeNowcast.wind_speed;

        if (isRealtime && realtimeData) {
            const risk = (realtimeData.risk_level || "LOW").toUpperCase();
            return {
                text: realtimeData.alert?.action || (risk === "HIGH" ? "Flood risk rising due to intense rainfall" : risk === "MODERATE" ? "Moderate rainfall and moisture persistence" : "Normal atmospheric conditions across nowcast window"),
                severity: risk,
                subtext: `Telemetry: ${realtimeData.rainfall} mm/h rain, ${realtimeData.wind_speed} m/s wind, ${realtimeData.humidity}% humidity. Source: ${sourceBadge(realtimeData.source === 'realtime_api' ? 'openweather' : realtimeData.source === 'open-meteo' ? 'open-meteo' : 'sample', null, realtimeData.data_time)}.`,
                color: risk === "HIGH" ? "rose" : risk === "MODERATE" ? "amber" : "emerald"
            };
        }

        if (rain >= 20) {
            return {
                text: "Flood risk rising due to intense rainfall",
                severity: "HIGH",
                subtext: evaluated,
                color: "rose"
            };
        }
        if (hum >= 90 && wind >= 9) {
            return {
                text: "Severe thunderstorm conditions forming",
                severity: "HIGH",
                subtext: evaluated,
                color: "rose"
            };
        }
        if (activeData?.reason && typeof activeData.reason === 'string' && activeData.reason.trim()) {
            return {
                text: activeData.reason,
                severity: activeNowcast.risk,
                subtext: evaluated,
                color: activeNowcast.risk === "HIGH" ? "rose" : activeNowcast.risk === "MODERATE" ? "amber" : "emerald"
            };
        }
        if (rain >= 10 || hum >= 80) {
            return {
                text: "Moderate rainfall and moisture persistence",
                severity: "MODERATE",
                subtext: evaluated,
                color: "amber"
            };
        }
        return {
            text: "Normal atmospheric conditions across nowcast window",
            severity: "LOW",
            subtext: evaluated,
            color: "emerald"
        };
    }, [isRealtime, realtimeData, activeNowcast, activeData?.reason, activeData?.city, weatherSource]);

    // The rule(s) that put the shown location at its level now (backend `rules_fired`, zone data only)
    const firedRules = useMemo(() => {
        if (activeNowcast.risk === "LOW") return "No rule fired (rule-based)";
        const rules = !isRealtime && Array.isArray(activeData?.rules_fired) ? activeData.rules_fired.filter(Boolean) : [];
        return rules.length ? `${rules.join('; ')} (rule-based)` : "Rule-based level; the rule that fired was not reported";
    }, [activeNowcast.risk, isRealtime, activeData]);

    const activeNodeName = activeData?.location || activeData?.city || activeData?.name || "Active Node";

    if (backendStatus !== 'ok' && !isRealtime) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
                <TopHeader showCredits onSearch={handleSearchSubmit} searchLoading={loading} selectedCity="" />
                <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full space-y-6">
                    <HonestyBanner kind="rule-score" />
                    <div data-testid="forecast-status" data-status={backendStatus}
                        className={`p-6 rounded-2xl border text-center font-bold ${backendStatus === 'down'
                            ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'}`}>
                        {backendStatus === 'down' ? WAKE_UNAVAILABLE : 'Loading forecast…'}
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
            {/* Inline Style for Chart Drawing Animation */}
            <style>{`
                @keyframes drawPath {
                    0% { stroke-dashoffset: 800; }
                    100% { stroke-dashoffset: 0; }
                }
                .animate-line-draw {
                    stroke-dasharray: 800;
                    stroke-dashoffset: 0;
                    animation: drawPath 1.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
            `}</style>

            {/* TopHeader - Linked with active city & internal backend node search */}
            <TopHeader
                showCredits
                onSearch={handleSearchSubmit}
                searchLoading={loading}
                selectedCity={activeNodeName}
            />

            <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full space-y-6">
                <HonestyBanner kind="rule-score" />
                {/* Heading Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl shadow-sm transition-all duration-300 hover:scale-105 hover:shadow-blue-500/20">
                            <CloudRain size={28} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-black tracking-tight">
                                    Nowcasting Engine (current conditions)
                                </h1>
                                {activeData?.city && (
                                    <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                        {activeData.city}, {activeData.state || "IN"}
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Current weather and a rule-based risk level
                            </p>
                            <p data-testid="forecast-source-badge" data-source={weatherSource} className="text-xs font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                                {sourceText}
                            </p>
                            {weatherSource === 'open-meteo' && <OpenMeteoCredit />}
                        </div>
                    </div>
                    <Link
                        to="/"
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-all duration-300 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] shrink-0 self-start sm:self-auto"
                    >
                        <ArrowLeft size={16} />
                        <span>Back to Dashboard</span>
                    </Link>
                </div>

                {/* 4. SAFE SEARCH INPUT UI (Uses Real-Time /nowcast with Node Fallback) */}
                <div
                    ref={searchContainerRef}
                    className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 md:p-5 shadow-sm transition-all duration-300 hover:shadow-md"
                >
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <div className="relative flex-1">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                                <Search size={18} />
                            </div>
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setShowDropdown(true);
                                }}
                                onFocus={() => setShowDropdown(true)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (filteredNodes.length > 0) {
                                            handleSelectNode(filteredNodes[0]);
                                        } else {
                                            handleSearchSubmit();
                                        }
                                    }
                                }}
                                placeholder="Search any city or location... (e.g. Mumbai, Delhi, Digha, Kolkata, Pune)"
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 transition-all"
                            />

                            {/* Dropdown Suggestions (Max 5 matching nodes) */}
                            {showDropdown && filteredNodes.length > 0 && (
                                <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                                    <div className="p-2 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                                        Available Network Nodes (Top {filteredNodes.length})
                                    </div>
                                    {filteredNodes.map((nodeName, idx) => {
                                        const nodeObj = citiesList.find(c => (c.location || c.city || c.name) === nodeName);
                                        return (
                                            <button
                                                key={idx}
                                                type="button"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    handleSelectNode(nodeName);
                                                }}
                                                className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors border-b border-slate-100 dark:border-slate-800/50 last:border-none cursor-pointer"
                                            >
                                                <span className="flex items-center gap-2">
                                                    <MapPin size={13} className="text-blue-500" />
                                                    <span>{nodeName}</span>
                                                    {nodeObj?.state && (
                                                        <span className="text-[11px] text-slate-400 font-normal">
                                                            ({nodeObj.state})
                                                        </span>
                                                    )}
                                                </span>
                                                {nodeObj?.risk_level && (
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                                        nodeObj.risk_level === "HIGH" ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400" :
                                                        nodeObj.risk_level === "MODERATE" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400" :
                                                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                                    }`}>
                                                        {nodeObj.risk_level}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Button: "Find" */}
                        <button
                            type="button"
                            onClick={() => {
                                if (filteredNodes.length > 0) {
                                    handleSelectNode(filteredNodes[0]);
                                } else {
                                    handleSearchSubmit();
                                }
                            }}
                            disabled={!search.trim() || isSearching}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer shrink-0"
                        >
                            {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                            <span>{isSearching ? "Searching..." : "Find"}</span>
                        </button>
                    </div>

                    {/* 4. ADD UI MESSAGE BELOW SEARCH INPUT */}
                    {fallbackMessage && (
                        <div style={{
                            marginTop: "6px",
                            color: "#b45309",
                            fontSize: "13px"
                        }}>
                            {fallbackMessage}
                        </div>
                    )}

                    {/* 7. UI Display: Show "Selected Node: <node.location>" or Real-Time Location */}
                    <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-3 py-1 rounded-lg font-bold border flex items-center gap-1.5 shadow-sm ${
                                isRealtime
                                    ? "bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                                    : "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${isRealtime ? "bg-purple-500 animate-ping" : "bg-blue-500 animate-pulse"}`} />
                                <span>{isRealtime ? (liveWeather ? "Real-Time Location:" : "Searched Location:") : "Selected Node:"}</span>
                                <strong className="text-slate-900 dark:text-white font-black">{activeNodeName}</strong>
                            </span>
                            {activeData?.state && (
                                <span className="text-slate-500 dark:text-slate-400 font-medium">
                                    ({activeData.state})
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            {isRealtime && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsRealtime(false);
                                        setRealtimeData(null);
                                        setFallbackMessage("");
                                    }}
                                    className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                                >
                                    <ArrowLeft size={12} />
                                    <span>Back to Monitoring Nodes</span>
                                </button>
                            )}
                            <div className="text-slate-400 text-[11px] font-medium">
                                {citiesList.length > 0 ? `${citiesList.length} Network Nodes Available` : "Loading nodes..."}
                            </div>
                        </div>
                    </div>
                </div>

                {/* STEP 5: ADD LABEL (IMPORTANT UX) & STEP 6: RESET BUTTON */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-300">
                    <div className="flex items-center gap-3">
                        <span className={`text-xs font-black px-3 py-1.5 rounded-xl border flex items-center gap-2 ${
                            isRealtime
                                ? "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800 shadow-sm"
                                : "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800 shadow-sm"
                        }`}>
                            {isRealtime ? (liveWeather ? "📡 Real-Time Location Data" : "📍 Searched Location Data") : "📊 Monitoring Node Data"}
                        </span>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Active Stream: <strong data-testid="forecast-stream" className="text-slate-900 dark:text-white font-bold">{sourceText}</strong>
                        </span>
                    </div>

                    {isRealtime && (
                        <button
                            type="button"
                            onClick={() => {
                                setIsRealtime(false);
                                setRealtimeData(null);
                                setFallbackMessage("");
                            }}
                            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer hover:scale-105"
                        >
                            <ArrowLeft size={13} />
                            <span>Back to Monitoring Nodes</span>
                        </button>
                    )}
                </div>

                {/* Quick City Switcher Pills (Synced with Dashboard) */}
                {citiesList.length > 0 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
                        <span className="font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 shrink-0">
                            <MapPin size={13} /> Active Nodes:
                        </span>
                        {citiesList.slice(0, 10).map((c, i) => {
                            const nodeName = c.location || c.city || c.name;
                            const isSelected = !isRealtime && (currentData?.location || currentData?.city) === nodeName;
                            return (
                                <button
                                    key={i}
                                    onClick={() => handleCitySelect(c)}
                                    className={`px-2.5 py-1 rounded-lg font-semibold transition-all duration-300 shrink-0 hover:scale-105 ${
                                        isSelected
                                            ? "bg-blue-600 text-white shadow-sm"
                                            : "bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-blue-400"
                                    }`}
                                >
                                    {nodeName}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* NOWCASTING ENGINE & LIVE NOWCAST PANEL */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 md:p-8 shadow-sm transition-all duration-300 hover:shadow-xl hover:scale-[1.005]">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold">Nowcasting Engine</h2>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                Now
                            </span>
                        </div>
                        {backendStatus === 'ok' && (
                            <span data-testid="forecast-backend-sync" className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <Activity size={12} className="text-blue-500" /> Backend Synchronized
                            </span>
                        )}
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">
                        {liveWeather ? `Current values from ${sourceText}; risk level by fixed rules (not the ML model).`
                            : 'Current sample weather values; risk level by fixed rules (not the ML model).'}
                    </p>

                    <div className="grid grid-cols-1 gap-5">
                        {/* LIVE NOWCAST PANEL with Timeline Slider */}
                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col justify-between transition-all duration-300 hover:border-blue-400 dark:hover:border-blue-500/50 hover:shadow-md">
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <h3 className="font-bold text-sm">{liveWeather ? 'Live Nowcast Panel' : 'Nowcast Panel (sample data)'}</h3>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${currentRiskInfo.badgeClass}`}>
                                        {currentRiskInfo.label}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {isRealtime ? (
                                        <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                                            <Info size={13} /> {liveWeather ? 'Live Nowcast' : 'Nowcast'} (No historical projection available)
                                        </span>
                                    ) : (
                                        <>Readout for: <strong>Now (current)</strong></>
                                    )}
                                </p>
                            </div>

                            {/* Timeline Slider Section */}
                            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/60">
                                {isRealtime && (
                                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs">
                                        <div className="font-bold flex items-center gap-1.5">
                                            <Info size={14} className="shrink-0" />
                                            <span>{liveWeather ? 'Live Nowcast' : 'Nowcast'} (No historical projection available)</span>
                                        </div>
                                        <p className="text-[11px] opacity-90 mt-1">
                                            Current values for {activeNodeName} from {sourceText}.
                                        </p>
                                    </div>
                                )}

                                {/* LIVE NOWCAST METRICS (Dynamic from forecast[selectedHour]) */}
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                    <div className="bg-white dark:bg-slate-900/90 p-2 rounded-lg border border-slate-200/80 dark:border-slate-700/60 transition-all duration-300 hover:border-blue-300">
                                        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                                            <CloudRain size={12} className="text-blue-500" />
                                            <span>Rainfall</span>
                                        </div>
                                        <span className="font-bold text-blue-600 dark:text-blue-400 text-sm">
                                            {activeNowcast.rainfall} mm
                                        </span>
                                    </div>
                                    <div className="bg-white dark:bg-slate-900/90 p-2 rounded-lg border border-slate-200/80 dark:border-slate-700/60 transition-all duration-300 hover:border-blue-300">
                                        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                                            <Droplets size={12} className="text-teal-500" />
                                            <span>Humidity</span>
                                        </div>
                                        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                                            {activeNowcast.humidity}%
                                        </span>
                                    </div>
                                    <div className="bg-white dark:bg-slate-900/90 p-2 rounded-lg border border-slate-200/80 dark:border-slate-700/60 transition-all duration-300 hover:border-blue-300">
                                        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                                            <Wind size={12} className="text-sky-500" />
                                            <span>Wind Speed</span>
                                        </div>
                                        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                                            {activeNowcast.wind_speed} m/s
                                        </span>
                                    </div>
                                    <div className="bg-white dark:bg-slate-900/90 p-2 rounded-lg border border-slate-200/80 dark:border-slate-700/60 transition-all duration-300 hover:border-blue-300">
                                        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                                            <Thermometer size={12} className="text-amber-500" />
                                            <span>Temperature</span>
                                        </div>
                                        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                                            {activeNowcast.temperature}°C
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <p data-testid="forecast-hourly-note" className="text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-5 py-3.5 shadow-sm">
                    Hourly forecasts are not available on this page. Calibrated 1–6 h nowcasts:{' '}
                    <Link to="/nowcast" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">ML Nowcast →</Link>
                </p>

                {/* RULE-BASED SUMMARY & RISK INDICATOR BAR */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Rule-based summary */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm transition-all duration-300 hover:shadow-xl hover:scale-[1.01] flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="p-2 bg-gradient-to-tr from-purple-500 to-blue-500 text-white rounded-xl shadow-sm">
                                        <ShieldAlert size={18} />
                                    </div>
                                    <h2 data-testid="forecast-summary-title" className="text-base font-bold tracking-tight">Rule-based summary</h2>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${
                                        aiInsightData.severity === "HIGH"
                                            ? "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-800"
                                            : aiInsightData.severity === "MODERATE"
                                                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800"
                                                : "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800"
                                    }`}>
                                        {aiInsightData.severity} SEVERITY
                                    </span>
                                </div>
                            </div>

                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                Rule-based reading of the current values (Now):
                            </p>

                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 transition-all duration-300 hover:border-purple-400/60">
                                <div className="flex items-start gap-3">
                                    <div className="p-1.5 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 mt-0.5">
                                        <Sparkles size={16} />
                                    </div>
                                    <div>
                                        <p className="text-base font-black text-slate-900 dark:text-white leading-snug">
                                            "{aiInsightData.text}"
                                        </p>
                                        <p data-testid="forecast-summary-source" className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                            {aiInsightData.subtext}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1">
                                <Droplets size={13} className="text-blue-500" /> Humidity: <strong>{activeNowcast.humidity}%</strong>
                            </span>
                            <span className="flex items-center gap-1">
                                <Wind size={13} className="text-teal-500" /> Wind: <strong>{activeNowcast.wind_speed} m/s</strong>
                            </span>
                            <span className="flex items-center gap-1">
                                <Thermometer size={13} className="text-amber-500" /> Temp: <strong>{activeNowcast.temperature}°C</strong>
                            </span>
                        </div>
                    </div>

                    {/* Risk Indicator Bar */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm transition-all duration-300 hover:shadow-xl hover:scale-[1.01] flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl">
                                        <AlertTriangle size={18} className="text-amber-500" />
                                    </div>
                                    <h2 className="text-base font-bold tracking-tight">Risk Indicator Bar</h2>
                                </div>
                                <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${currentRiskInfo.badgeClass}`}>
                                    {currentRiskInfo.label}
                                </span>
                            </div>

                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                Tri-tier rule-based level for Now: Green (Low) → Yellow (Moderate) → Red (High)
                            </p>

                            <div className="mt-2 space-y-2">
                                <div className="relative pt-3 pb-2">
                                    <div className="h-3 w-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-600 shadow-inner overflow-hidden relative">
                                        <div className="absolute inset-0 flex justify-between px-1 pointer-events-none opacity-25">
                                            <div className="w-0.5 h-full bg-white"></div>
                                            <div className="w-0.5 h-full bg-white"></div>
                                        </div>
                                    </div>

                                    {/* Animated Position Needle */}
                                    <div
                                        className="absolute top-1 -translate-x-1/2 transition-all duration-500 ease-out"
                                        style={{
                                            left: `${activeNowcast.risk === "HIGH" ? 90 : activeNowcast.risk === "MODERATE" ? 55 : 20}%`
                                        }}
                                    >
                                        <div className={`w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 shadow-md ${currentRiskInfo.bgClass} ring-4 transition-all duration-300`} />
                                    </div>
                                </div>

                                <div className="flex justify-between text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                                    <span className="text-emerald-600 dark:text-emerald-400">Green • Low</span>
                                    <span className="text-amber-600 dark:text-amber-400">Yellow • Moderate</span>
                                    <span className="text-rose-600 dark:text-rose-400">Red • High</span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-start justify-between gap-3 text-xs">
                            <span data-testid="forecast-fired-rules" className="min-w-0 text-slate-500 dark:text-slate-400">
                                {firedRules}
                            </span>
                            <span data-testid="forecast-risk-level" className="shrink-0 whitespace-nowrap font-bold text-slate-700 dark:text-slate-300">
                                Level: {LEVEL_WORD[activeNowcast.risk] || "Low"} (rule-based)
                            </span>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Forecast;
