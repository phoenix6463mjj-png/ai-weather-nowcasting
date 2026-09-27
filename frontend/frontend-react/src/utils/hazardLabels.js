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
