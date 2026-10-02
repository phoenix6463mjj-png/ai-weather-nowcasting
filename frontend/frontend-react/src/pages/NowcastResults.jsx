import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SvgPlot from '../components/nowcast/SvgPlot';
import PageShell, { Card, Quote } from '../components/nowcast/PageShell';
import InsatEvents from '../components/nowcast/InsatEvents';
import { getCaveats, getEventCheck, getResults, getTimeline } from '../services/nowcastApi';
import useHashScroll from '../utils/useHashScroll';
import { fmtIssueShort, VERIFY_STYLE } from '../utils/hazardLabels';

const COLORS = { v0: '#2563eb', advection: '#94a3b8', persistence: '#f59e0b' };
const LEAD_COLORS = { 1: '#2563eb', 3: '#9333ea', 6: '#dc2626' };

const LEADS = [1, 2, 3, 4, 6];
const niceMax = (v) => Math.ceil((v * 1.1) / 0.1) * 0.1;

const CsiChart = ({ rows, split, th }) => {
    const cells = rows.filter((r) => r.split === split && r.threshold === th).sort((a, b) => a.lead - b.lead);
    const ymax = niceMax(Math.max(...cells.flatMap((r) => [r.csi_v0, r.csi_advection, r.csi_persistence])));
    const pts = (k) => cells.map((r) => ({ x: r.lead, y: r[`csi_${k}`], label: r[`csi_${k}`].toFixed(3), far: r.far_above_advection, pers: r.persistence_ge_v0 }));
    return (
        <div data-testid={`csi-chart-${split}-${th}`}>
            <p className="text-sm font-bold text-center">≥{th} mm/hr</p>
            <SvgPlot h={170} xDomain={[0.6, 6.4]} yDomain={[0, ymax]} xTicks={LEADS} xFmt={(v) => `${v} h`}
                yTicks={[0, ymax / 2, ymax]} yFmt={(v) => v.toFixed(2)} series={[
                    { key: 'advection', color: COLORS.advection, points: pts('advection') },
                    { key: 'persistence', color: COLORS.persistence, points: pts('persistence'),
                      dot: (q) => (q.pers ? { r: 6, fill: COLORS.persistence, stroke: '#78350f', sw: 1.5, testid: 'csi-persistence-flag' } : { r: 2.5, fill: COLORS.persistence }) },
                    { key: 'v0', color: COLORS.v0, width: 2.6, points: pts('v0'),
                      dot: (q) => (q.far ? { r: 5.5, fill: '#fff', stroke: '#dc2626', sw: 2.2, testid: 'csi-far-flag' } : { r: 3, fill: COLORS.v0, testid: 'csi-v0-point' }) },
                ]} />
        </div>
    );
};

const ReliabilityChart = ({ rel, split }) => (
    <div data-testid={`reliability-${split}`}>
        <p className="text-sm font-bold text-center">{split === 'val' ? 'Validation 2022–23' : 'Test 2024'} · ≥{rel.threshold} mm/hr</p>
        <SvgPlot w={560} h={330} xDomain={[0, 1]} yDomain={[0, 1]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]} yTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
            xFmt={(v) => v.toFixed(1)} yFmt={(v) => v.toFixed(1)} diagonal xLabel="forecast probability" yLabel="observed frequency"
            series={Object.entries(rel.splits[split]).map(([L, pts]) => ({
                key: `${L} h`, color: LEAD_COLORS[L],
                points: pts.map((q) => ({ x: q.forecast, y: q.observed, label: `forecast ${q.forecast}, observed ${q.observed}, n=${q.n}` })),
            }))} />
        <div className="flex justify-center gap-3 text-sm">
            {Object.keys(rel.splits[split]).map((L) => (
                <span key={L}><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: LEAD_COLORS[L] }} />{L} h</span>
            ))}
        </div>
    </div>
);

const best = (list, pred) => list.filter(pred).sort((a, b) => b.hours_of_warning - a.hours_of_warning)[0];

const CaseStudies = ({ cases }) => {
    const [p, m] = [cases.REF045, cases.REF051];
    if (!p || !m) return <p className="text-base text-slate-500">Loading case studies…</p>;
    const ps = p.check.sites.find((s) => s.site_episode === 'REF045');
    const ms = m.check.sites.find((s) => s.site_episode === 'REF051');
    const pa = best(ps.qualifying, (a) => a.precision === 'precise' && a.hazard === 'cloudburst');
    const mc = best(ms.qualifying, (a) => a.hazard === 'cloudburst' && a.level === 'Warning');
    const mt = best(ms.qualifying, (a) => a.hazard === 'thunderstorm' && a.level === 'Warning');
    const vs = (a) => VERIFY_STYLE[a.imerg_verification?.status]?.label;
    const precisions = [...new Set([mc, mt].map((a) => a.precision))].join(', ');
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div data-testid="case-study-REF045" className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                <p className="text-base font-black">Pipalkoti, Uttarakhand, 13 Aug 2023 <span className="font-semibold text-emerald-700">(validation)</span></p>
                <p className="text-base">
                    <b>{pa.precision} cloudburst {pa.level}</b> issued {fmtIssueShort(pa.issue_time)} (L{pa.lead_time_h}),{' '}
                    <b>{pa.hours_of_warning} h</b> before the earliest reported time ({fmtIssueShort(ps.source.window_utc[0])});
                    alert peak <b>{pa.peak_to_site_km} km</b> from the site, <b>{Math.round(pa.area_km2)} km²</b>.
                </p>
                <p className="text-base">
                    IMERG calls it <b>{vs(pa)}</b> because IMERG did not resolve the storm: its peak within
                    {' '}{p.tl.imerg.radius_km} km of the site was <b>{p.tl.imerg.peak.max_mmhr} mm/hr</b>{p.tl.imerg.onset_ge30 ? '' : ' and it never reached 30 mm/hr'}.
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-300">Caveat: the reported time is {ps.source.confidence} (“{ps.source.local_time_as_stated}”).</p>
                <Link data-testid="case-link-REF045" to={`/nowcast?ep=REF045&ts=${pa.issue_time.replace(/[-:]/g, '')}&tab=event`}
                    className="text-base font-bold text-blue-700 underline">Open the warning timeline →</Link>
            </div>
            <div data-testid="case-study-REF051" className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                <p className="text-base font-black">Malana, Himachal Pradesh, 31 Jul 2024 <span className="font-semibold text-violet-700">(2024 test, descriptive)</span></p>
                <p className="text-base">
                    <b>Cloudburst Warning {mc.hours_of_warning} h</b> and <b>thunderstorm Warning {mt.hours_of_warning} h</b> before
                    the reported window ({fmtIssueShort(ms.source.window_utc[0])}–{fmtIssueShort(ms.source.window_utc[1])});
                    {' '}{precisions} areas; IMERG: <b>{vs(mc)}</b> / <b>{vs(mt)}</b>.
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-300">Caveat: {ms.source.window_label}.</p>
                <p className="text-sm text-violet-800 dark:text-violet-300">{m.check.case_label}</p>
                <Link data-testid="case-link-REF051" to="/nowcast?ep=REF051&ts=20240731T1800Z&tab=event"
                    className="text-base font-bold text-blue-700 underline">Open the warning timeline →</Link>
            </div>
        </div>
    );
};

