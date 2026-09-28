// Small deterministic SVG line plot (numeric x and y). Used on the Results page instead of
// recharts 2.8, whose axes/scales do not render correctly under React 19.
const SvgPlot = ({ w = 400, h = 190, xDomain, yDomain, xTicks, yTicks, xFmt = (v) => v, yFmt = (v) => v,
    series, diagonal = false, xLabel, yLabel, testid }) => {
    const m = { l: yLabel ? 46 : 38, r: 10, t: 8, b: xLabel ? 34 : 22 };
    const X = (v) => m.l + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * (w - m.l - m.r);
    const Y = (v) => h - m.b - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * (h - m.t - m.b);
    return (
        <svg data-testid={testid} viewBox={`0 0 ${w} ${h}`} className="w-full h-auto font-sans">
            {yTicks.map((t) => (
                <g key={`y${t}`}>
                    <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <text x={m.l - 4} y={Y(t) + 3} fontSize="10" textAnchor="end" fill="#64748b">{yFmt(t)}</text>
                </g>
            ))}
            {xTicks.map((t) => (
                <text key={`x${t}`} x={X(t)} y={h - m.b + 13} fontSize="10" textAnchor="middle" fill="#64748b">{xFmt(t)}</text>
            ))}
            <line x1={m.l} x2={w - m.r} y1={Y(yDomain[0])} y2={Y(yDomain[0])} stroke="#94a3b8" />
            <line x1={m.l} x2={m.l} y1={m.t} y2={Y(yDomain[0])} stroke="#94a3b8" />
            {xLabel && <text x={(m.l + w - m.r) / 2} y={h - 4} fontSize="10" textAnchor="middle" fill="#475569">{xLabel}</text>}
            {yLabel && <text x={11} y={(m.t + h - m.b) / 2} fontSize="10" textAnchor="middle" fill="#475569"
                transform={`rotate(-90 11 ${(m.t + h - m.b) / 2})`}>{yLabel}</text>}
            {diagonal && <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#94a3b8" strokeDasharray="4 4" />}
            {series.map((s) => (
                <g key={s.key} data-series={s.key}>
                    <polyline fill="none" stroke={s.color} strokeWidth={s.width || 1.8}
                        points={s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} />
                    {s.points.map((p) => {
                        const d = (s.dot && s.dot(p)) || { r: 2.5, fill: s.color };
                        return (
                            <circle key={p.x} data-testid={d.testid} data-x={p.x} data-y={p.y} cx={X(p.x)} cy={Y(p.y)} r={d.r}
                                fill={d.fill} stroke={d.stroke} strokeWidth={d.sw}>
                                <title>{`${s.key}: ${p.label ?? p.y}`}</title>
                            </circle>
                        );
                    })}
                </g>
            ))}
        </svg>
    );
};

export default SvgPlot;
