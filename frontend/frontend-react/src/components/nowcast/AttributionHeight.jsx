import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// The attribution control can wrap to several lines (it carries the full Copernicus DEM notice): its height is
// published as --attr-h on the closest [data-map-host] element (else the map's parent), so the panels anchored
// at the bottom of the map stay above it (utils/mapLayout.js).
const AttributionHeight = () => {
    const map = useMap();
    useEffect(() => {
        const box = map.getContainer();
        const el = box.querySelector('.leaflet-control-attribution');
        const host = box.closest('[data-map-host]') || box.parentElement;
        if (!el || !host) return undefined;
        const set = () => host.style.setProperty('--attr-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
        set();
        const ro = new ResizeObserver(set);
        ro.observe(el);
        return () => ro.disconnect();
    }, [map]);
    return null;
};

export default AttributionHeight;
