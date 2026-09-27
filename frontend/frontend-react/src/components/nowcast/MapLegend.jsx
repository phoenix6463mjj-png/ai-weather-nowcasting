import { HAZARD_STYLE, VERIFY_STYLE } from '../../utils/hazardLabels';

const Swatch = ({ color, dashed, fill = 0.35, round }) => (
    <span className={`inline-block w-4 h-3 shrink-0 ${round ? 'rounded-full' : 'rounded-sm'}`}
        style={{ border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`, background: `${color}${Math.round(fill * 255).toString(16).padStart(2, '0')}` }} />
);

const Row = ({ children }) => <div className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200 leading-tight">{children}</div>;

/**
 * Map legend. Raster classes and overlay texts come from the API's `legends`
 * (serve/labels.py), so colours and units always match the PNGs.
 */
const MapLegend = ({ legends, field, observed = true, missed = true, alerts = true, verification = true, site = false, note, ffNote }) => {
    const f = field && legends?.[field];
    return (
        <div data-testid="map-legend" className="bg-white/95 dark:bg-slate-800/95 backdrop-blur shadow-md rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 w-[300px]">
            {alerts && (
                <>
                    <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">Alerts</p>
                    <Row><Swatch color="#475569" />Warning (solid)<Swatch color="#475569" dashed fill={0.1} />Watch (dashed)</Row>
                    <Row>
                        {Object.values(HAZARD_STYLE).map((h) => (
                            <span key={h.name} className="flex items-center gap-1"><Swatch color={h.color} />{h.name}</span>
                        ))}
                    </Row>
                    {verification && (<Row>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: VERIFY_STYLE.verified.color }} /> verified
                        <span className="w-2.5 h-2.5 rounded-full border-2 bg-white" style={{ borderColor: VERIFY_STYLE.false_alarm.color }} /> not verified (false alarm)
                    </Row>)}
                    {verification && ffNote && (
                        <p data-testid="ff-verify-note-legend" className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">{ffNote}</p>
                    )}
                    {!verification && (
                        <Row><span className="w-3 h-3 rounded-full border border-slate-900 bg-slate-400" /> alert peak (colour = hazard)</Row>
                    )}
                </>
            )}
            {site > 0 && <Row><span className="w-3 h-3 rounded-full border-2 border-slate-900 bg-yellow-400" /> documented cloudburst site{site > 1 ? 's' : ''}</Row>}
            {(observed || missed) && legends && (
                <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 pt-1">Observed (replay)</p>
            )}
            {observed && legends?.observed_ge30 && (
                <Row><Swatch color={legends.observed_ge30.classes[0].color} fill={0.8} />{legends.observed_ge30.label}</Row>
            )}
            {missed && legends?.missed_ge30 && (
                <Row><Swatch color={legends.missed_ge30.classes[0].color} fill={0.8} /><span data-testid="missed-legend">{legends.missed_ge30.label}</span></Row>
            )}
            {note && <p className="text-[10px] text-amber-700 dark:text-amber-400">{note}</p>}
            {f && (
                <>
                    <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 pt-1">Forecast layer</p>
                    <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100" data-testid="raster-legend-label">{f.label}</p>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {f.classes.map((c) => (
                            <span key={c.label} className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-300">
                                <span className="w-3 h-3 rounded-sm" style={{ background: c.color }} />{c.label}
                            </span>
                        ))}
                    </div>
                    {f.kind === 'risk_index' && <p className="text-[10px] text-pink-700 dark:text-pink-300">Index values, not percentages.</p>}
                </>
            )}
        </div>
    );
};

export default MapLegend;
