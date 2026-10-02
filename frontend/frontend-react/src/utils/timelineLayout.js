import { createContext } from 'react';

// Warning timeline layout. Wide (>= 760 px): label | plot | right columns. Compact (Event check at its normal
// drawer width): the label and the right-hand text on one line, the plot full width below.
export const TIMELINE_COMPACT_BELOW = 760;
export const LABEL_PX = 215;
export const RIGHT_PX = 190;
export const TimelineCompact = createContext(false);
export const notePad = (compact) => (compact ? '' : 'pl-[215px] pr-[190px]');
