import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, MapPin, CloudLightning, ChevronDown, Menu, X } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import TeamCredits from './TeamCredits';

// Site navigation. The ML pages first; the team's rule-based current-weather pages sit in one menu
// ("Current weather (rule-based)"), each of which keeps its own "not the ML model" label.
const ML_NAV = [
    { to: '/', label: 'Overview', end: true, id: 'overview' },
    { to: '/nowcast', label: 'Explore map', end: true, id: 'explore' },
    { to: '/nowcast/results', label: 'Results', id: 'results' },
    { to: '/analytics', label: 'Analytics', id: 'analytics' },
];
const RULE_NAV = [
    { to: '/dashboard', label: 'Dashboard', id: 'dashboard' },
    { to: '/forecast', label: 'Forecast', id: 'forecast' },
    { to: '/alerts', label: 'Alerts', id: 'alerts' },
    { to: '/reports', label: 'Reports', id: 'reports' },
];
const RULE_MENU_LABEL = 'Current weather (rule-based)';
const RULE_MENU_NOTE = 'Rule-based indicators from current weather, not the ML model.';

const linkClass = ({ isActive }) => `nav-text font-bold h-full flex items-center pt-0.5 border-b-[3px] whitespace-nowrap transition-colors ${isActive
    ? 'text-blue-600 dark:text-blue-400 border-blue-600' : 'text-slate-600 dark:text-slate-300 border-transparent hover:text-slate-900 dark:hover:text-white'}`;
const itemClass = ({ isActive }) => `block px-4 py-2 rounded-lg nav-text font-bold ${isActive
    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`;

// A dropdown that closes on Esc, on an outside click and on navigation.
function useDropdown() {
    const [open, setOpen] = useState(false);
    const box = useRef(null);
    const { pathname } = useLocation();
    const [at, setAt] = useState(pathname);
    if (at !== pathname) { setAt(pathname); setOpen(false); }
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
    }, [open]);
    return { open, setOpen, box };
}

const RuleMenu = () => {
    const { open, setOpen, box } = useDropdown();
    const { pathname } = useLocation();
    const active = RULE_NAV.some((r) => pathname.startsWith(r.to));
    return (
        <div ref={box} className="relative h-full flex items-center">
            <button type="button" data-testid="nav-rule-menu" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                className={`nav-text font-bold h-full flex items-center gap-1 pt-0.5 border-b-[3px] whitespace-nowrap ${active
                    ? 'text-blue-600 dark:text-blue-400 border-blue-600' : 'text-slate-600 dark:text-slate-300 border-transparent hover:text-slate-900 dark:hover:text-white'}`}>
                {RULE_MENU_LABEL} <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
            </button>
            {open && (
                <div data-testid="nav-rule-items" role="menu" className="absolute right-0 top-full mt-1 w-72 z-[2100] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2">
                    <p className="px-4 pt-1 pb-2 text-sm text-slate-500 dark:text-slate-400">{RULE_MENU_NOTE}</p>
                    {RULE_NAV.map((r) => (
                        <NavLink key={r.to} to={r.to} role="menuitem" data-testid={`nav-${r.id}`} className={itemClass}>{r.label}</NavLink>
                    ))}
                </div>
            )}
        </div>
    );
};

// Below 1280 px: one "Menu" button with every page.
const CompactMenu = () => {
    const { open, setOpen, box } = useDropdown();
    return (
        <div ref={box} className="xl:hidden relative">
            <button type="button" data-testid="nav-compact" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 nav-text font-bold text-slate-700 dark:text-slate-200">
                {open ? <X size={18} /> : <Menu size={18} />}<span className="hidden sm:inline">Menu</span>
            </button>
            {open && (
                <div data-testid="nav-compact-items" className="absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2rem))] z-[2100] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2">
                    {ML_NAV.map((r) => <NavLink key={r.to} to={r.to} end={r.end} className={itemClass}>{r.label}</NavLink>)}
                    <p className="px-4 pt-3 pb-1 text-sm font-bold text-slate-500 dark:text-slate-400">{RULE_MENU_LABEL}</p>
                    {RULE_NAV.map((r) => <NavLink key={r.to} to={r.to} className={itemClass}>{r.label}</NavLink>)}
                </div>
            )}
        </div>
    );
};

