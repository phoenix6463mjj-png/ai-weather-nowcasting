import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { HAZARD_STYLE, VERIFY_STYLE, IMD_NOTE } from '../../utils/hazardLabels';
import { TERRAIN_ATTRIBUTION } from './useTerrain';
import IMDChip from './IMDChip';

const LEGEND_OPEN_MIN_WIDTH = 1400;

const Swatch = ({ color, dashed, fill = 0.35, round }) => (
    <span className={`inline-block w-4 h-3 shrink-0 ${round ? 'rounded-full' : 'rounded-sm'}`}
        style={{ border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`, background: `${color}${Math.round(fill * 255).toString(16).padStart(2, '0')}` }} />
);

const Row = ({ children, testid }) => <div data-testid={testid} className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200 leading-tight">{children}</div>;
const Head = ({ children }) => <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 pt-1 first:pt-0">{children}</p>;

/**
 * The one compact legend box. Only layers that are currently visible get an entry. Raster classes
 * and overlay texts come from the API's `legends` (serve/labels.py), so colours and units always
 * match the PNGs.
 *   hazards:   hazards whose alerts are switched on ([] = no alert layer)
 *   observed / missed: whether those overlays are drawn now; note: why they are not (if relevant)
 *   insat:     { classes, lines, availability } while the INSAT-3DR layer is switched on, else null
 */
const MapLegend = ({ legends, field, hazards = [], observed = false, missed = false, verification = true,
    site = 0, terrain = false, note, noteTitle, ffNote, insat = null }) => {
    const f = field && legends?.[field];
    // collapsed by default on narrower screens so it does not cover the map
    const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= LEGEND_OPEN_MIN_WIDTH);
    const alerts = hazards.length > 0;
    return (
        <div data-testid="map-legend" data-open={open}
            className="pointer-events-auto max-h-full overflow-y-auto bg-white/95 dark:bg-slate-800/95 backdrop-blur shadow-md rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1.5 w-[290px]">
            <button type="button" data-testid="legend-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
                Legend {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            {open && (<>
                {insat && (
                    <div data-testid="legend-insat" className="space-y-0.5">
                        <Head>Satellite observation (INSAT via MOSDAC)</Head>
                        <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">INSAT-3DR cloud-top brightness temperature (K)</p>
                        {/* one strip, coldest left; tick labels are the class boundaries */}
                        <div data-testid="legend-insat-strip" className="relative pb-3">
                            <div className="flex h-2.5 rounded-sm overflow-hidden border border-slate-300 dark:border-slate-600">
                                {insat.classes.filter((c) => c.color).map((c) => (
                                    <span key={c.label} title={c.label} className="flex-1" style={{ background: c.color }} />
                                ))}
                            </div>
                            {(() => {
                                const cs = insat.classes.filter((c) => c.color);
                                return cs.slice(0, -1).map((c, i) => (
                                    <span key={c.to} className="absolute top-3 -translate-x-1/2 text-[9px] text-slate-500 dark:text-slate-400 tabular-nums"
                                        style={{ left: `${((i + 1) / cs.length) * 100}%` }}>{i % 2 === 0 ? c.to : ''}</span>
                                )).concat(<span key="end" className="absolute top-3 right-0 text-[9px] text-slate-500 tabular-nums">{cs[cs.length - 1].to}</span>);
                            })()}
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                            {insat.classes.find((c) => !c.color)?.label} · display classes, not thresholds
                        </p>
                        {insat.availability && <p data-testid="legend-insat-availability" className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">{insat.availability} (at issue time, not at the lead&apos;s valid time)</p>}
                        {insat.lines.map((l) => <p key={l} data-testid="insat-line" className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">{l}</p>)}
                    </div>
                )}
                {alerts && (
                    <>
                        <Head>Alerts</Head>
                        <Row><Swatch color="#475569" />Warning (solid outline)<IMDChip level="Warning" /></Row>
                        <Row><Swatch color="#475569" dashed fill={0.1} />Watch (dashed outline)<IMDChip level="Watch" /></Row>
                        <p data-testid="imd-note-legend" className="text-[10px] text-slate-400 leading-snug">{IMD_NOTE}</p>
                        <Row testid="legend-hazards">
                            {hazards.map((h) => (
                                <span key={h} data-hazard={h} className="flex items-center gap-1"><Swatch color={HAZARD_STYLE[h].color} />{HAZARD_STYLE[h].name}</span>
                            ))}
                        </Row>
                        {verification && (<Row>
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: VERIFY_STYLE.verified.color }} /> verified
                            <span className="w-2.5 h-2.5 rounded-full border-2 bg-white" style={{ borderColor: VERIFY_STYLE.false_alarm.color }} /> not verified (false alarm)
                        </Row>)}
                        {verification && ffNote && hazards.includes('flash_flood') && (
                            <p data-testid="ff-verify-note-legend" className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">{ffNote}</p>
                        )}
                        {!verification && (
                            <Row><span className="w-3 h-3 rounded-full border border-slate-900 bg-slate-400" /> alert peak (colour = hazard)</Row>
                        )}
                    </>
                )}
                {site > 0 && <Row><span className="w-3 h-3 rounded-full border-2 border-slate-900 bg-yellow-400" /> documented cloudburst site{site > 1 ? 's' : ''}</Row>}
                {((observed && legends?.observed_ge30) || (missed && legends?.missed_ge30)) && <Head>Observed (replay)</Head>}
                {note && noteTitle && !observed && <Head>{noteTitle}</Head>}
                {observed && legends?.observed_ge30 && (
                    <Row testid="legend-observed"><Swatch color={legends.observed_ge30.classes[0].color} fill={0.8} />{legends.observed_ge30.label}</Row>
                )}
                {missed && legends?.missed_ge30 && (
                    <Row><Swatch color={legends.missed_ge30.classes[0].color} fill={0.8} /><span data-testid="missed-legend">{legends.missed_ge30.label}</span></Row>
                )}
                {note && <p className="text-[10px] text-amber-700 dark:text-amber-400">{note}</p>}
                {f && (
                    <>
                        <Head>Forecast layer</Head>
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
                {terrain && (
                    <Row testid="legend-terrain"><span className="w-4 h-3 rounded-sm bg-gradient-to-r from-slate-700 to-slate-100 shrink-0" />Terrain shading ({TERRAIN_ATTRIBUTION})</Row>
                )}
            </>)}
        </div>
    );
};

export default MapLegend;
