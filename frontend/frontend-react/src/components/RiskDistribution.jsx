import React from 'react';
import { Link } from 'react-router-dom';

const RiskDistribution = ({ locations = [], allCitiesData = [], summary = null, unrated = 0 }) => {
    let high = 0, medium = 0, low = 0, total = 0;

    if (summary != null) {
        // Backend Single Source of Truth
        high = summary.high ?? 0;
        medium = summary.moderate ?? 0;
        low = summary.low ?? 0;
        // rated zones only (sample-data zones carry no level)
        total = summary.n_rated ?? summary.total ?? (high + medium + low);
    } else {
        const list = locations.length > 0 ? locations : allCitiesData;
        list.forEach(city => {
            const risk = (city.risk_level || city.risk || city.prediction?.risk_text || "LOW").toUpperCase();
            if (risk === "HIGH") {
                high++;
            } else if (risk === "MODERATE") {
                medium++;
            } else {
                low++;
            }
        });
        total = high + medium + low;
    }

    return (
        <div className="h-full bg-white dark:bg-[#111827] rounded-2xl shadow-lg border border-slate-200 dark:border-gray-700 p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800 dark:text-white">Risk Distribution <span className="text-slate-400 font-bold text-xs ml-1">({total} Zones)</span>
                    {unrated > 0 && <span data-testid="risk-unrated" className="block text-xs font-semibold text-amber-700 dark:text-amber-400">+{unrated} with sample data (risk not shown)</span>}
                </h3>
                <Link to="/alerts" data-testid="risk-view-details" className="text-blue-600 dark:text-blue-400 text-xs font-black hover:underline tracking-wide">View Details ➔</Link>
            </div>

            <div className="flex items-center justify-between gap-2.5 mt-2">
                <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-2.5 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shadow-sm shadow-blue-500/50"></div>
                        <span className="text-xl font-black text-slate-800 dark:text-white leading-none">{total}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Total</span>
                </div>

                <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-2.5 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-600 shadow-sm shadow-red-500/50"></div>
                        <span className="text-xl font-black text-slate-800 dark:text-white leading-none">{high}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">High</span>
                </div>

                <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-2.5 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50"></div>
                        <span className="text-xl font-black text-slate-800 dark:text-white leading-none">{medium}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Moderate</span>
                </div>

                <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-2.5 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-teal-500 shadow-sm shadow-teal-500/50"></div>
                        <span className="text-xl font-black text-slate-800 dark:text-white leading-none">{low}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Low</span>
                </div>
            </div>
        </div>
    );
};

export default RiskDistribution;
