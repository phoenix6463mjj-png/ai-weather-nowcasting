import React from 'react';
import { CloudLightning, X, Droplets, Thermometer, Wind, MapPin, AlertTriangle, CloudRain, Sun } from 'lucide-react';
import { LEVEL_NAMES, RULE_LABEL, explanationText, hazardLevels, primaryThreat, riskText as zoneRisk, sourceBadge } from '../utils/dashboardRisk';
import OpenMeteoCredit from './OpenMeteoCredit';

const LEVEL_STYLE = [
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
    'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800',
    'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',
];

// One hazard as a rule-based level (Low / Moderate / High); never a percentage.
const HazardLevel = ({ label, level, icon, hazard }) => (
    <div data-testid="hazard-level" data-hazard={hazard} data-level={LEVEL_NAMES[level]} className="flex items-center justify-between text-xs w-full">
        <div className="flex items-center gap-2">
            <div className="w-5 flex justify-center items-center text-slate-500 dark:text-slate-400">{icon}</div>
            <span className="font-bold text-slate-700 dark:text-slate-300">{label}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-black ${LEVEL_STYLE[level]}`}>{LEVEL_NAMES[level]}</span>
    </div>
);

const RightPanel = ({ selectedCity, cityData, onClose }) => {
    // Single source of truth: selectedCity prop
    const cityObj = selectedCity || cityData;

    if (!cityObj) {
        return (
            <div className="h-full bg-white dark:bg-[#111827] rounded-2xl shadow-lg border border-slate-200 dark:border-gray-700 p-6 flex flex-col items-center justify-center text-center">
                <MapPin className="text-slate-400 mb-2" size={32} />
                <p className="text-slate-600 dark:text-slate-300 font-bold text-sm">No City Selected</p>
                <p className="text-slate-400 text-xs mt-1">Search for a city or click a marker on the map to inspect weather and threat data.</p>
            </div>
        );
    }

    const { city, weather, prediction = {}, lat, lon, state } = cityObj;

    // Safely extract risk level (LOW/MODERATE/HIGH)
    const riskText = zoneRisk(cityObj);
    const riskLabel = riskText === "HIGH" ? 2 : riskText === "MODERATE" ? 1 : 0;

    // never "stable" text on a MODERATE / HIGH zone; zones without one say so
    const explanation = explanationText(cityObj);

    // Extract explainable reason
    const reason = cityObj.reason || prediction?.reason || (riskLabel === 2 ? "Severe convective instability and elevated rainfall thresholds." : (riskLabel === 1 ? "Moderate atmospheric convective indicators." : "Normal atmospheric conditions within baseline limits."));

    // Extract & format backend timestamp
    const rawTimestamp = cityObj.timestamp || prediction?.timestamp;
    const formatTimestamp = (ts) => {
        if (!ts) return '—';
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return ts;
            return d.toLocaleTimeString('en-US', { hour12: false });
        } catch {
            return String(ts);
        }
    };
    const lastUpdated = formatTimestamp(rawTimestamp);

    let badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-800";
    let badgeText = "LOW RISK";
    if (riskLabel === 2) {
        badgeClass = "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-800";
        badgeText = "HIGH RISK";
    } else if (riskLabel === 1) {
        badgeClass = "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-400 dark:border-orange-800";
        badgeText = "MODERATE RISK";
    }

    // Rule-based hazard levels (capped at the zone's risk level) and the primary threat, which exists
    // only for MODERATE / HIGH zones so that it always agrees with the risk level
    const levels = hazardLevels(cityObj);
    const threatKey = primaryThreat(cityObj);
    const primaryThreat_ = { flood: 'Flash Flood', cloudburst: 'Cloudburst', thunderstorm: 'Thunderstorm' }[threatKey] || 'No primary threat (low risk)';

    // Threat Icon matching primary threat
    const getThreatIcon = () => {
        if (primaryThreat_ === "Flash Flood") return <Droplets size={26} className="text-teal-400" />;
        if (primaryThreat_ === "Cloudburst") return <CloudRain size={26} className="text-blue-400" />;
        if (primaryThreat_ === "Thunderstorm") return <CloudLightning size={26} className="text-amber-400" />;
        return <Sun size={26} className="text-emerald-400" />;
    };

    const coordLat = lat ?? weather?.lat;
    const coordLon = lon ?? weather?.lon;
    const coordText = (coordLat !== undefined && coordLon !== undefined && coordLat !== null && coordLon !== null)
        ? `Lat ${Number(coordLat).toFixed(2)}° • Lon ${Number(coordLon).toFixed(2)}°`
        : "Coordinates Unavailable";

    // Safe formatting for weather metrics
    const hasTemp = cityObj.weather?.temperature != null;
    const tempVal = hasTemp ? `${Math.round(cityObj.weather.temperature)}°C` : "--";
    const hasHum = cityObj.weather?.humidity != null;
    const humVal = hasHum ? `${Math.round(cityObj.weather.humidity)}%` : "--";
    const hasRain = cityObj.weather?.rainfall != null;
    const rainVal = hasRain ? `${Number(cityObj.weather.rainfall).toFixed(1)} mm` : "--";
    const windSpeed = cityObj.weather?.wind_speed ?? cityObj.weather?.wind;
    const windVal = windSpeed != null ? `${Number(windSpeed).toFixed(1)} m/s` : "--";

    const cityName = city || "Unknown Location";

    return (
        <div className="h-full bg-white dark:bg-[#111827] rounded-2xl shadow-lg border border-slate-200 dark:border-gray-700 flex flex-col overflow-hidden">
            {/* Header Area */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
                <div className="flex justify-between items-start">
                    <div className="min-w-0 pr-4">
                        <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight truncate">
                            {cityName}
                            {state && (
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 ml-2 font-mono">
                                    {state}
                                </span>
                            )}
                        </h2>
                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                            <MapPin size={12} className="text-blue-500 shrink-0" /> <span className="truncate">{coordText}</span>
                        </p>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-700 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full p-1.5 transition-colors shrink-0"
                            aria-label="Close panel"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs font-black tracking-wider ${badgeClass}`}>
                        <AlertTriangle size={14} className={riskLabel === 2 ? "text-red-600 dark:text-red-400" : (riskLabel === 1 ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400")} />
                        {badgeText}
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                        Last Updated: {lastUpdated}
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">

                {/* Primary Threat Banner */}
                <div className="bg-slate-800 dark:bg-slate-800/90 rounded-xl p-4 text-white shadow-md border border-slate-700 flex flex-col relative overflow-hidden shrink-0">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="bg-slate-700/60 p-3 rounded-lg z-10 border border-slate-600 shrink-0">
                            {getThreatIcon()}
                        </div>
                        <div className="z-10 min-w-0 flex-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Primary Threat</p>
                            <h3 className="text-lg font-black tracking-wide truncate text-white">{primaryThreat_}</h3>
                        </div>
                    </div>
                    <div className="bg-slate-700/40 rounded-lg p-3 mt-1 border border-slate-600/50 space-y-1.5">
                        <p className="text-xs font-medium text-slate-200 leading-relaxed">
                            {explanation}
                        </p>
                        <p className="text-xs font-bold text-amber-300">
                            Reason: {reason}
                        </p>
                    </div>
                </div>

                {/* Explainable AI Reason Card */}
                <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-xl p-3.5 shadow-xs shrink-0">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                            Rule-based explanation
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                            Last Updated: {lastUpdated}
                        </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-snug">
                        Reason: {reason}
                    </div>
                </div>

                {/* 4 Required Weather Metrics */}
                <div>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-1">Weather</h3>
                    <p data-testid="panel-weather-source" className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-3">
                        {sourceBadge(cityObj.weather?.source || 'sample', cityObj.weather?.observed_at, cityObj.weather?.data_time)}
                        {cityObj.weather?.conditions ? ` · ${cityObj.weather.conditions}` : ''}
                    </p>
                    {cityObj.weather?.source === 'open-meteo' && <p className="-mt-2 mb-3"><OpenMeteoCredit /></p>}
                    <div className="grid grid-cols-2 gap-3">
                        {/* 1. Temperature */}
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700/70 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
                            <div className="p-2 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-lg shrink-0">
                                <Thermometer size={18} />
                            </div>
                            <div className="min-w-0">
                                <span className="text-sm font-black text-slate-900 dark:text-white block leading-tight truncate">
                                    {tempVal}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">Temperature</span>
                            </div>
                        </div>

                        {/* 2. Humidity */}
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700/70 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg shrink-0">
                                <Droplets size={18} />
                            </div>
                            <div className="min-w-0">
                                <span className="text-sm font-black text-slate-900 dark:text-white block leading-tight truncate">
                                    {humVal}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">Humidity</span>
                            </div>
                        </div>

                        {/* 3. Rainfall */}
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700/70 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
                                <CloudRain size={18} />
                            </div>
                            <div className="min-w-0">
                                <span className="text-sm font-black text-slate-900 dark:text-white block leading-tight truncate">
                                    {rainVal}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">Rainfall</span>
                            </div>
                        </div>

                        {/* 4. Wind Speed */}
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700/70 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
                            <div className="p-2 bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 rounded-lg shrink-0">
                                <Wind size={18} />
                            </div>
                            <div className="min-w-0">
                                <span className="text-sm font-black text-slate-900 dark:text-white block leading-tight truncate">
                                    {windVal}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">Wind Speed</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Hazard indicators: levels only, rule-based (no percentages on this page) */}
                <div data-testid="hazard-levels">
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-1">
                        Hazard indicators
                    </h3>
                    <p data-testid="rule-label" className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-3">{RULE_LABEL}</p>
                    <div className="space-y-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700/70 shadow-sm">
                        <HazardLevel hazard="thunderstorm" label="Thunderstorm" level={levels.thunderstorm}
                            icon={<CloudLightning size={16} className="text-amber-500" />} />
                        <HazardLevel hazard="cloudburst" label="Cloudburst" level={levels.cloudburst}
                            icon={<CloudRain size={16} className="text-blue-500" />} />
                        <HazardLevel hazard="flood" label="Flash Flood" level={levels.flood}
                            icon={<Droplets size={16} className="text-teal-500" />} />
                    </div>
                </div>

            </div>
        </div>
    );
};

export default RightPanel;

