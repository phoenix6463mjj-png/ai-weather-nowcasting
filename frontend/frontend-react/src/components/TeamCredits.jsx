import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { getCredits } from '../services/nowcastApi';

// Team pages' data credits: a small "Credits" button in the top bar opening a popover (Esc / × close).
// Entries are the /credits sources marked for the team pages (nowcast_data serve/assets/credits/SOURCES.json),
// each with its provider's wording and links. The required credits also stay next to the data itself
// (map attribution, Open-Meteo and place-search credits, photo credits).
const TeamCredits = () => {
    const [open, setOpen] = useState(false);
    const [credits, setCredits] = useState(null);
    const [error, setError] = useState(null);
    const box = useRef(null);
    const pop = useRef(null);
    const [pos, setPos] = useState(null);
    useEffect(() => {
        if (!open || credits) return;
        getCredits().then((r) => setCredits(r.credits.filter((c) => c.shown_on.includes('team'))))
            .catch((e) => setError(e.message));
    }, [open, credits]);
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        const onDown = (e) => {
            if (!box.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
    }, [open]);
    return (
        <div ref={box} className="relative">
            <button type="button" data-testid="team-credits-button" aria-expanded={open} onClick={() => {
                    const r = box.current.getBoundingClientRect();
                    setPos({ top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right - 12) });
                    setOpen((o) => !o);
                }}
                aria-label="Data credits" title="Data credits"
                className="shrink-0 whitespace-nowrap flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                <Info size={18} className="2xl:hidden" /><span className="hidden 2xl:inline">Credits</span>
            </button>
            {open && pos && createPortal(
                <div ref={pop} data-testid="team-credits" role="dialog" aria-label="Data credits" style={{ top: pos.top, right: pos.right }}
                    className="fixed z-[2000] w-[420px] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4 text-xs leading-snug text-slate-600 dark:text-slate-300">
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Data credits</span>
                        <button type="button" data-testid="team-credits-close" aria-label="Close" onClick={() => setOpen(false)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><X size={14} /></button>
                    </div>
                    {error && <p className="text-red-700">Credits unavailable ({error})</p>}
                    {!credits && !error && <p>Loading…</p>}
                    <ul className="space-y-2">
                        {credits?.map((c) => (
                            <li key={c.id} data-testid={`team-credit-${c.id}`}>
                                <b className="text-slate-800 dark:text-slate-100">{c.label}</b>: {c.text}
                                {c.links.map((l) => (
                                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="ml-1.5 underline hover:text-slate-900 dark:hover:text-white">{l.label}</a>
                                ))}
                            </li>
                        ))}
                    </ul>
                </div>,
                document.body,
            )}
        </div>
    );
};

export default TeamCredits;
