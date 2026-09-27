import { useEffect, useState } from 'react';
import { getCredits } from '../../services/nowcastApi';

// Always-visible "Data credits" footer. Entries come from the serving API (/credits), each
// notice verbatim from its attribution file; new sources are appended there, not here.
const DataCredits = () => {
    const [credits, setCredits] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        getCredits().then((r) => setCredits(r.credits)).catch((e) => setError(e.message));
    }, []);
    return (
        <footer data-testid="data-credits"
            className="px-6 py-1.5 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 text-[10px] leading-snug text-slate-600 dark:text-slate-400">
            <span className="font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-2">Data credits</span>
            {error && <span className="text-red-700">unavailable ({error})</span>}
            {credits?.map((c, i) => (
                <span key={c.id} data-testid={`credit-${c.id}`}>
                    {i > 0 && <span className="mx-1.5">·</span>}
                    <b className="text-slate-700 dark:text-slate-300">{c.label}</b>: {c.text}
                    {c.links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="ml-1.5 underline hover:text-slate-900 dark:hover:text-white">{l.label}</a>
                    ))}
                </span>
            ))}
        </footer>
    );
};

export default DataCredits;
