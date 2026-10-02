import { useEffect, useState } from 'react';
import { Play, CheckCircle2, XCircle } from 'lucide-react';
import { getReplayStatus, runReplay } from '../../services/nowcastApi';

// Re-runs the frozen model (Nowcaster.predict) for this issue and compares the output
// byte-for-byte with the precomputed files that the map is showing.
// The API reports whether on-demand replay is enabled (ML_REPLAY_ENABLED=0 on the hosted demo).
let replayStatusCache = null;

const ReplayButton = ({ episode, issueTime }) => {
    const [state, setState] = useState({ status: 'idle' });
    const [avail, setAvail] = useState(replayStatusCache);
    useEffect(() => {
        if (replayStatusCache) return undefined;
        let live = true;
        getReplayStatus().then((r) => { replayStatusCache = r; if (live) setAvail(r); }).catch(() => {});
        return () => { live = false; };
    }, []);

    const run = async () => {
        setState({ status: 'running' });
        const t0 = performance.now();
        try {
            const r = await runReplay({ issue_time: issueTime, episode });
            setState({ status: 'done', r, wall: (performance.now() - t0) / 1000 });
        } catch (e) {
            setState({ status: 'error', message: e.message, code: e.status });
        }
    };

    const { status, r } = state;
    if (avail && avail.enabled === false) {
        return (
            <div data-testid="replay-box" className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                <p data-testid="replay-disabled-note" className="text-sm text-slate-600 dark:text-slate-300">{avail.note}</p>
            </div>
        );
    }
    return (
        <div data-testid="replay-box" className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
            <button onClick={run} disabled={status === 'running'} data-testid="replay-button"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-base font-bold">
                {status === 'running'
                    ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Play size={14} />}
                {status === 'running' ? 'Running the model…' : 'Re-run model now (replay)'}
            </button>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Runs the frozen model on the archived inputs for this issue time (about 3–15 s) and checks it against the files shown here.
            </p>
            {status === 'done' && (
                <div data-testid="replay-result" className="mt-2 text-base text-slate-700 dark:text-slate-200 space-y-0.5">
                    {r.all_match === true && (
                        <p className="flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 size={14} /> Output matches the precomputed files byte-for-byte ({Object.keys(r.matches_precomputed).length} files)
                        </p>
                    )}
                    {r.all_match === false && (
                        <p className="flex items-center gap-1 font-bold text-red-700">
                            <XCircle size={14} /> Output differs from the precomputed files:{' '}
                            {Object.entries(r.matches_precomputed).filter(([, v]) => !v).map(([k]) => k).join(', ')}
                        </p>
                    )}
                    {r.all_match === null && <p>No precomputed files to compare with.</p>}
                    <p>
                        {r.n_alerts} alerts · model run {r.runtime_s} s{r.model_load_s > 0.05 ? ` (incl. ${r.model_load_s} s model load)` : ''}
                        {r.cached ? ' · served from the replay cache' : ''}
                    </p>
                </div>
            )}
            {status === 'error' && (
                <p data-testid="replay-error" className="mt-2 text-base text-red-700 dark:text-red-400">
                    {state.code === 503 ? 'Another replay is running; try again in a few seconds.'
                        : state.code === 504 ? 'The replay took too long; it keeps running and will be cached. Try again shortly.'
                            : `Replay failed: ${state.message}`}
                </p>
            )}
        </div>
    );
};

export default ReplayButton;
