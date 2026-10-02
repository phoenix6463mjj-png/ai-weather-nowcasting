import { HAZARD_STYLE, LEVEL_STYLE, valueText, kindText } from '../../utils/hazardLabels';
import IMDChip from './IMDChip';
import IngredientsPanel from './IngredientsPanel';

// Ingredients section of the drawer, for the selected alert (detail from the parent).
const IngredientsTab = ({ d, error, selected, liveNote }) => {
    if (!selected) {
        return (
            <p data-testid="ingredients-empty" className="p-4 text-base text-slate-600 dark:text-slate-300">
                Select an alert (on the map or in the Alert list) to see which ingredients drove it.
            </p>
        );
    }
    if (error) return <div className="p-4 text-base text-red-600">Could not load ingredients: {error}</div>;
    if (!d) return <div className="p-4 text-base text-slate-500">Loading…</div>;
    const hz = HAZARD_STYLE[d.hazard];
    const ing = liveNote ? { available: false, note: liveNote } : d.ingredients;
    return (
        <div data-testid="ingredients-tab" className="text-slate-900 dark:text-slate-100">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: hz.color }} />
                    <span className="text-base font-black">{hz.name}</span>
                    <span className={`text-sm font-black px-1.5 py-0.5 rounded ${LEVEL_STYLE[d.level]?.badge}`}>{d.level}</span>
                    <IMDChip level={d.level} large />
                    <span className="ml-auto text-base font-black tabular-nums">{valueText(d)}</span>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{kindText(d)} · L{d.lead_time_h} h</p>
                {d.in_sample && (
                    <p className="mt-1.5 text-sm font-black text-white bg-red-600 rounded px-2 py-1">IN-SAMPLE training-period event: illustration only</p>
                )}
                {liveNote && (
                    <p className="mt-1.5 text-sm font-black text-amber-900 bg-amber-200 rounded px-2 py-1">Live output: system running operationally, NOT validated</p>
                )}
            </div>
            <section className="px-4 py-3">
                <h4 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                    {ing?.heading || 'Ingredients'}
                </h4>
                {ing ? <IngredientsPanel ing={ing} /> : <p data-testid="ingredients-unavailable" className="text-sm font-bold">Not available.</p>}
            </section>
        </div>
    );
};

export default IngredientsTab;
