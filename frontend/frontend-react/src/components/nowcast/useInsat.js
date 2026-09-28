import { useEffect, useState } from 'react';
import { getInsatIndex, getInsat, getIssueInsat, insatUrl } from '../../services/nowcastApi';

let indexCache = null;
const infoCache = {};

// INSAT-3DR cloud-top temperature layer for one replay issue: toggle (off by default), opacity, and
// the one image allowed at the issue time (the API applies the availability rule). Satellite
// observation (INSAT via MOSDAC); it is not a model input.
export default function useInsat(ep, ts) {
    const [index, setIndex] = useState(indexCache);
    const [, setInfoLoaded] = useState(0);
    const [atIssue, setAtIssue] = useState(null);
    const [on, setOn] = useState(false);
    const [opacity, setOpacity] = useState(0.75);

    useEffect(() => {
        if (indexCache) return undefined;
        let live = true;
        getInsatIndex().then((r) => { indexCache = r; if (live) setIndex(r); }).catch(() => {});
        return () => { live = false; };
    }, []);

    const available = !!(ep && index?.episodes.includes(ep));

    useEffect(() => {
        if (!available || infoCache[ep]) return undefined;
        let live = true;
        getInsat(ep).then((r) => { infoCache[ep] = r; if (live) setInfoLoaded((n) => n + 1); }).catch(() => {});
        return () => { live = false; };
    }, [ep, available]);

    useEffect(() => {
        if (!available || !ts) return undefined;
        let live = true;
        getIssueInsat(ep, ts).then((r) => live && setAtIssue(r)).catch(() => live && setAtIssue(null));
        return () => { live = false; };
    }, [ep, ts, available]);

    const cur = atIssue && atIssue.episode === ep && atIssue.ts === ts ? atIssue : null;
    const epInfo = available ? infoCache[ep] || null : null;
    return {
        available, indexLoaded: !!index, on, setOn, opacity, setOpacity, info: epInfo, atIssue: cur,
        overlay: available && on && cur?.available
            ? { url: insatUrl(ep, cur.id), opacity, zIndex: 0, kind: 'insat' } : null,
    };
}
