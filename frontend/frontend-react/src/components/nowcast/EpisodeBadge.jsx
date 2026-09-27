import { ShieldAlert, ShieldCheck } from 'lucide-react';

// REF025 (train) must always carry a visible in-sample warning.
const EpisodeBadge = ({ episode }) => {
    if (!episode) return null;
    if (episode.in_sample) {
        return (
            <span data-testid="in-sample-badge" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-600 text-white text-xs font-black tracking-wide shadow-sm">
                <ShieldAlert size={14} /> IN-SAMPLE — training-period event, shown for illustration only (not evidence of skill)
            </span>
        );
    }
    return (
        <span data-testid="oos-badge" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-xs font-bold">
            <ShieldCheck size={14} /> Out-of-sample ({episode.split} split, not used for training)
        </span>
    );
};

export default EpisodeBadge;
