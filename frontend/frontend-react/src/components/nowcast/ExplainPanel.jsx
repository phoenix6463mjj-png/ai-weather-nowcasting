import { ChevronLeft, FlaskConical } from 'lucide-react';
import AttributionBars from './AttributionBars';
import { issueFileUrl } from '../../services/nowcastApi';
import { HAZARD_STYLE, LEVEL_STYLE, VERIFY_STYLE, valueText, kindText, fmtUtc, stateName, FF_VERIFY_NOTE } from '../../utils/hazardLabels';
import IMDChip from './IMDChip';
import CapReview from './CapReview';

const Section = ({ title, children }) => (
    <section className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <h4 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-200 mb-1.5">{title}</h4>
        {children}
    </section>
);

const fmtNum = (v) => (v === null || v === undefined ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

const Waterfall = ({ items }) => {
    const shapItems = items.filter((w) => w.shap_logodds_total !== null && w.shap_logodds_total !== undefined);
    const rows = items.map((w) => ({
        key: w.concept, text: w.text, effect: w.effect, noScale: 'basin physics (no SHAP scale)',
        value: w.shap_logodds_total ?? null,
        extra: w.features?.some((f) => f.patch_normal_range_p5_p95) && (
            <ul className="mt-0.5">
                {w.features.filter((f) => f.patch_normal_range_p5_p95).map((f) => (
                    <li key={f.name} className="text-sm text-slate-500 dark:text-slate-400">
                        {f.name} = {fmtNum(f.value)} (normal here and now, p5–p95: {fmtNum(f.patch_normal_range_p5_p95[0])}–{fmtNum(f.patch_normal_range_p5_p95[1])})
                    </li>
                ))}
            </ul>
        ),
    }));
    return (
        <div data-testid="why-bars" className="space-y-2">
            <AttributionBars rows={rows} showValue testid="why-row" />
            {shapItems.length > 0 && (
                <p className="text-sm text-slate-400 leading-normal">
                    Bar length is the strength of each reason (SHAP contribution in log-odds): the signs and ranking carry over to the probability, but the sizes do not add up to it.
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
        <div className="space-y-2 text-base text-slate-700 dark:text-slate-300">
            {hazard === 'cloudburst' && (
                <p className="font-semibold text-pink-700 dark:text-pink-300">
                    The cloudburst index itself is an uncalibrated heuristic. The reliability below is for the rain probability P(≥30 mm/hr) it is built from.
                </p>
            )}
            {rel?.text && <p>{rel.text}</p>}
            {rel?.note && hazard !== 'cloudburst' && <p className="text-slate-500">{rel.note}</p>}
            {skill && (
                <div>
                    <p className="text-sm text-slate-500 mb-0.5">Validated skill at this lead (CSI, ≥30 mm/hr, 2022–23 validation):</p>
                    <table className="text-sm tabular-nums">
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

// Alert tab of the drawer: one alert's explanation. The alert detail is fetched by the parent
// (shared with the Ingredients tab).
const ExplainPanel = ({ episode, ts, d, error, onBack, onIngredients, review, onReview }) => {
    if (error) return <div className="p-4 text-base text-red-600">Could not load explanation: {error}</div>;
    if (!d) return <div className="p-4 text-base text-slate-500">Loading explanation…</div>;

    const hz = HAZARD_STYLE[d.hazard];
    const v = VERIFY_STYLE[d.verification_ui?.status];
    return (
        <div className="text-slate-900 dark:text-slate-100" data-testid="explain-panel" data-hazard={d.hazard}>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-[#0f172a] z-10">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: hz.color }} />
                    <h3 className="text-lg font-black">{hz.name}</h3>
                    <span className={`text-sm font-black px-1.5 py-0.5 rounded ${LEVEL_STYLE[d.level]?.badge}`}>{d.level}</span>
                    <IMDChip level={d.level} large />
                    <button onClick={onBack} className="ml-auto flex items-center gap-0.5 px-1.5 py-1 rounded text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" title="Back to list">
                        <ChevronLeft size={14} /> List
                    </button>
                </div>
                <p data-testid="explain-value" className="text-2xl font-black mt-1 tabular-nums">{valueText(d)}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-normal">{kindText(d)}</p>
                {d.in_sample && (
                    <p className="mt-1.5 text-sm font-black text-white bg-red-600 rounded px-2 py-1">
                        IN-SAMPLE training-period event: illustration only
                    </p>
                )}
            </div>

            {onReview && (
                <Section title="Forecaster review (CAP 1.2, demo)">
                    <CapReview src={{ kind: 'replay', ep: episode, ts }} alertId={d.alert_id} review={review} onChange={onReview} />
                </Section>
            )}

            <Section title="When and where">
                <div className="text-base space-y-0.5">
                    <p>Issued {fmtUtc(d.issue_time)}</p>
                    <p>Valid {fmtUtc(d.valid_time)} (lead {d.lead_time_h} h{d.radius_km ? `, within ${d.radius_km} km` : ''})</p>
                    <p>{d.state ? `${stateName(d.state)}${d.state_approx ? ' (approximate: nearest state)' : ''}` : ''} · peak {d.peak_cell[0].toFixed(2)}N {d.peak_cell[1].toFixed(2)}E · {Math.round(d.area_km2).toLocaleString()} km² ({d.n_cells} cells)</p>
                    {d.district_note && <p className="text-slate-400">{d.district_note}</p>}
                </div>
            </Section>

            <Section title="Satellite rain check (replay)">
                {v && <p data-testid="explain-verification" className={`inline-block text-base font-bold px-2 py-1 rounded ${v.badge}`}>
                    {v.label}{d.verification_ui?.status === 'verified' && d.radius_km ? ` (r = ${d.radius_km} km)` : ''}</p>}
                {d.site_note && <p data-testid="explain-site-note" className="mt-2 text-base text-violet-900 dark:text-violet-200 bg-violet-50 dark:bg-violet-950/40 rounded px-2 py-1.5">{d.site_note.text}</p>}
                <p className="text-base text-slate-500 dark:text-slate-400 mt-2">
                    Confirmed = at least one IMERG cell with ≥30 mm/hr observed (within r) inside the alert area; otherwise the alert is not confirmed and counts as a false alarm in our scores.
                    {d.hazard === 'flash_flood' && ' Flash-flood alerts use the same rain-overlap check: basin rain totals are not verified (no gauges).'}
                </p>
                {d.hazard === 'flash_flood' && (
                    <p data-testid="ff-verify-note-panel" className="text-sm font-semibold text-amber-700 dark:text-amber-400 mt-1 leading-normal">{FF_VERIFY_NOTE}</p>
                )}
            </Section>

            {d.explain_available === false ? (
                <Section title="Why: top reasons (model output)">
                    <p data-testid="explain-unavailable" className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                        {d.note}: no calculation trace, SHAP waterfall or confidence for this issue.
                    </p>
                    <ul className="space-y-1">
                        {(d.explanations || []).map((x) => (
                            <li key={x.concept} className="text-base text-slate-800 dark:text-slate-100">
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

            {d.ingredients && onIngredients && (
                <Section title="Ingredients">
                    <button type="button" data-testid="explain-open-ingredients" onClick={onIngredients}
                        className="flex items-center gap-1.5 text-base font-bold text-blue-700 dark:text-blue-400 hover:underline">
                        <FlaskConical size={13} /> Show the ingredient contributions for this alert
                    </button>
                </Section>
            )}

            {d.basin && (
                <Section title="Basin">
                    <div className="text-base grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
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
                        <ol className="list-decimal ml-4 space-y-1 text-sm text-slate-700 dark:text-slate-300 leading-normal">
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
            <p className="px-4 py-2 text-sm text-slate-400 break-all">{d.alert_id}</p>
        </div>
    );
};

export default ExplainPanel;
