import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Right-side details drawer (layout rule: ONE drawer, collapsed by default, one section at a time,
 * Esc / × closes). It sits beside the map in the flex row (it pushes the map, never covers it),
 * so map controls stay visible. The icon rail is always shown; clicking an icon opens that section.
 *   tabs: [{ id, label, short?, icon: LucideIcon, width?: px }]   active: tab id or null (collapsed)
 *   (short: the icon rail's text when the label is long; the panel header always shows label)
 * On screens >= 1600 px wide, sections up to 500 px get 25 % wider (16 px body text).
 */
const WIDE_MIN = 1600;
const WIDE_SCALE = 1.25;
const Drawer = ({ tabs, active, onOpen, onClose, children }) => {
    const open = tabs.find((t) => t.id === active) || null;
    const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= WIDE_MIN);
    useEffect(() => {
        const on = () => setWide(window.innerWidth >= WIDE_MIN);
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    const base = open ? open.width || 420 : 0;
    const width = wide && base <= 500 ? Math.round(base * WIDE_SCALE) : base;

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    return (
        <div data-testid="drawer" data-open={open ? open.id : ''} className="flex shrink-0 h-full">
            {open && (
                <section data-testid={`drawer-panel-${open.id}`} aria-label={open.label}
                    style={{ width }} data-width={width}
                    className="h-full flex flex-col border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] min-w-0">
                    <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
                        <open.icon size={18} className="text-slate-500" />
                        <h3 className="text-lg font-black text-slate-900 dark:text-white">{open.label}</h3>
                        <button type="button" data-testid="drawer-close" onClick={onClose} title="Close (Esc)" aria-label="Close details"
                            className="ml-auto p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
                            <X size={16} />
                        </button>
                    </header>
                    <div className="flex-1 overflow-y-auto text-base leading-normal">{children(open.id)}</div>
                </section>
            )}
            <nav aria-label="Details" className="w-[92px] h-full flex flex-col items-stretch gap-1 py-2 border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                {tabs.map((t) => {
                    const on = t.id === active;
                    return (
                        <button key={t.id} type="button" data-testid={`drawer-tab-${t.id}`} aria-pressed={on}
                            onClick={() => (on ? onClose() : onOpen(t.id))} title={on ? `Close ${t.label}` : `Open ${t.label}`}
                            className={`mx-1 py-2 rounded-lg flex flex-col items-center gap-0.5 text-xs font-bold leading-tight transition-colors ${on
                                ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'}`}>
                            <t.icon size={17} />
                            <span className="text-center">{t.short || t.label}</span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
};

export default Drawer;
