import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getCredits } from '../../services/nowcastApi';

// "Data credits" footer of the ML pages: one line of source names that expands (on click) to every
// credit, each notice verbatim from its attribution file via the serving API (/credits); new sources are
// appended there, not here. Credits whose licence asks for them next to the data stay visible there too
// (map attribution: OpenStreetMap, Copernicus DEM, MOSDAC; team pages: OpenWeather / Open-Meteo lines).
const SHORT = {
    era5: 'ERA5', imerg: 'IMERG', gfs: 'GFS', imd: 'IMD', copernicus_dem: 'Copernicus DEM', insat_mosdac: 'INSAT/MOSDAC',
    nasa_gibs: 'NASA GIBS', osm: 'OpenStreetMap', osm_shelters: 'OpenStreetMap', openweather: 'OpenWeather', open_meteo: 'Open-Meteo',
};

const DataCredits = () => {
    const [credits, setCredits] = useState(null);
    const [error, setError] = useState(null);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        getCredits().then((r) => setCredits(r.credits.filter((c) => c.shown_on.includes('ml')))).catch((e) => setError(e.message));
    }, []);
    const names = credits ? [...new Set(credits.map((c) => SHORT[c.id] || c.label))] : [];
    return (
        <footer data-testid="data-credits" data-open={String(open)} id="data-credits"
            className="px-6 py-1 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 text-credits text-slate-600 dark:text-slate-400">
            <button type="button" data-testid="credits-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center gap-2 text-left min-w-0 hover:text-slate-900 dark:hover:text-white">
                <span className="font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0">Data credits:</span>
                <span data-testid="credits-names" className="truncate min-w-0">{error ? `unavailable (${error})` : names.join(', ')}</span>
                <span className="ml-auto shrink-0 font-bold underline inline-flex items-center gap-0.5">{open ? 'Hide' : 'All credits'}{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
            </button>
            {open && credits && (
                <div data-testid="credits-full" className="max-h-[40vh] overflow-y-auto pt-1 pb-1">
                    {credits.map((c, i) => (
                        <span key={c.id} data-testid={`credit-${c.id}`}>
                            {i > 0 && <span className="mx-1.5">·</span>}
                            <b className="text-slate-700 dark:text-slate-300">{c.label}</b>: {c.text}
                            {c.links.map((l) => (
                                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="ml-1.5 underline hover:text-slate-900 dark:hover:text-white">{l.label}</a>
                            ))}
                        </span>
                    ))}
                </div>
            )}
        </footer>
    );
};

export default DataCredits;
