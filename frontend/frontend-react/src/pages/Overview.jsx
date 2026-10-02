import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Pause, Play } from 'lucide-react';
import TopHeader from '../components/TopHeader';
import DataCredits from '../components/nowcast/DataCredits';
import BriefingMap from '../components/overview/BriefingMap';
import { CsiChart, ExploreCards, FreshnessBars, InsatMultiples, Overlay, ReasonsChart } from '../components/overview/BriefingParts';
import { malanaEvents, scrubTimes } from '../utils/briefing';
import { getOverview } from '../services/nowcastApi';

// "/" System briefing: a pinned map (phones: top half) and eight short steps; each step changes the map.
// Every number comes from /api/overview (read from docs/ and models/v0 by the ML API).
const WIDE = '(min-width: 1024px)';
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SCRUB_MS = 900;

const hhmm = (iso) => iso.slice(11, 16);
const STEP_TITLES = [
    'Cloudbursts are small, fast and hard to see',
    'Satellite rain often misses them',
    'Malana, 31 Jul 2024 (test year, case study)',
    'Every alert explains itself',
    'INSAT sees what satellite rain misses',
    'Does it work?',
    'Built for real time',
    'Explore it yourself',
];

function stepText(i, d) {
    if (!d) return null;
    const nVal = d.sites.filter((s) => s.split === 'val').length;
    const nTest = d.sites.filter((s) => s.split === 'test').length;
    const m = d.malana;
    const [tsW, cbW] = m.warnings;
    const rt = d.realtime.arithmetic;
    switch (i) {
    case 0: return <>A cloudburst can pour extreme rain on one valley within an hour, often at night and far from rain gauges. The dots are the <b>{d.sites.length}</b> documented Himalayan cloudbursts we check against ({nVal} validation 2022–23, {nTest} test 2024).</>;
    case 1: return <>Dot size is the strongest satellite rain (IMERG) seen within 25 km of each site. The median peak is <b data-testid="ov-median">{d.imerg.median_mmhr} mm/hr</b>, and only <b data-testid="ov-ge30">{d.imerg.n_ge30} of {d.imerg.n}</b> reach 30 mm/hr.</>;
    case 2: return <>The model issued a {tsW.hazard_name.toLowerCase()} Warning at <b>{hhmm(tsW.issue_time)}Z</b> and a cloudburst Warning at <b>{hhmm(cbW.issue_time)}Z</b>, <b data-testid="ov-hours-before">{cbW.hours_of_warning} h</b> before the reported window. Satellite rain first reached 30 mm/hr near the site at {hhmm(m.imerg_first_ge30.t)}Z.</>;
    case 3: return <>Each alert lists the conditions that pushed its risk up or down, from the model&apos;s own attributions. These are the top {d.explain.reasons.length} for the {d.explain.label.split(',')[0]}.</>;
    case 4: return d.insat.site.min_at_floor
        ? <>INSAT-3DR shows cloud tops at <b data-testid="ov-insat-floor">{d.insat.floor_label}</b> within {d.insat.site.radius_km} km of Malana at {hhmm(d.insat.slot)}Z, the coldest the product records. At three 2024 cloudbursts that IMERG barely saw, INSAT still showed cold, tall cloud tops.</>
        : <>INSAT-3DR&apos;s coldest cloud top within {d.insat.site.radius_km} km of Malana at {hhmm(d.insat.slot)}Z was <b data-testid="ov-insat-floor">{d.insat.site.min_bt_k} K</b>. At three 2024 cloudbursts that IMERG barely saw, INSAT still showed cold, tall cloud tops.</>;
    case 5: return <>On {d.csi.split_name} data, the model&apos;s CSI at ≥{d.csi.threshold} mm/hr is above moving today&apos;s rain forward (advection) and keeping it in place (persistence) at every lead. Across all leads and thresholds it has <b data-testid="ov-csi-cells">higher CSI in {d.csi.better}/{d.csi.cells} cells</b> than advection.</>;
    case 6: return <>IMERG Early rain arrives hours late, INSAT files within minutes, and our compute takes seconds. A {rt.lead_h} h lead on {rt.imerg_early_age_h} h-old IMERG Early data ≈ <b>{rt.real_warning_imerg_h} h</b> of real warning; on ~{rt.insat_age_h} h-old INSAT data ≈ <b>{rt.real_warning_insat_h} h</b> (<span data-testid="ov-arith-label">{rt.label}</span>).</>;
    case 7: return <>Open the exact views behind this briefing.</>;
    default: return null;
    }
}

