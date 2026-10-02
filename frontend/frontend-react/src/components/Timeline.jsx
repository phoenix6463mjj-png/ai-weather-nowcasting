import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ArrowRight } from 'lucide-react';
import { getIndiaMeta } from '../services/nowcastApi';

// The Dashboard has no per-lead forecast. This card points to the ML Nowcast page, which does; the
// lead list is read from the ML API (india/meta leads_available), not typed in here.
const Timeline = () => {
    const [leads, setLeads] = useState(null);
    useEffect(() => {
        let live = true;
        getIndiaMeta().then((m) => live && setLeads(m.leads_available)).catch(() => {});
        return () => { live = false; };
    }, []);

    return (
        <Link to="/nowcast" data-testid="dashboard-timeline-card"
            className="h-full bg-white dark:bg-[#111827] rounded-2xl shadow-lg border border-slate-200 dark:border-gray-700 p-5 flex items-center justify-between gap-4 hover:border-blue-400 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="text-blue-600 shrink-0" />
                <div className="min-w-0">
                    <h3 data-testid="dashboard-timeline-text" className="text-sm font-black text-slate-800 dark:text-white">
                        Per-lead forecasts{leads?.length ? ` (${leads.join(', ')} h)` : ''} → ML Nowcast
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        This page has no per-lead forecast; the calibrated lead-time maps are on the ML Nowcast page.
                    </p>
                </div>
            </div>
            <ArrowRight size={20} className="text-blue-600 shrink-0" />
        </Link>
    );
};

export default Timeline;
