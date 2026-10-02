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

// The copyright holders from the Copernicus DEM notice ("© DLR e.V. 2010-2014 and © Airbus Defence and Space
// GmbH 2014-2018"), shown in the map attribution next to the terrain layer (short on-screen form; the full
// notice is in the Data credits).
export const terrainHolders = (notice) => (String(notice || '').match(/© DLR.*?\d{4}-\d{4}.*?© .*?\d{4}-\d{4}/) || [''])[0];
