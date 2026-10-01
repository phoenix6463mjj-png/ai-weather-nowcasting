import { useEffect, useState } from 'react';
import PageShell, { Card, Quote } from '../components/nowcast/PageShell';
import { getApproach } from '../services/nowcastApi';

const STATUS_STYLE = {
    Delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    'Tested, no gain': 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
    'Not yet tested': 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300',
    'Blocked by data access': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'Observation layer delivered': 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-300',
    'Not yet built': 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300',
    'File export built': 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-300',
};

const Stat = ({ label, value, sub, testid }) => (
    <div data-testid={testid} className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-2.5">
        <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
        <p className="text-xl font-black tabular-nums">{value}</p>
        {sub && <p className="text-[10px] text-slate-500 leading-snug">{sub}</p>}
    </div>
);

const NowcastApproach = () => {
    const [a, setA] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => { getApproach().then(setA).catch((e) => setError(e.message)); }, []);
    const n = a?.live.latency.numbers;
    const lat = a?.live.latency;
    return (
        <PageShell testid="approach-page" title="Approach & live readiness"
            subtitle="What the proposal asked for, what was built and tested, and what live operation needs.">
            {error && <p className="text-sm text-red-600">{error}</p>}
            {a && (
                <div className="grid grid-cols-12 gap-4">
                    <Card title="Proposal item → implemented feature → status" testid="approach-table" className="col-span-7">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-1.5 pr-2 w-[170px]">Proposal item</th><th className="py-1.5 pr-2">Implemented feature / evidence</th><th className="py-1.5 w-[150px]">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {a.rows.map((r) => (
                                    <tr key={r.item} data-testid="approach-row" data-item={r.item} data-status={r.status}
                                        className="border-b border-slate-100 dark:border-slate-800 align-top">
                                        <td className="py-1.5 pr-2 font-bold">{r.item}</td>
                                        <td className="py-1.5 pr-2 space-y-1">
                                            <p>{r.feature}</p>
                                            {r.note && <p className="text-[11px] text-slate-500">{r.note}</p>}
                                            {r.attribution && <p data-testid="iwv-attribution" className="text-[11px] text-slate-600 dark:text-slate-300 bg-sky-50 dark:bg-sky-950/40 rounded p-1.5 leading-snug">{r.attribution}</p>}
                                            {(r.evidence || []).map((q) => <Quote key={q.id} q={q} />)}
                                        </td>
                                        <td className="py-1.5"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                                            {r.status_note && <p data-testid="approach-status-note" className="mt-1 text-[10px] leading-snug text-slate-600 dark:text-slate-300">{r.status_note}</p>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                    <div className="col-span-5 space-y-4">
                        <Card title="Evidence: satellite rain (IMERG) misses cloudbursts" testid="imerg-evidence">
                            <p className="text-xs mb-1.5">Satellite rain (IMERG) is the model's rain input. At the documented cloudbursts it peaks far below a cloudburst's intensity; at Pipalkoti it never reached the 30 mm/hr threshold:</p>
                            {a.imerg_evidence.map((q) => <Quote key={q.id} q={q} />)}
                        </Card>
                        <Card title="Live readiness" testid="live-readiness">
                            <p className="text-[11px] font-black uppercase text-slate-500 mb-1">Open data today (measured latency)</p>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <Stat testid="lat-imerg" label="IMERG Early" value={`~${n.imerg_early_min[0]} min`} sub={lat.imerg_early_label} />
                                <Stat testid="lat-gfs" label="GFS analysis" value={`~${n.gfs_min[0]} min`} sub="age varies with the 6 h cycle (quoted below)" />
                            </div>
                            <p className="text-[11px] font-black uppercase text-slate-500 mb-1">INSAT via the MOSDAC API (measured, search only)</p>
                            <div className="grid grid-cols-3 gap-2 mb-2">
                                <Stat testid="lat-3dr" label="INSAT-3DR" value={`${n.insat_3dr_min[0]} min`} sub={`every ${n.insat_cadence_min[0]} min, :15/:45`} />
                                <Stat testid="lat-3ds" label="INSAT-3DS" value={`${n.insat_3ds_min[0]} min`} sub={`every ${n.insat_cadence_min[0]} min, :00/:30`} />
                                <Stat testid="lat-combined" label="3DR + 3DS" value={`${n.insat_combined_min[0]} min`} sub="effective refresh" />
                            </div>
                            <div data-testid="latency-arithmetic" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2.5 text-xs space-y-0.5 mb-2">
                                <p>A {lat.lead_h} h lead on IMERG Early data {lat.imerg_early_age_h} h old (our first live poll) ≈ <b>{lat.real_warning_imerg_h} h</b> of real warning;
                                    at the ~{lat.imerg_early_typical_h} h typical latency LIVE_PIPELINE.md also notes ≈ <b>{lat.real_warning_imerg_typical_h} h</b>.</p>
                                <p>On ~{lat.insat_age_h} h-old INSAT data ≈ <b>{lat.real_warning_insat_h} h</b>.</p>
                            </div>
                            {a.insat_latency && (
                                <p data-testid="approach-insat-latency" className="text-xs mb-2">
                                    <span className="font-black">INSAT latency (measured): </span>{a.insat_latency.text}{' '}
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Latency = {a.insat_latency.definition}. Source: {a.insat_latency.source}.</span>
                                </p>
                            )}
                            {a.compute && (
                                <p data-testid="approach-compute-latency" className="text-xs mb-2">
                                    <span className="font-black">Our compute time (measured): </span>{a.compute.text}{' '}
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Source: {a.compute.method}.</span>
                                </p>
                            )}
                            <p className="text-[11px] font-black uppercase text-slate-500 mb-1">What INSAT access unlocks</p>
                            <ul className="text-xs space-y-0.5 mb-2 list-disc ml-4">
                                <li>Cloud-top temperature drop rate: convection seen before it rains hard.</li>
                                <li>About {lat.insat_age_h} h data latency instead of IMERG Early&apos;s {lat.imerg_early_label}.</li>
                                <li>Retraining on live-available inputs. The live system claims no validated skill until that is done.</li>
                            </ul>
                            <div className="space-y-1">{[...a.live.insat, ...a.live.unlocks, ...a.live.current].map((q) => <Quote key={q.id} q={q} />)}</div>
                        </Card>
                    </div>
                </div>
            )}
        </PageShell>
    );
};

export default NowcastApproach;
