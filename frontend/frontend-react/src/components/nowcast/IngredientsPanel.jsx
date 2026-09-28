// Per-alert ingredient bars: summed SHAP per ingredient group (log-odds, before calibration),
// plus lead time shown separately, plus the descriptive demo aggregate for the alert's model.
// All text and numbers come from the serving API (serve/ingredients.py, AGGREGATE.json).

const Bar = ({ label, value, max, testid, group, muted }) => {
    const w = `${(Math.abs(value) / max) * 50}%`;
    const up = value > 0;
    return (
        <div data-testid={testid} data-group={group} data-value={value} className="flex items-center gap-2 text-[11px]">
            <span className={`w-36 shrink-0 ${muted ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>{label}</span>
            <div className="flex-1 h-2.5 relative bg-slate-100 dark:bg-slate-800 rounded">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-400" />
                <div className={`absolute top-0 bottom-0 rounded ${muted ? 'bg-slate-400' : up ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={up ? { left: '50%', width: w } : { right: '50%', width: w }} />
            </div>
            <span className="w-12 text-right tabular-nums text-slate-500">{value > 0 ? '+' : ''}{value.toFixed(2)}</span>
        </div>
    );
};

const IngredientsPanel = ({ ing }) => {
    if (!ing) return null;
    if (!ing.available) {
        return (
            <p data-testid="ingredients-unavailable" className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                Not available{ing.note ? `: ${ing.note}` : ''}.
            </p>
        );
    }
    const max = Math.max(0.001, ...ing.groups.map((g) => Math.abs(g.shap_logodds)), Math.abs(ing.lead.shap_logodds));
    const agg = ing.aggregate;
    return (
        <div data-testid="ingredients-panel" data-model={ing.model} className="space-y-1.5">
            <p data-testid="ingredients-label" className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">{ing.label}</p>
            <div className="space-y-1">
                {ing.groups.map((g) => (
                    <Bar key={g.group} testid="ingredient-row" group={g.group} label={g.label} value={g.shap_logodds} max={max} />
                ))}
                <div className="border-t border-dashed border-slate-200 dark:border-slate-700 pt-1">
                    <Bar testid="ingredient-lead" label={ing.lead.label} value={ing.lead.shap_logodds} max={max} muted />
                </div>
            </div>
            <p className="text-[10px] text-slate-400">red = raises, green = lowers the model score</p>
            {ing.boost && (
                <p data-testid="ingredients-boost" className="text-[11px] font-semibold text-pink-700 dark:text-pink-300 leading-snug">{ing.boost}</p>
            )}
            {agg && (
                <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-2.5 space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Across the demo alerts (descriptive)</p>
                    <p data-testid="ingredients-agg-lead" className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">{agg.lead_trend}</p>
                    <p data-testid="ingredients-agg-moisture" className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">{agg.moisture}</p>
                    <p data-testid="ingredients-agg-scope" className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">{agg.scope}</p>
                </div>
            )}
        </div>
    );
};

export default IngredientsPanel;
