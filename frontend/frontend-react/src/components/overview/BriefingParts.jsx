import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Radio } from 'lucide-react';
import SvgPlot from '../nowcast/SvgPlot';
import AttributionBars from '../nowcast/AttributionBars';
import { mlUrl } from '../../services/nowcastApi';

// Overview pieces drawn over the map or under a step's text. Every number comes from /api/overview.

export const Overlay = ({ children, testid, className = '' }) => (
    <div data-testid={testid} className={`pointer-events-auto rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-xl border border-slate-200 dark:border-slate-700 p-4 ${className}`}>
        {children}
    </div>
);

// Step 4: top-5 reasons as left-aligned bars (length = strength; colour, arrow and label = raises / lowers
// risk, from the sign); no numbers.
export const ReasonsChart = ({ e }) => (
    <Overlay testid="ov-reasons" className="w-[min(30rem,100%)]">
        <p className="font-black text-base leading-snug">{e.label}: top {e.reasons.length} reasons</p>
        {e.fallback && <p data-testid="ov-reasons-fallback" className="text-sm text-amber-800 dark:text-amber-300">{e.label}</p>}
        <div className="mt-2">
            <AttributionBars testid="ov-reason"
                rows={e.reasons.map((r) => ({ key: r.text, text: r.text, value: r.shap_logodds, effect: r.effect }))} />
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Bar length = how strongly each reason moved this alert (model attributions).</p>
    </Overlay>
);

// Step 6: CSI at >=10 mm/hr by lead, validation: model vs advection vs persistence.
const SERIES = [
    { key: 'model', label: 'Model (lgbm_v0)', color: '#2563eb', width: 3 },
    { key: 'advection', label: 'Advection', color: '#f97316', width: 2 },
    { key: 'persistence', label: 'Persistence', color: '#64748b', width: 2 },
];
export const CsiChart = ({ c }) => {
    const ymax = Math.ceil(Math.max(...c.model, ...c.advection, ...c.persistence) * 10) / 10;
    const series = SERIES.map((s) => ({ ...s, points: c.leads.map((L, i) => ({ x: L, y: c[s.key][i] })) }));
    return (
        <Overlay testid="ov-csi" className="w-[min(32rem,100%)]">
            <p className="font-black text-base">CSI at ≥{c.threshold} mm/hr by lead, {c.split_name}</p>
            <SvgPlot testid="ov-csi-plot" w={420} h={190} xDomain={[0.6, 6.4]} yDomain={[0, ymax]} xTicks={c.leads} xFmt={(v) => `${v} h`}
                yTicks={[0, ymax / 2, ymax]} yFmt={(v) => v.toFixed(2)} series={series} />
            <p className="text-sm flex flex-wrap gap-x-4">
                {SERIES.map((s) => <span key={s.key}><span className="inline-block w-4 h-1 align-middle mr-1" style={{ background: s.color }} />{s.label}</span>)}
            </p>
        </Overlay>
    );
};

// Step 7: measured delays as bars on one minutes scale (compute shown in seconds).
export const FreshnessBars = ({ rt }) => {
    const mins = rt.bars.map((b) => b.minutes ?? (b.seconds != null ? b.seconds / 60 : 0));
    const max = Math.max(...mins);
    const val = (b) => (b.minutes != null ? `${b.minutes} min` : `${Math.round(b.seconds)} s`);
    return (
        <Overlay testid="ov-freshness" className="w-[min(30rem,100%)]">
            <p className="font-black text-base">Measured delays</p>
            <ul className="mt-1 space-y-2">
                {rt.bars.map((b, i) => (
                    <li key={b.id} data-testid={`ov-fresh-${b.id}`}>
                        <div className="flex justify-between gap-3 text-sm"><span>{b.label}</span><b className="whitespace-nowrap">{val(b)}</b></div>
                        <div className="h-3 mt-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                            <div className="h-3 rounded bg-blue-600" style={{ width: `${Math.max(1.5, (mins[i] / max) * 100)}%` }} />
                        </div>
                    </li>
                ))}
            </ul>
            {rt.snapshots[0] && <p data-testid="ov-live-insat" className="mt-2 text-sm text-slate-600 dark:text-slate-300">Map: {rt.snapshots[0].text} · satellite observation (INSAT via MOSDAC)</p>}
        </Overlay>
    );
};

// Step 5: the three IMERG-blind 2024 cloudbursts, IMERG peak vs coldest cloud top.
export const InsatMultiples = ({ i }) => {
    const IMERG_REF = 30;                       // the model's 30 mm/hr cloudburst threshold (scale end)
    const warm = 300;
    return (
        <div data-testid="ov-insat-events" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {i.events.map((e) => (
                <div key={e.episode} data-testid="ov-insat-event" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                    <p className="font-bold text-base leading-snug">{e.site}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{e.date}</p>
                    <p className="text-sm mt-2">IMERG peak <b data-testid="ov-ev-imerg">{e.imerg_peak_mmhr} mm/hr</b></p>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded"><div className="h-2.5 rounded bg-sky-600" style={{ width: `${Math.min(100, (e.imerg_peak_mmhr / IMERG_REF) * 100)}%` }} /></div>
                    <p className="text-sm mt-2">Coldest cloud top <b data-testid="ov-ev-cold">{e.coldest_top_k} K</b></p>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded"><div className="h-2.5 rounded bg-indigo-900" style={{ width: `${Math.min(100, ((warm - e.coldest_top_k) / (warm - 180)) * 100)}%` }} /></div>
                </div>
            ))}
            <p className="sm:col-span-3 text-sm text-slate-500 dark:text-slate-400">Bars: IMERG against the 30 mm/hr threshold; cloud top from 300 K (warm) to 180 K (coldest the product records).</p>
        </div>
    );
};

const THUMB_BG = { live: 'from-sky-100 to-blue-200 dark:from-sky-950 dark:to-blue-900', results: 'from-slate-100 to-indigo-100 dark:from-slate-900 dark:to-indigo-950' };
export const ExploreCards = ({ cards }) => (
    <div data-testid="ov-explore" className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        {cards.map((c) => (
            <Link key={c.id} to={c.to} data-testid={`ov-card-${c.id}`}
                className="group flex gap-3 items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 hover:border-blue-500 hover:shadow-md">
                <div className={`w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br ${THUMB_BG[c.id] || 'from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700'}`}>
                    {c.thumb ? <img src={mlUrl(c.thumb)} alt="" loading="lazy" className="w-full h-full object-cover" />
                        : <span className="w-full h-full flex items-center justify-center text-blue-700 dark:text-blue-300">{c.id === 'live' ? <Radio size={30} /> : <BarChart3 size={30} />}</span>}
                </div>
                <div className="min-w-0">
                    <p className="font-black text-base leading-snug group-hover:text-blue-700 dark:group-hover:text-blue-300">{c.title} <ArrowRight size={16} className="inline" /></p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{c.note}</p>
                </div>
            </Link>
        ))}
    </div>
);