// Step 3's time scrubber: auto-plays issue times once when the step is reached (never with reduced motion).
const Scrubber = ({ m, value, setValue, playing, setPlaying }) => {
    const times = scrubTimes(m);
    const idx = Math.max(0, times.indexOf(value));
    const events = malanaEvents(m);
    return (
        <Overlay testid="ov-scrubber" className="w-[min(30rem,100%)]">
            <div className="flex items-center gap-3">
                <button type="button" data-testid="ov-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => {
                    if (!playing && idx === times.length - 1) setValue(times[0]);
                    setPlaying(!playing);
                }} className="p-2 rounded-full bg-blue-600 text-white shrink-0">{playing ? <Pause size={18} /> : <Play size={18} />}</button>
                <input type="range" min={0} max={times.length - 1} value={idx} aria-label="Issue time (UTC)" data-testid="ov-scrub"
                    onChange={(e) => { setPlaying(false); setValue(times[Number(e.target.value)]); }} className="flex-1 accent-blue-600" />
                <b data-testid="ov-scrub-time" className="text-lg tabular-nums">{value}Z</b>
            </div>
            <ul className="mt-2 space-y-0.5">
                {events.map((e) => (
                    <li key={e.id} data-testid={`ov-cap-${e.id}`} data-shown={String(e.t <= value)}
                        className={`text-base ${e.t <= value ? 'opacity-100' : 'opacity-30'}`}>{e.text}</li>
                ))}
            </ul>
            {events.at(-1).t <= value && <p data-testid="ov-imerg-note" className="text-sm text-slate-500 dark:text-slate-400 mt-1">Green: IMERG rain ≥30 mm/hr within {m.imerg_layer.radius_km} km, at {hhmm(m.imerg_layer.valid_time)}Z (the Warning&apos;s valid time).</p>}
        </Overlay>
    );
};

