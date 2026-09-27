import { useState } from 'react';
import TopHeader from '../components/TopHeader';
import ReplayView from '../components/nowcast/ReplayView';
import CaveatsBar from '../components/nowcast/CaveatsBar';

// lgbm_v0 nowcast outputs (served by nowcast_data/serve through the backend's /ml proxy).
const TABS = [
    { id: 'replay', label: 'Event replay' },
];

const Nowcast = () => {
    const [tab, setTab] = useState('replay');
    return (
        <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden">
            <TopHeader />
            <div className="px-6 pt-3 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 flex items-end gap-6 shrink-0">
                <div className="pb-2">
                    <h2 className="text-lg font-black leading-tight">ML Nowcast: thunderstorm, cloudburst and flash-flood risk, 1–6 h</h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">LightGBM model lgbm_v0 (frozen) · 0.1° grid · Himalaya cloudburst study</p>
                </div>
                <nav className="flex gap-1 ml-auto">
                    {TABS.map((t) => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`px-4 py-2 text-sm font-bold rounded-t-lg border-b-[3px] transition-colors ${tab === t.id
                                ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
                            {t.label}
                        </button>
                    ))}
                </nav>
            </div>
            {tab === 'replay' && <ReplayView />}
            <CaveatsBar />
        </div>
    );
};

export default Nowcast;
