// Analytics page (ML model): pure functions over the ML API's alerts. Every number shown comes from these,
// and the e2e test recomputes them from the same API responses.
export const LEADS = [1, 2, 3, 4, 6];
export const HAZARD_IDS = ['thunderstorm', 'cloudburst', 'flash_flood'];
export const LEVELS = ['Watch', 'Warning'];
const HZ_WORD = { thunderstorm: 'thunderstorm', cloudburst: 'cloudburst', flash_flood: 'flash-flood' };

export const fmtArea = (km2) => Math.round(km2 / 100) * 100;
export const fmtAreaText = (km2) => fmtArea(km2).toLocaleString('en-US');
const levelWord = (level, n) => (level === 'Watch' ? (n === 1 ? 'Watch' : 'Watches') : (n === 1 ? 'Warning' : 'Warnings'));

export function selectAlerts(alerts, lead, hazards, levels) {
    return alerts.filter((a) => a.lead_time_h === lead && hazards.includes(a.hazard) && levels.includes(a.level));
}

// per hazard at one lead: Watch / Warning counts and total area (selected levels only)
export function tileStats(alerts, lead, hazards, levels) {
    const out = {};
    for (const h of HAZARD_IDS) {
        const sel = alerts.filter((a) => a.lead_time_h === lead && a.hazard === h && levels.includes(a.level));
        out[h] = {
            selected: hazards.includes(h),
            watch: sel.filter((a) => a.level === 'Watch').length,
            warning: sel.filter((a) => a.level === 'Warning').length,
            n: sel.length,
            area: sel.reduce((s, a) => s + (a.area_km2 || 0), 0),
        };
    }
    return out;
}

export function areaByLead(alerts, hazards, levels, leads = LEADS) {
    return leads.map((L) => {
        const by = {};
        for (const h of hazards) by[h] = alerts.filter((a) => a.lead_time_h === L && a.hazard === h && levels.includes(a.level))
            .reduce((s, a) => ({ area: s.area + (a.area_km2 || 0), n: s.n + 1 }), { area: 0, n: 0 });
        return { lead: L, byHazard: by, total: Object.values(by).reduce((s, x) => s + x.area, 0) };
    });
}

// "At +4 h the model has 2 cloudburst Warnings covering 4,400 km²."
export function sentenceWarning(stats, lead, hazards, levels) {
    const sel = hazards.filter((h) => stats[h].n > 0);
    if (!sel.length) {
        const lv = levels.length === 2 ? 'alerts' : levelWord(levels[0], 2);
        return `At +${lead} h the model has no ${lv} for the selected hazards.`;
    }
    const top = [...sel].sort((a, b) => stats[b].area - stats[a].area)[0];
    const s = stats[top];
    const parts = [];
    if (s.warning) parts.push(`${s.warning} ${HZ_WORD[top]} ${levelWord('Warning', s.warning)}`);
    if (s.watch) parts.push(`${s.watch} ${HZ_WORD[top]} ${levelWord('Watch', s.watch)}`);
    let text = `At +${lead} h the model has ${parts.join(' and ')} covering ${fmtAreaText(s.area)} km²`;
    const others = sel.filter((h) => h !== top).reduce((n, h) => n + stats[h].n, 0);
    if (others) text += `, and ${others} other alert${others === 1 ? '' : 's'}`;
    return `${text}.`;
}

// "Alert area is largest at +4 h (12,300 km²) and smallest at +1 h (900 km²)."
export function sentenceLeads(rows) {
    const any = rows.filter((r) => r.total > 0);
    if (!any.length) return 'The selection has no alerts at any lead.';
    const max = rows.reduce((m, r) => (r.total > m.total ? r : m), rows[0]);
    const min = rows.reduce((m, r) => (r.total < m.total ? r : m), rows[0]);
    if (max.lead === min.lead || max.total === min.total) return `Alert area is the same at every lead (${fmtAreaText(max.total)} km²).`;
    return `Alert area is largest at +${max.lead} h (${fmtAreaText(max.total)} km²) and smallest at +${min.lead} h (${fmtAreaText(min.total)} km²).`;
}
