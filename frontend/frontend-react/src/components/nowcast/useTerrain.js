import { useEffect, useState } from 'react';
import { getTerrain, terrainUrl } from '../../services/nowcastApi';

export const TERRAIN_ATTRIBUTION = 'Copernicus DEM GLO-90';
let cached = null;

// Terrain (DEM) hillshade for one view: toggle (on by default), opacity, and the layer to draw.
// layerId: an episode id (detailed 15" hillshade of that patch) or 'national'.
export default function useTerrain(layerId) {
    const [index, setIndex] = useState(cached);
    const [on, setOn] = useState(true);
    const [opacity, setOpacity] = useState(0.8);
    useEffect(() => {
        if (cached) return undefined;
        let live = true;
        getTerrain().then((t) => { cached = t; if (live) setIndex(t); }).catch(() => {});
        return () => { live = false; };
    }, []);
    const lay = index?.available && layerId ? index.layers[layerId] : null;
    return {
        available: !!lay, on, setOn, opacity, setOpacity,
        fullNotice: index?.attribution_full,
        layers: lay && on ? [{ id: layerId, url: terrainUrl(layerId), bounds: lay.bounds, opacity }] : [],
    };
}

// Map attribution whenever terrain is drawn: the full Copernicus DEM notice, verbatim from the attribution
// file (the same text as the Data credits), after the dataset name. HTML-escaped for Leaflet.
const escHtml = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const terrainAttribution = (notice) => `<span data-testid="terrain-attribution">Terrain (${TERRAIN_ATTRIBUTION}): ${escHtml(notice)}</span>`;
