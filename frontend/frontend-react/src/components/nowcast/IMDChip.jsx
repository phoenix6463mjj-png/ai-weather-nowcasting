import { IMD_STYLE, IMD_NOTE } from '../../utils/hazardLabels';

// Small colour chip shown next to every Watch/Warning: our own indicative mapping onto the
// familiar IMD colour scheme (Watch = orange, Warning = red), never a claim of an IMD product.
const IMDChip = ({ level }) => {
    const s = IMD_STYLE[level];
    if (!s) return null;
    return (
        <span data-testid="imd-chip" data-imd={s.name} title={IMD_NOTE}
            className="inline-block w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
            style={{ background: s.color }} />
    );
};

export default IMDChip;
