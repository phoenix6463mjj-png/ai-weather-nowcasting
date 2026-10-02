import { useState } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';

const OPEN_MIN_WIDTH = 1600;     // open at >= 1600 px, collapsed below (the map keeps >= ~70 % uncovered)
const OPEN_MIN_HEIGHT = 900;

/**
 * The one compact, collapsible "Layers" panel (top-left of the map). Collapsed, it still shows a
 * one-line summary of the current selection. Its content stays mounted when collapsed (hidden),
 * it stays open until closed (a map click never closes it), and scrolls inside at most half the map height,
 * so the current state is always in the DOM. Open by default on large screens only.
 */
const LayersPanel = ({ summary, children }) => {
    const [open, setOpen] = useState(() => typeof window === 'undefined'
        || (window.innerWidth >= OPEN_MIN_WIDTH && window.innerHeight >= OPEN_MIN_HEIGHT));
    return (
        <div data-testid="layers-panel" data-open={open}
            className="pointer-events-auto max-h-[50%] flex flex-col bg-white/95 dark:bg-slate-800/95 backdrop-blur shadow-md rounded-xl border border-slate-200 dark:border-slate-700 w-[280px]">
            <button type="button" data-testid="layers-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left shrink-0">
                <Layers size={15} className="text-slate-500 shrink-0 mt-0.5" />
                <span className="min-w-0">
                    <span className="block text-xs font-black uppercase text-slate-700 dark:text-slate-200">Layers</span>
                    <span data-testid="layers-summary" className="block text-xs text-slate-500 dark:text-slate-400 leading-snug">{summary}</span>
                </span>
                <span className="ml-auto text-slate-500 mt-0.5">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
            </button>
            <div className={`${open ? '' : 'hidden'} overflow-y-auto px-3 pb-2 space-y-2 border-t border-slate-200 dark:border-slate-700 pt-1.5`}>
                {children}
            </div>
        </div>
    );
};

export default LayersPanel;
