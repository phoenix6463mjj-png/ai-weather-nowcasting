// Slim strip at the top of the map for the always-visible badges (split / in-sample /
// case study / forecast-only / Live "not validated"). Never inside the drawer.
export const MapBadges = ({ children, testid = 'map-badges',
    tone = 'border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a]' }) => (
    <div data-testid={testid}
        className={`px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0 ${tone}`}>
        {children}
    </div>
);
