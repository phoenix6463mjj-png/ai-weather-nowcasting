// Small SVG donut (replaces a recharts Pie whose sector angles came out NaN under React 19, so it never
// drew and logged console errors). Same look: 55/80 px radii, 4° gaps, legend below, tooltip on hover.
const DonutChart = ({ data, unit = 'nodes', inner = 55, outer = 80, gapDeg = 4 }) => {
    const slices = data.filter((d) => Number.isFinite(d.value) && d.value > 0);
    const total = slices.reduce((s, d) => s + d.value, 0);
    const size = outer * 2 + 8;
    const c = size / 2;
    const pt = (r, deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        return [c + r * Math.cos(a), c + r * Math.sin(a)];
    };
    let start = 0;
    const gap = slices.length > 1 ? gapDeg : 0;
    const paths = total > 0 ? slices.map((d) => {
        const sweep = (d.value / total) * 360;
        const a0 = start + gap / 2;
        const a1 = start + Math.max(sweep - gap / 2, gap / 2 + 0.01);
        start += sweep;
        if (slices.length === 1) {                    // full ring: two half arcs
            return { d: `M ${c} ${c - outer} A ${outer} ${outer} 0 1 1 ${c} ${c + outer} A ${outer} ${outer} 0 1 1 ${c} ${c - outer} `
                + `M ${c} ${c - inner} A ${inner} ${inner} 0 1 0 ${c} ${c + inner} A ${inner} ${inner} 0 1 0 ${c} ${c - inner} Z`, ...d };
        }
        const large = a1 - a0 > 180 ? 1 : 0;
        const [x0, y0] = pt(outer, a0); const [x1, y1] = pt(outer, a1);
        const [x2, y2] = pt(inner, a1); const [x3, y3] = pt(inner, a0);
        return { d: `M ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`, ...d };
    }) : [];
    return (
        <div data-testid="donut-chart" className="flex flex-col items-center justify-center h-full">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
                aria-label={slices.map((d) => `${d.name}: ${d.value} ${unit}`).join(', ') || 'no data'}>
                {paths.map((p) => (
                    <path key={p.name} d={p.d} fill={p.color} fillRule="evenodd"><title>{`${p.name}: ${p.value} ${unit}`}</title></path>
                ))}
            </svg>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2.5 text-xs">
                {slices.map((d) => (
                    <span key={d.name} className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                        <span className="inline-block w-[9px] h-[9px]" style={{ background: d.color }} />{d.name}
                    </span>
                ))}
            </div>
        </div>
    );
};

export default DonutChart;
