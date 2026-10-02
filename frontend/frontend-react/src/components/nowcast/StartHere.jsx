import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, ArrowRight, Compass } from 'lucide-react';

// "Start here" (judge-first pass): shown on the first open of /nowcast, dismissible, reopened from the
// header's "Start here" button. Findings come from /api/start-here (every number read from docs/ or
// models/v0 by the ML API).
const StartHere = ({ data, error, onClose, onGo }) => {
    useEffect(() => {
        // capture phase: Esc closes this panel only, not the details drawer as well
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    return (
        <section data-testid="start-here" role="dialog" aria-label="Start here"
            className="pointer-events-auto w-[min(580px,100%)] max-h-full overflow-y-auto bg-white/97 dark:bg-slate-900/97 backdrop-blur shadow-xl rounded-xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
            <header className="flex items-center gap-2 px-4 pt-2.5 pb-0.5">
                <Compass size={18} className="text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-black">Start here: what this nowcast shows</h3>
                <button type="button" data-testid="start-here-close" onClick={onClose} title="Close (Esc)" aria-label="Close Start here"
                    className="ml-auto p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
                    <X size={18} />
                </button>
            </header>
            {error && <p className="px-4 pb-3 text-sm text-red-600">Could not load the findings: {error}</p>}
            {!data && !error && <p className="px-4 pb-3 text-sm text-slate-500">Loading…</p>}
            {data && (
                <ol className="px-4">
                    {data.findings.map((f) => (
                        <li key={f.id} data-testid={`finding-${f.id}`} className="py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0 text-base leading-normal">
                            {f.case_study && (
                                <span data-testid="finding-case-study" className="mr-1.5 align-[1px] text-xs font-black uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100">case study</span>
                            )}
                            {f.text}{' '}
                            <button type="button" data-testid={`finding-go-${f.id}`} onClick={() => onGo(f)}
                                className="inline-flex items-center gap-0.5 font-bold text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
                                {f.button} <ArrowRight size={14} />
                            </button>
                        </li>
                    ))}
                </ol>
            )}
            {data && <p data-testid="start-here-note" className="px-4 pt-1 text-sm text-slate-500 dark:text-slate-400">{data.case_study_note.quote.replace(/\n/g, ' ')}</p>}
            <p className="px-4 pt-1 pb-2.5">
                <Link to="/" data-testid="start-here-overview" className="inline-flex items-center gap-1 font-bold text-blue-700 dark:text-blue-300 hover:underline">
                    See the overview (a 1-minute visual briefing) <ArrowRight size={16} />
                </Link>
            </p>
        </section>
    );
};

export default StartHere;
