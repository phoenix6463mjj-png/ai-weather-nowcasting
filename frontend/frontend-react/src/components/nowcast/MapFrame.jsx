import { useState } from 'react';
import { Info } from 'lucide-react';

// Slim strip at the top of the map for the always-visible badges (split / in-sample /
// case study / forecast-only / Live "not validated"). Never inside the drawer.
export const MapBadges = ({ children, testid = 'map-badges',
    tone = 'border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a]' }) => (
    <div data-testid={testid}
        className={`px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0 ${tone}`}>
        {children}
    </div>
);

// One compact status line per view (badge, the must-see notice, actions) with a "Details" (i) button that
// expands the rest; the details stay in the DOM (hidden) so their text is still in the page.
export const StatusLine = ({ children, details, testid = 'map-badges',
    tone = 'border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a]' }) => {
    const [open, setOpen] = useState(false);
    return (
        <div data-testid={testid} data-details-open={String(open)} className={`px-4 py-1.5 shrink-0 ${tone}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                {children}
                {details && (
                    <button type="button" data-testid="status-info" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                        title={open ? 'Hide details' : 'Show details'}
                        className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-300 dark:border-slate-600 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <Info size={16} /> {open ? 'Less' : 'Details'}
                    </button>
                )}
            </div>
            {details && <div data-testid="status-details" hidden={!open} className="pt-1.5 text-sm leading-normal space-y-1">{details}</div>}
        </div>
    );
};
