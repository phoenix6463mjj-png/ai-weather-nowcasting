import { FileText } from 'lucide-react';
import { HAZARD_STYLE, LEVEL_STYLE, VERIFY_STYLE, fmtIssueShort } from '../../utils/hazardLabels';
import IMDChip from './IMDChip';
import WarningTimeline from './WarningTimeline';

const Chip = ({ className, children, testid }) => (
    <span data-testid={testid} className={`px-1.5 py-0.5 rounded text-sm font-bold ${className}`}>{children}</span>
);

// One alert under the documented-event rule (or on the documented date). Click = open it.
const AlertCard = ({ a, onJump, showWarning = true }) => {
    const v = VERIFY_STYLE[a.imerg_verification?.status] || VERIFY_STYLE.unavailable;
    return (
        <li data-testid="event-alert" data-precision={a.precision}>
            <button onClick={() => onJump(a)}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <div className="flex items-center gap-2 text-base">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: HAZARD_STYLE[a.hazard].color }} />
                    <span className="font-bold">{a.hazard_name}</span>
                    <Chip className={LEVEL_STYLE[a.level]?.badge}>{a.level}</Chip>
                    <IMDChip level={a.level} large />
                    <span className="ml-auto font-black tabular-nums">{a.display?.value_text}</span>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                    issued {fmtIssueShort(a.issue_time)} → valid {fmtIssueShort(a.valid_time)} (L{a.lead_time_h})
                    {showWarning && a.hours_of_warning != null && <> · <b>{a.hours_of_warning} h</b> of warning</>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1 text-sm text-slate-500 dark:text-slate-400">
                    <span>{Math.round(a.area_km2).toLocaleString()} km²</span>·<span>peak {a.peak_to_site_km} km from site</span>
                    <Chip testid="event-precision" className={a.precision === 'precise'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}>{a.precision}</Chip>
                    <Chip testid="event-imerg" className={v.badge}>IMERG: {v.short}</Chip>
                </div>
            </button>
        </li>
    );
};

const Source = ({ s }) => (
    <div className="text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5 space-y-0.5">
        <p className="flex items-start gap-1"><FileText size={12} className="mt-0.5 shrink-0" />
            <span>“{s.quote}” <span className="text-slate-400">({s.local_time_as_stated})</span></span></p>
        {s.window_utc?.[0] && (
            <p>Event window: <b>{fmtIssueShort(s.window_utc[0])} – {fmtIssueShort(s.window_utc[1])}</b> ({s.confidence})</p>
        )}
        {s.window_label && <p className="text-violet-800 dark:text-violet-300">{s.window_label}</p>}
        {s.notes && <p className="text-slate-400">{s.notes}</p>}
        <p data-testid="event-source-note" className="font-semibold">{s.source_note}</p>
        <p className="text-slate-400 break-all">
            Source: <a href={s.source_url} target="_blank" rel="noreferrer" className="underline">{s.source_url}</a> (accessed {s.access_date});
            cited original (not fetched): {s.cited_original}
        </p>
    </div>
);

/**
 * Documented-event check: alerts vs the REPORTED event time and location (derived by the
 * serving API from catalog/documented_event_times.csv; not a model output, not a score).
 */
const EventCheckPanel = ({ check, timeline, onJump, underReport }) => {
    if (!check) return <p className="p-4 text-base text-slate-500">Loading…</p>;
    return (
        <div data-testid="event-check-panel" className="p-4 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="space-y-1">
                <h3 className="text-base font-black">Documented-event check</h3>
                <p data-testid="event-label" className="text-sm font-bold text-amber-800 dark:text-amber-300">{check.label}</p>
                <p data-testid="event-disagree" className="text-sm text-slate-600 dark:text-slate-300">{check.disagree_note}</p>
                {underReport && <p data-testid="event-under-report" className="text-base text-violet-800 dark:text-violet-300">{underReport}</p>}
                {check.case_label && <p className="text-sm font-bold text-violet-800 dark:text-violet-300">{check.case_label}</p>}
            </div>
            {check.sites.map((s) => (
                <section key={s.site_episode} data-testid={`event-site-${s.site_episode}`} className="space-y-2">
                    <h4 className="text-base font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.site}</h4>
                    <p data-testid="event-result" className="text-base font-bold">{s.result_text}</p>
                    {s.kind === 'timed' && timeline?.episode === s.site_episode && (
                        <WarningTimeline site={s} timeline={timeline} onJump={onJump} />
                    )}
                    {s.source && <Source s={s.source} />}
                    {s.kind === 'timed' && s.qualifying.length > 0 && (
                        <ul className="space-y-1.5">{s.qualifying.map((a) => <AlertCard key={a.alert_id} a={a} onJump={onJump} />)}</ul>
                    )}
                    {s.kind === 'date_only' && s.covering_on_date.length > 0 && (
                        <ul className="space-y-1.5">{s.covering_on_date.map((a) => <AlertCard key={a.alert_id} a={a} onJump={onJump} showWarning={false} />)}</ul>
                    )}
                    {s.kind === 'timed' && (
                        <div data-testid="event-nearby" className="border-t border-dashed border-slate-200 dark:border-slate-700 pt-2">
                            <p className="text-sm font-bold">Separate criterion: {s.nearby_cells.criterion}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-300">{s.nearby_cells.result_text}</p>
                            <ul className="mt-1 space-y-1">
                                {s.nearby_cells.items.map((n) => (
                                    <li key={`${n.issue_time}-${n.lead_time_h}`}>
                                        <button onClick={() => onJump({ issue_time: n.issue_time, lead_time_h: n.lead_time_h })}
                                            className="w-full text-left text-sm px-3 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                                            issued {fmtIssueShort(n.issue_time)} → valid {fmtIssueShort(n.valid_time)} (L{n.lead_time_h}) ·
                                            {' '}{n.n_cells} cloudburst alert cell{n.n_cells === 1 ? '' : 's'}, nearest <b>{n.nearest_cell_km} km</b> ·
                                            {' '}<b>{n.hours_of_warning} h</b> before window · <i>{n.note}</i>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            ))}
            <div data-testid="event-rules" className="border-t border-slate-200 dark:border-slate-700 pt-3">
                <p className="text-sm font-black uppercase text-slate-500 dark:text-slate-400 mb-1">Rules</p>
                <ul className="space-y-1">
                    {check.rules.map((r) => <li key={r} className="text-sm text-slate-600 dark:text-slate-300 leading-normal">• {r}</li>)}
                </ul>
            </div>
        </div>
    );
};

export default EventCheckPanel;
