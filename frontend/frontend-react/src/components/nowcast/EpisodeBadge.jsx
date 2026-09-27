import { ShieldAlert, ShieldCheck, FlaskConical } from 'lucide-react';

// REF025 (train) must always carry a visible in-sample warning; case studies on the 2024
// test period carry a "test (2024)" badge and their descriptive-only label.
const EpisodeBadge = ({ episode }) => {
    if (!episode) return null;
    if (episode.in_sample) {
        return (
            <span data-testid="in-sample-badge" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-600 text-white text-xs font-black tracking-wide shadow-sm">
                <ShieldAlert size={14} /> IN-SAMPLE — training-period event, shown for illustration only (not evidence of skill)
            </span>
        );
    }
    if (episode.case_study) {
        return (
            <span data-testid="case-study-badge" title={episode.sample_label}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200 text-xs font-black">
                <FlaskConical size={14} /> {episode.badge}
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
