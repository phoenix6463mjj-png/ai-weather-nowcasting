import { HAZARDS, HAZARD_STYLE, FIELD_OPTIONS } from '../../utils/hazardLabels';


// Lead selector, hazard toggles and the Watch toggle (Warnings are always shown).
const MapControls = ({ leads, lead, setLead, leadInfo = {}, hazards, setHazards, showWatch, setShowWatch, counts,
    field, setField, fieldOptions = FIELD_OPTIONS, alertControls = true }) => (
    <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur shadow-md rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5 w-[250px]">
        <div>
            <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">Lead time</p>
            <div className="flex gap-1">
                {leads.map((L) => (
                    <button key={L} onClick={() => setLead(L)} data-testid={`lead-${L}`} aria-pressed={L === lead}
                        className={`flex-1 py-1 rounded-md text-xs font-bold transition-colors ${L === lead
                            ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                        {L} h
                    </button>
                ))}
            </div>
            {leadInfo[lead] && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    valid {leadInfo[lead].valid} · probabilities are "within {leadInfo[lead].radius} km"
                </p>
            )}
        </div>
        {setField && (
            <div>
                <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">Forecast map layer</p>
                <select data-testid="field-select" value={field} onChange={(e) => setField(e.target.value)}
                    className="w-full text-xs bg-slate-100 dark:bg-slate-700 dark:text-white rounded-md px-2 py-1 border border-slate-200 dark:border-slate-600">
                    {fieldOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            </div>
        )}
        {alertControls && (<>
        <div>
            <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">Hazards</p>
            {HAZARDS.map((h) => (
                <label key={h} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer py-0.5">
                    <input type="checkbox" checked={hazards.includes(h)}
                        onChange={() => setHazards(hazards.includes(h) ? hazards.filter((x) => x !== h) : [...hazards, h])} />
                    <span className="w-3 h-3 rounded-sm" style={{ background: HAZARD_STYLE[h].color }} />
                    {HAZARD_STYLE[h].name}
                    <span className="text-slate-400 font-normal">({HAZARD_STYLE[h].kindLabel})</span>
                    {counts && <span className="ml-auto text-slate-500 font-normal">{counts[h] ?? 0}</span>}
                </label>
            ))}
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer border-t border-slate-200 dark:border-slate-700 pt-2">
            <input type="checkbox" data-testid="watch-toggle" checked={showWatch} onChange={(e) => setShowWatch(e.target.checked)} />
            Also show Watch
            <span className="text-slate-400 font-normal">(Warnings always shown)</span>
        </label>
        </>)}
    </div>
);

export default MapControls;
