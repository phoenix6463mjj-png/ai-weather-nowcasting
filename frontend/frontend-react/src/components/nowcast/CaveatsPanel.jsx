import { useEffect, useState } from 'react';
import { getCaveats } from '../../services/nowcastApi';

let cached = null;

// Model caveats (drawer section). Each item is backed by a verbatim quote from the project docs,
// shown under it with its source.
const CaveatsPanel = () => {
    const [caveats, setCaveats] = useState(cached);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (cached) return undefined;
        let live = true;
        getCaveats().then((r) => { cached = r.caveats; if (live) setCaveats(r.caveats); }).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, []);

    return (
        <div data-testid="caveats-panel" className="p-4 space-y-3">
            <p className="text-[11px] font-black uppercase tracking-wide text-amber-800 dark:text-amber-300">Read before using these forecasts</p>
            {error && <p className="text-xs text-red-700">Caveats unavailable: {error}</p>}
            {!caveats && !error && <p className="text-xs text-slate-500">Loading…</p>}
            <ul className="space-y-2.5">
                {(caveats || []).map((c) => (
                    <li key={c.id} data-testid="caveat" className="text-xs text-slate-800 dark:text-slate-200 leading-snug">
                        <p className="font-semibold">• {c.short}</p>
                        <p className="ml-3 mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">“{c.quote}” ({c.source})</p>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default CaveatsPanel;
