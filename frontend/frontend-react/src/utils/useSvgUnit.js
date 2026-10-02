import { useLayoutEffect, useRef, useState } from 'react';

// SVG charts scale with their container, so a fixed fontSize renders smaller on narrow screens. This
// returns a ref for the <svg> and k = SVG user units per CSS pixel: text drawn with fontSize={15 * k}
// renders at 15 px (the site's smallest text size) at any width.
export function useSvgUnit(viewBoxWidth) {
    const ref = useRef(null);
    const [k, setK] = useState(1);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = () => {
            const cw = el.getBoundingClientRect().width;
            if (cw > 0) setK(viewBoxWidth / cw);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [viewBoxWidth]);
    return [ref, k];
}

export const SVG_TEXT_PX = 15;
