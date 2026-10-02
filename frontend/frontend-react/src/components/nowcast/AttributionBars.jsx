import { ArrowUp, ArrowDown } from 'lucide-react';

// Attribution as left-aligned bars (Alert drawer "Why" section and the Overview's step 4): bar length = the
// strength of the attribution (|SHAP|, relative to the largest shown); colour + arrow + label = whether it
// raises or lowers the risk, from the sign of the attribution. Same rows, same order as given.
//   rows: [{ key, text, value (signed log-odds, or null), effect, noScale, extra }]
const AttributionBars = ({ rows, showValue = false, testid = 'attr-row' }) => {
    const max = Math.max(0.001, ...rows.filter((r) => r.value != null).map((r) => Math.abs(r.value)));
    return (
        <ul className="space-y-2.5">
            {rows.map((r) => {
                const up = r.value != null ? r.value > 0 : r.effect === 'raises risk';
                return (
                    <li key={r.key} data-testid={testid} data-direction={up ? 'raises' : 'lowers'} data-effect={r.effect}>
                        <p className="text-base leading-snug text-slate-800 dark:text-slate-100">{r.text}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span data-testid="attr-label" className={`shrink-0 w-[7.5rem] inline-flex items-center gap-1 text-sm font-bold ${up
                                ? 'text-rose-700 dark:text-rose-300' : 'text-sky-700 dark:text-sky-300'}`}>
                                {up ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                                {up ? 'raises risk' : 'lowers risk'}
                            </span>
                            {r.value != null ? (
                                <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded">
                                    <div data-testid="attr-bar" className={`h-2.5 rounded ${up ? 'bg-rose-600' : 'bg-sky-600'}`}
                                        style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
                                </div>
                            ) : <span className="text-sm text-slate-400">{r.noScale}</span>}
                            {showValue && r.value != null && (
                                <span className="text-sm tabular-nums text-slate-500 w-14 text-right">{r.value > 0 ? '+' : ''}{r.value.toFixed(2)}</span>
                            )}
                        </div>
                        {r.extra}
                    </li>
                );
            })}
        </ul>
    );
};

export default AttributionBars;