const NowcastResults = () => {
    const [r, setR] = useState(null);
    const [caveats, setCaveats] = useState([]);
    const [cases, setCases] = useState({});
    const [error, setError] = useState(null);
    useHashScroll(!!r);
    useEffect(() => {
        getResults().then(setR).catch((e) => setError(e.message));
        getCaveats().then((c) => setCaveats(c.caveats)).catch(() => {});
        for (const ep of ['REF045', 'REF051']) {
            Promise.all([getEventCheck(ep), getTimeline(ep)])
                .then(([check, tl]) => setCases((c) => ({ ...c, [ep]: { check, tl } }))).catch(() => {});
        }
    }, []);
    return (
        <PageShell testid="results-page" title="Results: lgbm_v0 skill, calibration and case studies"
            subtitle="General skill = CSI against the advection and persistence baselines. Case studies are documented events, not a lead-time claim.">
            {error && <p className="text-base text-red-600">{error}</p>}
            {r && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-8 space-y-4 min-w-0">
                    <Card title="CSI by lead and threshold: v0 vs advection vs persistence (FAR-capped cut-offs)" testid="csi-section">
                        {['val', 'test'].map((split) => (
                            <div key={split} className="mb-1">
                                <p className="text-sm font-black uppercase text-slate-500">{split === 'val' ? 'Validation 2022–23' : 'Official test 2024 (scored once)'}</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{[1, 10, 30].map((th) => <CsiChart key={th} rows={r.csi} split={split} th={th} />)}</div>
                            </div>
                        ))}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1">
                            <span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: COLORS.v0 }} />v0</span>
                            <span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: COLORS.advection }} />advection</span>
                            <span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: COLORS.persistence }} />persistence</span>
                            <span data-testid="far-caveat-legend"><span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-red-600 align-middle mr-1" />FAR caveat: v0's false-alarm ratio is above advection's at this cell</span>
                            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-900 align-middle mr-1" />persistence ties or beats v0</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">{r.notes.map((q) => <Quote key={q.id} q={q} testid={`note-${q.id}`} />)}</div>
                    </Card>
                    <Card title="Case studies (documented events)" testid="case-studies">
                        <CaseStudies cases={cases} />
                        <div className="mt-2"><Quote q={r.case_study_note} testid="case-study-note" /></div>
                    </Card>
                    {r.insat_events && (
                        <Card title={r.insat_events.title} testid="insat-events-section">
                            <InsatEvents d={r.insat_events} />
                        </Card>
                    )}
                    </div>
                    <div className="lg:col-span-4 space-y-4 min-w-0">
                    <Card title="Calibration (reliability) at ≥30 mm/hr" testid="reliability-section">
                        <div className="space-y-1">
                            <ReliabilityChart rel={r.reliability} split="val" />
                            <ReliabilityChart rel={r.reliability} split="test" />
                        </div>
                        <p data-testid="reliability-min-n" className="text-sm text-slate-500 mb-1">Dashed line = perfect calibration. Bins with fewer than {r.reliability.min_n} cells are hidden. Source: {r.reliability.source}.</p>
                        <Quote q={r.reliability_note} />
                    </Card>
                    <Card title="Negative results" testid="negative-results" className="space-y-2">
                        <p className="text-base"><b>v1, pressure-level physics</b> (K-index, Total Totals, 500–850 hPa shear, moisture-flux convergence): no measurable skill gain.</p>
                        {r.negative.v1.map((q) => <Quote key={q.id} q={q} />)}
                        <p className="text-base pt-1"><b>U-Net (storm-relative deep model)</b>: behind v0 in every combination; not adopted.</p>
                        {r.negative.unet.map((q) => <Quote key={q.id} q={q} />)}
                    </Card>
                    </div>
                    <Card title="Limitations" testid="limitations" className="lg:col-span-12">
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                            {caveats.map((c) => <li key={c.id} className="text-base text-slate-700 dark:text-slate-300" title={`"${c.quote}" (${c.source})`}>• {c.short}</li>)}
                        </ul>
                    </Card>
                </div>
            )}
        </PageShell>
    );
};

export default NowcastResults;
