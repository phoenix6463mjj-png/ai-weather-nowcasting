// Visitor-facing text without internal episode IDs: "REF054 (a 2024 test-period episode)" -> "a 2024
// test-period episode"; any other "REF0xx" is dropped.
export const withoutIds = (t) => String(t ?? '').replace(/\bREF\d{3}\s*\((an? [^)]*)\)/g, '$1').replace(/\bREF\d{3}\b\s*/g, '');

// "2024 test period" / "2023 validation period" from a note such as "... (a 2024 test-period episode) ...".
export function periodOf(note) {
    const m = /(\d{4}) (test|validation)-period/.exec(note || '');
    return m ? `${m[1]} ${m[2]} period` : null;
}
