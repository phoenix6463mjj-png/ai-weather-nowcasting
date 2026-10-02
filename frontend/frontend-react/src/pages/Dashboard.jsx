import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { API_BASE } from '../config';
import { fetchWithWake, isServerUnavailable, WAKE_UNAVAILABLE } from '../utils/serverWake';
import { askShownFirst, useFillPoll } from '../utils/weatherFill';
import { RISK_COLOURS, isLiveSource, isSampleSource, isUnratedZone, mixedCounts, sourceBadge } from '../utils/dashboardRisk';
import SampleSafetyNotice from '../components/SampleSafetyNotice';
import OpenMeteoCredit from '../components/OpenMeteoCredit';
import OpenWeatherCredit from '../components/OpenWeatherCredit';
import NominatimCredit from '../components/NominatimCredit';
import { geocode, SupersededError } from '../utils/nominatim';
import Sidebar from '../components/Sidebar';
import TopHeader from '../components/TopHeader';
import HeroBanner from '../components/HeroBanner';
import AlertBanner from '../components/AlertBanner';
import MapSection from '../components/MapSection';
import RightPanel from '../components/RightPanel';
import Timeline from '../components/Timeline';
import RiskDistribution from '../components/RiskDistribution';

const Dashboard = () => {
    // 1. Single Source of Truth States
    const [allCities, setAllCities] = useState([]);
    const [summary, setSummary] = useState({ total: 0, high: 0, moderate: 0, low: 0 });
    const [selectedCity, setSelectedCity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchLoading, setSearchLoading] = useState(false);
    const [error, setError] = useState(null);
    const [activeLayers, setActiveLayers] = useState({
        thunderstorm: true,
        cloudburst: true,
        flood: true
    });

    // weather source of the zone list ("sample" | "openweather" | "mixed") and its latest observation time
    const [source, setSource] = useState({ source: null, observedAt: null, dataTime: null });
    const [baseLayer, setBaseLayer] = useState('map');      // 'map' | 'satellite' | 'terrain'

    const isFetchingRef = useRef(false);
    // the header search on the other pages opens "/?city=<name>": run that search here once
    const [searchParams, setSearchParams] = useSearchParams();

    const loadAllData = async (silent = false) => {
        // Prevent overlapping/duplicate concurrent API calls
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        if (!silent) setLoading(true);
        setError(null);
        try {
            // Fetch ONLY from /alerts — SINGLE SOURCE OF TRUTH (380 ZONES)
            const response = await fetchWithWake(`${API_BASE}/alerts?limit=380`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const summaryData = data.summary || { total: 0, high: 0, moderate: 0, low: 0 };
            setSummary(summaryData);
            setSource({ source: summaryData.source || 'sample', observedAt: summaryData.latest_observed_at || null, dataTime: summaryData.data_time || null });

            const alertsData = data.alerts || (Array.isArray(data) ? data : []);
            const fetchedAt = new Date().toISOString();      // when this page fetched the zones ("Fetched HH:MM UTC")
            console.log("ALERTS API RESPONSE:", summaryData, "Total alerts:", alertsData.length);

            const formatted = alertsData.map((item, index) => ({
                id: index,
                city: item.city,
                fullName: item.city,
                state: item.state,
                lat: item.lat,
                lon: item.lon,
                // sample-data zones carry no risk level (grey marker, no risk in the panel)
                risk: isUnratedZone(item) ? null : (item.risk_level || item.risk || item.severity || "LOW").toUpperCase(),
                risk_level: isUnratedZone(item) ? null : (item.risk_level || item.risk || item.severity || "LOW").toUpperCase(),
                zone_source: item.zone_source || null,
                source: item.source || null,
                rules_fired: Array.isArray(item.rules_fired) ? item.rules_fired : null,   // names a hazard only via its rule
                weather: item.weather || {
                    temperature: item.temperature,
                    humidity: item.humidity,
                    rainfall: item.rainfall,
                    wind_speed: item.wind_speed,
                },
                probabilities: item.probabilities || null,
                prediction: item.prediction || null,
                reason: item.reason || item.prediction?.reason || null,
                timestamp: item.timestamp || null,
                fetched_at: fetchedAt
            }));

            console.log("Loaded cities:", formatted.length);
            setAllCities(formatted);
            // OpenWeather still filling the list: the selected zone and the flagged zones first
            let saved = null;
            try { saved = localStorage.getItem('selected_city'); } catch { /* storage off */ }
            askShownFirst(summaryData, [saved, ...formatted.filter((c) => c.risk && c.risk !== 'LOW').map((c) => c.city)]);

            // Maintain user selection across background refreshes
            setSelectedCity(prev => {
                if (prev) {
                    const match = formatted.find(c =>
                        (c.city && prev.city && c.city.toLowerCase() === prev.city.toLowerCase()) ||
                        (c.fullName && prev.fullName && c.fullName.toLowerCase() === prev.fullName.toLowerCase())
                    );
                    return match || prev;
                }
                const savedCity = localStorage.getItem('selected_city');
                if (savedCity) {
                    const match = formatted.find(c => c.city && c.city.toLowerCase() === savedCity.toLowerCase());
                    if (match) return match;
                }
                if (formatted.length > 0) return formatted[0];
                return null;
            });
        } catch {
            setError(WAKE_UNAVAILABLE);
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
    };

    useEffect(() => {
        console.log("useEffect triggered");
        loadAllData();

        // Real-Time 5-Minute Auto-Refresh Interval (300,000 ms)
        const interval = setInterval(() => {
            console.log("Auto refresh triggered");
            loadAllData();
        }, 300000); // 5 minutes

        return () => {
            clearInterval(interval);
        };
    }, []);

    useFillPoll(summary, loadAllData);

    // Sync selected city to localStorage so Forecast and other pages share the active city seamlessly
    useEffect(() => {
        if (selectedCity?.city) {
            try {
                localStorage.setItem('selected_city', selectedCity.city);
            } catch (e) {
                // Ignore storage errors if disabled
            }
        }
    }, [selectedCity]);

    // 3. SEARCH HANDLING
    const handleSearch = async (cityName) => {
        const trimmed = cityName?.trim();
        if (!trimmed) {
            setError("Please enter a valid city name.");
            return;
        }

        setSearchLoading(true);
        setError(null);
        try {
            // Fetch coordinates (Nominatim: throttled, cached, within its usage policy; see utils/nominatim.js)
            const geoData = await geocode(trimmed);

            if (!geoData || geoData.length === 0) {
                throw new Error("Location not found.");
            }

            const location = geoData[0];
            const lat = parseFloat(location.lat);
            const lon = parseFloat(location.lon);

            if (isNaN(lat) || isNaN(lon)) {
                throw new Error("Invalid coordinates received for location.");
            }

            const display_name = location.display_name;
            const shortName = display_name.split(",")[0].trim();

            // Call backend: POST {API_BASE}/predict
            let data = {};
            try {
                const response = await fetchWithWake(`${API_BASE}/predict`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        lat,
                        lon,
                        location: cityName
                    })
                });

                if (response.ok) {
                    data = await response.json();
                } else {
                    console.warn("Backend /predict returned non-OK status:", response.status);
                }
            } catch (apiErr) {
                if (isServerUnavailable(apiErr)) throw apiErr;      // server did not wake up: say so, no LOW default
                console.error("Backend /predict call failed:", apiErr);
            }

            console.log("Search API response:", data);

            const risk = (data.risk || data.risk_level || "LOW").toUpperCase();

            const newLocation = {
                id: Date.now(),
                city: shortName,
                fullName: display_name,
                lat,
                lon,
                risk,
                weather: data.weather || null,
                prediction: data.prediction || null,
                reason: data.reason || data.prediction?.reason || null,
                explanation: data.explanation || null,
                timestamp: data.timestamp || null,
                fetched_at: new Date().toISOString(),
                geocoder: 'nominatim'
            };

            console.log("Final Location Object:", newLocation);

            let resolvedCity = newLocation;
            setAllCities(prev => {
                const existingIndex = prev.findIndex(
                    c => (c.city && c.city.toLowerCase() === shortName.toLowerCase()) ||
                         (c.fullName && c.fullName.toLowerCase() === display_name.toLowerCase()) ||
                         (Math.abs(c.lat - lat) < 0.05 && Math.abs(c.lon - lon) < 0.05)
                );

                if (existingIndex !== -1) {
                    const updated = [...prev];
                    const existingItem = updated[existingIndex];
                    resolvedCity = {
                        ...existingItem,
                        ...newLocation,
                        id: existingItem.id
                    };
                    updated[existingIndex] = resolvedCity;
                    return updated;
                } else {
                    resolvedCity = newLocation;
                    return [newLocation, ...prev];
                }
            });

            setSelectedCity(resolvedCity);
        } catch (err) {
            if (err instanceof SupersededError) return;      // a newer search replaced this one before it was sent
            // own messages only (never a browser error class such as "Failed to fetch")
            setError(isServerUnavailable(err) ? WAKE_UNAVAILABLE
                : (!(err instanceof TypeError) && err.message) || `City '${trimmed}' could not be retrieved. Please check city name.`);
        } finally {
            setSearchLoading(false);
        }
    };

    useEffect(() => {
        const q = searchParams.get('city');
        if (q && q.trim()) {
            setSearchParams({}, { replace: true });
            const run = async () => { await handleSearch(q); };
            run();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Marker Click / Select Handler
    const handleSelectCity = (location) => {
        if (!location) return;
        setSelectedCity(location);
    };

    const handleRegionSelect = (region) => {
        if (region === "India") {
            loadAllData();
        } else {
            handleSearch(region);
        }
    };

    // sample data: no rule-based risk anywhere on the page (banner, counts, markers, panel)
    const sampleOnly = isSampleSource(source.source);
    const mixed = source.source === 'mixed';
    const nUnrated = mixed ? mixedCounts(summary, allCities).sample : 0;
    const selSource = selectedCity?.weather?.source;
    // a mixed list states its real counts; otherwise the selected zone's own source
    const badgeSource = mixed ? 'mixed' : (selSource || source.source);
    const badgeText = badgeSource
        ? sourceBadge(badgeSource, (!mixed && selSource && selectedCity.weather.observed_at) || source.observedAt,
            (!mixed && selSource && selectedCity.weather.data_time) || source.dataTime, summary, allCities)
        : 'Loading weather source…';

    return (
        <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-300">
            {/* Top Navigation Bar */}
            <TopHeader
                showCredits
                onSearch={handleSearch}
                searchLoading={searchLoading}
                selectedCity={selectedCity?.city}
                alertCount={sampleOnly ? null : summary?.high}
            />

            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar with Toggles & Monitor India */}
                <Sidebar
                    live={isLiveSource(source.source)}
                    activeLayers={activeLayers}
                    setActiveLayers={setActiveLayers}
                    onMonitorIndia={loadAllData}
                    onRegionSelect={handleRegionSelect}
                    loading={loading}
                />

                <div className="flex-1 flex flex-col overflow-hidden relative">
                    {/* Scrollable Content Area */}
                    <div className="flex-1 overflow-y-auto pb-4 flex flex-col">
                        {/* first-visit pointer to the ML system briefing (/overview) */}
                        <div data-testid="dashboard-briefing-card" className="mx-6 mt-4 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-3">
                            <p className="text-base font-bold text-blue-950 dark:text-blue-100 flex-1 min-w-[14rem]">New here? See the system briefing: what the ML nowcast warns about, and how well it works.</p>
                            <Link to="/overview" data-testid="dashboard-briefing-link" className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-base">
                                See the system briefing →
                            </Link>
                        </div>

                        {/* Error Handling Banner */}
                        {error && (
                            <div className="bg-red-600 text-white px-6 py-3 font-semibold text-sm shadow-md flex justify-between items-center z-50 shrink-0 animate-in fade-in duration-200">
                                <div className="flex items-center gap-2">
                                    <span className="text-base">⚠️</span>
                                    <span>{error}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => { setError(null); loadAllData(); }}
                                        className="bg-red-700 hover:bg-red-800 rounded px-2.5 py-1 text-xs font-bold transition-colors"
                                    >
                                        Retry
                                    </button>
                                    <button
                                        onClick={() => setError(null)}
                                        className="hover:bg-red-700 rounded px-2 py-1 text-xs font-bold transition-colors"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Top Hero Banner */}
                        <HeroBanner cityData={selectedCity} sample={mixed ? isUnratedZone(selectedCity) : !isLiveSource(source.source)} />

                        {/* Alert Banner: Pure component using backend single source of truth summary */}
                        <div className="px-6 pt-4">
                            {/* only for zone data that actually loaded (never a "no high-risk" banner on an error) */}
                            {source.source && (sampleOnly ? <SampleSafetyNotice />
                                : <AlertBanner locations={allCities} summary={summary} sample={!isLiveSource(source.source)} source={source.source} unrated={nUnrated} />)}
                        </div>

                        {/* Interactive Main Map & Right Panel */}
                        <div className="flex-1 flex px-6 py-4 gap-6 min-h-[500px]">
                            {/* Map Container */}
                            <div className="flex-1 relative rounded-2xl overflow-hidden shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#020617] flex flex-col">
                                {/* Map Controls Header */}
                                <div className="absolute top-4 left-4 z-[400] flex gap-2">
                                    <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur shadow-sm rounded-lg p-1 flex border border-slate-200 dark:border-slate-700">
                                        {[['map', 'Map'], ['satellite', 'Satellite'], ['terrain', 'Terrain']].map(([id, label]) => (
                                            <button key={id} type="button" data-testid={`basemap-${id}`} aria-pressed={baseLayer === id}
                                                onClick={() => setBaseLayer(id)}
                                                className={baseLayer === id
                                                    ? 'px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium shadow-sm'
                                                    : 'px-4 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md text-sm font-medium transition-colors'}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="absolute top-4 right-4 z-[400]">
                                    <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur shadow-sm rounded-lg px-4 py-2 border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                                        <span className={`w-2.5 h-2.5 rounded-full ${loading ? "bg-blue-500 animate-spin" : isLiveSource(badgeSource) ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                                        <span className="flex flex-col max-w-[330px]">
                                            <span data-testid="dashboard-source-badge" data-source={badgeSource || ''} className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                                {loading && allCities.length > 0 ? "Updating…" : badgeText}
                                            </span>
                                            {(badgeSource === 'open-meteo' || (mixed && mixedCounts(summary, allCities).openMeteo > 0)) && <OpenMeteoCredit />}
                                            {(badgeSource === 'openweather' || (mixed && mixedCounts(summary, allCities).openWeather > 0)) && <OpenWeatherCredit />}
                                        </span>
                                    </div>
                                </div>

                                {loading && allCities.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 z-50">
                                        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                        <div className="mt-4 text-slate-600 dark:text-slate-300 font-bold">Loading map data...</div>
                                    </div>
                                ) : (
                                    <MapSection
                                        key={allCities.length}
                                        allCities={allCities}
                                        selectedCity={selectedCity}
                                        onSelectCity={handleSelectCity}
                                        activeLayers={activeLayers}
                                        baseLayer={baseLayer}
                                        hideRisk={sampleOnly}
                                    />
                                )}

                                {/* Legend: markers are coloured by the zone's rule-based risk level (no percentages) */}
                                {!sampleOnly && <div data-testid="dashboard-legend" className="absolute bottom-6 left-6 z-[400] bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-xl p-4 shadow-lg border border-slate-200 dark:border-slate-700 w-64">
                                    <p className="text-xs font-bold mb-2 uppercase text-slate-500 dark:text-slate-400">Risk level (rule-based)</p>
                                    <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                                        {[['LOW', 'Low'], ['MODERATE', 'Moderate'], ['HIGH', 'High']].map(([k, label]) => (
                                            <span key={k} className="flex items-center gap-1.5">
                                                <span className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ background: RISK_COLOURS[k] }} />{label}
                                            </span>
                                        ))}
                                    </div>
                                    {mixed && (
                                        <p data-testid="legend-unrated" className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                            <span className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ background: RISK_COLOURS.NONE }} />Grey: sample data — risk not shown
                                        </p>
                                    )}
                                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">Marker colour = the zone&apos;s rule-based risk level (not the ML model).</p>
                                </div>}
                            </div>

                            {/* Right Panel: Pure component using central selectedCity */}
                            <div className="w-[360px] flex-shrink-0 flex flex-col gap-2 min-h-0">
                                <div className="flex-1 min-h-0">
                                    <RightPanel
                                        selectedCity={selectedCity}
                                        onClose={() => setSelectedCity(null)}
                                        hideRisk={(sampleOnly && (!selSource || isSampleSource(selSource))) || isUnratedZone(selectedCity)}
                                    />
                                </div>
                                {selectedCity?.geocoder === 'nominatim' && <NominatimCredit className="shrink-0 px-1" />}
                                <Link to="/nowcast" data-testid="dashboard-ml-link"
                                    className="shrink-0 text-xs font-bold text-blue-700 dark:text-blue-400 hover:underline px-1">
                                    Calibrated 1–6 h nowcasts: ML Nowcast →
                                </Link>
                            </div>
                        </div>

                        {/* Timeline and Risk Distribution */}
                        <div className="h-28 px-6 pb-2 flex gap-6 shrink-0">
                            <div className="flex-1">
                                <Timeline />
                            </div>
                            <div className="w-[360px] flex-shrink-0">
                                {sampleOnly ? (
                                    <div data-testid="sample-zone-count" className="h-full bg-white dark:bg-[#111827] rounded-2xl shadow-lg border border-slate-200 dark:border-gray-700 p-5 flex flex-col justify-center text-sm">
                                        <p className="font-black text-slate-800 dark:text-white">{summary?.total ?? allCities.length} zones (sample data)</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Risk counts are not shown on sample data.</p>
                                    </div>
                                ) : <RiskDistribution locations={allCities} summary={summary} unrated={nUnrated} />}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
