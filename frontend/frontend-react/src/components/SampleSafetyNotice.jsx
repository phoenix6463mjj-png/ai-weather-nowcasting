import React from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { SAMPLE_SAFETY_TEXT } from '../utils/dashboardRisk';

// Shown instead of every rule-based risk element (banner, pill, counts, primary threat, alert cards)
// when the backend has no weather feed and serves sample values.
const SampleSafetyNotice = ({ className = '' }) => (
    <div data-testid="sample-safety-net" role="status"
        className={`w-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-amber-900 dark:text-amber-200 ${className}`}>
        <span className="flex items-center gap-2 min-w-0">
            <Info size={16} className="shrink-0" />
            <span data-testid="sample-safety-text">{SAMPLE_SAFETY_TEXT}</span>
        </span>
        <Link to="/nowcast" data-testid="sample-safety-ml-link" className="font-bold text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap">
            Calibrated 1–6 h nowcasts: ML Nowcast →
        </Link>
    </div>
);

export default SampleSafetyNotice;
