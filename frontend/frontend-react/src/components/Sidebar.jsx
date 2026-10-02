import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Home, Map, CloudRain, Bell, BarChart2, FileText, Play } from 'lucide-react';

const Sidebar = ({
    live = false,
    activeLayers = { thunderstorm: true, cloudburst: true, flood: true },
    setActiveLayers,
    onMonitorIndia,
    onRegionSelect,
    loading = false
}) => {
    const toggleLayer = (layer) => {
        if (setActiveLayers) {
            setActiveLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
        }
    };

    const navLinkClass = ({ isActive }) =>
        isActive
            ? "flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-xl font-bold transition-colors"
            : "flex items-center gap-3 px-4 py-3 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl font-semibold transition-colors";

    return (
        <aside className="w-[260px] bg-white dark:bg-[#0f172a] border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between overflow-y-auto shrink-0 z-40">
            <div className="p-4">
                <nav className="space-y-1">
                    <NavLink to="/" end className={navLinkClass}>
                        <Home size={18} />
                        <span className="text-sm">Dashboard</span>
                    </NavLink>
                    {/* the ML Nowcast map (calibrated probability maps for India) */}
                    <NavLink to="/nowcast" data-testid="sidebar-live-map" className={({ isActive }) => `${navLinkClass({ isActive })} justify-between`}>
                        <div className="flex items-center gap-3">
                            <Map size={18} />
                            <span className="text-sm">Live Map</span>
                        </div>
                        <span className="bg-blue-500 text-white text-xs font-black px-1.5 py-0.5 rounded-sm">ML</span>
                    </NavLink>
                    <NavLink to="/forecast" className={navLinkClass}>
                        <CloudRain size={18} />
                        <span className="text-sm">Forecast</span>
                    </NavLink>
                    <NavLink to="/alerts" className={({ isActive }) =>
                        isActive
                            ? "flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-xl font-bold transition-colors"
                            : "flex items-center justify-between px-4 py-3 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl font-semibold transition-colors"
                    }>
                        <div className="flex items-center gap-3">
                            <Bell size={18} />
                            <span className="text-sm">Alerts</span>
                        </div>
                        {live && <span data-testid="sidebar-live" className="bg-emerald-600 text-white text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap">Current weather</span>}
                    </NavLink>
                    <NavLink to="/analytics" className={navLinkClass}>
                        <BarChart2 size={18} />
                        <span className="text-sm">Analytics</span>
                    </NavLink>
                    <NavLink to="/reports" className={navLinkClass}>
                        <FileText size={18} />
                        <span className="text-sm">Reports</span>
                    </NavLink>
                </nav>

                <div className="mt-8">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-4">Event Layers</h3>
                    <div className="space-y-3 px-4">
                        {/* Thunderstorm Layer */}
                        <div
                            onClick={() => toggleLayer('thunderstorm')}
                            className="flex items-center justify-between p-1.5 -mx-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                        >
                            <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                                <CloudRain size={16} className="text-amber-500" />
                                <span className="text-sm font-bold select-none">Thunderstorm</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={Boolean(activeLayers.thunderstorm)}
                                aria-label="Toggle Thunderstorm Filter"
                                onClick={(e) => { e.stopPropagation(); toggleLayer('thunderstorm'); }}
                                className={`w-9 h-5 rounded-full relative cursor-pointer shadow-inner transition-colors duration-200 focus:outline-none ${activeLayers.thunderstorm ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                            >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm transition-all duration-200 ${activeLayers.thunderstorm ? 'right-0.5 bg-white' : 'left-0.5 bg-white dark:bg-slate-400'}`}></span>
                            </button>
                        </div>

                        {/* Cloudburst Layer */}
                        <div
                            onClick={() => toggleLayer('cloudburst')}
                            className="flex items-center justify-between p-1.5 -mx-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                        >
                            <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                                <CloudRain size={16} className="text-blue-500" />
                                <span className="text-sm font-bold select-none">Cloudburst</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={Boolean(activeLayers.cloudburst)}
                                aria-label="Toggle Cloudburst Filter"
                                onClick={(e) => { e.stopPropagation(); toggleLayer('cloudburst'); }}
                                className={`w-9 h-5 rounded-full relative cursor-pointer shadow-inner transition-colors duration-200 focus:outline-none ${activeLayers.cloudburst ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                            >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm transition-all duration-200 ${activeLayers.cloudburst ? 'right-0.5 bg-white' : 'left-0.5 bg-white dark:bg-slate-400'}`}></span>
                            </button>
                        </div>

                        {/* Flash Flood Layer */}
                        <div
                            onClick={() => toggleLayer('flood')}
                            className="flex items-center justify-between p-1.5 -mx-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                        >
                            <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                                <CloudRain size={16} className="text-teal-500" />
                                <span className="text-sm font-bold select-none">Flash Flood</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={Boolean(activeLayers.flood)}
                                aria-label="Toggle Flash Flood Filter"
                                onClick={(e) => { e.stopPropagation(); toggleLayer('flood'); }}
                                className={`w-9 h-5 rounded-full relative cursor-pointer shadow-inner transition-colors duration-200 focus:outline-none ${activeLayers.flood ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                            >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm transition-all duration-200 ${activeLayers.flood ? 'right-0.5 bg-white' : 'left-0.5 bg-white dark:bg-slate-400'}`}></span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-8 px-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Region</h3>
                    <select
                        onChange={(e) => onRegionSelect && onRegionSelect(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-bold outline-none"
                    >
                        <option value="India">All India</option>
                        <option value="Delhi">NCR Region</option>
                        <option value="Mumbai">Mumbai Metro</option>
                        <option value="Bangalore">Bengaluru Urban</option>
                        <option value="Kolkata">Kolkata Metro</option>
                        <option value="Chennai">Chennai Metro</option>
                    </select>
                </div>

                <div className="mt-6 px-4">
                    <button
                        onClick={onMonitorIndia}
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-500/25 cursor-pointer"
                    >
                        {loading ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>Scanning India...</span>
                            </>
                        ) : (
                            <>
                                <Play size={16} className="fill-white" />
                                <span>Monitor India</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="p-4 mt-auto">
                <div className="relative rounded-xl overflow-hidden shadow-sm h-32 flex flex-col justify-end p-4 border border-slate-200 dark:border-slate-800">
                    <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1542224566-6e85f2e6772f?auto=format&fit=crop&w=600&q=80')] bg-cover bg-center"></div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent"></div>
                    <a data-testid="photo-credit" href="https://unsplash.com/license" target="_blank" rel="noreferrer" className="absolute top-1 right-2 z-20 px-1.5 py-px rounded bg-black/45 text-xs font-semibold text-white hover:bg-black/70">Photo: Unsplash</a>
                    <Link to="/nowcast" data-testid="sidebar-nowcast-card" className="relative z-10 flex items-center justify-between hover:opacity-90">
                        <div>
                            <p className="text-white font-bold leading-tight text-sm">ML Nowcast<br/>maps and alerts</p>
                        </div>
                        <div className="w-6 h-6 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">
                            <span className="text-white text-xs">➔</span>
                        </div>
                    </Link>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
