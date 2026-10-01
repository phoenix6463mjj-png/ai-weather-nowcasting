import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';

// One slim banner at the top of a team page, saying what its figures are (and are not).
//   kind="rule-figures": Reports / Analytics (figures computed from current weather with the team's rules)
//   kind="rule-score":   Forecast (its risk levels are a rule-based indicator)
const TEXT = {
    'rule-figures': { lead: 'Figures on this page are computed from current weather with fixed rules — not from the ML model. Measured skill:', link: 'ML Nowcast → Results', to: '/nowcast/results' },
    'rule-score': { lead: 'The risk levels on this page are a rule-based indicator, not the ML model. Calibrated nowcasts:', link: 'ML Nowcast →', to: '/nowcast' },
};

const HonestyBanner = ({ kind }) => {
    const t = TEXT[kind];
    return (
        <div data-testid={`honesty-banner-${kind}`}
            className="mb-5 flex items-center gap-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Info size={16} className="shrink-0" />
            <span>{t.lead} <Link to={t.to} className="underline font-bold text-blue-700 dark:text-blue-400">{t.link}</Link></span>
        </div>
    );
};

export default HonestyBanner;
