import { useEffect, useState } from 'react';
import { HAZARD_STYLE, LEVEL_STYLE, fmtIssueShort } from '../../utils/hazardLabels';
import IMDChip from './IMDChip';
import InsatTimelineRows from './InsatTimelineRows';

// width of the plot column (row minus the 215 px label and 190 px right columns)
function usePlotWidth() {
    const [el, setEl] = useState(null);
    const [w, setW] = useState(0);
    useEffect(() => {
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([e]) => setW(Math.max(0, e.contentRect.width - 215 - 190)));
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return [setEl, w];
}

// Warning timeline for one documented site. Alerts, nearby cells and the reported window come
// from the event-check API (not recomputed); ingredients and the IMERG site series from
// /episodes/{ep}/timeline. Times are UTC.

const H = 3600e3;
const ms = (iso) => new Date(iso).getTime();
const hh = (t) => `${String(new Date(t).getUTCHours()).padStart(2, '0')}Z`;
const signed = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);

const SOURCE_STYLE = {
    model: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    'model inputs': 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
    reports: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
    satellite: 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300',
    derived: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};
const Source = ({ s }) => (
    <span data-testid="tl-source" data-source={s} className={`px-1 rounded text-[9px] font-black uppercase ${SOURCE_STYLE[s]}`}>{s}</span>
);

const Row = ({ label, source, children, right, h = 'h-6', testid, wrap = false }) => (
    <div className="flex items-stretch" data-testid={testid}>
        <div className={`w-[215px] shrink-0 pr-2 flex items-center gap-1.5 text-slate-700 dark:text-slate-200 leading-tight ${wrap ? 'text-[9px]' : 'text-[10px] whitespace-nowrap'}`}>
            {source && <Source s={source} />}<span data-testid="tl-row-label" className={`min-w-0 ${wrap ? '' : 'truncate'}`}>{label}</span>
        </div>
        <div className={`relative flex-1 ${h}`}>{children}</div>
        <div className="w-[190px] shrink-0 pl-2 flex items-center gap-1 text-[9px] text-slate-600 dark:text-slate-300 whitespace-nowrap">{right}</div>
    </div>
);
const Note = ({ children, testid }) => (
    <p data-testid={testid} className="pl-[215px] pr-[190px] text-[9px] leading-snug">{children}</p>
);
const imergShort = (st) => (st === 'verified' ? 'IMERG verified' : st === 'false_alarm' ? 'IMERG false alarm' : 'IMERG n/a');
const laneRight = (a, kind) => (kind === 'alert'
    ? <><Source s="model" /> L{a.lead_time_h} · <b>{a.precision}</b> · {imergShort(a.imerg_verification?.status)}</>
    : <><Source s="model" /> L{a.lead_time_h} · {a.n_cells} cells, nearest {a.nearest_cell_km} km</>);

