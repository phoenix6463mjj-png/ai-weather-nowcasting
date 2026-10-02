import { useEffect, useRef } from 'react';
import { API_BASE } from '../config';

// With an OpenWeather key the backend fills the 380-zone list at most 50 calls a minute (60-min cache), so
// after a cold start of the host zones show Open-Meteo for a few minutes. While the list summary says
// `openweather_filling`, a page asks for the zones it shows to be fetched first (/zones/first) and
// re-polls every 30 s; the source badge always states the real per-source counts meanwhile.
export const FILL_POLL_MS = 30000;
const MAX_FIRST = 60;

export function askShownFirst(summary, names) {
    if (!summary?.openweather_filling) return;
    const list = [...new Set(names.filter(Boolean))].slice(0, MAX_FIRST);
    if (!list.length) return;
    fetch(`${API_BASE}/zones/first?names=${encodeURIComponent(list.join('|'))}`).catch(() => {});
}

// Re-poll `reload(true)` (a silent reload) 30 s after each load while the list is still filling.
export function useFillPoll(summary, reload) {
    const ref = useRef(reload);
    useEffect(() => { ref.current = reload; });
    useEffect(() => {
        if (!summary?.openweather_filling) return undefined;
        const t = setTimeout(() => ref.current(true), FILL_POLL_MS);
        return () => clearTimeout(t);
    }, [summary]);
}
