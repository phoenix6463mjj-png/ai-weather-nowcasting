// Dashboard ("/") helpers: the page's rule-based risk indicator (NOT the ML model; see /nowcast for that).
// The backend gives each zone a risk level (LOW / MODERATE / HIGH) from fixed weather rules, plus
// per-hazard rule scores. The page shows levels only, never a percentage.

export const RISK_COLOURS = { HIGH: '#ef4444', MODERATE: '#f59e0b', LOW: '#10b981' };
export const RISK_ORDER = { LOW: 0, MODERATE: 1, HIGH: 2 };
export const LEVEL_NAMES = ['Low', 'Moderate', 'High'];
export const RULE_LABEL = 'rule-based indicator (not the ML model)';
export const NO_EXPLANATION = 'No explanation available';

export const HAZARDS = [
    { key: 'thunderstorm', name: 'Thunderstorm', layer: 'thunderstorm' },
    { key: 'cloudburst', name: 'Cloudburst', layer: 'cloudburst' },
    { key: 'flood', name: 'Flash Flood', layer: 'flood' },
];

export const riskColour = (risk) => RISK_COLOURS[risk] || '#6b7280';

export function riskText(loc) {
    const r = String(loc?.risk || loc?.prediction?.risk_text || loc?.prediction?.risk_level || 'LOW').toUpperCase();
    return r in RISK_ORDER ? r : 'LOW';
}

function scores(loc) {
    const p = loc?.prediction || {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
    return {
        thunderstorm: num(p.prob_thunderstorm ?? p.thunderstorm),
        cloudburst: num(p.prob_cloudburst ?? p.cloudburst),
        flood: num(p.prob_flood ?? p.flood),
    };
}

// Per-hazard level from the backend's rule score, using the page's former bar cut-offs (>= 0.70 high,
// >= 0.40 moderate), and never above the zone's overall risk level.
export function hazardLevels(loc) {
    const s = scores(loc);
    const cap = RISK_ORDER[riskText(loc)];
    const lv = (v) => Math.min(v >= 0.7 ? 2 : v >= 0.4 ? 1 : 0, cap);
    return Object.fromEntries(HAZARDS.map((h) => [h.key, lv(s[h.key])]));
}

// The hazard with the highest rule score, only when the zone's risk is MODERATE or HIGH (so it always
// agrees with the risk level); null = no primary threat.
export function primaryThreat(loc) {
    if (riskText(loc) === 'LOW') return null;
    const s = scores(loc);
    if (s.flood >= s.thunderstorm && s.flood >= s.cloudburst) return 'flood';
    if (s.cloudburst >= s.thunderstorm) return 'cloudburst';
    return 'thunderstorm';
}

// Explanation text: never a "stable" sentence on a MODERATE / HIGH zone; none -> NO_EXPLANATION.
export function explanationText(loc) {
    const e = loc?.prediction?.explanation || loc?.explanation;
    if (!e) return NO_EXPLANATION;
    if (riskText(loc) !== 'LOW' && /stable|normal atmospheric/i.test(e)) return NO_EXPLANATION;
    return e;
}

const hhmmUtc = (iso) => `${iso.slice(11, 16)} UTC`;

// Weather source badge text for the page ("sample" = deterministic sample values, not observations).
export function sourceBadge(source, observedAt) {
    if (source === 'openweather') return observedAt ? `OpenWeather, observed ${hhmmUtc(observedAt)}` : 'OpenWeather';
    if (source === 'mixed') return 'Mixed: some zones use sample data (no live weather feed)';
    return 'Sample data — no live weather feed';
}
