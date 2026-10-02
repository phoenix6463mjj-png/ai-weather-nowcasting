import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import TopHeader from '../components/TopHeader';
import ReplayView from '../components/nowcast/ReplayView';
import NationalView from '../components/nowcast/NationalView';
import LiveView from '../components/nowcast/LiveView';
import DataCredits from '../components/nowcast/DataCredits';
import StartHere from '../components/nowcast/StartHere';
import { startHereDismissed, rememberStartHereDismissed } from '../utils/startHereStorage';
import { nowcastTarget } from '../utils/nowcastUrl';
import { getStartHere } from '../services/nowcastApi';

// lgbm_v0 nowcast outputs (served by nowcast_data/serve through the backend's /ml proxy).
const TABS = [
    { id: 'replay', label: 'Event replay' },
    { id: 'india', label: 'All-India example' },
    { id: 'live', label: 'Live (not validated)' },
];

const Nowcast = () => {
    const navigate = useNavigate();
    const [tab, setTab] = useState(() => nowcastTarget().view || 'replay');
    const [startOpen, setStartOpen] = useState(() => !startHereDismissed());
    const [start, setStart] = useState({ data: null, error: null });
    const [jump, setJump] = useState(null);             // replay target picked in Start here (or the Pipalkoti link)
    // below 1600 px the opening alert waits (drawer collapsed) while Start here is open
    const [narrow, setNarrow] = useState(() => window.innerWidth < 1600);
    useEffect(() => {
        const on = () => setNarrow(window.innerWidth < 1600);
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);

    useEffect(() => {
        let live = true;
        getStartHere().then((d) => live && setStart({ data: d, error: null }))
            .catch((e) => live && setStart({ data: null, error: e.message }));
        return () => { live = false; };
    }, []);

    const closeStart = useCallback(() => { setStartOpen(false); rememberStartHereDismissed(); }, []);
    // a jump remounts the replay view with the target as its opening view
    const goReplay = useCallback((t) => { setTab('replay'); setJump({ ...t, nonce: Date.now() }); }, []);
    const go = (f) => {
        closeStart();
        if (f.target.kind === 'replay') goReplay(f.target);
        else navigate(`${f.target.to}#${f.target.anchor}`);
    };

    // Start here sits over the map, right of the Layers panel (never over the drawer or the badges)
    const overlay = startOpen ? (
        <div className="absolute z-[600] top-3 bottom-3 left-[294px] right-3 flex flex-col items-start pointer-events-none">
            <StartHere data={start.data} error={start.error} onClose={closeStart} onGo={go} />
        </div>
    ) : null;

    return (
        <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden">
            <TopHeader />
            <div className="px-6 pt-2 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 flex items-end gap-5 shrink-0">
                <div className="pb-2 min-w-0 flex-1">
                    <h2 className="text-lg font-black leading-tight truncate" title="ML Nowcast: thunderstorm, cloudburst and flash-flood risk, 1–6 h · LightGBM model lgbm_v0 (frozen) · 0.1° grid · Himalaya cloudburst study">ML Nowcast: thunderstorm, cloudburst and flash-flood risk, 1–6 h</h2>
                    <p className="hidden min-[1600px]:block text-sm text-slate-500 dark:text-slate-400 truncate">LightGBM model lgbm_v0 (frozen) · 0.1° grid · Himalaya cloudburst study</p>
                </div>
                <div className="pb-2 shrink-0 flex items-center gap-2">
                    <button type="button" data-testid="start-here-open" aria-pressed={startOpen}
                        onClick={() => (startOpen ? closeStart() : setStartOpen(true))}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap border border-blue-600 text-blue-700 dark:text-blue-300 ${startOpen
                            ? 'bg-blue-100 dark:bg-blue-950' : 'hover:bg-blue-50 dark:hover:bg-slate-800'}`}>
                        <Compass size={16} /> Start here
                    </button>
                </div>
                <nav className="flex gap-1 shrink-0">
                    {TABS.map((t) => (
                        <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
                            className={`px-3 2xl:px-4 py-2 text-sm font-bold whitespace-nowrap rounded-t-lg border-b-[3px] transition-colors ${tab === t.id
                                ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
                            {t.label}
                        </button>
                    ))}
                </nav>
            </div>
            {tab === 'replay' && <ReplayView key={jump ? jump.nonce : 'open'} jump={jump} onJump={goReplay} startHere={start.data} mapOverlay={overlay} holdDrawer={startOpen && narrow} />}
            {tab === 'india' && <NationalView mapOverlay={overlay} />}
            {tab === 'live' && <LiveView mapOverlay={overlay} />}
            <DataCredits />
        </div>
    );
};

export default Nowcast;