const WarningTimeline = ({ site, timeline, onJump }) => {
    const [rootRef, plotPx] = usePlotWidth();
    const win = site.source?.window_utc;
    if (!timeline || !win?.[0]) return null;
    const [w0, w1] = win.map(ms);
    const im = timeline.imerg;
    const q = site.qualifying || [];
    const near = site.nearby_cells?.items || [];
    const starts = [...q, ...near].map((a) => ms(a.issue_time));
    const ends = [w1, ms(im.peak.t), ...(im.onset_ge30 ? [ms(im.onset_ge30.t)] : [])];
    const t0 = Math.floor(Math.min(w0 - 6 * H, ...starts) / H) * H - H;
    const t1 = Math.ceil(Math.max(...ends) / H) * H + H;
    const x = (t) => `${((t - t0) / (t1 - t0)) * 100}%`;
    const hours = [];
    for (let t = t0; t <= t1; t += H) hours.push(t);
    const issues = timeline.issues.filter((i) => ms(i.issue_time) > t0 + H / 2 && ms(i.issue_time) < t1 - H / 2);
    const hidden = timeline.issues.length - issues.length;
    // spacing between consecutive issues with inputs, from the data (3 h Pipalkoti, 1 h Malana)
    const gaps = [...new Set(timeline.issues.filter((i) => i.change_since).map((i) => (ms(i.issue_time) - ms(i.change_since)) / H))];
    const ROWS = [
        ['tcwv_anom_mean', 'model inputs', 'TCWV anomaly (SD) · area mean (patch), not at the site'],
        ['tcwv_anom_change', 'derived', `Change in area-mean TCWV anomaly since previous issue (${gaps.join('/')} h) · derived, not a model feature`],
        ['cape_anom_mean', 'model inputs', 'CAPE anomaly (SD) · area mean (patch), not at the site'],
    ];
    const band = (
        <div className="absolute top-0 bottom-0 bg-violet-400/15 border-x border-violet-500/50 pointer-events-none"
            style={{ left: x(w0), width: `calc(${x(w1)} - ${x(w0)})` }} />
    );
    const cell = (i, key, fmt) => (
        <button key={i.ts} data-testid="tl-ingredient" data-ts={i.ts} data-field={key} data-forecast-only={i.forecast_only}
            onClick={() => onJump({ issue_time: i.issue_time })}
            title={i.forecast_only ? `forecast-only issue: ${i.note}` : `${timeline.ingredient_labels[key]} at issue ${fmtIssueShort(i.issue_time)} (ERA5 ${fmtIssueShort(i.era5_valid_time)})`}
            className={`absolute top-0.5 -translate-x-1/2 px-1 rounded text-[9px] tabular-nums font-semibold ${i.forecast_only
                ? 'bg-[repeating-linear-gradient(45deg,#e2e8f0_0_3px,#fff_3px_6px)] text-slate-500 border border-dashed border-slate-400'
                : i[key] == null ? 'text-slate-400' : i[key] > 0 ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}
            style={{ left: x(ms(i.issue_time)) }}>
            {i.forecast_only ? 'n/a' : fmt(i[key])}
        </button>
    );
    const lane = (a, kind) => {
        const ti = ms(a.issue_time);
        return (
            <button data-testid={kind === 'alert' ? 'tl-alert' : 'tl-nearby'} data-alert-id={a.alert_id} data-hours={a.hours_of_warning}
                data-x={((ti - t0) / (t1 - t0)) * 100} data-x-window={((w0 - t0) / (t1 - t0)) * 100}
                data-issue={a.issue_time} onClick={() => onJump(a)}
                className="absolute inset-0 w-full text-left hover:bg-slate-100/70 dark:hover:bg-slate-800/60 rounded"
                title={`issued ${fmtIssueShort(a.issue_time)} → valid ${fmtIssueShort(a.valid_time)} (L${a.lead_time_h}); click to open on the map`}>
                <span className={`absolute top-1/2 -translate-y-1/2 h-0.5 ${kind === 'alert' ? 'bg-slate-500' : 'bg-slate-400 border-t border-dashed'}`}
                    style={{ left: x(ti), width: `calc(${x(w0)} - ${x(ti)})` }} />
                <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow"
                    style={{ left: x(ti), background: kind === 'alert' ? HAZARD_STYLE[a.hazard].color : '#64748b' }} />
                <span className="absolute -top-0.5 text-[9px] font-black text-slate-800 dark:text-slate-100 -translate-x-1/2"
                    style={{ left: `calc((${x(ti)} + ${x(w0)}) / 2)` }}>{a.hours_of_warning} h</span>
            </button>
        );
    };

    return (
        <div ref={rootRef} data-testid="warning-timeline" data-t0={new Date(t0).toISOString()} data-t1={new Date(t1).toISOString()} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1">
            <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-black">Warning timeline: {site.site}</p>
                <p className="text-[9px] text-slate-500">times UTC (IST = UTC + 5:30) · click a marker to open it on the map</p>
            </div>
            <Row label={`${new Date(t0).toUTCString().slice(5, 11)} (UTC)`} h="h-4">
                {/* label every 2 h (readable in the narrower drawer), tick the hours between */}
                {hours.map((t) => (new Date(t).getUTCHours() % 2 === 0
                    ? <span key={t} className="absolute -translate-x-1/2 text-[9px] text-slate-400 tabular-nums" style={{ left: x(t) }}>{hh(t)}</span>
                    : <span key={t} className="absolute top-1 h-1.5 w-px bg-slate-300" style={{ left: x(t) }} />))}
            </Row>

            <Row label="Reported event window" source="reports" testid="tl-window"
                right={<span className="text-violet-800 dark:text-violet-300">{fmtIssueShort(win[0])}–{hh(w1).replace('Z', '')}:{String(new Date(w1).getUTCMinutes()).padStart(2, '0')}Z ({site.source.confidence})</span>}>
                {band}
                <span className="absolute inset-y-1 bg-violet-500/70 rounded" style={{ left: x(w0), width: `calc(${x(w1)} - ${x(w0)})` }} />
            </Row>
            {site.source.window_label && <Note testid="tl-window-label"><span className="text-violet-800 dark:text-violet-300">{site.source.window_label}</span></Note>}

            <Row label={`IMERG ≥30 mm/hr (${im.radius_km} km)`} source="satellite" testid="tl-imerg"
                right={<>peak {im.peak.max_mmhr} mm/hr</>}>
                {band}
                {im.onset_ge30 && (
                    <span data-testid="tl-imerg-onset" className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[9px] font-bold text-lime-800 whitespace-nowrap"
                        style={{ left: x(ms(im.onset_ge30.t)) }} title={`first half-hour frame ≥30 mm/hr: ${im.onset_ge30.t}`}>▲ onset {im.onset_ge30.max_mmhr}</span>
                )}
                <span data-testid="tl-imerg-peak" className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[9px] font-bold text-lime-800 whitespace-nowrap"
                    style={{ left: x(ms(im.peak.t)) }} title={`peak half-hour frame: ${im.peak.t}`}>◆ peak {im.peak.max_mmhr}</span>
            </Row>
            <p data-testid="tl-imerg-note" className="pl-[215px] pr-[190px] text-[9px] text-slate-600 dark:text-slate-300 leading-snug">
                {im.onset_ge30
                    ? `IMERG first reached 30 mm/hr at ${fmtIssueShort(im.onset_ge30.t)} (${im.onset_ge30.max_mmhr} mm/hr); peak ${im.peak.max_mmhr} mm/hr at ${fmtIssueShort(im.peak.t)} (${im.n_frames_ge30} half-hour frames ≥30).`
                    : `IMERG never reached 30 mm/hr within ${im.radius_km} km of the site (peak ${im.peak.max_mmhr} mm/hr at ${fmtIssueShort(im.peak.t)}).`}
            </p>

            {timeline.insat && (
                <InsatTimelineRows insat={timeline.insat} siteEpisode={site.site_episode} t0={t0} t1={t1} x={x}
                    plotPx={plotPx} Row={Row} band={band} />
            )}

            {ROWS.map(([k, src, lab]) => (
                <Row key={k} label={lab} source={src} testid={`tl-row-${k}`} h="h-9" wrap>
                    {band}
                    {issues.map((i) => cell(i, k, signed))}
                </Row>
            ))}
            <Note><span className="text-slate-500">Patch means at each issue (ERA5 at issue − 1 h), quoted from explain.json inputs; n/a = forecast-only issue (no explanation inputs).{hidden > 0 ? ` ${hidden} earlier/later issues are outside this time range.` : ''}</span></Note>

            <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[10px] font-bold mb-0.5">Early-warning alerts covering the site (issued before the window, valid during it)</p>
                {q.length === 0 && <p className="text-[10px] text-slate-500">None.</p>}
                {q.map((a) => (
                    <Row key={a.alert_id} h="h-6" right={laneRight(a, 'alert')} label={
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: HAZARD_STYLE[a.hazard].color }} />
                            {a.hazard_name}
                            <span className={`px-1 rounded text-[9px] font-bold ${LEVEL_STYLE[a.level]?.badge}`}>{a.level}</span>
                            <IMDChip level={a.level} />
                        </span>}>
                        {band}
                        {lane(a, 'alert')}
                    </Row>
                ))}
            </div>
            {near.length > 0 && (
                <div className="pt-1 border-t border-dashed border-slate-200 dark:border-slate-700">
                    <p className="text-[10px] font-bold mb-0.5">Separate criterion: {site.nearby_cells.criterion}</p>
                    {near.map((n) => (
                        <Row key={`${n.issue_time}-${n.lead_time_h}`} right={laneRight(n, 'nearby')} label={<span className="text-slate-500" title={n.note}>forecast-only issue (no explanation)</span>}>
                            {band}
                            {lane(n, 'nearby')}
                        </Row>
                    ))}
                </div>
            )}
        </div>
    );
};

export default WarningTimeline;
