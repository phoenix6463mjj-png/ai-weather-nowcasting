import React, { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

// Small (i) button with a popover: click toggles it, Esc or a click outside closes it. The popover stays in
// the DOM while closed (hidden), so its full wording remains the page's text of record.
const PLACES = {
    'below-end': 'top-full right-0 mt-1.5',
    'below-start': 'top-full left-0 mt-1.5',
    'above-start': 'bottom-full left-0 mb-1.5',
};

const InfoTip = ({ label, testid, children, place = 'below-end', size = 15, className = '', panelClassName = '' }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const id = useId();
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDown);
        };
    }, [open]);
    return (
        <span ref={ref} className={`relative inline-flex shrink-0 ${className}`}>
            <button type="button" aria-label={label} aria-expanded={open} aria-controls={id} data-testid={`${testid}-button`}
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center justify-center rounded-full p-0.5 text-slate-500 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <Info size={size} />
            </button>
            <div id={id} role="note" hidden={!open} data-testid={testid}
                className={`absolute z-[1000] ${PLACES[place]} w-80 max-w-[80vw] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg px-3 py-2 text-left font-normal normal-case tracking-normal text-slate-700 dark:text-slate-200 ${panelClassName}`}>
                {children}
            </div>
        </span>
    );
};

export default InfoTip;
