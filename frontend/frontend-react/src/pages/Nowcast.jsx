import { useState } from 'react';
import TopHeader from '../components/TopHeader';
import ReplayView from '../components/nowcast/ReplayView';
import NationalView from '../components/nowcast/NationalView';
import LiveView from '../components/nowcast/LiveView';
import DataCredits from '../components/nowcast/DataCredits';
import { NowcastPageLinks } from '../components/nowcast/PageShell';

// lgbm_v0 nowcast outputs (served by nowcast_data/serve through the backend's /ml proxy).
const TABS = [
    { id: 'replay', label: 'Event replay' },
    { id: 'india', label: 'National sample' },
    { id: 'live', label: 'Live (not validated)' },
];

const Nowcast = () => {
    const [tab, setTab] = useState('replay');
    return (
        <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden">
            <TopHeader />
            <div className="px-6 pt-2 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 flex items-end gap-5 shrink-0">
                <div className="pb-2 min-w-0 flex-1">
                    <h2 className="text-[15px] 2xl:text-lg font-black leading-tight truncate" title="ML Nowcast: thunderstorm, cloudburst and flash-flood risk, 1–6 h">ML Nowcast: thunderstorm, cloudburst and flash-flood risk, 1–6 h</h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">LightGBM model lgbm_v0 (frozen) · 0.1° grid · Himalaya cloudburst study</p>
                </div>
                <div className="pb-2 shrink-0"><NowcastPageLinks /></div>
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
            {tab === 'replay' && <ReplayView />}
            {tab === 'india' && <NationalView />}
            {tab === 'live' && <LiveView />}
            <DataCredits />
        </div>
    );
};

export default Nowcast;
