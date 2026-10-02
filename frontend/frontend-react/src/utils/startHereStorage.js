// Remembers that "Start here" was dismissed (per browser). Storage may be unavailable (private mode,
// blocked site data): then the panel simply shows again on the next visit.
export const START_HERE_KEY = 'nowcast.startHere.dismissed';

export function startHereDismissed() {
    try { return window.localStorage.getItem(START_HERE_KEY) === '1'; } catch { return false; }
}

export function rememberStartHereDismissed() {
    try { window.localStorage.setItem(START_HERE_KEY, '1'); } catch { /* storage unavailable */ }
}
