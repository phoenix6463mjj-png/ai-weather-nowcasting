import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../config';
import HonestyBanner from '../components/HonestyBanner';
import DonutChart from '../components/DonutChart';
import OpenMeteoCredit from '../components/OpenMeteoCredit';
import {
    BarChart2,
    ArrowLeft,
    RefreshCw,
    Wind,
    Droplets,
    CloudRain,
    Sparkles,
    Calendar,
    Filter,
    MapPin
} from 'lucide-react';
import {
    ResponsiveContainer,
    LineChart,
    Line,
    BarChart,
    Bar,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip
} from 'recharts';
import TopHeader from '../components/TopHeader';

// Rich fallback dataset for all-India meteorological telemetry
const FALLBACK_NODES = [
    { city: "Vizianagaram", state: "Andhra Pradesh", rainfall: 38.4, wind_speed: 11.2, humidity: 94, risk_level: "HIGH", hazard: "Flash Flood" },
    { city: "Ratnagiri", state: "Maharashtra", rainfall: 29.2, wind_speed: 14.1, humidity: 88, risk_level: "HIGH", hazard: "Severe Squall" },
    { city: "Anantapur", state: "Andhra Pradesh", rainfall: 22.0, wind_speed: 12.8, humidity: 86, risk_level: "HIGH", hazard: "Thunderstorm" },
    { city: "Nagpur", state: "Maharashtra", rainfall: 18.5, wind_speed: 9.4, humidity: 78, risk_level: "MODERATE", hazard: "Convective Rain" },
    { city: "Hyderabad", state: "Telangana", rainfall: 16.2, wind_speed: 8.6, humidity: 82, risk_level: "MODERATE", hazard: "Urban Runoff" },
    { city: "Kozhikode", state: "Kerala", rainfall: 21.0, wind_speed: 7.2, humidity: 89, risk_level: "MODERATE", hazard: "Monsoon Surge" },
    { city: "Pune", state: "Maharashtra", rainfall: 14.0, wind_speed: 6.8, humidity: 74, risk_level: "MODERATE", hazard: "Rain Shower" },
    { city: "Shimla", state: "Himachal Pradesh", rainfall: 15.5, wind_speed: 10.1, humidity: 81, risk_level: "MODERATE", hazard: "Slope Runoff" },
    { city: "Bengaluru", state: "Karnataka", rainfall: 7.2, wind_speed: 5.4, humidity: 68, risk_level: "LOW", hazard: "Light Shower" },
    { city: "Chennai", state: "Tamil Nadu", rainfall: 5.0, wind_speed: 6.2, humidity: 72, risk_level: "LOW", hazard: "Nominal" },
    { city: "Delhi NCR", state: "Delhi NCR", rainfall: 2.1, wind_speed: 4.8, humidity: 55, risk_level: "LOW", hazard: "Nominal" },
    { city: "Jaipur", state: "Rajasthan", rainfall: 0.5, wind_speed: 5.0, humidity: 42, risk_level: "LOW", hazard: "Dry" },
    { city: "Kolkata", state: "West Bengal", rainfall: 8.4, wind_speed: 6.0, humidity: 76, risk_level: "LOW", hazard: "Intermittent Rain" },
    { city: "Mumbai", state: "Maharashtra", rainfall: 24.5, wind_speed: 10.5, humidity: 85, risk_level: "HIGH", hazard: "Coastal Downpour" },
    { city: "Surat", state: "Gujarat", rainfall: 12.0, wind_speed: 7.5, humidity: 70, risk_level: "MODERATE", hazard: "Tidal Surge" }
];

const POPULAR_STATES = [
    "All India",
    "Andhra Pradesh",
    "Maharashtra",
    "Tamil Nadu",
    "Karnataka",
    "Kerala",
    "Gujarat",
    "West Bengal",
    "Rajasthan",
    "Delhi NCR",
    "Telangana",
    "Himachal Pradesh"
];

