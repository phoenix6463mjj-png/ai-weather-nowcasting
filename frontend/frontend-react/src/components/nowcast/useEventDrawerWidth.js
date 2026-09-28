import { useEffect, useState } from 'react';

// The event-check section holds the timeline, so it is wider; it still leaves room for the map
// and its controls (Layers panel + zoom) on small screens.
export default function useEventDrawerWidth() {
    const calc = () => (typeof window === 'undefined' ? 900 : Math.max(560, Math.min(900, window.innerWidth - 700)));
    const [w, setW] = useState(calc);
    useEffect(() => {
        const on = () => setW(calc());
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return w;
}
