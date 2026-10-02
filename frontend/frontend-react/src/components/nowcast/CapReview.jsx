import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Pencil, Download, FileCode2, Rss } from 'lucide-react';
import { getAlertCap, getApprovedCap, getCapApprovals, postCapReview, capFeedUrl } from '../../services/nowcastApi';

const CAP_FORMAT_LABEL = "CAP 1.2 compatible (format used by India's Sachet alerting platform)";
const CAP_NOT_SENT = 'Demo only: nothing is ever sent anywhere. "Download CAP" saves a file to this computer.';

const CAP_NS = 'urn:oasis:names:tc:emergency:cap:1.2';
const pick = (doc, tag) => doc.getElementsByTagNameNS(CAP_NS, tag)[0]?.textContent ?? '';

const STATUS_STYLE = {
    pending: ['not reviewed', 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'],
    approved: ['approved for issue (demo)', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'],
    rejected: ['rejected', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'],
};

/**
 * Forecaster review of one alert's CAP message (demo): Approve / Edit (headline + description only) /
 * Reject. Only an approved alert can be downloaded as a CAP file; editing sends it back to review.
 * Each decision is also stored by the ML API (POST cap/review) for the Atom feed of approved messages
 * (cap/feed.atom); on the hosted demo approvals reset when the server restarts. Nothing is sent anywhere.
 *   src: { kind: 'replay', ep, ts } | { kind: 'live', run }
 */
const keyOf = (src, alertId) => (src.kind === 'live' ? `live:${src.run}:${alertId}` : `replay:${src.ep}/${src.ts}:${alertId}`);
const CapReview = ({ src, alertId, review, onChange }) => {
    const [cap, setCap] = useState(null);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState({ headline: '', description: '' });
    const [dl, setDl] = useState(null);
    const [feed, setFeed] = useState(null);                 // { n_approved, storage_note, ... } from the ML API
    const [saveErr, setSaveErr] = useState(null);
    const r = review || { status: 'pending' };

    // the stored decision for this alert (if any) and the feed count
    useEffect(() => {
        let live = true;
        getCapApprovals().then((s) => {
            if (!live) return;
            setFeed(s);
            const it = s.items.find((i) => i.key === keyOf(src, alertId));
            if (it && !review) onChange({ status: it.status, headline: it.headline ?? undefined, description: it.description ?? undefined, edited: it.edited });
        }).catch(() => {});
        return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [alertId, src.kind, src.ep, src.ts, src.run]);

    const decide = (next) => {
        onChange(next);
        setSaveErr(null);
        postCapReview(src, alertId, next).then(setFeed).catch((e) => setSaveErr(e.message));
    };

    useEffect(() => {
        let live = true;
        getAlertCap(src, alertId).then((xml) => {
            if (!live) return;
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            setCap({
                headline: pick(doc, 'headline'), description: pick(doc, 'description'), status: pick(doc, 'status'),
                severity: pick(doc, 'severity'), certainty: pick(doc, 'certainty'), urgency: pick(doc, 'urgency'),
            });
        }).catch((e) => live && setError(e.message));
        return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [alertId, src.kind, src.ep, src.ts, src.run]);

    if (error) return <p className="text-base text-red-600">CAP preview unavailable: {error}</p>;
    if (!cap) return <p className="text-base text-slate-500">Loading CAP preview…</p>;

    const headline = r.headline ?? cap.headline;
    const description = r.description ?? cap.description;
    const [statusText, statusCls] = STATUS_STYLE[r.status];

    const startEdit = () => { setDraft({ headline, description }); setEditing(true); };
    const saveEdit = () => {
        decide({ status: 'pending', headline: draft.headline.trim(), description: draft.description.trim(), edited: true });
        setEditing(false);
    };
    const download = async () => {
        setDl('working');
        try {
            const xml = await getApprovedCap(src, alertId, r.edited ? { headline, description } : null);
            const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
            const a = document.createElement('a');
            a.href = url; a.download = `${alertId}.cap.xml`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setDl('done');
        } catch (e) {
            setDl(`failed: ${e.message}`);
        }
    };

    const btn = 'flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-bold border disabled:opacity-40 disabled:cursor-not-allowed';
    return (
        <div data-testid="cap-review" data-status={r.status} className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
                <span data-testid="cap-review-status" className={`px-2 py-0.5 rounded text-sm font-black ${statusCls}`}>{statusText}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                    CAP status <b data-testid="cap-status">{cap.status}</b> · severity {cap.severity} · certainty {cap.certainty} · urgency {cap.urgency}
                </span>
            </div>
            {editing ? (
                <div className="space-y-1.5">
                    <label className="block text-sm font-bold text-slate-500">Headline
                        <input data-testid="cap-edit-headline" maxLength={160} value={draft.headline}
                            onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                            className="mt-0.5 w-full text-base rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1" />
                    </label>
                    <label className="block text-sm font-bold text-slate-500">Description
                        <textarea data-testid="cap-edit-description" maxLength={4000} rows={6} value={draft.description}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                            className="mt-0.5 w-full text-base rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1" />
                    </label>
                    <p className="text-sm text-slate-500">Only the headline and description can be edited. Saving returns the alert to review.</p>
                    <div className="flex gap-2">
                        <button type="button" data-testid="cap-save" onClick={saveEdit} disabled={!draft.headline.trim() || !draft.description.trim()}
                            className={`${btn} border-blue-600 bg-blue-600 text-white`}>Save edit</button>
                        <button type="button" onClick={() => setEditing(false)} className={`${btn} border-slate-300 text-slate-700 dark:text-slate-200`}>Cancel</button>
                    </div>
                </div>
            ) : (
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-2.5 space-y-1">
                    <p data-testid="cap-headline" className="text-base font-bold">{headline}</p>
                    <p data-testid="cap-description" className="text-sm text-slate-700 dark:text-slate-300 leading-normal">{description}</p>
                    {r.edited && <p className="text-sm text-amber-700 dark:text-amber-400">edited by the forecaster</p>}
                </div>
            )}
            {!editing && (
                <div className="flex flex-wrap gap-1.5">
                    <button type="button" data-testid="cap-approve" onClick={() => decide({ ...r, status: 'approved' })} disabled={r.status === 'approved'}
                        className={`${btn} border-emerald-600 text-emerald-700 dark:text-emerald-400`}><CheckCircle2 size={13} /> Approve</button>
                    <button type="button" data-testid="cap-edit" onClick={startEdit}
                        className={`${btn} border-slate-400 text-slate-700 dark:text-slate-200`}><Pencil size={13} /> Edit</button>
                    <button type="button" data-testid="cap-reject" onClick={() => decide({ ...r, status: 'rejected' })} disabled={r.status === 'rejected'}
                        className={`${btn} border-red-500 text-red-700 dark:text-red-400`}><XCircle size={13} /> Reject</button>
                    <button type="button" data-testid="cap-download" onClick={download} disabled={r.status !== 'approved' || dl === 'working'}
                        title={r.status === 'approved' ? 'Save this CAP message as a file on this computer' : 'Approve the alert first'}
                        className={`${btn} ml-auto border-blue-600 bg-blue-600 text-white`}><Download size={13} /> Download CAP</button>
                </div>
            )}
            {dl && dl !== 'working' && (
                <p data-testid="cap-download-result" className="text-sm text-slate-500">{dl === 'done' ? `Saved ${alertId}.cap.xml (not sent anywhere).` : `Download ${dl}`}</p>
            )}
            {saveErr && <p data-testid="cap-save-error" className="text-sm text-red-600">Decision not stored: {saveErr}</p>}
            <div data-testid="cap-feed" className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-sm space-y-0.5">
                <p className="flex items-center gap-2">
                    <a data-testid="cap-feed-link" href={capFeedUrl()} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 font-bold text-blue-700 dark:text-blue-400 hover:underline"><Rss size={12} /> Feed (Atom)</a>
                    <span data-testid="cap-feed-count" className="text-slate-600 dark:text-slate-300">
                        {feed ? `${feed.n_approved} approved message${feed.n_approved === 1 ? '' : 's'} in the feed` : 'loading…'}
                    </span>
                </p>
                {feed && <p data-testid="cap-feed-storage" className="text-sm text-slate-500 dark:text-slate-400">{feed.storage_note}</p>}
                <p className="text-sm text-slate-500 dark:text-slate-400">Exercise feed — not an official warning; not connected to IMD, NDMA or Sachet.</p>
            </div>
            <p data-testid="cap-format" className="text-sm text-slate-500 dark:text-slate-400 flex items-start gap-1">
                <FileCode2 size={12} className="shrink-0 mt-px" /><span>{CAP_FORMAT_LABEL}. <b>{CAP_NOT_SENT}</b></span>
            </p>
        </div>
    );
};

export default CapReview;
