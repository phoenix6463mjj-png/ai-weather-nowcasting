// Live tab: INSAT cloud-top layer toggle for the Layers panel (off by default). Satellite observation
// (INSAT via MOSDAC), not a model input. Every value is the API's (/live-insat, serve/insat_live.py): the
// frame's satellite, scan time and measured latency; on the host a snapshot label.
export const LIVE_INSAT_LABEL = 'INSAT cloud tops (satellite observation, INSAT via MOSDAC)';

const hhmm = (iso) => `${iso.slice(11, 16)}Z`;
const short = (f) => `${f.satellite.replace('INSAT-', '')} ${hhmm(f.acq_start)}`;

const LiveInsatControl = ({ layer, on, setOn, frameId, setFrameId, opacity, setOpacity }) => {
    if (!layer) return null;
    const frame = layer.frames.find((f) => f.id === frameId) || layer.latest;
    return (
        <div data-testid="live-insat-control" className="border-t border-slate-200 dark:border-slate-700 pt-2">
            <label className={`flex items-start gap-2 text-xs font-bold ${layer.available ? 'text-slate-800 dark:text-slate-100 cursor-pointer' : 'text-slate-400'}`}>
                <input type="checkbox" className="mt-0.5" data-testid="live-insat-toggle" checked={on && layer.available}
                    disabled={!layer.available} onChange={(e) => setOn(e.target.checked)} />
                <span>{LIVE_INSAT_LABEL}</span>
            </label>
            {!layer.available && <p data-testid="live-insat-unavailable" className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{layer.note}</p>}
            {(layer.by_satellite || []).length > 0 && (
                <ul data-testid="live-insat-by-satellite" className="mt-1 space-y-0.5 text-[10px] leading-snug text-slate-700 dark:text-slate-200"
                    title={layer.age_note || ''}>
                    {layer.by_satellite.map((s) => <li key={s.satellite} data-testid="live-insat-sat-age" data-satellite={s.satellite}>{s.text}</li>)}
                </ul>
            )}
            {layer.available && on && frame && (
                <div className="mt-1 space-y-1">
                    {layer.snapshot && (
                        <p data-testid="live-insat-snapshot" className="text-[10px] font-black text-amber-800 dark:text-amber-300">{layer.snapshot.label}</p>
                    )}
                    <p data-testid="live-insat-caption" data-frame={frame.id} className="text-[10px] leading-snug text-slate-700 dark:text-slate-200"
                        title={`scan ${frame.acq_start} – ${frame.acq_end}; available ${frame.time_available}; file ${frame.file}`}>
                        {frame.caption}
                    </p>
                    {layer.frames.length > 1 && (
                        <div data-testid="live-insat-frames" className="flex flex-wrap gap-1">
                            {layer.frames.map((f) => (
                                <button key={f.id} type="button" data-testid="live-insat-frame" data-frame={f.id} aria-pressed={f.id === frame.id}
                                    onClick={() => setFrameId(f.id)}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${f.id === frame.id
                                        ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                                        : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                    {short(f)}
                                </button>
                            ))}
                        </div>
                    )}
                    <label className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                        opacity
                        <input type="range" data-testid="live-insat-opacity" min="0.1" max="1" step="0.05" value={opacity}
                            onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-slate-600" />
                    </label>
                    {frame.satellite === 'INSAT-3DS' && (
                        <p data-testid="live-insat-3ds-note" className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                            INSAT-3DS uses the same projection metadata; its image offset has not been measured (docs/insat_georef.md).
                        </p>
                    )}
                    <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">The layer shows its own scan time, not the forecast&apos;s valid time. {layer.threshold_note}</p>
                </div>
            )}
        </div>
    );
};

export default LiveInsatControl;
