import React, { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Search, Bell, MapPin, CloudLightning } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import TeamCredits from './TeamCredits';

const TopHeader = ({ onSearch, searchLoading, selectedCity, alertCount = null, showCredits = false }) => {
    const [searchInput, setSearchInput] = useState('');
    const navigate = useNavigate();

    const handleSubmit = (e) => {
        if (e) e.preventDefault();
        if (searchInput.trim()) {
            if (onSearch) {
                onSearch(searchInput.trim());
            } else {
                navigate(`/?city=${encodeURIComponent(searchInput.trim())}`);
            }
        }
    };

    return (
        <header className="h-[72px] bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 z-50 shrink-0">
            <div className="flex items-center gap-4 2xl:gap-8 min-w-0">
                <Link to="/" className="flex items-center gap-3 hover:opacity-95 transition-opacity shrink-0">
                    <div className="bg-blue-600 p-2 rounded-xl text-white shadow-md shadow-blue-500/20">
                        <CloudLightning size={24} />
                    </div>
                    <div>
                        <h1 data-testid="header-title" className="text-xl font-black text-slate-900 dark:text-white leading-tight tracking-tight whitespace-nowrap">AI Weather Nowcasting System</h1>
                        <p data-testid="header-subtitle" className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Hyper-Local Early Warning System</p>
                    </div>
                </Link>
                
                {/* long place names are cut with an ellipsis (full name on hover), never the title */}
                <div data-testid="header-city" title={selectedCity || "India Network"} className="flex items-center gap-1.5 px-3 py-1.5 min-w-0 max-w-[150px] 2xl:max-w-[280px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full border border-blue-100 dark:border-blue-800">
                    <MapPin size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-xs font-bold truncate">{selectedCity || "India Network"}</span>
                </div>
            </div>

            <nav className="hidden xl:flex items-center gap-5 2xl:gap-8 h-full shrink-0 px-4">
                <NavLink 
                    to="/" 
                    className={({ isActive }) => 
                        isActive 
                            ? "text-sm font-bold text-blue-600 dark:text-blue-400 border-b-[3px] border-blue-600 h-full flex items-center pt-0.5" 
                            : "text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors h-full flex items-center pt-0.5"
                    }
                >
                    Dashboard
                </NavLink>
                <NavLink 
                    to="/forecast" 
                    className={({ isActive }) => 
                        isActive 
                            ? "text-sm font-bold text-blue-600 dark:text-blue-400 border-b-[3px] border-blue-600 h-full flex items-center pt-0.5" 
                            : "text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors h-full flex items-center pt-0.5"
                    }
                >
                    Forecast
                </NavLink>
                <NavLink 
                    to="/analytics" 
                    className={({ isActive }) => 
                        isActive 
                            ? "text-sm font-bold text-blue-600 dark:text-blue-400 border-b-[3px] border-blue-600 h-full flex items-center pt-0.5" 
                            : "text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors h-full flex items-center pt-0.5"
                    }
                >
                    Analytics
                </NavLink>
                <NavLink 
                    to="/alerts" 
                    className={({ isActive }) => 
                        isActive 
                            ? "text-sm font-bold text-blue-600 dark:text-blue-400 border-b-[3px] border-blue-600 h-full flex items-center pt-0.5" 
                            : "text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors h-full flex items-center pt-0.5"
                    }
                >
                    Alerts
                </NavLink>
                <NavLink 
                    to="/reports" 
                    className={({ isActive }) => 
                        isActive 
                            ? "text-sm font-bold text-blue-600 dark:text-blue-400 border-b-[3px] border-blue-600 h-full flex items-center pt-0.5" 
                            : "text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors h-full flex items-center pt-0.5"
                    }
                >
                    Reports
                </NavLink>
                <NavLink
                    to="/nowcast"
                    className={({ isActive }) =>
                        isActive
                            ? "text-sm font-bold text-blue-600 dark:text-blue-400 border-b-[3px] border-blue-600 h-full flex items-center pt-0.5"
                            : "text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors h-full flex items-center pt-0.5"
                    }
                >
                    ML Nowcast
                </NavLink>
            </nav>

            <div className={`flex items-center shrink-0 ${showCredits ? 'gap-4 2xl:gap-6' : 'gap-6'}`}>
                <form onSubmit={handleSubmit} className="relative hidden md:flex items-center">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                        type="text" 
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search city…"
                        aria-label="Search city (e.g. Mumbai, Jaipur)" 
                        disabled={searchLoading}
                        className="w-52 2xl:w-72 pl-9 pr-20 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 dark:focus:border-blue-500 rounded-lg text-sm outline-none transition-colors dark:text-white placeholder:text-slate-400 text-ellipsis"
                    />
                    <button
                        type="submit"
                        disabled={searchLoading || !searchInput.trim()}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded text-xs font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer"
                    >
                        {searchLoading ? (
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <span>Find</span>
                        )}
                    </button>
                </form>
                
                {showCredits && <TeamCredits />}

                <Link to="/alerts" className="relative cursor-pointer hover:opacity-80 transition-opacity" title="View Weather Alerts">
                    <Bell size={20} className="text-slate-600 dark:text-slate-300" />
                    {alertCount != null && alertCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border-2 border-white dark:border-slate-900">
                            {alertCount}
                        </span>
                    )}
                </Link>
                
                <ThemeToggle />
                
            </div>
        </header>
    );
};

export default TopHeader;
