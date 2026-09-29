import { useEffect, useState } from 'react';
import { Loader2, CloudOff } from 'lucide-react';
import { WAKE_STARTING, WAKE_UNAVAILABLE, subscribeWake, wakeState } from '../utils/serverWake';

// One small notice (bottom centre) while a backend request is being retried, or after it gave up.
// Hidden otherwise.
export default function ServerWakeNotice() {
    const [s, setS] = useState(wakeState);
    useEffect(() => subscribeWake(setS), []);
    if (!s.starting && !s.unavailable) return null;
    return (
        <div data-testid="server-wake" data-state={s.starting ? 'starting' : 'unavailable'} role="status" aria-live="polite"
            className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000] max-w-[calc(100vw-32px)] flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg border text-sm font-medium ${s.starting
                ? 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                : 'bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800'}`}>
            {s.starting ? <Loader2 size={16} className="animate-spin shrink-0 text-blue-600" /> : <CloudOff size={16} className="shrink-0" />}
            <span data-testid="server-wake-text">{s.starting ? WAKE_STARTING : WAKE_UNAVAILABLE}</span>
        </div>
    );
}
