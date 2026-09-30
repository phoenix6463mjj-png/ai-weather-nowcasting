import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { sourceShort, unratedNote } from '../utils/dashboardRisk';

// Warning-style banner (icon + pill) only when there are HIGH zones; otherwise a neutral info strip.
const AlertBanner = ({ locations = [], summary = null, sample = false, source = null, unrated = 0 }) => {
    // mixed list: the counts cover only the zones with weather data (sample zones are not rated)
    const mixed = source === 'mixed';
    const note = mixed ? ' (rule-based, zones with weather data only)' : sample ? ' (sample data, rule-based)' : '';
    // If backend single source of truth summary is provided, use it directly (NO recalculations)
    const highCount = summary != null ? (summary.high ?? 0) : locations.filter(
        loc => loc.risk === "HIGH" || loc.prediction?.risk_label === 2 || loc.prediction?.risk_text === "HIGH"
    ).length;
    const modCount = summary != null ? (summary.moderate ?? 0) : locations.filter(
        loc => loc.risk === "MODERATE" || loc.prediction?.risk_label === 1 || loc.prediction?.risk_text === "MODERATE"
    ).length;

    // HIGH zones: "High Risk in X locations" warning banner. Otherwise (Moderate / Low only): the neutral
    // strip "Rule-based indicators: N moderate, 0 high zones (<source>). Not an official warning."
    if (highCount > 0) {
        return (
            <div className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl p-3.5 flex items-center justify-between shadow-sm transition-all duration-300">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-black text-sm">
                        <AlertTriangle size={18} className="fill-red-100 dark:fill-transparent" />
                        <span data-testid="alert-banner-text">High Risk in {highCount} location{highCount === 1 ? '' : 's'}{note}</span>
                    </div>
                </div>
                <span className="text-[11px] font-black uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/60 px-2.5 py-1 rounded-md border border-red-200 dark:border-red-800">
                    High Alert{mixed ? ' (rule-based)' : note}
                </span>
            </div>
        );
    }

    return (
        <div data-testid="info-strip" className="w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 flex items-center gap-2 text-slate-600 dark:text-slate-300 text-sm transition-all duration-300">
            <Info size={16} className="text-slate-400 shrink-0" />
            <span data-testid="info-strip-text">
                {mixed
                    ? <>Rule-based indicators: {modCount} moderate, {highCount} high zones (zones with weather data only; {unratedNote(unrated)}). Not an official warning.</>
                    : <>Rule-based indicators: {modCount} moderate, {highCount} high zones ({sourceShort(source || (sample ? 'sample' : null))}). Not an official warning.</>}
            </span>
        </div>
    );
};

export default AlertBanner;