const Analytics = () => {
    const [data, setData] = useState([]);
    // "backend" = /batch_predict answered; "fallback" = the page's built-in example nodes
    const [dataOrigin, setDataOrigin] = useState(null);
    const [loading, setLoading] = useState(true);
    const [, setError] = useState(null);
    const isFetchingRef = useRef(false);
    const srcOf = (d) => d.source || d.weather?.source;
    const liveWeather = dataOrigin === "backend" && data.length > 0 && data.every((d) => ["openweather", "open-meteo"].includes(srcOf(d)));
    const openMeteo = liveWeather && data.every((d) => srcOf(d) === "open-meteo");
    const dataLabel = dataOrigin === "fallback" ? "built-in example data (backend not reachable)"
        : openMeteo ? "Open-Meteo data (model data)" : liveWeather ? "OpenWeather data" : "sample data";

    // 1. FILTER BAR STATE
    const [timeRange, setTimeRange] = useState("Today"); // "Today" | "7 Days" | "30 Days"
    const [hazardType, setHazardType] = useState("All"); // "All" | "Flood" | "Storm" | "Wind"
    const [selectedRegion, setSelectedRegion] = useState("All India");

    const loadData = useCallback(async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/batch_predict?limit=100`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (Array.isArray(json) && json.length > 0) {
                setData(json);
                setDataOrigin("backend");
            } else {
                setData(FALLBACK_NODES);
                setDataOrigin("fallback");
            }
        } catch (err) {
            console.warn("Analytics fetch error, falling back to cached nodes:", err);
            setData(FALLBACK_NODES);
            setDataOrigin("fallback");
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
    }, []);

    useEffect(() => {
        let isMounted = true;
        const init = async () => {
            if (isMounted) await loadData();
        };
        init();

        // 5-minute auto-refresh interval
        const interval = setInterval(() => {
            if (isMounted) loadData();
        }, 300000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [loadData]);

    // Active dataset filtered by Region & Hazard Type
    const filteredDataset = useMemo(() => {
        const raw = data.length > 0 ? data : FALLBACK_NODES;

        return raw.filter(item => {
            // Region filter
            if (selectedRegion !== "All India") {
                const itemState = String(item.state || '').toLowerCase();
                const targetState = selectedRegion.toLowerCase();
                if (!itemState.includes(targetState) && !targetState.includes(itemState)) {
                    return false;
                }
            }

            // Hazard Type filter
            if (hazardType === "Flood") {
                const rain = Number(item.rainfall ?? item.weather?.rainfall ?? 0);
                const hasFlood = (item.alert || item.hazard || '').toLowerCase().includes("flood");
                if (rain < 15 && !hasFlood) return false;
            } else if (hazardType === "Storm") {
                const wind = Number(item.wind_speed ?? item.weather?.wind_speed ?? 0);
                const hasStorm = (item.alert || item.hazard || '').toLowerCase().includes("thunder");
                if (wind < 8 && !hasStorm) return false;
            } else if (hazardType === "Wind") {
                const wind = Number(item.wind_speed ?? item.weather?.wind_speed ?? 0);
                if (wind < 7) return false;
            }

            return true;
        });
    }, [data, selectedRegion, hazardType]);

    // Compute key telemetry summary metrics
    const { avgRain, avgWind, avgHum, highCount, modCount, lowCount, totalNodes } = useMemo(() => {
        const dataset = filteredDataset.length > 0 ? filteredDataset : (data.length > 0 ? data : FALLBACK_NODES);
        let tRain = 0, tWind = 0, tHum = 0;
        let hCount = 0, mCount = 0, lCount = 0;

        dataset.forEach(item => {
            const r = String(item.risk_level || item.risk || "LOW").toUpperCase();
            if (r === "HIGH") hCount++;
            else if (r === "MODERATE" || r === "MEDIUM") mCount++;
            else lCount++;

            const rain = Number(item.rainfall ?? item.weather?.rainfall ?? 0);
            const wind = Number(item.wind_speed ?? item.weather?.wind_speed ?? 0);
            const hum = Number(item.humidity ?? item.weather?.humidity ?? 0);

            tRain += isNaN(rain) ? 0 : rain;
            tWind += isNaN(wind) ? 0 : wind;
            tHum += isNaN(hum) ? 0 : hum;
        });

        const total = dataset.length || 1;
        return {
            avgRain: (tRain / total).toFixed(1),
            avgWind: (tWind / total).toFixed(1),
            avgHum: Math.round(tHum / total),
            highCount: hCount,
            modCount: mCount,
            lowCount: lCount,
            totalNodes: dataset.length
        };
    }, [filteredDataset, data]);

    // 2A. Rainfall Trend Line Chart Data (dynamically structured by Time Range)
    const lineChartData = useMemo(() => {
        const base = parseFloat(avgRain) || 16.5;
        if (timeRange === "Today") {
            return [
                { time: "00:00", rainfall: +(base * 0.4).toFixed(1), threshold: 15.0 },
                { time: "04:00", rainfall: +(base * 0.6).toFixed(1), threshold: 15.0 },
                { time: "08:00", rainfall: +(base * 0.9).toFixed(1), threshold: 15.0 },
                { time: "12:00", rainfall: +(base * 1.3).toFixed(1), threshold: 15.0 },
                { time: "16:00", rainfall: +(base * 1.5).toFixed(1), threshold: 15.0 },
                { time: "20:00", rainfall: +(base * 1.1).toFixed(1), threshold: 15.0 },
                { time: "Now",   rainfall: +(base * 1.0).toFixed(1), threshold: 15.0 }
            ];
        } else if (timeRange === "7 Days") {
            return [
                { time: "Mon", rainfall: +(base * 0.7).toFixed(1), threshold: 15.0 },
                { time: "Tue", rainfall: +(base * 0.9).toFixed(1), threshold: 15.0 },
                { time: "Wed", rainfall: +(base * 1.4).toFixed(1), threshold: 15.0 },
                { time: "Thu", rainfall: +(base * 1.6).toFixed(1), threshold: 15.0 },
                { time: "Fri", rainfall: +(base * 1.2).toFixed(1), threshold: 15.0 },
                { time: "Sat", rainfall: +(base * 1.0).toFixed(1), threshold: 15.0 },
                { time: "Sun", rainfall: +(base * 0.8).toFixed(1), threshold: 15.0 }
            ];
        } else {
            // 30 Days
            return [
                { time: "Day 1",  rainfall: +(base * 0.6).toFixed(1), threshold: 15.0 },
                { time: "Day 5",  rainfall: +(base * 0.8).toFixed(1), threshold: 15.0 },
                { time: "Day 10", rainfall: +(base * 1.2).toFixed(1), threshold: 15.0 },
                { time: "Day 15", rainfall: +(base * 1.7).toFixed(1), threshold: 15.0 },
                { time: "Day 20", rainfall: +(base * 1.3).toFixed(1), threshold: 15.0 },
                { time: "Day 25", rainfall: +(base * 1.0).toFixed(1), threshold: 15.0 },
                { time: "Day 30", rainfall: +(base * 0.9).toFixed(1), threshold: 15.0 }
            ];
        }
    }, [avgRain, timeRange]);

    // 2B. City Risk Comparison Bar Chart Data (Top 5 cities by rainfall / intensity)
    const barChartData = useMemo(() => {
        const dataset = filteredDataset.length > 0 ? filteredDataset : (data.length > 0 ? data : FALLBACK_NODES);
        const sorted = [...dataset].sort((a, b) => {
            const rA = Number(a.rainfall ?? a.weather?.rainfall ?? 0);
            const rB = Number(b.rainfall ?? b.weather?.rainfall ?? 0);
            return rB - rA;
        });

        return sorted.slice(0, 5).map(item => {
            const rain = Number(item.rainfall ?? item.weather?.rainfall ?? 0);
            const wind = Number(item.wind_speed ?? item.weather?.wind_speed ?? 0);
            const risk = String(item.risk_level || item.risk || "LOW").toUpperCase();
            return {
                city: item.city,
                rainfall: +rain.toFixed(1),
                wind: +wind.toFixed(1),
                risk: risk,
                fill: risk === "HIGH" ? "#ef4444" : risk === "MODERATE" ? "#f59e0b" : "#10b981"
            };
        });
    }, [filteredDataset, data]);

    // 2C. Risk Distribution Pie / Doughnut Chart Data
    const pieChartData = useMemo(() => {
        return [
            { name: "High Risk", value: highCount, color: "#ef4444" },
            { name: "Moderate Risk", value: modCount, color: "#f59e0b" },
            { name: "Low Risk", value: lowCount, color: "#10b981" }
        ].filter(item => item.value > 0);
    }, [highCount, modCount, lowCount]);

    // 5. TOP RISK CITIES (Ranked List)
    const topRiskCities = useMemo(() => {
        const dataset = filteredDataset.length > 0 ? filteredDataset : (data.length > 0 ? data : FALLBACK_NODES);

        // Priority sort: HIGH -> MODERATE -> LOW, then rainfall
        const sorted = [...dataset].sort((a, b) => {
            const getRank = (r) => {
                const s = String(r || '').toUpperCase();
                if (s === 'HIGH') return 3;
                if (s === 'MODERATE' || s === 'MEDIUM') return 2;
                return 1;
            };
            const rankDiff = getRank(b.risk_level || b.risk) - getRank(a.risk_level || a.risk);
            if (rankDiff !== 0) return rankDiff;

            const rainA = Number(a.rainfall ?? a.weather?.rainfall ?? 0);
            const rainB = Number(b.rainfall ?? b.weather?.rainfall ?? 0);
            return rainB - rainA;
        });

        return sorted.slice(0, 6);
    }, [filteredDataset, data]);

    // 4. KEY INSIGHTS (AI Generated Synthesis)
    const keyInsights = useMemo(() => {
        const highCities = topRiskCities.filter(c => String(c.risk_level || c.risk).toUpperCase() === 'HIGH');
        const insights = [];

        if (highCities.length > 0) {
            insights.push({
                type: "danger",
                text: `High risk intensifying in coastal and delta corridors (${highCities.map(c => c.city).slice(0, 3).join(', ')}) with precipitation exceeding 20 mm/hr.`
            });
        } else {
            insights.push({
                type: "success",
                text: "No active critical flood thresholds breached across selected regional sectors."
            });
        }

        insights.push({
            type: "warning",
            text: `Rule-based thunderstorm indicator elevated across Southern and Western sectors; average wind ${avgWind} m/s.`
        });

        insights.push({
            type: "info",
            text: `Atmospheric relative humidity remains elevated at ${avgHum}%, sustaining strong latent heat flux for afternoon localized convection.`
        });

        return insights;
    }, [topRiskCities, avgWind, avgHum]);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
            <TopHeader onSearch={() => {}} searchLoading={false} selectedCity="All India" />

            <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
                <HonestyBanner kind="illustrative" />
                {/* Header Title Bar */}
                <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-200 dark:border-blue-900/50">
                            <BarChart2 size={26} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white">
                                Meteorological Analytics Dashboard
                            </h1>
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                {liveWeather ? 'Real-Time Atmospheric Telemetry, Predictive Risk Stratification & Trends' : 'Atmospheric Summary, Rule-based Risk Stratification & Trends'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 self-start sm:self-center">
                        <button
                            onClick={loadData}
                            disabled={loading}
                            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                            title="Refresh Analytics Telemetry"
                        >
                            <RefreshCw size={13} className={loading ? "animate-spin text-blue-500" : ""} />
                            <span>{loading ? "Updating..." : "Refresh"}</span>
                        </button>
                        <Link
                            to="/"
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-colors shadow-xs"
                        >
                            <ArrowLeft size={14} />
                            <span>Dashboard</span>
                        </Link>
                    </div>
                </div>

                {/* 1. FILTER BAR (TOP - HORIZONTALLY ALIGNED) */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 mb-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <Filter size={15} className="text-blue-500" />
                        <span>Dashboard Filters</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Time Range Filter */}
                        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                            <span className="text-[11px] font-bold text-slate-400 pl-2 pr-1 flex items-center gap-1">
                                <Calendar size={12} /> Time:
                            </span>
                            {["Today", "7 Days", "30 Days"].map((range) => (
                                <button
                                    key={range}
                                    onClick={() => setTimeRange(range)}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                                        timeRange === range
                                            ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                    }`}
                                >
                                    {range}
                                </button>
                            ))}
                        </div>

                        {/* Hazard Type Filter */}
                        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                            <span className="text-[11px] font-bold text-slate-400 pl-2 pr-1">
                                Hazard:
                            </span>
                            {["All", "Flood", "Storm", "Wind"].map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setHazardType(type)}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                                        hazardType === type
                                            ? "bg-blue-600 text-white shadow-xs"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                    }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>

                        {/* Region (State Selector) */}
                        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
                            <MapPin size={13} className="text-slate-400" />
                            <select
                                value={selectedRegion}
                                onChange={(e) => setSelectedRegion(e.target.value)}
                                className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer pr-2"
                            >
                                {POPULAR_STATES.map((state) => (
                                    <option key={state} value={state} className="dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                                        {state}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* 3. EXISTING METRIC CARDS (IMPROVED STYLING) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    {/* Metric 1: Avg Precipitation */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                Avg Precipitation
                            </span>
                            <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">
                                {avgRain} mm
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Across {totalNodes} monitored sectors
                            </p>
                        </div>
                        <div className="p-3 bg-blue-50 dark:bg-blue-950/40 text-blue-500 rounded-xl">
                            <CloudRain size={24} />
                        </div>
                    </div>

                    {/* Metric 2: Avg Relative Humidity */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                Avg Relative Humidity
                            </span>
                            <div className="text-2xl font-black text-teal-600 dark:text-teal-400 mt-1">
                                {avgHum}%
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Convective moisture potential
                            </p>
                        </div>
                        <div className="p-3 bg-teal-50 dark:bg-teal-950/40 text-teal-500 rounded-xl">
                            <Droplets size={24} />
                        </div>
                    </div>

                    {/* Metric 3: Avg Wind Velocity */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                Avg Wind Velocity
                            </span>
                            <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
                                {avgWind} m/s
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Surface shear & isobar gradient
                            </p>
                        </div>
                        <div className="p-3 bg-purple-50 dark:bg-purple-950/40 text-purple-500 rounded-xl">
                            <Wind size={24} />
                        </div>
                    </div>
                </div>

                {/* 2. REAL CHARTS SECTION (2 COLUMNS) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* Chart A: Line Chart - Rainfall Trend */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                                    Rainfall Trend
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Precipitation timeline trajectory ({timeRange})
                                </p>
                            </div>
                            <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900">
                                Baseline: {avgRain} mm
                            </span>
                        </div>

                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={lineChartData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" />
                                    <XAxis
                                        dataKey="time"
                                        tick={{ fill: '#64748b', fontSize: 11 }}
                                        stroke="#cbd5e1"
                                        className="dark:stroke-slate-700"
                                    />
                                    <YAxis
                                        tick={{ fill: '#64748b', fontSize: 11 }}
                                        stroke="#cbd5e1"
                                        className="dark:stroke-slate-700"
                                        unit="mm"
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#0f172a',
                                            borderColor: '#334155',
                                            borderRadius: '8px',
                                            color: '#f8fafc',
                                            fontSize: '12px',
                                            fontWeight: 'bold'
                                        }}
                                        formatter={(val) => [`${val} mm`, 'Rainfall']}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="rainfall"
                                        stroke="#3b82f6"
                                        strokeWidth={2.5}
                                        dot={{ fill: '#3b82f6', r: 4 }}
                                        activeDot={{ r: 6, fill: '#2563eb' }}
                                        name="Rainfall"
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="threshold"
                                        stroke="#ef4444"
                                        strokeWidth={1.5}
                                        strokeDasharray="4 4"
                                        dot={false}
                                        name="Warning Threshold"
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Chart B: Bar Chart - City Risk Comparison */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                                    City Risk Comparison
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Top 5 monitored cities by precipitation load
                                </p>
                            </div>
                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                Ranked Metric (mm)
                            </span>
                        </div>

                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={barChartData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" />
                                    <XAxis
                                        dataKey="city"
                                        tick={{ fill: '#64748b', fontSize: 11 }}
                                        stroke="#cbd5e1"
                                        className="dark:stroke-slate-700"
                                    />
                                    <YAxis
                                        tick={{ fill: '#64748b', fontSize: 11 }}
                                        stroke="#cbd5e1"
                                        className="dark:stroke-slate-700"
                                        unit="mm"
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#0f172a',
                                            borderColor: '#334155',
                                            borderRadius: '8px',
                                            color: '#f8fafc',
                                            fontSize: '12px',
                                            fontWeight: 'bold'
                                        }}
                                        formatter={(val, name, item) => [
                                            `${val} mm (${item.payload.risk})`,
                                            'Precipitation'
                                        ]}
                                    />
                                    <Bar dataKey="rainfall" radius={[6, 6, 0, 0]}>
                                        {barChartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* 2C. PIE CHART + 4. INSIGHTS PANEL (2 COLUMNS) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    {/* Chart C: Pie / Doughnut Chart - Risk Distribution */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
                        <div>
                            <h3 className="font-bold text-base text-slate-900 dark:text-white">
                                Risk Distribution
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                                Classification proportions ({totalNodes} nodes)
                            </p>
                        </div>

                        <div className="h-60 w-full flex items-center justify-center">
                            <DonutChart data={pieChartData.map((d) => ({ name: d.name, value: d.value, color: d.color }))} />
                        </div>
                    </div>

                    {/* 4. INSIGHTS PANEL (VERY IMPORTANT) */}
                    <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg">
                                        <Sparkles size={16} />
                                    </div>
                                    <h3 className="font-bold text-base text-slate-900 dark:text-white">
                                        Key Insights
                                    </h3>
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900">
                                    Rule-based summary
                                </span>
                            </div>

                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3.5">
                                <span data-testid="analytics-summary-source">Rule-based summary of {dataLabel}</span> for {selectedRegion}:
                                {openMeteo && <><br /><OpenMeteoCredit /></>}
                            </p>

                            <div className="space-y-2.5">
                                {keyInsights.map((insight, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                                    >
                                        <span className="text-blue-500 shrink-0 mt-0.5">•</span>
                                        <span className="leading-relaxed">{insight.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                            <span data-testid="analytics-model-label">Rule-based indicator (not the ML model)</span>
                        </div>
                    </div>
                </div>

                {/* 5. TOP RISK CITIES SECTION */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="font-bold text-base text-slate-900 dark:text-white">
                                Top Risk Cities
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Ranked priority list evaluated against physical meteorological danger thresholds
                            </p>
                        </div>
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            Ranked by Threat Urgency
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {topRiskCities.map((item, index) => {
                            const r = String(item.risk_level || item.risk || "LOW").toUpperCase();
                            const isHigh = r === "HIGH";
                            const isMod = r === "MODERATE" || r === "MEDIUM";

                            // Color indicators: Red (High), Yellow (Moderate), Green (Low)
                            const badgeColor = isHigh
                                ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900"
                                : isMod
                                    ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900";

                            const dotColor = isHigh ? "bg-red-500" : isMod ? "bg-amber-400" : "bg-emerald-500";
                            const rain = Number(item.rainfall ?? item.weather?.rainfall ?? 0);
                            const wind = Number(item.wind_speed ?? item.weather?.wind_speed ?? 0);

                            return (
                                <div
                                    key={index}
                                    className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="w-6 h-6 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center font-black text-xs text-slate-700 dark:text-slate-300 shrink-0">
                                            {index + 1}
                                        </span>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                                                    {item.city}
                                                </h4>
                                                <span className="text-[10px] text-slate-400">
                                                    ({item.state || 'India'})
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                <span>Rain: {rain.toFixed(1)} mm</span>
                                                <span>•</span>
                                                <span>Wind: {wind.toFixed(1)} m/s</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border flex items-center gap-1.5 ${badgeColor}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                            {r}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Analytics;
