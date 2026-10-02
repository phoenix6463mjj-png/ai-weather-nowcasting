import { HAZARDS, HAZARD_STYLE, FIELD_OPTIONS } from '../../utils/hazardLabels';
import { TERRAIN_ATTRIBUTION } from './useTerrain';


// The Layers panel's settings (the rarer ones; lead time and "Also show Watch" are in the map toolbar):
// forecast layer, terrain toggle + opacity, the observed / "outside displayed alerts" overlays (off by
// default), hazard toggles. Compact spacing.
//   observed / missed: { label, on, setOn } while an observed frame exists for this lead, else null
const MapControls = ({ hazards, setHazards, counts, field, setField, fieldOptions = FIELD_OPTIONS, alertControls = true, terrain,
    observed = null, missed = null }) => (
    <div data-testid="map-controls" className="space-y-2">
        {setField && (
            <div>
                <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400 mb-1">Forecast map layer</p>
                <select data-testid="field-select" value={field} onChange={(e) => setField(e.target.value)}
                    className="w-full text-xs bg-slate-100 dark:bg-slate-700 dark:text-white rounded-md px-2 py-1 border border-slate-200 dark:border-slate-600">
                    {fieldOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            </div>
        )}
        {terrain?.available && (
            <div>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer">
                    <input type="checkbox" data-testid="terrain-toggle" checked={terrain.on} onChange={(e) => terrain.setOn(e.target.checked)} />
                    Terrain (DEM)
                    <span className="text-slate-400 font-normal text-xs truncate" title={terrain.fullNotice}>{TERRAIN_ATTRIBUTION}</span>
                </label>
                {terrain.on && (
                    <label className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                        opacity
                        <input type="range" data-testid="terrain-opacity" min="0.1" max="1" step="0.05" value={terrain.opacity}
                            onChange={(e) => terrain.setOpacity(Number(e.target.value))} className="flex-1 accent-slate-600" />
                    </label>
                )}
            </div>
        )}
        {(observed || missed) && (
            <div>
                <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400 mb-0.5">Observed (replay)</p>
                {[[observed, 'observed-toggle'], [missed, 'missed-toggle']].filter(([o]) => o).map(([o, id]) => (
                    <label key={id} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer py-0.5 leading-snug">
                        <input type="checkbox" data-testid={id} className="mt-1" checked={o.on} onChange={(e) => o.setOn(e.target.checked)} />
                        {o.label}
                    </label>
                ))}
            </div>
        )}
        {alertControls && (<>
        <div>
            <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400 mb-1">Hazards</p>
            {HAZARDS.map((h) => (
                <label key={h} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input type="checkbox" checked={hazards.includes(h)}
                        onChange={() => setHazards(hazards.includes(h) ? hazards.filter((x) => x !== h) : [...hazards, h])} />
                    <span className="w-3 h-3 rounded-sm" style={{ background: HAZARD_STYLE[h].color }} />
                    {HAZARD_STYLE[h].name}
                    <span className="text-slate-400 font-normal">({HAZARD_STYLE[h].kindLabel})</span>
                    {counts && <span className="ml-auto text-slate-500 font-normal">{counts[h] ?? 0}</span>}
                </label>
            ))}
        </div>
        </>)}
    </div>
);

export default MapControls;
