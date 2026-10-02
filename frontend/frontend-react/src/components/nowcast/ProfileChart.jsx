// Terrain along the straight line from the chosen point to one building (API `profile`, serve/shelters.py):
// heights on the 9" DEM grid, river/stream crossings (blue), stretches inside a current alert (red; darker
// where an alert at the lead shown on the map covers it). Values only; not a route.
const W = 320;
const H = 92;
const PAD = { l: 4, r: 4, t: 12, b: 14 };

const fmtM = (m) => (m == null ? 'no data' : `${m.toLocaleString()} m`);

const ProfileChart = ({ p, lead }) => {
    const pts = p.km.map((k, i) => [k, p.elev_m[i]]).filter(([, e]) => e != null);
    if (pts.length < 2) return <p className="text-sm text-slate-500">Elevation profile: no DEM data along this line.</p>;
    const L = Math.max(p.length_km, 1e-6);
    const es = pts.map(([, e]) => e);
    let lo = Math.min(...es);
    let hi = Math.max(...es);
    if (hi - lo < 20) { lo -= 10; hi += 10; }
    const x = (k) => PAD.l + (k / L) * (W - PAD.l - PAD.r);
    const y = (e) => PAD.t + (1 - (e - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const line = pts.map(([k, e], i) => `${i ? 'L' : 'M'}${x(k).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts[pts.length - 1][0]).toFixed(1)},${H - PAD.b} L${x(pts[0][0]).toFixed(1)},${H - PAD.b} Z`;
    const half = p.spacing_m / 2000;
    const elevAt = (k) => {
        const i = Math.min(pts.length - 1, Math.max(0, Math.round((k / L) * (p.n - 1))));
        return p.elev_m[i] ?? es[0];
    };
    const start = p.elev_m[0];
    const end = p.elev_m[p.elev_m.length - 1];
    return (
        <figure data-testid="shelter-profile" data-n={p.n} data-crossings={p.crossings.length} data-stretches={p.alert_stretches.length} className="mt-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
                aria-label={`Elevation profile, ${p.length_km.toFixed(1)} km, from ${fmtM(start)} to ${fmtM(end)}`}>
                {p.alert_stretches.map((s) => (
                    <rect key={`${s.from_km}-${s.leads.join()}`} data-testid="profile-alert-stretch" data-current={String(s.leads.includes(lead))}
                        x={x(Math.max(0, s.from_km - half))} y={PAD.t - 8} height={H - PAD.b - PAD.t + 8}
                        width={Math.max(1, x(Math.min(L, s.to_km + half)) - x(Math.max(0, s.from_km - half)))}
                        fill={s.leads.includes(lead) ? '#fca5a5' : '#fee2e2'} opacity="0.9">
                        <title>{`Inside a current alert at +${s.leads.join(', +')} h (${s.from_km.toFixed(1)}–${s.to_km.toFixed(1)} km)`}</title>
                    </rect>
                ))}
                <path d={area} fill="#cbd5e1" opacity="0.55" />
                <path d={line} fill="none" stroke="#334155" strokeWidth="1.4" />
                {p.crossings.map((c, i) => (
                    <g key={`${c.km}-${i}`} data-testid="profile-crossing">
                        <line x1={x(c.km)} x2={x(c.km)} y1={PAD.t - 6} y2={H - PAD.b} stroke="#2563eb" strokeWidth="1" strokeDasharray="2 2" />
                        <circle cx={x(c.km)} cy={y(elevAt(c.km))} r="2.6" fill="#2563eb">
                            <title>{`${c.kind}${c.name ? `: ${c.name}` : ''} at ${c.km.toFixed(2)} km`}</title>
                        </circle>
                    </g>
                ))}
                <text data-testid="profile-start" x={PAD.l} y={9} fontSize="8.5" fontWeight="700" fill="#0f172a">{fmtM(start)}</text>
                <text data-testid="profile-end" x={W - PAD.r} y={9} fontSize="8.5" fontWeight="700" fill="#0f172a" textAnchor="end">{fmtM(end)}</text>
                <text x={PAD.l} y={H - 3} fontSize="8" fill="#64748b">point</text>
                <text x={W - PAD.r} y={H - 3} fontSize="8" fill="#64748b" textAnchor="end">{p.length_km.toFixed(1)} km · building</text>
            </svg>
            <figcaption className="text-sm leading-normal text-slate-500 dark:text-slate-400">
                Terrain every {p.spacing_m} m (9″ DEM grid).
                {p.crossings.length > 0 && <> <span className="text-blue-700 dark:text-blue-400 font-bold">Blue</span>: {p.crossings.length} river/stream crossing{p.crossings.length === 1 ? '' : 's'}.</>}
                {p.alert_stretches.length > 0 && <> <span className="text-red-700 dark:text-red-400 font-bold">Red</span>: inside a current alert (darker: at +{lead} h).</>}
                {' '}<span data-testid="profile-note" className="font-bold">{p.note}</span>
            </figcaption>
        </figure>
    );
};

export default ProfileChart;
