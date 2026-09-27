import { HAZARD_STYLE, LEVEL_STYLE, VERIFY_STYLE, valueText, stateName, FF_VERIFY_NOTE } from '../../utils/hazardLabels';
import IMDChip from './IMDChip';

const order = { Warning: 0, Watch: 1 };

const AlertList = ({ alerts, selectedId, onSelect, emptyText }) => {
    const sorted = [...alerts].sort((a, b) =>
        (order[a.level] - order[b.level]) || (b.display.value - a.display.value));
    if (!sorted.length) {
        return <p className="text-sm text-slate-500 dark:text-slate-400 p-4">{emptyText}</p>;
    }
    return (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sorted.map((a) => {
                const hz = HAZARD_STYLE[a.hazard];
                const v = a.verification && VERIFY_STYLE[a.verification.status];
                return (
                    <li key={a.alert_id} data-testid="alert-row" data-hazard={a.hazard} data-level={a.level}>
                        <button onClick={() => onSelect(a)}
                            className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${a.alert_id === selectedId ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: hz.color }} />
                                <span className="text-sm font-bold text-slate-900 dark:text-white">{hz.name}</span>
                                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${LEVEL_STYLE[a.level]?.badge}`}>{a.level}</span>
                                <IMDChip level={a.level} />
                                <span data-testid="alert-value" className="ml-auto text-sm font-black tabular-nums text-slate-800 dark:text-slate-100">{valueText(a)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                <span>L{a.lead_time_h} h</span>
                                <span>·</span>
                                <span>{a.state ? `${stateName(a.state)}${a.state_approx ? ' (approx.)' : ''}` : `${a.peak_cell[0].toFixed(2)}N ${a.peak_cell[1].toFixed(2)}E`}</span>
                                <span>·</span>
                                <span>{Math.round(a.area_km2).toLocaleString()} km²</span>
                                {v && <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold ${v.badge}`}
                                    title={a.hazard === 'flash_flood' && a.verification.status !== 'unavailable' ? FF_VERIFY_NOTE : undefined}>{v.label}</span>}
                            </div>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
};

export default AlertList;
