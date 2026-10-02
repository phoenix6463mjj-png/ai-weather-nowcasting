import { NavLink } from 'react-router-dom';
import TopHeader from '../TopHeader';
import DataCredits from './DataCredits';

const NOWCAST_PAGES = [
    { to: '/nowcast', label: 'Nowcast map', end: true },
    { to: '/nowcast/results', label: 'Results' },
    { to: '/nowcast/approach', label: 'Approach & live readiness' },
];

// Links between the Nowcast pages (map, results, approach).
export const NowcastPageLinks = () => (
    <nav data-testid="nowcast-page-links" className="flex flex-wrap gap-1">
        {NOWCAST_PAGES.map((p) => (
            <NavLink key={p.to} to={p.to} end={p.end} data-testid={`page-link-${p.to.split('/').pop()}`}
                className={({ isActive }) => `px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap ${isActive
                    ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                {p.label}
            </NavLink>
        ))}
    </nav>
);

export const Quote = ({ q, testid }) => (
    <blockquote data-testid={testid} className="border-l-2 border-slate-300 dark:border-slate-600 pl-2 text-sm text-slate-600 dark:text-slate-300 leading-normal">
        “{q.quote.replace(/\*\*/g, '').replace(/\\_/g, '_').replace(/\n\s*/g, ' ')}” <span className="text-slate-400">({q.source})</span>
    </blockquote>
);

export const Card = ({ title, children, testid, className = '' }) => (
    <section data-testid={testid} className={`bg-white dark:bg-[#0f172a] rounded-xl border border-slate-200 dark:border-slate-800 p-4 ${className}`}>
        {title && <h3 className="text-base font-black mb-2">{title}</h3>}
        {children}
    </section>
);

const PageShell = ({ title, subtitle, children, testid }) => (
    <div data-testid={testid} className="flex flex-col h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden">
        <TopHeader />
        <div className="px-4 sm:px-6 py-3 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-end gap-x-6 gap-y-2 shrink-0">
            <div className="min-w-0 flex-1 basis-80">
                <h2 className="text-xl font-black leading-tight">{title}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            </div>
            <div className="ml-auto"><NowcastPageLinks /></div>
        </div>
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-4">{children}</main>
        <DataCredits />
    </div>
);

export default PageShell;
