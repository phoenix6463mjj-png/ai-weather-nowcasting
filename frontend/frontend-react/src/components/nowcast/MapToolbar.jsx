// The slim toolbar along the top of the map: the most-used controls, never collapsed. Event and issue pickers
// (passed as children), lead-time buttons and "Also show Watch". On a phone it wraps inside itself.
const MapToolbar = ({ children, leads, lead, setLead, leadInfo = {}, showWatch, setShowWatch }) => (
    <div data-testid="map-toolbar" className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800">
        {children}
        {leads?.length > 0 && (
            <div role="group" aria-label="Lead time" className="flex items-center gap-1">
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400 mr-0.5">Lead</span>
                {leads.map((L) => (
                    <button key={L} type="button" onClick={() => setLead(L)} data-testid={`lead-${L}`} aria-pressed={L === lead}
                        title={leadInfo[L] ? `valid ${leadInfo[L].valid} · probabilities are "within ${leadInfo[L].radius} km"` : undefined}
                        className={`px-2 py-0.5 rounded-md text-sm font-bold transition-colors ${L === lead
                            ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                        {L} h
                    </button>
                ))}
                {leadInfo[lead] && <span data-testid="lead-valid" className="hidden min-[1600px]:inline ml-1 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">valid {leadInfo[lead].valid}</span>}
            </div>
        )}
        {setShowWatch && (
            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100 cursor-pointer whitespace-nowrap">
                <input type="checkbox" data-testid="watch-toggle" checked={showWatch} onChange={(e) => setShowWatch(e.target.checked)} />
                Also show Watch
            </label>
        )}
    </div>
);

export default MapToolbar;
