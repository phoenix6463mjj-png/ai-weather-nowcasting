// Presentation of lgbm_v0 hazard values. The numbers and their wording come from the
// serving API's `display` block (serve/labels.py); this file only styles them and guards
// against a non-probability ever being shown as a percentage.
//   thunderstorm -> calibrated PROBABILITY of >=30 mm/hr (%)
//   cloudburst   -> RISK INDEX (0-1), not a probability, never %
//   flash_flood  -> RISK RATIO (basin forecast rain / threshold), never %

export const HAZARDS = ['thunderstorm', 'cloudburst', 'flash_flood'];

export const HAZARD_STYLE = {
    thunderstorm: { name: 'Thunderstorm', color: '#f97316', kindLabel: 'probability' },
    cloudburst: { name: 'Cloudburst', color: '#db2777', kindLabel: 'risk index' },
    flash_flood: { name: 'Flash flood', color: '#0f766e', kindLabel: 'risk ratio' },
};

export const LEVEL_STYLE = {
    Warning: { fillOpacity: 0.38, weight: 2.5, dashArray: null, badge: 'bg-red-600 text-white' },
    Watch: { fillOpacity: 0.1, weight: 1.5, dashArray: '5 4', badge: 'bg-amber-400 text-slate-900' },
};

// Indicative mapping to IMD colour codes, shown as a small chip next to every Watch/Warning.
// This is our own mapping onto the familiar scheme, not an IMD product.
export const IMD_NOTE = 'Indicative mapping to IMD colour codes; not an official IMD warning.';
export const IMD_STYLE = {
    Warning: { color: '#dc2626', name: 'red' },
    Watch: { color: '#f59e0b', name: 'orange' },
};

export const VERIFY_STYLE = {
    verified: { color: '#16a34a', label: 'verified', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    false_alarm: { color: '#6b7280', label: 'not verified (false alarm)', badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
    unavailable: { color: '#9ca3af', label: 'not verifiable', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

export function valueText(alert) {
    const d = alert?.display;
    if (!d) return '';
    if (d.kind !== 'probability' && d.value_text.includes('%')) {
        // must never happen: the API only uses % for probabilities
        console.error('Refusing to show a non-probability as a percentage', alert.alert_id);
        return `${d.kind === 'risk_index' ? 'index' : 'ratio'} ${Number(d.value).toFixed(2)}`;
    }
    return d.value_text;
}

export function kindText(alert) {
    return alert?.display?.unit_text || '';
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtUtc(iso, withIst = true) {
    if (!iso) return '';
    const d = new Date(iso);
    const utc = `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
    if (!withIst) return utc;
    const ist = new Date(d.getTime() + 330 * 60000);
    return `${utc} (${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST)`;
}

export function fmtIssueShort(iso) {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

// GADM level-1 names come without spaces ("HimachalPradesh", "JammuandKashmir"); display only.
export function stateName(s) {
    return s ? s.replace(/([a-z])and([A-Z])/g, '$1 and $2').replace(/([a-z])([A-Z])/g, '$1 $2') : s;
}

// Lead with the most Warnings (ties -> shorter lead); if none, the lead with the most alerts.
export function defaultLead(alerts, leads) {
    const score = (L, lvl) => alerts.filter((a) => a.lead_time_h === L && (!lvl || a.level === lvl)).length;
    const byWarn = [...leads].sort((a, b) => score(b, 'Warning') - score(a, 'Warning') || a - b);
    if (byWarn.length && score(byWarn[0], 'Warning') > 0) return byWarn[0];
    return [...leads].sort((a, b) => score(b) - score(a) || a - b)[0] ?? leads[0];
}

// Showcase hazard per demo issue: used only when an issue has no observed >=30 mm/hr cells.
export const SHOWCASE_HAZARD = {
    'REF045/20230813T1500Z': 'thunderstorm',
    'REF045/20230813T2100Z': 'cloudburst',
    'REF045/20230812T2100Z': 'flash_flood',
};

// Replay issues: the lead with the most observed >=30 mm/hr cells (ties -> shorter lead);
// if no lead has any, the lead with the most Warnings of the issue's showcase hazard;
// otherwise the generic defaultLead above.
export function issueDefaultLead(meta, alerts, ep, ts) {
    const leads = meta.leads_available;
    const obs = (L) => meta.per_lead[String(L)]?.observed_cells_ge30_in_patch || 0;
    const byObs = [...leads].sort((a, b) => obs(b) - obs(a) || a - b);
    if (byObs.length && obs(byObs[0]) > 0) return byObs[0];
    const hz = SHOWCASE_HAZARD[`${ep}/${ts}`];
    if (hz) {
        const warn = (L) => alerts.filter((a) => a.lead_time_h === L && a.level === 'Warning' && a.hazard === hz).length;
        const byWarn = [...leads].sort((a, b) => warn(b) - warn(a) || a - b);
        if (warn(byWarn[0]) > 0) return byWarn[0];
    }
    return defaultLead(alerts, leads);
}

// Shown wherever flash-flood verified / false-alarm status appears.
export const FF_VERIFY_NOTE = 'FF verification uses a rain-rate proxy (≥30 mm/hr observed), not basin accumulation.';

// Forecast raster layers offered in the map controls (legends come from the API).
export const FIELD_OPTIONS = [
    { id: '', label: 'None' },
    { id: 'thunderstorm', label: 'Thunderstorm probability (≥30 mm/hr)' },
    { id: 'cloudburst_index', label: 'Cloudburst risk index (not a probability)' },
    { id: 'flash_flood', label: 'Flash-flood risk ratio (Watch/Warning)' },
    { id: 'rain_p10', label: 'Rain probability ≥10 mm/hr' },
    { id: 'rain_p1', label: 'Rain probability ≥1 mm/hr' },
];
