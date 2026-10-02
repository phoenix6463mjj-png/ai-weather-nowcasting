// Results page: "INSAT at three cloudbursts IMERG barely saw" (docs/insat_events.json via /results).
// Descriptive: every value is the file's; "Three case studies, not a general result".
const fmtBt = (s, key, floorKey) => (s[key] == null ? '—' : s[floorKey] ? `≤${s.lut_floor_k.toFixed(1)}` : s[key].toFixed(1));

const Event = ({ e }) => {
    const alerts = e.alerts || [];
    const im = (e.imerg || []).reduce((m, x) => (m && m.max_mmhr_25km >= x.max_mmhr_25km ? m : x), null);
    return (
        <div data-testid="insat-event" data-episode={e.episode} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
            <p className="text-base font-black">{e.episode} · {e.site} ({e.district}, {e.state}) · reported {e.reported_date}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{e.time_note} Window {e.window[0].slice(5, 16).replace('T', ' ')}Z – {e.window[1].slice(5, 16).replace('T', ' ')}Z.</p>
            <p data-testid="insat-event-summary" className="text-base font-bold text-slate-800 dark:text-slate-100">{e.summary}</p>
            <div className="max-h-44 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded">
                <table data-testid="insat-event-table" className="w-full text-sm tabular-nums">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-sm uppercase text-slate-500">
                        <tr><th className="text-left px-2 py-1">INSAT-3DR slot</th><th className="text-right px-2">coldest (K)</th><th className="text-right px-2">10th pct (K)</th><th className="text-left px-2">30-min change of 10th pct</th></tr>
                    </thead>
                    <tbody>
                        {e.insat.map((s) => (
                            <tr key={s.slot} data-testid="insat-event-row" className="border-t border-slate-100 dark:border-slate-800">
                                <td className="px-2 py-0.5">{s.slot.slice(5, 16).replace('T', ' ')}Z</td>
                                <td className="px-2 text-right">{fmtBt(s, 'min_bt_k', 'min_at_lut_floor')}</td>
                                <td className="px-2 text-right">{fmtBt(s, 'p10_bt_k', 'p10_at_lut_floor')}</td>
                                <td className="px-2">{s.d30_p10_k != null ? `${s.d30_p10_k > 0 ? '+' : ''}${s.d30_p10_k.toFixed(1)} K` : <span className="text-slate-500">{s.change_note}</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {e.gaps.length > 0 && <p data-testid="insat-event-gaps" className="text-sm text-slate-500">No INSAT-3DR file for {e.gaps.length} slot{e.gaps.length === 1 ? '' : 's'}: {e.gaps.map((g) => `${g.slice(11, 16)}Z`).join(', ')} (not filled).</p>}
            <p data-testid="insat-event-imerg" className="text-sm">IMERG (25 km max, half-hourly): {im ? `${im.max_mmhr_25km} mm/hr at ${im.time.slice(11, 16)}Z, ${e.imerg.length} frames` : 'no frames'}.</p>
            <p data-testid="insat-event-alerts" className="text-sm">
                Model cloudburst alerts within 25 km (lgbm_v0): {alerts.length}
                {alerts.length > 0 && ` (valid ${alerts[0].valid_time.slice(11, 16)}Z – ${alerts[alerts.length - 1].valid_time.slice(11, 16)}Z)`}.
            </p>
        </div>
    );
};

const InsatEvents = ({ d }) => (
    <div data-testid="insat-events" className="space-y-2">
        <p data-testid="insat-events-scope" className="text-base font-black text-violet-900 dark:text-violet-200">{d.scope} Satellite observation (INSAT via MOSDAC); not a model input.</p>
        {!d.available && <p data-testid="insat-events-unavailable" className="text-base text-slate-600 dark:text-slate-300">{d.note}</p>}
        {d.available && (
            <>
                <p className="text-sm text-slate-600 dark:text-slate-300">{d.method.insat}. {d.threshold_note} {d.timeline_note}</p>
                <p data-testid="insat-events-position" className="text-sm text-amber-700 dark:text-amber-400">{d.position_line}</p>
                {d.events.map((e) => <Event key={e.episode} e={e} />)}
                <p className="text-sm text-slate-500">{d.credit} · <a href={d.doi} className="underline" target="_blank" rel="noreferrer">DOI</a> · source {d.source}</p>
            </>
        )}
    </div>
);

export default InsatEvents;
