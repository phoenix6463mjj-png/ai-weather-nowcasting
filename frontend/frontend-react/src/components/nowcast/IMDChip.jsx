import { IMD_STYLE, IMD_NOTE } from '../../utils/hazardLabels';

// Labelled pill next to every Watch/Warning: our own indicative mapping onto the familiar IMD
// colour scheme (Watch = Orange, Warning = Red), never a claim of an IMD product.
const IMDChip = ({ level }) => {
    const s = IMD_STYLE[level];
    if (!s) return null;
    return (
        <span data-testid="imd-chip" data-imd={s.name} title={IMD_NOTE}
            className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-black leading-4 shrink-0 ring-1 ring-black/20"
            style={{ background: s.color, color: s.text }}>
            {s.label}
        </span>
    );
};

export default IMDChip;
