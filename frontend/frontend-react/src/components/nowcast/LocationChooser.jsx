import { useState } from 'react';
import { Crosshair, LocateFixed, MapPin, Search } from 'lucide-react';
import { geocode, SupersededError } from '../../utils/nominatim';
import { loadIndiaLocationsCSV } from '../../services/api';
import NominatimCredit from '../NominatimCredit';

// Shelter options: the ways to choose a location. Every chosen location is used only to compute distances:
// it is kept in this page's memory (never in storage), and the access logs hide the coordinates
// (serve/privacy.py, backend/main.py). "Use my location" asks the browser only when clicked.
const EXAMPLE = 'Kullu';                        // the example location, read from public/india_locations.csv

const GEO_ERRORS = {
    1: 'Location permission was not given. Choose a place another way.',
    2: 'Your location could not be found. Choose a place another way.',
    3: 'Finding your location took too long. Try again or choose a place another way.',
};

const LocationChooser = ({ onChoose, selected, onUseAlert }) => {
    const [q, setQ] = useState('');
    const [busy, setBusy] = useState(null);       // 'search' | 'geo' | 'example'
    const [msg, setMsg] = useState(null);

    const search = async (e) => {
        e.preventDefault();
        if (!q.trim()) return;
        setBusy('search');
        setMsg(null);
        try {
            const r = await geocode(q);
            if (!r?.length) setMsg(`No place found for "${q.trim()}".`);
            else onChoose({ lat: Number(r[0].lat), lon: Number(r[0].lon), source: 'search', text: r[0].display_name });
        } catch (err) {
            if (!(err instanceof SupersededError)) setMsg(err.message || 'Place search failed.');
        } finally {
            setBusy(null);
        }
    };

    const locate = () => {
        setMsg(null);
        if (!navigator.geolocation) { setMsg('This browser cannot share a location. Choose a place another way.'); return; }
        setBusy('geo');
        navigator.geolocation.getCurrentPosition(
            (p) => { setBusy(null); onChoose({ lat: p.coords.latitude, lon: p.coords.longitude, source: 'geo' }); },
            (err) => { setBusy(null); setMsg(GEO_ERRORS[err.code] || GEO_ERRORS[2]); },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
        );
    };

    const example = async () => {
        setMsg(null);
        setBusy('example');
        try {
            const k = (await loadIndiaLocationsCSV()).find((l) => l.city === EXAMPLE);
            if (k) onChoose({ lat: k.lat, lon: k.lon, source: 'example', text: EXAMPLE });
            else setMsg('The example location is not available.');
        } catch {
            setMsg('The example location is not available.');
        } finally {
            setBusy(null);
        }
    };

    const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50';
    return (
        <div data-testid="location-chooser" className="space-y-2">
            <form onSubmit={search} className="flex gap-2">
                <label className="sr-only" htmlFor="shelter-search">Search a place</label>
                <input id="shelter-search" data-testid="shelter-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place (e.g. Manali)"
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-base" />
                <button type="submit" data-testid="shelter-search-go" disabled={busy === 'search' || !q.trim()} className={btn}>
                    <Search size={14} /> {busy === 'search' ? 'Searching…' : 'Find'}
                </button>
            </form>
            <NominatimCredit />
            <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="shelter-geolocate" onClick={locate} disabled={busy === 'geo'} className={btn}>
                    <LocateFixed size={14} /> {busy === 'geo' ? 'Finding you…' : 'Use my location'}
                </button>
                <button type="button" data-testid="shelter-example" onClick={example} disabled={busy === 'example'} className={btn}>
                    <MapPin size={14} /> Try an example location: {EXAMPLE}
                </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
                <Crosshair size={14} className="inline -mt-0.5 mr-1" />Or click the map{selected ? ', or ' : '.'}
                {selected?.peak_cell && (
                    <button type="button" data-testid="shelter-use-alert" onClick={onUseAlert} className="font-bold text-blue-700 dark:text-blue-400 hover:underline">
                        use the selected alert&apos;s peak
                    </button>
                )}
            </p>
            <p data-testid="shelter-privacy" className="text-sm text-slate-500 dark:text-slate-400">
                &ldquo;Use my location&rdquo; asks your browser only when clicked; the location is used only to compute distances, never stored or logged.
            </p>
            {msg && <p data-testid="shelter-location-msg" role="status" className="text-sm font-bold text-amber-800 dark:text-amber-300">{msg}</p>}
        </div>
    );
};

export default LocationChooser;