const Overview = () => {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [active, setActive] = useState(0);
    const [reduced] = useState(reducedMotion);
    // charts sit over the map on wide screens, under the step's text on phones (the map is the top half)
    const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? true);
    useEffect(() => {
        const mq = window.matchMedia?.(WIDE);
        if (!mq) return undefined;
        const on = () => setWide(mq.matches);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    }, []);
    const [scrub, setScrub] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [played, setPlayed] = useState(false);
    const scroller = useRef(null);
    const stepRefs = useRef([]);

    useEffect(() => {
        let live = true;
        getOverview().then((d) => live && setData(d)).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, []);

    // the step crossing the middle of the scroller is the active one
    useEffect(() => {
        const root = scroller.current;
        if (!root) return undefined;
        const io = new IntersectionObserver((entries) => {
            const hit = entries.filter((e) => e.isIntersecting).map((e) => Number(e.target.dataset.step));
            if (hit.length) setActive(hit[0]);
        }, { root, rootMargin: '-45% 0px -45% 0px' });
        stepRefs.current.forEach((el) => el && io.observe(el));
        return () => io.disconnect();
    }, []);

    const times = useMemo(() => (data ? scrubTimes(data.malana) : []), [data]);
    // reaching step 3 starts the scrubber once (reduced motion: shows the final state, no autoplay)
    if (data && active === 2 && !played) {
        setPlayed(true);
        setScrub(reduced ? times.at(-1) : times[0]);
        setPlaying(!reduced);
    }
    useEffect(() => {
        if (!playing || active !== 2) return undefined;
        const t = setTimeout(() => {
            const i = times.indexOf(scrub);
            if (i < times.length - 1) setScrub(times[i + 1]);
            else setPlaying(false);
        }, SCRUB_MS);
        return () => clearTimeout(t);
    }, [playing, scrub, active, times]);

    const go = useCallback((i) => {
        const n = Math.max(0, Math.min(STEP_TITLES.length - 1, i));
        setActive(n);
        // phones: the step's top just below the pinned map (scroll-margin 50vh)
        stepRefs.current[n]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: wide ? 'center' : 'start' });
    }, [reduced, wide]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active, go]);

    const overlay = data && (
        active === 2 ? (scrub && <Scrubber m={data.malana} value={scrub} setValue={setScrub} playing={playing} setPlaying={setPlaying} />)
            : active === 3 ? <ReasonsChart e={data.explain} />
                : active === 5 ? <CsiChart c={data.csi} />
                    : active === 6 ? <FreshnessBars rt={data.realtime} /> : null
    );

    return (
        <div data-testid="overview-page" data-reduced-motion={String(reduced)} className="flex flex-col h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 overflow-hidden">
            <TopHeader />
            <main ref={scroller} data-testid="overview-scroller" className="flex-1 overflow-y-auto overflow-x-hidden">
                <div className="px-4 sm:px-8 py-4 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="min-w-0 flex-1">
                        <h2 data-testid="overview-heading" className="text-sm font-black uppercase tracking-wide text-blue-700 dark:text-blue-300">System briefing</h2>
                        <p data-testid="overview-headline" className="text-xl font-black leading-snug">Short-range (1–6 h) warnings for Himalayan cloudbursts, thunderstorms and flash floods, each one explained.</p>
                    </div>
                    <Link to="/nowcast" data-testid="overview-skip" className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-base">
                        Skip the briefing <ArrowRight size={18} /> Explore map
                    </Link>
                </div>
                <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                    {/* map: pinned (phones: the top half) */}
                    <div data-map-host className="sticky top-0 z-10 h-[50vh] lg:h-[calc(100vh-72px)] lg:col-start-2 lg:row-start-1 border-b lg:border-b-0 lg:border-l border-slate-200 dark:border-slate-800">
                        <BriefingMap data={data} step={active} scrub={scrub} reduced={reduced} />
                        {overlay && wide && <div className="absolute z-[500] left-6 right-16 flex pointer-events-none" style={{ bottom: 'calc(var(--attr-h, 22px) + 12px)' }}>{overlay}</div>}
                        <nav aria-label="Briefing steps" data-testid="overview-dots" className="absolute z-[500] top-3 right-3 flex lg:flex-col gap-2 rounded-full bg-white/90 dark:bg-slate-900/90 p-2 shadow">
                            {STEP_TITLES.map((t, i) => (
                                <button key={t} type="button" data-testid={`ov-dot-${i + 1}`} aria-label={`Step ${i + 1}: ${t}`} aria-current={active === i ? 'step' : undefined}
                                    onClick={() => go(i)} className={`w-3.5 h-3.5 rounded-full border-2 ${active === i ? 'bg-blue-600 border-blue-600' : 'border-slate-400 hover:border-blue-500'}`} />
                            ))}
                        </nav>
                    </div>
                    <div className="lg:col-start-1 lg:row-start-1 px-4 sm:px-8">
                        {error && <p className="mt-6 text-base text-red-700">The briefing data could not be loaded ({error}). <Link to="/nowcast" className="underline">Explore the map</Link></p>}
                        {STEP_TITLES.map((t, i) => (
                            <section key={t} ref={(el) => { stepRefs.current[i] = el; }} data-step={i} data-testid={`ov-step-${i + 1}`}
                                data-active={String(active === i)}
                                className={`min-h-[60vh] lg:min-h-[calc(100vh-72px)] scroll-mt-[50vh] lg:scroll-mt-0 flex flex-col justify-start lg:justify-center py-6 lg:py-10 ${reduced ? '' : 'transition-opacity duration-500'} ${active === i ? 'opacity-100' : 'opacity-40'}`}>
                                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{i + 1} / {STEP_TITLES.length}</p>
                                <h3 className="text-step-heading font-black mt-1">{t}</h3>
                                <p data-testid={`ov-text-${i + 1}`} className="text-step mt-3 max-w-[40rem]">{stepText(i, data) || '…'}</p>
                                {overlay && !wide && active === i && <div className="mt-4 flex">{overlay}</div>}
                                {i === 2 && data && <p className="mt-3"><span className="text-sm font-bold px-2 py-1 rounded bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100">{data.malana.case_label}</span></p>}
                                {i === 4 && data && (
                                    <>
                                        <InsatMultiples i={data.insat} />
                                        <p data-testid="ov-insat-caption" className="mt-3 text-base font-bold">{data.insat.scope} Observation only, not a model input.</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">{data.insat.label}; {data.insat.floor_line}</p>
                                    </>
                                )}
                                {i === 5 && data && (
                                    <p className="mt-3"><Link to={`${data.known_limits.to}#${data.known_limits.anchor}`} data-testid="ov-known-limits" className="inline-flex items-center gap-1 font-bold text-blue-700 dark:text-blue-300 hover:underline text-base">Known limits <ArrowRight size={16} /></Link></p>
                                )}
                                {i === 7 && data && <ExploreCards cards={data.explore} />}
                            </section>
                        ))}
                    </div>
                </div>
                <footer className="px-4 sm:px-8 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a]">
                    <p data-testid="overview-disclaimer" className="text-base font-bold">Not an official warning. Follow IMD and state advisories.</p>
                </footer>
                <DataCredits />
            </main>
        </div>
    );
};

export default Overview;
