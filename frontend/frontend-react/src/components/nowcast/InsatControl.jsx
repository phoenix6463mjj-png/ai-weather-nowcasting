// INSAT-3DR cloud-top temperature toggle for the Layers panel (off by default). Observation only:
// the image is the one usable at the issue time (the API applies acquisition end + latency <= issue).
const InsatControl = ({ insat }) => {
    if (!insat.indexLoaded) return null;
    if (!insat.available) {
        return (
            <p data-testid="insat-unavailable" className="text-[10px] text-slate-400 border-t border-slate-200 dark:border-slate-700 pt-2">
                INSAT-3DR cloud-top temperature: not available for this event (no case files downloaded).
            </p>
        );
    }
    const a = insat.atIssue;
    return (
        <div data-testid="insat-control" className="border-t border-slate-200 dark:border-slate-700 pt-2">
            <label className="flex items-start gap-2 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer">
                <input type="checkbox" className="mt-0.5" data-testid="insat-toggle" checked={insat.on} onChange={(e) => insat.setOn(e.target.checked)} />
                <span>INSAT-3DR cloud-top temperature (observation)</span>
            </label>
            {insat.on && (
                <>
                    <label className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                        opacity
                        <input type="range" data-testid="insat-opacity" min="0.1" max="1" step="0.05" value={insat.opacity}
                            onChange={(e) => insat.setOpacity(Number(e.target.value))} className="flex-1 accent-slate-600" />
                    </label>
                    {a && (
                        <p data-testid="insat-availability" data-available={a.available} data-slot={a.slot || ''}
                            className={`mt-1 text-[10px] leading-snug ${a.available ? 'text-slate-600 dark:text-slate-300' : 'text-amber-700 dark:text-amber-400'}`}
                            title={a.available ? `scan ${a.acq_start} – ${a.acq_end}; usable from ${a.available_at} (${insat.info?.availability_rule || ''})` : undefined}>
                            {a.label}
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

export default InsatControl;