const TopHeader = ({ onSearch, searchLoading, selectedCity, alertCount = null, showCredits = false }) => {
    const [searchInput, setSearchInput] = useState('');
    const navigate = useNavigate();
    // The city pill, search and alert bell belong to the rule-based pages (they pass selectedCity).
    const ruleBased = selectedCity !== undefined || Boolean(onSearch);

    const handleSubmit = (e) => {
        if (e) e.preventDefault();
        if (searchInput.trim()) {
            if (onSearch) {
                onSearch(searchInput.trim());
            } else {
                navigate(`/dashboard?city=${encodeURIComponent(searchInput.trim())}`);
            }
        }
    };

    return (
        <header className="h-[72px] bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 px-4 sm:px-6 z-50 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
                <Link to="/" className="flex items-center gap-3 hover:opacity-95 transition-opacity min-w-0">
                    <div className="bg-blue-600 p-2 rounded-xl text-white shadow-md shadow-blue-500/20 shrink-0">
                        <CloudLightning size={24} />
                    </div>
                    <div className="min-w-0">
                        <h1 data-testid="header-title" className="text-[17px] sm:text-xl font-black text-slate-900 dark:text-white leading-tight tracking-tight sm:whitespace-nowrap">AI Weather Nowcasting System</h1>
                        <p data-testid="header-subtitle" className="hidden min-[1700px]:block text-sm font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Hyper-Local Early Warning System</p>
                    </div>
                </Link>

                {/* long place names are cut with an ellipsis (full name on hover), never the title */}
                {selectedCity !== undefined && (
                    <div data-testid="header-city" title={selectedCity || "India Network"} className="hidden min-[1600px]:flex items-center gap-1.5 px-3 py-1.5 min-w-0 max-w-[220px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full border border-blue-100 dark:border-blue-800">
                        <MapPin size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="text-sm font-bold truncate">{selectedCity || "India Network"}</span>
                    </div>
                )}
            </div>

            <nav data-testid="site-nav" className="hidden xl:flex items-center gap-5 2xl:gap-7 h-full shrink-0">
                {ML_NAV.map((r) => (
                    <NavLink key={r.to} to={r.to} end={r.end} data-testid={`nav-${r.id}`} className={linkClass}>{r.label}</NavLink>
                ))}
                <RuleMenu />
            </nav>

            <div className="flex items-center shrink-0 gap-2 sm:gap-3 2xl:gap-5">
                {ruleBased && (
                    <form onSubmit={handleSubmit} className="relative hidden min-[1600px]:flex items-center">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search city…"
                            aria-label="Search city (e.g. Mumbai, Jaipur)"
                            disabled={searchLoading}
                            className="w-56 2xl:w-64 pl-9 pr-20 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 dark:focus:border-blue-500 rounded-lg text-sm outline-none transition-colors dark:text-white placeholder:text-slate-400 text-ellipsis"
                        />
                        <button
                            type="submit"
                            disabled={searchLoading || !searchInput.trim()}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded text-sm font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer"
                        >
                            {searchLoading ? (
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <span>Find</span>
                            )}
                        </button>
                    </form>
                )}

                {showCredits && <TeamCredits />}

                {ruleBased && (
                    <Link to="/alerts" className="relative cursor-pointer hover:opacity-80 transition-opacity hidden sm:block" title="View Weather Alerts">
                        <Bell size={20} className="text-slate-600 dark:text-slate-300" />
                        {alertCount != null && alertCount > 0 && (
                            <span className="absolute -top-2 -right-2 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white border-2 border-white dark:border-slate-900">
                                {alertCount}
                            </span>
                        )}
                    </Link>
                )}

                <ThemeToggle />
                <CompactMenu />
            </div>
        </header>
    );
};

export default TopHeader;
