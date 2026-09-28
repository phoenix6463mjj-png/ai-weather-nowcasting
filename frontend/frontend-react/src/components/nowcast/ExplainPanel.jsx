import { useEffect, useState } from 'react';
import { X, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getAlertDetail, issueFileUrl } from '../../services/nowcastApi';
import { HAZARD_STYLE, LEVEL_STYLE, VERIFY_STYLE, valueText, kindText, fmtUtc, stateName, FF_VERIFY_NOTE } from '../../utils/hazardLabels';
import IMDChip from './IMDChip';
import IngredientsPanel from './IngredientsPanel';

const Section = ({ title, children }) => (
    <section className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <h4 className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">{title}</h4>
        {children}
    </section>
);

const fmtNum = (v) => (v === null || v === undefined ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

const Waterfall = ({ items }) => {
    const shapItems = items.filter((w) => w.shap_logodds_total !== null && w.shap_logodds_total !== undefined);
    const max = Math.max(0.001, ...shapItems.map((w) => Math.abs(w.shap_logodds_total)));
    return (
        <div className="space-y-2">
            {items.map((w) => {
                const up = w.effect === 'raises risk';
                const has = w.shap_logodds_total !== null && w.shap_logodds_total !== undefined;
                return (
                    <div key={w.concept}>
                        <div className="flex items-start gap-1.5 text-xs text-slate-800 dark:text-slate-100">
                            {up ? <ArrowUpRight size={14} className="text-red-600 shrink-0 mt-0.5" />
                                : <ArrowDownRight size={14} className="text-emerald-600 shrink-0 mt-0.5" />}
                            <span>{w.text}</span>
                        </div>
                        {has ? (
                            <div className="flex items-center gap-2 mt-1 ml-5">
                                <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded">
                                    <div className={`h-1.5 rounded ${up ? 'bg-red-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${(Math.abs(w.shap_logodds_total) / max) * 100}%` }} />
                                </div>
                                <span className="text-[10px] tabular-nums text-slate-500 w-14 text-right">
                                    {w.shap_logodds_total > 0 ? '+' : ''}{w.shap_logodds_total.toFixed(2)}
                                </span>
                            </div>
                        ) : (
                            <p className="ml-5 text-[10px] text-slate-400">basin physics (no SHAP scale)</p>
                        )}
                        {w.features?.some((f) => f.patch_normal_range_p5_p95) && (
                            <ul className="ml-5 mt-0.5">
                                {w.features.filter((f) => f.patch_normal_range_p5_p95).map((f) => (
                                    <li key={f.name} className="text-[10px] text-slate-500 dark:text-slate-400">
                                        {f.name} = {fmtNum(f.value)} (normal here and now, p5–p95: {fmtNum(f.patch_normal_range_p5_p95[0])}–{fmtNum(f.patch_normal_range_p5_p95[1])})
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                );
            })}
            {shapItems.length > 0 && (
                <p className="text-[10px] text-slate-400 leading-snug">
                    Bars are SHAP contributions in log-odds: the signs and ranking carry over to the probability, but the sizes do not add up to it.
                </p>
            )}
        </div>
    );
};

const Confidence = ({ c, hazard }) => {
    if (!c) return null;
    const rel = c.reliability;
    const skill = c.validated_skill_val_csi_ge30;
    return (
        <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
            {hazard === 'cloudburst' && (
                <p className="font-semibold text-pink-700 dark:text-pink-300">
                    The cloudburst index itself is an uncalibrated heuristic. The reliability below is for the rain probability P(≥30 mm/hr) it is built from.
                </p>
            )}
            {rel?.text && <p>{rel.text}</p>}
            {rel?.note && hazard !== 'cloudburst' && <p className="text-slate-500">{rel.note}</p>}
            {skill && (
                <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Validated skill at this lead (CSI, ≥30 mm/hr, 2022–23 validation):</p>
                    <table className="text-[11px] tabular-nums">
                        <tbody>
                            <tr><td className="pr-3">model (v0)</td><td className="font-bold">{skill.v0}</td></tr>
                            <tr><td className="pr-3">advection baseline</td><td>{skill.advection}</td></tr>
                            <tr><td className="pr-3">persistence baseline</td><td>{skill.persistence}</td></tr>
                        </tbody>
                    </table>
                    {skill.caveat && <p className="text-amber-700 dark:text-amber-400 mt-1">{skill.caveat}</p>}
                </div>
            )}
            {c.note && <p>{c.note}</p>}
            {c.validated_skill === null && !skill && <p className="font-semibold">No skill score is claimed for this hazard.</p>}
        </div>
    );
};

const ExplainPanel = ({ episode, ts, alertId, onClose }) => {
    const [d, setD] = useState(null);
    const [error, setError] = useState(null);

    // the parent remounts this panel per alert (key={alertId}), so state starts empty
    useEffect(() => {
        let live = true;
        getAlertDetail(episode, ts, alertId).then((r) => live && setD(r)).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, [episode, ts, alertId]);

    if (error) return <div className="p-4 text-sm text-red-600">Could not load explanation: {error}</div>;
    if (!d) return <div className="p-4 text-sm text-slate-500">Loading explanation…</div>;

    const hz = HAZARD_STYLE[d.hazard];
    const v = VERIFY_STYLE[d.verification_ui?.status];
    return (
        <div className="text-slate-900 dark:text-slate-100" data-testid="explain-panel" data-hazard={d.hazard}>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-[#0f172a] z-10">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: hz.color }} />
                    <h3 className="text-base font-black">{hz.name}</h3>
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${LEVEL_STYLE[d.level]?.badge}`}>{d.level}</span>
                    <IMDChip level={d.level} />
                    <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" title="Back to list">
                        <X size={16} />
                    </button>
                </div>
                <p data-testid="explain-value" className="text-2xl font-black mt-1 tabular-nums">{valueText(d)}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{kindText(d)}</p>
                {d.in_sample && (
                    <p className="mt-1.5 text-[11px] font-black text-white bg-red-600 rounded px-2 py-1">
                        IN-SAMPLE training-period event: illustration only
                    </p>
                )}
            </div>

            <Section title="When and where">
                <div className="text-xs space-y-0.5">
                    <p>Issued {fmtUtc(d.issue_time)}</p>
                    <p>Valid {fmtUtc(d.valid_time)} (lead {d.lead_time_h} h{d.radius_km ? `, within ${d.radius_km} km` : ''})</p>
                    <p>{d.state ? `${stateName(d.state)}${d.state_approx ? ' (approximate: nearest state)' : ''}` : ''} · peak {d.peak_cell[0].toFixed(2)}N {d.peak_cell[1].toFixed(2)}E · {Math.round(d.area_km2).toLocaleString()} km² ({d.n_cells} cells)</p>
                    {d.district_note && <p className="text-slate-400">{d.district_note}</p>}
                </div>
            </Section>

            <Section title="Verification (replay)">
                {v && <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded ${v.badge}`}>{v.label}</span>}
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    Verified = at least one observed ≥30 mm/hr cell (within r) inside the alert area; otherwise it is a false alarm.
                    {d.hazard === 'flash_flood' && ' Flash-flood alerts use the same rain-overlap check: basin rain totals are not verified (no gauges).'}
                </p>
                {d.hazard === 'flash_flood' && (
                    <p data-testid="ff-verify-note-panel" className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mt-1 leading-snug">{FF_VERIFY_NOTE}</p>
                )}
            </Section>

            {d.explain_available === false ? (
                <Section title="Why: top reasons (model output)">
                    <p data-testid="explain-unavailable" className="text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                        {d.note}: no calculation trace, SHAP waterfall or confidence for this issue.
                    </p>
                    <ul className="space-y-1">
                        {(d.explanations || []).map((x) => (
                            <li key={x.concept} className="text-xs text-slate-800 dark:text-slate-100">
                                {x.effect === 'raises risk' ? '↑' : '↓'} {x.text}
                            </li>
                        ))}
                    </ul>
                </Section>
            ) : (
                <Section title="Why: top 5 reasons">
                    <Waterfall items={d.waterfall || []} />
                </Section>
            )}

            {d.ingredients && (
                <Section title={d.ingredients.heading}>
                    <IngredientsPanel ing={d.ingredients} />
                </Section>
            )}

            {d.basin && (
                <Section title="Basin">
                    <div className="text-xs grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
                        <span className="text-slate-500">forecast rain 0–{d.basin.window_h} h</span><span>{d.basin.forecast_accum_mm} mm</span>
                        <span className="text-slate-500">flash-flood threshold</span><span>{d.basin.threshold_mm} mm</span>
                        <span className="text-slate-500">risk ratio</span><span className="font-bold">{d.basin.risk_ratio}</span>
                        <span className="text-slate-500">antecedent rain index</span><span>{d.basin.antecedent_api_mm} mm</span>
                        <span className="text-slate-500">basin area / slope</span><span>{d.basin.area_km2} km² / {d.basin.mean_slope_deg}°</span>
                        <span className="text-slate-500">basins in region (high)</span><span>{d.basin.n_basins_in_region} ({d.basin.n_basins_high})</span>
                    </div>
                </Section>
            )}

            {d.explain_available !== false && (
                <>
                    <Section title="How the number was calculated">
                        <ol className="list-decimal ml-4 space-y-1 text-[11px] text-slate-700 dark:text-slate-300 leading-snug">
                            {(d.calculation || []).map((c, i) => <li key={i}>{c}</li>)}
                        </ol>
                    </Section>

                    <Section title="Confidence">
                        <Confidence c={d.confidence} hazard={d.hazard} />
                    </Section>
                </>
            )}

            {d.waterfall_png && (
                <Section title="Waterfall figure">
                    <img src={issueFileUrl(episode, ts, d.waterfall_png)} alt={`waterfall for ${d.alert_id}`}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white" />
                </Section>
            )}
            <p className="px-4 py-2 text-[10px] text-slate-400 break-all">{d.alert_id}</p>
        </div>
    );
};

export default ExplainPanel;
