import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

const AlertBanner = ({ locations = [], summary = null }) => {
    // If backend single source of truth summary is provided, use it directly (NO recalculations)
    const highCount = summary != null ? (summary.high ?? 0) : locations.filter(
        loc => loc.risk === "HIGH" || loc.prediction?.risk_label === 2 || loc.prediction?.risk_text === "HIGH"
    ).length;
    const modCount = summary != null ? (summary.moderate ?? 0) : locations.filter(
        loc => loc.risk === "MODERATE" || loc.prediction?.risk_label === 1 || loc.prediction?.risk_text === "MODERATE"
    ).length;

    // Exact required logic:
    // IF highCount > 0:
    //    show "High Risk in X locations"
    // ELSE IF modCount > 0:
    //    show "Moderate Risk present"
    // ELSE:
    //    show "No high-risk zones in this data"
    if (highCount > 0) {
        return (
            <div className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl p-3.5 flex items-center justify-between shadow-sm transition-all duration-300">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-black text-sm">
                        <AlertTriangle size={18} className="fill-red-100 dark:fill-transparent" />
                        <span>High Risk in {highCount} locations</span>
                    </div>
                </div>
                <span className="text-[11px] font-black uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/60 px-2.5 py-1 rounded-md border border-red-200 dark:border-red-800">
                    High Alert
                </span>
            </div>
        );
    }

    if (modCount > 0) {
        return (
            <div className="w-full bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/50 rounded-xl p-3.5 flex items-center justify-between shadow-sm transition-all duration-300">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm">
                        <AlertTriangle size={18} className="fill-orange-100 dark:fill-transparent" />
                        <span>Moderate Risk present ({modCount} locations)</span>
                    </div>
                </div>
                <span className="text-[11px] font-black uppercase tracking-wider text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-950/60 px-2.5 py-1 rounded-md border border-orange-200 dark:border-orange-800">
                    Advisory
                </span>
            </div>
        );
    }

    return (
        <div className="w-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-3.5 flex items-center justify-between shadow-sm transition-all duration-300">
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-black text-sm">
                    <ShieldCheck size={18} />
                    <span>No high-risk zones in this data</span>
                </div>
            </div>
        </div>
    );
};

export default AlertBanner;
