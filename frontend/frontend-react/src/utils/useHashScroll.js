import { useEffect } from 'react';

// Results / Approach: a link from "Start here" (/nowcast/results#csi-section) scrolls to that section once
// the page's data has loaded. The hash names an element id or a data-testid.
export default function useHashScroll(ready) {
    useEffect(() => {
        if (!ready) return;
        const id = decodeURIComponent(window.location.hash.slice(1));
        if (!id) return;
        const el = document.getElementById(id) || document.querySelector(`[data-testid="${CSS.escape(id)}"]`);
        if (!el) return;
        el.scrollIntoView({ block: 'start' });
        el.setAttribute('data-target', 'true');                 // brief highlight (index.css)
    }, [ready]);
}
