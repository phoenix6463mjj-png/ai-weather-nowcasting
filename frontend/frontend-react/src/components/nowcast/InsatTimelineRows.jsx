import { useState } from 'react';

// INSAT-3DR rows of the warning timeline: site-patch 10th-percentile BT and its 30-min change per
// scan, placed at the acquisition time (an observation record: every scan, gaps marked). Values come
// from /episodes/{ep}/timeline -> insat (serve/build_insat_case.py). Observation only.

const M30 = 30 * 60e3;
const ms = (iso) => new Date(iso).getTime();
const hm = (iso) => iso.slice(11, 16);
const MIN_TEXT_PX = 15;

const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const classColour = (scale, v) => {
    const c = scale.classes.find((k) => k.color && (k.from == null || v >= k.from) && (k.to == null || v < k.to));
    return c ? c.color : null;
};

const InsatTimelineRows = ({ insat, siteEpisode, t0, t1, x, plotPx, Row, band }) => {
    const [table, setTable] = useState(false);
    const site = insat.sites.find((s) => s.site_episode === siteEpisode);
    if (!site) return null;
    const inRange = (iso) => ms(iso) >= t0 && ms(iso) + M30 <= t1;
    const series = site.series.filter((s) => inRange(s.slot));
    const gaps = insat.gaps.filter((g) => inRange(g.slot));
    const hidden = site.series.length - series.length;
    const cellPx = (plotPx * M30) / (t1 - t0);
    const text = cellPx >= MIN_TEXT_PX;
    const floorLabel = insat.colour_scale.classes[0].label;          // "≤180 K"
    const floorShort = floorLabel.replace(' K', '');
    const th = insat.thresholds[0];
    const w = `calc(${x(M30 + t0)} - ${x(t0)})`;

    const cell = (s, kind) => {
        const floor = s.p10_at_lut_floor;
        const v = kind === 'p10' ? s.p10_bt_k : s.d30_p10_k;
        let bg = 'rgba(148,163,184,0.18)';
        let fg = 'text-slate-700 dark:text-slate-200';
        let label;
        let title;
        if (kind === 'p10') {
            const c = v != null ? classColour(insat.colour_scale, v) : null;
            if (c) { bg = c; fg = luminance(c) < 0.45 ? 'text-white' : 'text-slate-900'; }
            label = floor ? floorShort : v != null ? String(Math.round(v)) : 'n/a';
            title = `${hm(s.acq_start)}–${hm(s.acq_end)}Z scan: patch 10th-percentile BT ${floor ? floorLabel : `${v} K`}; min ${s.min_bt_k} K${s.min_at_lut_floor ? ' (LUT floor)' : ''}`;
        } else {
            if (v == null) {
                bg = 'repeating-linear-gradient(45deg,rgba(148,163,184,0.35) 0 2px,transparent 2px 5px)';
                label = '–';
                title = `${hm(s.slot)}Z: no 30-min change (${s.change_note})`;
            } else {
                bg = v < 0 ? 'rgba(59,130,246,0.30)' : 'rgba(244,63,94,0.22)';
                label = `${v > 0 ? '+' : ''}${Math.round(v)}`;
                title = `${hm(s.slot)}Z: 30-min change of the patch 10th percentile ${v > 0 ? '+' : ''}${v} K (vs the previous INSAT-3DR scan)`;
            }
        }
        return (
            <span key={s.slot} data-testid={`insat-cell-${kind}`} data-slot={s.slot} data-value={v ?? ''} data-floor={floor}
                title={title}
                className={`absolute top-0.5 bottom-0.5 rounded-[2px] border border-white/60 dark:border-slate-900/60 flex items-center justify-center text-[7px] tracking-tighter font-bold tabular-nums overflow-hidden ${fg}`}
                style={{ left: x(ms(s.slot)), width: w, background: bg }}>
                {text ? label : ''}
            </span>
        );
    };
    const gapCell = (g) => (
        <span key={g.slot} data-testid="insat-gap" data-slot={g.slot} title={`${hm(g.slot)}Z: ${g.reason}`}
            className="absolute top-0.5 bottom-0.5 rounded-[2px] border border-dashed border-slate-400 flex items-center justify-center text-[8px] text-slate-500"
            style={{ left: x(ms(g.slot)), width: w, background: 'repeating-linear-gradient(-45deg,#e2e8f0 0 2px,transparent 2px 5px)' }}>
            {text ? 'gap' : ''}
        </span>
    );

    return (
        <div data-testid="insat-rows" className="pt-1 border-t border-slate-100 dark:border-slate-800 space-y-0.5">
            <Row label="INSAT-3DR via MOSDAC · 10th-percentile BT, 25 km patch (K)" source="satellite" testid="tl-insat-p10" h="h-6" wrap
                right={<>at scan time (UTC)</>}>
                {band}
                {series.map((s) => cell(s, 'p10'))}
                {gaps.map(gapCell)}
            </Row>
            <Row label="INSAT-3DR · 30-min change of that value (K)" source="satellite" testid="tl-insat-d30" h="h-6" wrap
                right={<>consecutive 3DR scans only</>}>
                {band}
                {series.map((s) => cell(s, 'd30'))}
                {gaps.map(gapCell)}
            </Row>
            <div data-testid="insat-notes" className="pl-[215px] pr-2 text-[9px] leading-snug space-y-0.5 text-slate-600 dark:text-slate-300">
                {insat.lines.map((l) => <p key={l} data-testid="insat-line" className="text-amber-700 dark:text-amber-400">{l}</p>)}
                <p>
                    Every downloaded scan of {site.site} at its acquisition time.
                    {gaps.length > 0 && ` Hatched = no file (${gaps.map((g) => `${hm(g.slot)}Z`).join(', ')}); no change across a gap.`}
                    {hidden > 0 && ` ${hidden} scans outside this time range are not drawn.`}
                </p>
                <p data-testid="insat-floor-line">{insat.floor_line}</p>
                {th ? (
                    <p data-testid="insat-threshold">
                        Reference: {th.label} — &ldquo;{th.quote}&rdquo; ({th.short_citation}).
                    </p>
                ) : <p data-testid="insat-threshold-note">{insat.threshold_note}</p>}
                <button type="button" data-testid="insat-table-toggle" onClick={() => setTable((o) => !o)}
                    className="underline text-slate-700 dark:text-slate-200">{table ? 'Hide' : 'Show'} INSAT values per scan ({site.series.length}) and method</button>
                {table && (<>
                    <div data-testid="insat-method" className="text-slate-500 dark:text-slate-400 space-y-0.5">
                        <p>BT: {insat.bt_method}.</p>
                        <p>Min: {insat.patch.stats.min_bt_k}. 10th percentile: {insat.patch.stats.p10_bt_k}. Change: {insat.patch.stats.d30_p10_k}.</p>
                        <p>{insat.lut_floor}</p>
                        <p>{insat.scan_note}</p>
                        {th && <p>Reference source: {th.citation} {th.context}</p>}
                    </div>
                    <p data-testid="insat-table-floor-line" className="text-slate-600 dark:text-slate-300">{insat.floor_line}</p>
                    <table data-testid="insat-table" className="w-full text-[9px] tabular-nums">
                        <thead><tr className="text-left text-slate-500"><th>scan (UTC)</th><th>10th pct (K)</th><th>min (K)</th><th>30-min change (K)</th><th>pixels</th></tr></thead>
                        <tbody>
                            {site.series.map((s) => (
                                <tr key={s.slot} data-testid="insat-table-row" data-slot={s.slot}>
                                    <td>{hm(s.acq_start)}–{hm(s.acq_end)}</td>
                                    <td>{s.p10_at_lut_floor ? floorLabel : s.p10_bt_k}</td>
                                    <td>{s.min_at_lut_floor ? floorLabel : s.min_bt_k}</td>
                                    <td>{s.d30_p10_k ?? <span className="text-slate-400">— {s.change_note}</span>}</td>
                                    <td>{s.n_px}{s.n_px_at_lut_floor ? ` (${s.n_px_at_lut_floor} at floor)` : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>)}
            </div>
        </div>
    );
};

export default InsatTimelineRows;
