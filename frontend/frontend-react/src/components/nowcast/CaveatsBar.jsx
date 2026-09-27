import { useEffect, useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { getCaveats } from '../../services/nowcastApi';

// Always-visible model caveats; each item is backed by a verbatim quote from the project docs.
const CaveatsBar = () => {
    const [caveats, setCaveats] = useState([]);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        getCaveats().then((r) => setCaveats(r.caveats)).catch((e) => setError(e.message));
    }, []);

    const shown = open ? caveats : caveats.slice(0, 5);
    return (
        <div className="border-t border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-6 py-2.5 shrink-0">
            <div className="flex items-start gap-3">
                <Info size={16} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-wide text-amber-800 dark:text-amber-300 mb-1">
                        Read before using these forecasts
                    </p>
                    {error && <p className="text-xs text-red-700">Caveats unavailable: {error}</p>}
                    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0.5">
                        {shown.map((c) => (
                            <li key={c.id} className="text-xs text-slate-700 dark:text-slate-300 leading-snug"
                                title={`"${c.quote}" — ${c.source}`}>
                                • {c.short}
                            </li>
                        ))}
                    </ul>
                </div>
                {caveats.length > 5 && (
                    <button onClick={() => setOpen((o) => !o)}
                        className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1 shrink-0 hover:underline">
                        {open ? <>Less <ChevronUp size={14} /></> : <>All {caveats.length} <ChevronDown size={14} /></>}
                    </button>
                )}
            </div>
        </div>
    );
};

export default CaveatsBar;
