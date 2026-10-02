import { useState } from 'react';
import { Clock } from 'lucide-react';
import { fmtIssueShort } from '../../utils/hazardLabels';

const hours = (min) => `${(min / 60).toFixed(1)} h`;

const Item = ({ testid, label, children }) => (
    <span data-testid={testid} className="whitespace-nowrap">
        <span className="text-slate-500 dark:text-slate-400">{label}</span> <b>{children}</b>
    </span>
);

// Live tab "Data freshness": every value is read from the API (the run manifest's input latencies, the INSAT
// frames' ages, docs/latency_benchmark.json) or computed from timestamps. No thresholds, no good/bad colours.
const FreshnessStrip = ({ meta, insat, compute }) => {
    const [now] = useState(() => Date.now());             // page-open time (the run is frozen, not refreshing)
    if (!meta) return null;
    const runAgeMin = (now - new Date(meta.issue_time).getTime()) / 60000;
    return (
        <div data-testid="freshness-strip" className="px-4 py-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <span className="flex items-center gap-1 font-black uppercase text-xs text-slate-600 dark:text-slate-300"><Clock size={13} /> Data freshness</span>
            <Item testid="fresh-run" label="Run issued">{fmtIssueShort(meta.issue_time)} ({hours(Math.max(0, runAgeMin))} ago)</Item>
            <Item testid="fresh-imerg" label="Rain input (IMERG Early) at issue:">{hours(meta.latency_min.imerg)} old</Item>
            <Item testid="fresh-gfs" label="Environment (GFS) at issue:">{hours(meta.latency_min.gfs)} old</Item>
            {(insat?.by_satellite || []).map((s) => (
                <Item key={s.satellite} testid={`fresh-insat-${s.satellite}`} label={`${s.satellite} newest frame:`}>
                    {s.newest ? `${fmtIssueShort(s.acq_start)}, ${s.text.split(', ').pop()}` : s.text.split(': ').pop()}
                </Item>
            ))}
            {compute && (
                <Item testid="fresh-compute" label="Compute:">{Math.round(compute.pipeline_seconds.median)} s per all-India run (measured, laptop CPU)</Item>
            )}
        </div>
    );
};

export default FreshnessStrip;
